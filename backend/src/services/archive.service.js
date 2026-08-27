const { eq, and, gte, lt } = require('drizzle-orm');
const { db } = require('../db/client');
const { nonconformities } = require('../db/schema');
const { ApiError } = require('../utils/apiError');

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** 'YYYY-MM' etiketinden [ay başı, sonraki ay başı) tarih aralığını üretir. */
function periodRange(periodLabel) {
  const [y, m] = periodLabel.split('-').map(Number);
  const from = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0));
  const to = new Date(Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1, 0, 0, 0));
  return { from, to };
}

function assertValidPeriod(periodLabel) {
  if (!periodLabel || !PERIOD_RE.test(periodLabel)) {
    throw ApiError.badRequest('Geçersiz dönem. Format: YYYY-MM (ör. 2026-08).');
  }
}

/** Belirtilen proje + dönem için ilgili nonconformity id listesini döner. */
async function findNonconformityIdsForPeriod(projectId, periodLabel) {
  const { from, to } = periodRange(periodLabel);
  const rows = await db
    .select({ id: nonconformities.id })
    .from(nonconformities)
    .where(and(eq(nonconformities.projectId, projectId), gte(nonconformities.createdAt, from), lt(nonconformities.createdAt, to)));
  return rows.map((r) => r.id);
}

/** Bugünün tarihine göre "önceki ay" için 'YYYY-MM' etiketi üretir (ör. bugün Eylül'deyse Ağustos döner). */
function previousMonthLabel(reference = new Date()) {
  const d = new Date(reference.getFullYear(), reference.getMonth() - 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

module.exports = { PERIOD_RE, periodRange, assertValidPeriod, findNonconformityIdsForPeriod, previousMonthLabel };
