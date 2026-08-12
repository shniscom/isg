const { db } = require('../db/client');
const { auditLogs } = require('../db/schema');

/**
 * Kritik işlemleri değiştirilemez şekilde loglar.
 * @param {object} params
 * @param {string|null} params.userId
 * @param {string} params.action - örn. "USER_LOGIN", "PROJECT_CREATE"
 * @param {string} [params.entityType]
 * @param {string} [params.entityId]
 * @param {object} [params.details]
 * @param {string} [params.ipAddress]
 */
async function logAudit({ userId = null, action, entityType, entityId, details, ipAddress }) {
  try {
    await db.insert(auditLogs).values({
      userId,
      action,
      entityType: entityType || null,
      entityId: entityId || null,
      details: details || null,
      ipAddress: ipAddress || null,
    });
  } catch (err) {
    // Audit logu asla ana işlemi bloklamamalı; sadece konsola yaz.
    console.error('Audit log yazılamadı:', err.message);
  }
}

module.exports = { logAudit };
