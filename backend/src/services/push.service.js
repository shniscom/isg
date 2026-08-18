const webpush = require('web-push');
const { eq } = require('drizzle-orm');
const { db } = require('../db/client');
const { pushSubscriptions } = require('../db/schema');

let configured = false;

function ensureConfigured() {
  if (configured) return true;
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return false;
  webpush.setVapidDetails(VAPID_SUBJECT || 'mailto:destek@isg.shnai.cloud', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  configured = true;
  return true;
}

/**
 * Bir kullanıcının kayıtlı tüm push aboneliklerine bildirim gönderir. VAPID anahtarları
 * tanımlı değilse (yerel geliştirme / henüz kurulmamış ortam) sessizce hiçbir şey yapmaz.
 * Süresi dolmuş/iptal edilmiş abonelikler (410/404) otomatik olarak silinir.
 */
async function sendPushToUser(userId, { title, message, url }) {
  if (!ensureConfigured()) return;

  const subs = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
  if (subs.length === 0) return;

  const payload = JSON.stringify({ title, body: message, url: url || '/' });

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload
        );
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) {
          await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id));
        } else {
          console.error('[push] Bildirim gönderilemedi:', err.message);
        }
      }
    })
  );
}

async function sendPushToUsers(userIds, payload) {
  if (!userIds || userIds.length === 0) return;
  await Promise.all(userIds.map((userId) => sendPushToUser(userId, payload)));
}

module.exports = { sendPushToUser, sendPushToUsers, ensureConfigured };
