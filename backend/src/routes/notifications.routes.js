const express = require('express');
const { eq, and, desc, count } = require('drizzle-orm');
const { db } = require('../db/client');
const { notifications } = require('../db/schema');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../utils/asyncHandler');
const { ApiError } = require('../utils/apiError');

const router = express.Router();
router.use(requireAuth);

// ---------------------------------------------------------------------------
// Bildirim listesi (en yeni önce). ?unread=true ile yalnızca okunmamışlar.
// ---------------------------------------------------------------------------
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const conditions = [eq(notifications.userId, req.user.sub)];
    if (req.query.unread === 'true') conditions.push(eq(notifications.isRead, false));

    const rows = await db
      .select()
      .from(notifications)
      .where(and(...conditions))
      .orderBy(desc(notifications.createdAt))
      .limit(50);

    res.json({ notifications: rows });
  })
);

// ---------------------------------------------------------------------------
// Okunmamış bildirim sayısı (header'daki zil rozeti için)
// ---------------------------------------------------------------------------
router.get(
  '/unread-count',
  asyncHandler(async (req, res) => {
    const [row] = await db
      .select({ value: count() })
      .from(notifications)
      .where(and(eq(notifications.userId, req.user.sub), eq(notifications.isRead, false)));

    res.json({ count: row?.value || 0 });
  })
);

router.post(
  '/:id/read',
  asyncHandler(async (req, res) => {
    const [updated] = await db
      .update(notifications)
      .set({ isRead: true })
      .where(and(eq(notifications.id, req.params.id), eq(notifications.userId, req.user.sub)))
      .returning();
    if (!updated) throw ApiError.notFound('Bildirim bulunamadı.');
    res.json({ notification: updated });
  })
);

router.post(
  '/read-all',
  asyncHandler(async (req, res) => {
    await db
      .update(notifications)
      .set({ isRead: true })
      .where(and(eq(notifications.userId, req.user.sub), eq(notifications.isRead, false)));
    res.json({ success: true });
  })
);

module.exports = router;
