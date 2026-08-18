const express = require('express');
const { z } = require('zod');
const { eq, and, desc, inArray } = require('drizzle-orm');
const { db } = require('../db/client');
const { penalties, nonconformities, employees, users, companies } = require('../db/schema');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permission');
const { asyncHandler } = require('../utils/asyncHandler');
const { ApiError } = require('../utils/apiError');
const { logAudit } = require('../utils/audit');
const { createNotifications } = require('../services/notification.service');
const { loadAssigneeIdsFor } = require('../services/nonconformity.service');

const router = express.Router();
router.use(requireAuth);

/**
 * Ceza listesi. Admin ve 'cezai_islem' yetkisi olanlar görebilir. ?status= ile filtrelenebilir
 * (BEKLEMEDE / ONAYLANDI / REDDEDILDI). ?projectId= sistem admini için zorunludur.
 */
router.get(
  '/',
  requirePermission('cezai_islem'),
  asyncHandler(async (req, res) => {
    let projectId = req.query.projectId;
    if (!req.user.isSystemAdmin) projectId = req.user.projectId;
    if (!projectId) throw ApiError.badRequest('projectId parametresi zorunludur.');

    const conditions = [eq(nonconformities.projectId, projectId)];
    if (req.query.status) conditions.push(eq(penalties.status, req.query.status));

    const rows = await db
      .select({
        id: penalties.id,
        status: penalties.status,
        sanctionType: penalties.sanctionType,
        suggestedAmount: penalties.suggestedAmount,
        reason: penalties.reason,
        requestedAt: penalties.requestedAt,
        decidedAt: penalties.decidedAt,
        decisionNote: penalties.decisionNote,
        nonconformityId: nonconformities.id,
        nonconformityNumber: nonconformities.number,
        employeeId: employees.id,
        employeeName: employees.fullName,
        employeeCompanyName: companies.name,
        requestedById: penalties.requestedById,
        decidedById: penalties.decidedById,
      })
      .from(penalties)
      .innerJoin(nonconformities, eq(penalties.nonconformityId, nonconformities.id))
      .leftJoin(employees, eq(penalties.employeeId, employees.id))
      .leftJoin(companies, eq(employees.companyId, companies.id))
      .where(and(...conditions))
      .orderBy(desc(penalties.requestedAt));

    const userIds = [...new Set(rows.flatMap((r) => [r.requestedById, r.decidedById]).filter(Boolean))];
    const userRows = userIds.length
      ? await db.select({ id: users.id, fullName: users.fullName }).from(users).where(inArray(users.id, userIds))
      : [];
    const userNameById = new Map(userRows.map((u) => [u.id, u.fullName]));

    const result = rows.map((r) => ({
      ...r,
      requestedByName: userNameById.get(r.requestedById) || null,
      decidedByName: userNameById.get(r.decidedById) || null,
    }));

    res.json({ penalties: result });
  })
);

async function loadPenaltyWithNc(id) {
  const [row] = await db
    .select({ penalty: penalties, nonconformity: nonconformities })
    .from(penalties)
    .innerJoin(nonconformities, eq(penalties.nonconformityId, nonconformities.id))
    .where(eq(penalties.id, id))
    .limit(1);
  return row;
}

router.post(
  '/:id/approve',
  requirePermission('cezai_islem'),
  asyncHandler(async (req, res) => {
    const row = await loadPenaltyWithNc(req.params.id);
    if (!row) throw ApiError.notFound('Ceza talebi bulunamadı.');
    const { penalty, nonconformity: nc } = row;
    if (!req.user.isSystemAdmin && nc.projectId !== req.user.projectId) throw ApiError.forbidden();
    if (penalty.status !== 'BEKLEMEDE') throw ApiError.conflict('Bu talep zaten karara bağlanmış.');

    const schema = z.object({ decisionNote: z.string().optional().nullable() });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('Geçersiz istek.');

    await db
      .update(penalties)
      .set({ status: 'ONAYLANDI', decidedById: req.user.sub, decidedAt: new Date(), decisionNote: parsed.data.decisionNote || null })
      .where(eq(penalties.id, penalty.id));

    const assigneeIds = await loadAssigneeIdsFor(nc.id);
    await createNotifications(null, {
      userIds: [...new Set([nc.openedById, ...assigneeIds])],
      nonconformityId: nc.id,
      title: 'Ceza talebi onaylandı',
      message: `${nc.number} numaralı uygunsuzluk için cezai işlem talebi onaylandı.`,
    });

    await logAudit({ userId: req.user.sub, action: 'PENALTY_APPROVE', entityType: 'penalty', entityId: penalty.id, ipAddress: req.ip });
    res.json({ success: true });
  })
);

router.post(
  '/:id/reject',
  requirePermission('cezai_islem'),
  asyncHandler(async (req, res) => {
    const row = await loadPenaltyWithNc(req.params.id);
    if (!row) throw ApiError.notFound('Ceza talebi bulunamadı.');
    const { penalty, nonconformity: nc } = row;
    if (!req.user.isSystemAdmin && nc.projectId !== req.user.projectId) throw ApiError.forbidden();
    if (penalty.status !== 'BEKLEMEDE') throw ApiError.conflict('Bu talep zaten karara bağlanmış.');

    const schema = z.object({ decisionNote: z.string().min(3, 'Red gerekçesi zorunludur.') });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('Red gerekçesi zorunludur.', parsed.error.flatten());

    await db
      .update(penalties)
      .set({ status: 'REDDEDILDI', decidedById: req.user.sub, decidedAt: new Date(), decisionNote: parsed.data.decisionNote })
      .where(eq(penalties.id, penalty.id));

    await logAudit({ userId: req.user.sub, action: 'PENALTY_REJECT', entityType: 'penalty', entityId: penalty.id, ipAddress: req.ip });
    res.json({ success: true });
  })
);

module.exports = router;
