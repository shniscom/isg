const { db } = require('../db/client');
const { notifications } = require('../db/schema');
const { sendPushToUser, sendPushToUsers } = require('./push.service');

function notificationUrl(nonconformityId) {
  return nonconformityId ? `/uygunsuzluklar/${nonconformityId}` : '/';
}

/**
 * Kullanıcıya uygulama içi bildirim oluşturur. `tx` verilirse aynı transaction içinde çalışır
 * (ör. uygunsuzluk oluşturma/atama işlemiyle birlikte atomik olarak kaydedilir).
 * Ayrıca (VAPID yapılandırılmışsa) tarayıcı push bildirimi de tetiklenir; push gönderimi
 * ana işlemi bloklamaz/başarısız etmez (fire-and-forget).
 */
async function createNotification(tx, { userId, nonconformityId, title, message }) {
  const executor = tx || db;
  await executor.insert(notifications).values({
    userId,
    nonconformityId: nonconformityId || null,
    title,
    message,
  });
  sendPushToUser(userId, { title, message, url: notificationUrl(nonconformityId) }).catch(() => {});
}

/** Birden fazla kullanıcıya aynı bildirimi gönderir (ör. tüm atananlara). */
async function createNotifications(tx, { userIds, nonconformityId, title, message }) {
  if (!userIds || userIds.length === 0) return;
  const executor = tx || db;
  await executor.insert(notifications).values(
    userIds.map((userId) => ({
      userId,
      nonconformityId: nonconformityId || null,
      title,
      message,
    }))
  );
  sendPushToUsers(userIds, { title, message, url: notificationUrl(nonconformityId) }).catch(() => {});
}

module.exports = { createNotification, createNotifications };
