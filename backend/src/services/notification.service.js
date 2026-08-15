const { db } = require('../db/client');
const { notifications } = require('../db/schema');

/**
 * Kullanıcıya uygulama içi bildirim oluşturur. `tx` verilirse aynı transaction içinde çalışır
 * (ör. uygunsuzluk oluşturma/atama işlemiyle birlikte atomik olarak kaydedilir).
 */
async function createNotification(tx, { userId, nonconformityId, title, message }) {
  const executor = tx || db;
  await executor.insert(notifications).values({
    userId,
    nonconformityId: nonconformityId || null,
    title,
    message,
  });
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
}

module.exports = { createNotification, createNotifications };
