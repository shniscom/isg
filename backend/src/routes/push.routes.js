const express = require('express');
const { z } = require('zod');
const { eq, and } = require('drizzle-orm');
const { db } = require('../db/client');
const { pushSubscriptions } = require('../db/schema');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../utils/asyncHandler');

const router = express.Router();
router.use(requireAuth);

const subscribeSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

/** VAPID public key'i istemciye verir; frontend pushManager.subscribe() için buna ihtiyaç duyar. */
router.get('/vapid-public-key', asyncHandler(async (req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY || null });
}));

/** Tarayıcıdan alınan push subscription'ı kaydeder/günceller (aynı endpoint tekrar gelirse üzerine yazar). */
router.post('/subscribe', asyncHandler(async (req, res) => {
  const { endpoint, keys } = subscribeSchema.parse(req.body);
  const userId = req.user.sub;
  await db
    .insert(pushSubscriptions)
    .values({ userId, endpoint, p256dh: keys.p256dh, auth: keys.auth })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: { userId, p256dh: keys.p256dh, auth: keys.auth },
    });
  res.json({ ok: true });
}));

/** Kullanıcı bildirimleri kapattığında ilgili subscription'ı siler. */
router.post('/unsubscribe', asyncHandler(async (req, res) => {
  const { endpoint } = z.object({ endpoint: z.string().url() }).parse(req.body);
  await db
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.endpoint, endpoint), eq(pushSubscriptions.userId, req.user.sub)));
  res.json({ ok: true });
}));

module.exports = router;
