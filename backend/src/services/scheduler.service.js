const { eq, and, isNull, isNotNull, inArray } = require('drizzle-orm');
const { db } = require('../db/client');
const { nonconformities, archives, projects, users, notifications, employees, companies } = require('../db/schema');
const { createNotification, createNotifications } = require('./notification.service');
const { loadAssigneeIdsFor } = require('./nonconformity.service');
const { findNonconformityIdsForPeriod, previousMonthLabel } = require('./archive.service');

const CHECK_INTERVAL_MS = 15 * 60 * 1000; // 15 dakikada bir kontrol eder
const ARCHIVE_REMINDER_TITLE = 'Aylık arşivleme hatırlatması';
const TEMP_ASSIGNMENT_ENDING_DAYS = 5; // geçici görevlendirme bitiş uyarısı: kaç gün kala
const EXPIRY_REMINDER_DAYS = 7; // eğitim/tetkik/Ek-2 süresi dolma uyarısı: kaç gün kala

/**
 * Tehlike sınıfına göre periyodik sağlık muayenesi (tetkik / Ek-2) geçerlilik süresi (yıl).
 * 6331 sayılı Kanun ve İşyeri Hekimi ve Diğer Sağlık Personelinin Görev, Yetki, Sorumluluk ve
 * Eğitimleri Hakkında Yönetmelik Ek-2 uyarınca: az tehlikeli işyerlerinde en geç 5 yılda, tehlikeli
 * işyerlerinde en geç 3 yılda, çok tehlikeli işyerlerinde en geç yılda bir tekrarlanır. Tehlike
 * sınıfı tanımlı değilse (firma kaydında dangerClass boşsa) süre hesaplanamaz - null döner ve
 * ilgili çalışan için bildirim üretilmez (yanlış/erken uyarı vermemek için).
 */
function healthExamValidityYears(dangerClass) {
  if (dangerClass === 'COK_TEHLIKELI') return 1;
  if (dangerClass === 'TEHLIKELI') return 3;
  if (dangerClass === 'AZ_TEHLIKELI') return 5;
  return null;
}

function addYears(date, years) {
  const d = new Date(date);
  d.setFullYear(d.getFullYear() + years);
  return d;
}

function daysBetween(from, to) {
  return (new Date(to).getTime() - new Date(from).getTime()) / (24 * 60 * 60 * 1000);
}

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

/** Sistem adminlerine (aktif) bildirim gönderir - geçici görevlendirme/süre dolum uyarıları için ortak yardımcı. */
async function notifyAdmins({ title, message }) {
  const admins = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.isSystemAdmin, true), eq(users.isActive, true)));
  if (admins.length === 0) return;
  await createNotifications(null, { userIds: admins.map((a) => a.id), nonconformityId: null, title, message });
}

/**
 * Geçici görevlendirme firmasına bağlı, hâlâ aktif ve görev bitiş tarihine (endDate) en fazla
 * TEMP_ASSIGNMENT_ENDING_DAYS gün kalmış çalışanlar için admine bir kereye mahsus "görev bitiyor"
 * uyarısı gönderir (tempAssignmentEndingReminderSentAt işaretlenir).
 */
async function checkTempAssignmentEndingReminders() {
  try {
    const now = new Date();
    const candidates = await db
      .select({ employee: employees, companyName: companies.name })
      .from(employees)
      .innerJoin(companies, eq(employees.companyId, companies.id))
      .where(
        and(
          eq(companies.isTemporaryAssignment, true),
          eq(employees.isActive, true),
          isNotNull(employees.endDate),
          isNull(employees.tempAssignmentEndingReminderSentAt)
        )
      );

    for (const { employee: emp, companyName } of candidates) {
      const daysLeft = daysBetween(now, emp.endDate);
      if (daysLeft > TEMP_ASSIGNMENT_ENDING_DAYS) continue;

      await notifyAdmins({
        title: 'Geçici görevlendirme bitiyor',
        message: `${emp.fullName} (${companyName}) adlı personelin geçici görev tarihi bitiyor (bitiş: ${new Date(emp.endDate).toLocaleDateString('tr-TR')}). Sahadan çıkışı yapılmadıysa kontrol edin.`,
      });

      await db.update(employees).set({ tempAssignmentEndingReminderSentAt: now }).where(eq(employees.id, emp.id));
    }
  } catch (err) {
    console.error('[scheduler] Geçici görevlendirme bitiş uyarı kontrolü başarısız:', err.message);
  }
}

/**
 * Geçici görevlendirme firmasına bağlı, görev bitiş tarihi (endDate) gelmiş/geçmiş ama hâlâ aktif
 * görünen çalışanları otomatik arşivler (isActive=false, lastExitDate=endDate) ve admine "görev
 * bitti" bildirimi gönderir. isActive=true koşulu sorguda olduğu için doğal olarak tekrar
 * çalışmaz (bir kez arşivlenince bir daha adaylar arasına girmez) - ayrı bir "gönderildi" işareti
 * gerekmez.
 */
async function checkTempAssignmentEndedAndArchive() {
  try {
    const now = new Date();
    const candidates = await db
      .select({ employee: employees, companyName: companies.name })
      .from(employees)
      .innerJoin(companies, eq(employees.companyId, companies.id))
      .where(
        and(
          eq(companies.isTemporaryAssignment, true),
          eq(employees.isActive, true),
          isNotNull(employees.endDate)
        )
      );

    for (const { employee: emp, companyName } of candidates) {
      if (new Date(emp.endDate).getTime() > now.getTime()) continue;

      await db.update(employees).set({ isActive: false, lastExitDate: emp.endDate }).where(eq(employees.id, emp.id));

      await notifyAdmins({
        title: 'Geçici görevlendirme bitti',
        message: `${emp.fullName} (${companyName}) adlı personelin geçici görevlendirmesi bitti (${new Date(emp.endDate).toLocaleDateString('tr-TR')}) ve otomatik olarak arşivlendi.`,
      });
    }
  } catch (err) {
    console.error('[scheduler] Geçici görevlendirme bitiş/arşivleme kontrolü başarısız:', err.message);
  }
}

/**
 * Aktif çalışanların İSG eğitim geçerlilik tarihine (isgTrainingExpiryDate) en fazla
 * EXPIRY_REMINDER_DAYS gün kalmışsa admine bir kereye mahsus uyarı gönderir.
 */
async function checkTrainingExpiryReminders() {
  try {
    const now = new Date();
    const candidates = await db
      .select({ employee: employees, companyName: companies.name })
      .from(employees)
      .leftJoin(companies, eq(employees.companyId, companies.id))
      .where(
        and(
          eq(employees.isActive, true),
          isNotNull(employees.isgTrainingExpiryDate),
          isNull(employees.trainingExpiryReminderSentAt)
        )
      );

    for (const { employee: emp, companyName } of candidates) {
      const daysLeft = daysBetween(now, emp.isgTrainingExpiryDate);
      if (daysLeft > EXPIRY_REMINDER_DAYS) continue;

      await notifyAdmins({
        title: 'İSG eğitim geçerlilik süresi doluyor',
        message: `${emp.fullName}${companyName ? ` (${companyName})` : ''} adlı personelin İSG eğitim sertifikası süresi doluyor (${new Date(emp.isgTrainingExpiryDate).toLocaleDateString('tr-TR')}). Eğitimin yenilenmesi gerekiyor.`,
      });

      await db.update(employees).set({ trainingExpiryReminderSentAt: now }).where(eq(employees.id, emp.id));
    }
  } catch (err) {
    console.error('[scheduler] İSG eğitim süresi uyarı kontrolü başarısız:', err.message);
  }
}

/**
 * Aktif çalışanların tetkik (medicalExamDate) ve Ek-2 (ek2Date) tarihlerinden, bağlı oldukları
 * firmanın tehlike sınıfına göre hesaplanan geçerlilik süresinin dolmasına en fazla
 * EXPIRY_REMINDER_DAYS gün kalmışsa admine bir kereye mahsus uyarı gönderir. Firmanın tehlike
 * sınıfı tanımlı değilse süre hesaplanamayacağından o çalışan atlanır (bkz. healthExamValidityYears).
 */
async function checkHealthExamExpiryReminders() {
  try {
    const now = new Date();
    const rows = await db
      .select({ employee: employees, companyName: companies.name, dangerClass: companies.dangerClass })
      .from(employees)
      .innerJoin(companies, eq(employees.companyId, companies.id))
      .where(eq(employees.isActive, true));

    for (const { employee: emp, companyName, dangerClass } of rows) {
      const validityYears = healthExamValidityYears(dangerClass);
      if (!validityYears) continue;

      if (emp.medicalExamDate && !emp.medicalExamExpiryReminderSentAt) {
        const expiry = addYears(emp.medicalExamDate, validityYears);
        const daysLeft = daysBetween(now, expiry);
        if (daysLeft <= EXPIRY_REMINDER_DAYS) {
          await notifyAdmins({
            title: 'Periyodik tetkik süresi doluyor',
            message: `${emp.fullName} (${companyName}) adlı personelin periyodik sağlık tetkik süresi doluyor (tahmini: ${expiry.toLocaleDateString('tr-TR')}, tehlike sınıfına göre hesaplandı). Yeni tetkik planlanması gerekiyor.`,
          });
          await db.update(employees).set({ medicalExamExpiryReminderSentAt: now }).where(eq(employees.id, emp.id));
        }
      }

      if (emp.ek2Date && !emp.ek2ExpiryReminderSentAt) {
        const expiry = addYears(emp.ek2Date, validityYears);
        const daysLeft = daysBetween(now, expiry);
        if (daysLeft <= EXPIRY_REMINDER_DAYS) {
          await notifyAdmins({
            title: 'Ek-2 (periyodik muayene formu) süresi doluyor',
            message: `${emp.fullName} (${companyName}) adlı personelin Ek-2 periyodik muayene formu süresi doluyor (tahmini: ${expiry.toLocaleDateString('tr-TR')}, tehlike sınıfına göre hesaplandı). Yeni muayene planlanması gerekiyor.`,
          });
          await db.update(employees).set({ ek2ExpiryReminderSentAt: now }).where(eq(employees.id, emp.id));
        }
      }
    }
  } catch (err) {
    console.error('[scheduler] Tetkik/Ek-2 süresi uyarı kontrolü başarısız:', err.message);
  }
}

function startScheduler() {
  checkDeadlineReminders();
  checkDeadlineExpirations();
  checkArchiveReminders();
  checkTempAssignmentEndingReminders();
  checkTempAssignmentEndedAndArchive();
  checkTrainingExpiryReminders();
  checkHealthExamExpiryReminders();
  return setInterval(() => {
    checkDeadlineReminders();
    checkDeadlineExpirations();
    checkArchiveReminders();
    checkTempAssignmentEndingReminders();
    checkTempAssignmentEndedAndArchive();
    checkTrainingExpiryReminders();
    checkHealthExamExpiryReminders();
  }, CHECK_INTERVAL_MS);
}

module.exports = {
  startScheduler,
  checkDeadlineReminders,
  checkDeadlineExpirations,
  checkArchiveReminders,
  checkTempAssignmentEndingReminders,
  checkTempAssignmentEndedAndArchive,
  checkTrainingExpiryReminders,
  checkHealthExamExpiryReminders,
};
