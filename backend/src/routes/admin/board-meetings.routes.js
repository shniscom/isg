const express = require('express');
const { z } = require('zod');
const { eq, desc } = require('drizzle-orm');
const { db } = require('../../db/client');
const { boardMeetings, companies } = require('../../db/schema');
const { requirePermission } = require('../../middleware/permission');
const { asyncHandler } = require('../../utils/asyncHandler');
const { ApiError } = require('../../utils/apiError');
const { logAudit } = require('../../utils/audit');
const { createViewUrl } = require('../../services/storage.service');
const { computeBoardStatus } = require('../../services/board-meeting.service');

const router = express.Router();
router.use(requirePermission('firma_yonetme'));

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

const createSchema = z.object({
  companyId: z.string().min(1),
  meetingDate: z.string().min(1, 'Toplantı tarihi zorunludur.'),
  periodLabel: z.string().regex(PERIOD_RE, "Geçersiz dönem. Format: YYYY-MM."),
  isExtraordinary: z.boolean().optional().default(false),
  attendanceFormFileKey: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { companyId } = req.query;
    if (!companyId) throw ApiError.badRequest('companyId zorunludur.');

    const [company] = await db.select().from(companies).where(eq(companies.id, companyId)).limit(1);
    if (!company) throw ApiError.notFound('Firma bulunamadı.');

    const rows = await db.select().from(boardMeetings).where(eq(boardMeetings.companyId, companyId)).orderBy(desc(boardMeetings.meetingDate));
    const withUrls = await Promise.all(
      rows.map(async (m) => ({ ...m, attendanceFormViewUrl: m.attendanceFormFileKey ? await createViewUrl(m.attendanceFormFileKey).catch(() => null) : null }))
    );
    const boardStatus = computeBoardStatus(company.dangerClass, rows);
    res.json({ meetings: withUrls, boardStatus });
  })
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('Geçersiz toplantı bilgisi.', parsed.error.flatten());
    const data = parsed.data;

    const [company] = await db.select().from(companies).where(eq(companies.id, data.companyId)).limit(1);
    if (!company) throw ApiError.notFound('Firma bulunamadı.');

    // Aynı dönem için birden fazla NORMAL (olağanüstü olmayan) toplantı girilmesini engelle;
    // olağanüstü toplantılar aynı dönemde sınırsız eklenebilir.
    if (!data.isExtraordinary) {
      const existing = await db
        .select()
        .from(boardMeetings)
        .where(eq(boardMeetings.companyId, data.companyId));
      const duplicate = existing.find((m) => !m.isExtraordinary && m.periodLabel === data.periodLabel);
      if (duplicate) {
        throw ApiError.conflict('Bu dönem için zaten bir normal kurul toplantısı kaydedilmiş.');
      }
    }

    const [created] = await db
      .insert(boardMeetings)
      .values({
        companyId: data.companyId,
        meetingDate: new Date(data.meetingDate),
        periodLabel: data.periodLabel,
        isExtraordinary: data.isExtraordinary ?? false,
        attendanceFormFileKey: data.attendanceFormFileKey || null,
        notes: data.notes || null,
        createdById: req.user.sub,
      })
      .returning();

    await logAudit({ userId: req.user.sub, action: 'BOARD_MEETING_CREATE', entityType: 'board_meeting', entityId: created.id, details: data, ipAddress: req.ip });
    res.status(201).json({ meeting: created });
  })
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const [deleted] = await db.delete(boardMeetings).where(eq(boardMeetings.id, req.params.id)).returning();
    if (!deleted) throw ApiError.notFound('Kayıt bulunamadı.');
    await logAudit({ userId: req.user.sub, action: 'BOARD_MEETING_DELETE', entityType: 'board_meeting', entityId: deleted.id, ipAddress: req.ip });
    res.json({ success: true });
  })
);

module.exports = router;
