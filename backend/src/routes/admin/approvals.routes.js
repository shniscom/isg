// Kritik/geri dönülmez işlemler için admin onay kuyruğu (bkz. utils/approval.js,
// services/criticalActions.service.js). Yalnızca sistem admini erişebilir: bekleyen istekleri
// listeler, onaylar (gerçek işlemi tetikler) veya reddeder (yalnızca kaydı REDDEDILDI yapar,
// hiçbir şey uygulamaz).
const express = require('express');
const { z } = require('zod');
const { eq, desc, and, inArray } = require('drizzle-orm');
const { db } = require('../../db/client');
const { pendingApprovals, users, projects } = require('../../db/schema');
const { asyncHandler } = require('../../utils/asyncHandler');
const { ApiError } = require('../../utils/apiError');
const { requireSystemAdmin } = require('../../middleware/permission');
const { logAudit } = require('../../utils/audit');
const { EXECUTORS } = require('../../services/criticalActions.service');

const router = express.Router();
router.use(requireSystemAdmin);

const STATUSES = ['BEKLEMEDE', 'ONAYLANDI', 'REDDEDILDI'];

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { status, projectId } = req.query;
    const conditions = [];
    if (status) {
      if (!STATUSES.includes(status)) throw ApiError.badRequest('Geçersiz durum.');
      conditions.push(eq(pendingApprovals.status, status));
    }
    if (projectId) conditions.push(eq(pendingApprovals.projectId, projectId));

    const rows = await db
      .select({
        id: pendingApprovals.id,
        actionType: pendingApprovals.actionType,
        entityType: pendingApprovals.entityType,
        entityId: pendingApprovals.entityId,
        payload: pendingApprovals.payload,
        summary: pendingApprovals.summary,
        status: pendingApprovals.status,
        projectId: pendingApprovals.projectId,
        projectName: projects.name,
        requestedById: pendingApprovals.requestedById,
        requestedByName: users.fullName,
        requestedAt: pendingApprovals.requestedAt,
        decidedById: pendingApprovals.decidedById,
        decidedAt: pendingApprovals.decidedAt,
        decisionNote: pendingApprovals.decisionNote,
      })
      .from(pendingApprovals)
      .innerJoin(users, eq(pendingApprovals.requestedById, users.id))
      .leftJoin(projects, eq(pendingApprovals.projectId, projects.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(pendingApprovals.requestedAt));

    // decidedByName ayrı bir sorgu ile eklenir (decidedById nullable olduğu için LEFT JOIN
    // yerine basitlik adına ikinci bir küçük sorgu tercih edildi - liste çoğunlukla küçük olur).
    const deciderIds = [...new Set(rows.map((r) => r.decidedById).filter(Boolean))];
    let deciderNames = {};
    if (deciderIds.length > 0) {
      const deciders = await db.select({ id: users.id, fullName: users.fullName }).from(users).where(inArray(users.id, deciderIds));
      deciderNames = Object.fromEntries(deciders.map((d) => [d.id, d.fullName]));
    }

    res.json({ approvals: rows.map((r) => ({ ...r, decidedByName: r.decidedById ? deciderNames[r.decidedById] || null : null })) });
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const [row] = await db.select().from(pendingApprovals).where(eq(pendingApprovals.id, req.params.id)).limit(1);
    if (!row) throw ApiError.notFound('Onay kaydı bulunamadı.');
    res.json({ approval: row });
  })
);

router.post(
  '/:id/approve',
  asyncHandler(async (req, res) => {
    const [approval] = await db.select().from(pendingApprovals).where(eq(pendingApprovals.id, req.params.id)).limit(1);
    if (!approval) throw ApiError.notFound('Onay kaydı bulunamadı.');
    if (approval.status !== 'BEKLEMEDE') throw ApiError.conflict('Bu talep zaten karara bağlanmış.');

    const executor = EXECUTORS[approval.actionType];
    if (!executor) throw ApiError.badRequest(`Bilinmeyen işlem tipi: ${approval.actionType}`);

    const schema = z.object({ decisionNote: z.string().optional().nullable() });
    const parsed = schema.safeParse(req.body || {});
    if (!parsed.success) throw ApiError.badRequest('Geçersiz istek.');

    // Asıl işlem, talebi oluşturan kişi adına uygulanır (actorId = requestedById) - admin'in
    // ONAY KARARI ayrı bir audit satırı olarak (APPROVAL_GRANT) aşağıda loglanır.
    let result;
    try {
      result = await executor(approval.payload, approval.requestedById);
    } catch (err) {
      const statusCode = err.statusCode || 500;
      throw new ApiError(statusCode, `İşlem uygulanamadı: ${err.message}`);
    }

    const [updatedApproval] = await db
      .update(pendingApprovals)
      .set({ status: 'ONAYLANDI', decidedById: req.user.sub, decidedAt: new Date(), decisionNote: parsed.data.decisionNote || null })
      .where(eq(pendingApprovals.id, approval.id))
      .returning();

    await logAudit({
      userId: req.user.sub,
      action: 'APPROVAL_GRANT',
      entityType: 'pending_approval',
      entityId: approval.id,
      details: { actionType: approval.actionType, entityType: approval.entityType, entityId: approval.entityId },
      ipAddress: req.ip,
    });

    res.json({ approval: updatedApproval, result });
  })
);

router.post(
  '/:id/reject',
  asyncHandler(async (req, res) => {
    const [approval] = await db.select().from(pendingApprovals).where(eq(pendingApprovals.id, req.params.id)).limit(1);
    if (!approval) throw ApiError.notFound('Onay kaydı bulunamadı.');
    if (approval.status !== 'BEKLEMEDE') throw ApiError.conflict('Bu talep zaten karara bağlanmış.');

    const schema = z.object({ decisionNote: z.string().min(3, 'Red gerekçesi zorunludur.') });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('Red gerekçesi zorunludur.', parsed.error.flatten());

    const [updatedApproval] = await db
      .update(pendingApprovals)
      .set({ status: 'REDDEDILDI', decidedById: req.user.sub, decidedAt: new Date(), decisionNote: parsed.data.decisionNote })
      .where(eq(pendingApprovals.id, approval.id))
      .returning();

    await logAudit({
      userId: req.user.sub,
      action: 'APPROVAL_REJECT',
      entityType: 'pending_approval',
      entityId: approval.id,
      details: { actionType: approval.actionType, decisionNote: parsed.data.decisionNote },
      ipAddress: req.ip,
    });

    res.json({ approval: updatedApproval });
  })
);

module.exports = router;
