const { eq, and, isNull, inArray } = require('drizzle-orm');
const { db } = require('../db/client');
const { nonconformities } = require('../db/schema');
const { createNotifications } = require('./notification.service');
const { loadAssigneeIdsFor } = require('./nonconformity.service');

const CHECK_INTERVAL_MS = 15 * 60 * 1000; // 15 dakikada bir kontrol eder

/**
 * Termin süresinin 2/3'ü dolmuş ama henüz kapatılmamış ve daha önce uyarı gönderilmemiş
 * uygunsuzlukları bulup atanan kişilere bildirim gönderir. Her kayıt için yalnızca bir kez
 * çalışır (deadlineReminderSentAt alanı işaretlenir).
 */
async function checkDeadlineReminders() {
  try {
    const now = new Date();
    const candidates = await db
      .select()
      .from(nonconformities)
      .where(
        and(
          inArray(nonconformities.status, ['ACIK', 'BEKLEMEDE']),
          isNull(nonconformities.deadlineReminderSentAt)
        )
      );

    for (const nc of candidates) {
      const totalMs = new Date(nc.dueDate).getTime() - new Date(nc.createdAt).getTime();
      if (totalMs <= 0) continue;
      const elapsedMs = now.getTime() - new Date(nc.createdAt).getTime();
      if (elapsedMs / totalMs < 2 / 3) continue;

      const assigneeIds = await loadAssigneeIdsFor(nc.id);
      if (assigneeIds.length > 0) {
        await createNotifications(null, {
          userIds: assigneeIds,
          nonconformityId: nc.id,
          title: 'Termin süresi dolmak üzere',
          message: `Tarafınıza atanan ${nc.number} numaralı uygunsuzluğun termin süresi dolmak üzeredir. Cezai yaptırımlarla karşılaşmamak için lütfen uygunsuzluğu kapatın ya da ek termin süresi talep edin.`,
        });
      }

      await db.update(nonconformities).set({ deadlineReminderSentAt: now }).where(eq(nonconformities.id, nc.id));
    }
  } catch (err) {
    console.error('[scheduler] Termin uyarı kontrolü başarısız:', err.message);
  }
}

function startScheduler() {
  checkDeadlineReminders();
  return setInterval(checkDeadlineReminders, CHECK_INTERVAL_MS);
}

module.exports = { startScheduler, checkDeadlineReminders };
