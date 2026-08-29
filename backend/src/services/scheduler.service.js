const { eq, and, isNull, inArray } = require('drizzle-orm');
const { db } = require('../db/client');
const { nonconformities, archives, projects, users, notifications } = require('../db/schema');
const { createNotification, createNotifications } = require('./notification.service');
const { loadAssigneeIdsFor } = require('./nonconformity.service');
const { findNonconformityIdsForPeriod, previousMonthLabel } = require('./archive.service');

const CHECK_INTERVAL_MS = 15 * 60 * 1000; // 15 dakikada bir kontrol eder
const ARCHIVE_REMINDER_TITLE = 'Aylık arşivleme hatırlatması';

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

/**
 * Termin tarihi geçmiş (dolmuş) ve henüz kapatılmamış uygunsuzluklar için: açan kişiye
 * "cezai işlem başlatabilirsiniz", atanan kişi(ler)e "ek süre talep ediniz" bildirimi gönderir.
 * Her kayıt için yalnızca bir kez çalışır (deadlineExpiredNotifiedAt alanı işaretlenir).
 */
async function checkDeadlineExpirations() {
  try {
    const now = new Date();
    const candidates = await db
      .select()
      .from(nonconformities)
      .where(
        and(
          inArray(nonconformities.status, ['ACIK', 'BEKLEMEDE']),
          isNull(nonconformities.deadlineExpiredNotifiedAt)
        )
      );

    for (const nc of candidates) {
      if (new Date(nc.dueDate).getTime() > now.getTime()) continue;

      await createNotification(null, {
        userId: nc.openedById,
        nonconformityId: nc.id,
        title: 'Termin süresi doldu',
        message: `${nc.number} numaralı uygunsuzluğun termin süreniz dolmuştur. Cezai işlem başlatabilirsiniz.`,
      });

      const assigneeIds = await loadAssigneeIdsFor(nc.id);
      if (assigneeIds.length > 0) {
        await createNotifications(null, {
          userIds: assigneeIds,
          nonconformityId: nc.id,
          title: 'Termin süresi doldu',
          message: `${nc.number} numaralı uygunsuzluğun süresi dolmuştur. Ceza almamak için ek süre talep ediniz.`,
        });
      }

      await db.update(nonconformities).set({ deadlineExpiredNotifiedAt: now }).where(eq(nonconformities.id, nc.id));
    }
  } catch (err) {
    console.error('[scheduler] Termin dolum kontrolü başarısız:', err.message);
  }
}

/**
 * Her proje için bir önceki ayın uygunsuzluk kayıtları henüz arşivlenmemişse (data hâlâ
 * sunucuda ve archives tablosunda o proje+dönem için kayıt yoksa), sistem adminlerine bir
 * hatırlatma bildirimi gönderir. Aynı proje+dönem için tekrar tekrar bildirim göndermemek
 * amacıyla, önce o başlık+dönem için zaten bir bildirim gönderilmiş mi kontrol eder.
 */
async function checkArchiveReminders() {
  try {
    const periodLabel = previousMonthLabel();

    const allProjects = await db.select({ id: projects.id, name: projects.name }).from(projects);
    if (allProjects.length === 0) return;

    const admins = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.isSystemAdmin, true), eq(users.isActive, true)));
    if (admins.length === 0) return;

    for (const project of allProjects) {
      const [existingArchive] = await db
        .select()
        .from(archives)
        .where(and(eq(archives.projectId, project.id), eq(archives.periodLabel, periodLabel)))
        .limit(1);
      if (existingArchive) continue; // bu dönem için zaten en az bir kez arşiv üretilmiş

      const ncIds = await findNonconformityIdsForPeriod(project.id, periodLabel);
      if (ncIds.length === 0) continue; // arşivlenecek veri yok, hatırlatma anlamsız

      const reminderMessage = `${project.name} projesinin ${periodLabel} dönemine ait ${ncIds.length} uygunsuzluk kaydı henüz arşivlenmedi. Sunucu yükünü azaltmak için Arşiv sayfasından dışa aktarıp onaylı silme yapabilirsiniz.`;

      // Bu proje+dönem için daha önce hatırlatma gönderilmiş mi? (aynı başlık+mesaj taşıyan
      // bir bildirim varsa tekrar göndermeyiz.)
      const [alreadySent] = await db
        .select({ id: notifications.id })
        .from(notifications)
        .where(and(eq(notifications.title, ARCHIVE_REMINDER_TITLE), eq(notifications.message, reminderMessage)))
        .limit(1);
      if (alreadySent) continue;

      await createNotifications(null, {
        userIds: admins.map((a) => a.id),
        nonconformityId: null,
        title: ARCHIVE_REMINDER_TITLE,
        message: reminderMessage,
      });
    }
  } catch (err) {
    console.error('[scheduler] Arşiv hatırlatma kontrolü başarısız:', err.message);
  }
}

function startScheduler() {
  checkDeadlineReminders();
  checkDeadlineExpirations();
  checkArchiveReminders();
  return setInterval(() => {
    checkDeadlineReminders();
    checkDeadlineExpirations();
    checkArchiveReminders();
  }, CHECK_INTERVAL_MS);
}

module.exports = { startScheduler, checkDeadlineReminders, checkDeadlineExpirations, checkArchiveReminders };
