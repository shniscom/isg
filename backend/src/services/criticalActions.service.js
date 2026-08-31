// Kritik/geri dönülmez işlemlerin GERÇEK uygulama mantığı burada, TEK bir yerde toplanır.
//
// Neden: admin onay sistemi (bkz. utils/approval.js) aynı işlemi iki farklı zamanda
// çalıştırabilmeli - (1) işlemi admin kendisi yaptığında ANINDA, (2) admin olmayan biri
// istediğinde ve admin sonradan onayladığında GECİKMELİ. İki çağrı noktasının (route handler'ın
// admin dalı ve admin/approvals.routes.js'in onay dalı) aynı kodu çalıştırdığından emin olmak
// için mantık route dosyalarından buraya taşınmıştır; route dosyaları artık yalnızca
// doğrulama/yetki kontrolü yapar ve gerçek işlemi EXECUTORS[actionType](payload, actorId)
// üzerinden tetikler.
//
// Her executor (payload, actorId) alır ve route'un daha önce döndürdüğü ile aynı şekle sahip
// bir sonuç nesnesi döner. actorId: işlemi admin kendisi yaptıysa admin'in id'si, onay
// üzerinden geldiyse asıl talebi oluşturan kişinin id'sidir (audit/karar kayıtlarında "kim
// yaptı" anlamlı kalsın diye) - admin'in ONAY KARARI ayrıca admin/approvals.routes.js
// tarafından APPROVAL_GRANT/APPROVAL_REJECT audit satırıyla loglanır.

const { eq, and, ne } = require('drizzle-orm');
const { db } = require('../db/client');
const { companies, companyBlocks, projects, nonconformities, penalties } = require('../db/schema');
const { ApiError } = require('../utils/apiError');
const { logAudit } = require('../utils/audit');
const { createNotifications } = require('./notification.service');
const { loadAssigneeIdsFor } = require('./nonconformity.service');

/** company_blocks tablosunu verilen firma için blockIds listesiyle eşleşecek şekilde senkronize eder. */
async function syncCompanyBlocks(tx, companyId, blockIds) {
  await tx.delete(companyBlocks).where(eq(companyBlocks.companyId, companyId));
  if (blockIds && blockIds.length > 0) {
    await tx.insert(companyBlocks).values([...new Set(blockIds)].map((blockId) => ({ companyId, blockId })));
  }
}

async function executeCompanyUpdate({ companyId, companyData, blockIds }, actorId) {
  const updated = await db.transaction(async (tx) => {
    let row;
    if (companyData && Object.keys(companyData).length > 0) {
      [row] = await tx.update(companies).set({ ...companyData, updatedAt: new Date() }).where(eq(companies.id, companyId)).returning();
    } else {
      [row] = await tx.select().from(companies).where(eq(companies.id, companyId)).limit(1);
    }
    if (!row) return null;
    if (blockIds !== undefined) {
      await syncCompanyBlocks(tx, row.id, blockIds);
    }
    return row;
  });
  if (!updated) throw ApiError.notFound('Firma bulunamadı.');

  await logAudit({ userId: actorId, action: 'COMPANY_UPDATE', entityType: 'company', entityId: updated.id, details: { companyData, blockIds }, ipAddress: null });
  return { company: updated };
}

async function executeCompanyDelete({ companyId }, actorId) {
  const [updated] = await db.update(companies).set({ isActive: false, updatedAt: new Date() }).where(eq(companies.id, companyId)).returning();
  if (!updated) throw ApiError.notFound('Firma bulunamadı.');

  await logAudit({ userId: actorId, action: 'COMPANY_DEACTIVATE', entityType: 'company', entityId: updated.id, ipAddress: null });
  return { company: updated };
}

async function executeProjectUpdate({ projectId, data }, actorId) {
  const [existing] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!existing) throw ApiError.notFound('Proje bulunamadı.');

  if (data.code && data.code !== existing.code) {
    const duplicate = await db.select().from(projects).where(and(eq(projects.code, data.code), ne(projects.id, projectId))).limit(1);
    if (duplicate.length > 0) throw ApiError.conflict('Bu proje kodu başka bir projede zaten kullanımda.');
  }

  const [updated] = await db.update(projects).set({ ...data, updatedAt: new Date() }).where(eq(projects.id, projectId)).returning();
  await logAudit({ userId: actorId, action: 'PROJECT_UPDATE', entityType: 'project', entityId: updated.id, details: data, ipAddress: null });
  return { project: updated };
}

async function executeProjectStatusChange({ projectId, status }, actorId) {
  const [updated] = await db.update(projects).set({ status, updatedAt: new Date() }).where(eq(projects.id, projectId)).returning();
  if (!updated) throw ApiError.notFound('Proje bulunamadı.');

  await logAudit({ userId: actorId, action: 'PROJECT_STATUS_CHANGE', entityType: 'project', entityId: updated.id, details: { status }, ipAddress: null });
  return { project: updated };
}

async function executeNonconformityDelete({ nonconformityId }, actorId) {
  const [nc] = await db.select().from(nonconformities).where(eq(nonconformities.id, nonconformityId)).limit(1);
  if (!nc) throw ApiError.notFound('Uygunsuzluk bulunamadı.');

  await db.delete(nonconformities).where(eq(nonconformities.id, nc.id));

  await logAudit({ userId: actorId, action: 'NONCONFORMITY_DELETE', entityType: 'nonconformity', entityId: nc.id, details: { number: nc.number }, ipAddress: null });
  return { success: true };
}

async function executePenaltyApprove({ penaltyId, decisionNote }, actorId) {
  const [penalty] = await db.select().from(penalties).where(eq(penalties.id, penaltyId)).limit(1);
  if (!penalty) throw ApiError.notFound('Ceza talebi bulunamadı.');
  if (penalty.status !== 'BEKLEMEDE') throw ApiError.conflict('Bu talep zaten karara bağlanmış.');

  const [updated] = await db
    .update(penalties)
    .set({ status: 'ONAYLANDI', decidedById: actorId, decidedAt: new Date(), decisionNote: decisionNote || null })
    .where(eq(penalties.id, penalty.id))
    .returning();

  const [nc] = await db.select().from(nonconformities).where(eq(nonconformities.id, penalty.nonconformityId)).limit(1);
  if (nc) {
    const assigneeIds = await loadAssigneeIdsFor(nc.id);
    await createNotifications(null, {
      userIds: [...new Set([nc.openedById, ...assigneeIds])],
      nonconformityId: nc.id,
      title: 'Ceza talebi onaylandı',
      message: `${nc.number} numaralı uygunsuzluk için cezai işlem talebi onaylandı.`,
    });
  }

  await logAudit({ userId: actorId, action: 'PENALTY_APPROVE', entityType: 'penalty', entityId: penalty.id, ipAddress: null });
  return { penalty: updated };
}

async function executePenaltyReject({ penaltyId, decisionNote }, actorId) {
  const [penalty] = await db.select().from(penalties).where(eq(penalties.id, penaltyId)).limit(1);
  if (!penalty) throw ApiError.notFound('Ceza talebi bulunamadı.');
  if (penalty.status !== 'BEKLEMEDE') throw ApiError.conflict('Bu talep zaten karara bağlanmış.');

  const [updated] = await db
    .update(penalties)
    .set({ status: 'REDDEDILDI', decidedById: actorId, decidedAt: new Date(), decisionNote: decisionNote || null })
    .where(eq(penalties.id, penalty.id))
    .returning();

  await logAudit({ userId: actorId, action: 'PENALTY_REJECT', entityType: 'penalty', entityId: penalty.id, ipAddress: null });
  return { penalty: updated };
}

// actionType -> executor. admin/approvals.routes.js ve utils/approval.js BUNU tek kaynak olarak kullanır.
const EXECUTORS = {
  COMPANY_UPDATE: executeCompanyUpdate,
  COMPANY_DELETE: executeCompanyDelete,
  PROJECT_UPDATE: executeProjectUpdate,
  PROJECT_STATUS_CHANGE: executeProjectStatusChange,
  NONCONFORMITY_DELETE: executeNonconformityDelete,
  PENALTY_APPROVE: executePenaltyApprove,
  PENALTY_REJECT: executePenaltyReject,
};

module.exports = { EXECUTORS };
