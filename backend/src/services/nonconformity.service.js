const { sql, eq } = require('drizzle-orm');
const { db } = require('../db/client');
const { projects, nonconformityStatusHistory, nonconformityAssignees } = require('../db/schema');

/**
 * Proje bazında atomik olarak bir sonraki uygunsuzluk numarasını üretir.
 * Örnek: 2026-ANK-000125
 * Yarış durumlarını (race condition) önlemek için çağıran taraf bunu bir transaction içinde
 * (db.transaction) kullanmalıdır.
 */
async function generateNonconformityNumber(tx, projectId) {
  const [updated] = await tx
    .update(projects)
    .set({ nonconformitySeq: sql`${projects.nonconformitySeq} + 1` })
    .where(eq(projects.id, projectId))
    .returning({ seq: projects.nonconformitySeq, code: projects.code });

  if (!updated) {
    throw new Error('Proje bulunamadı, uygunsuzluk numarası üretilemedi.');
  }

  const year = new Date().getFullYear();
  const seqPadded = String(updated.seq).padStart(6, '0');
  return `${year}-${updated.code}-${seqPadded}`;
}

/**
 * Uygunsuzluk için değiştirilemez bir tarihçe (durum geçmişi) satırı ekler.
 */
async function logStatusChange(tx, { nonconformityId, fromStatus, toStatus, actorId, note }) {
  await tx.insert(nonconformityStatusHistory).values({
    nonconformityId,
    fromStatus: fromStatus || null,
    toStatus,
    actorId,
    note: note || null,
  });
}

/** Bir uygunsuzluğa atanan kullanıcı id'lerini döner (bildirim/zamanlayıcı gibi servis içi kullanım için). */
async function loadAssigneeIdsFor(nonconformityId) {
  const rows = await db
    .select({ userId: nonconformityAssignees.userId })
    .from(nonconformityAssignees)
    .where(eq(nonconformityAssignees.nonconformityId, nonconformityId));
  return rows.map((r) => r.userId);
}

module.exports = { generateNonconformityNumber, logStatusChange, loadAssigneeIdsFor };
