const { db } = require('../db/client');
const { userPermissions, permissions } = require('../db/schema');
const { eq, and, or, isNull } = require('drizzle-orm');

/**
 * Bir kullanıcının belirli bir proje bağlamındaki etkin yetki anahtarlarını döner.
 * Proje bazlı (userPermissions.projectId = projectId) tanım varsa o esas alınır;
 * yoksa global (projectId = null) tanım kullanılır.
 */
async function getEffectivePermissions(userId, projectId) {
  const rows = await db
    .select({
      key: permissions.key,
      granted: userPermissions.granted,
      projectId: userPermissions.projectId,
    })
    .from(userPermissions)
    .innerJoin(permissions, eq(userPermissions.permissionId, permissions.id))
    .where(
      and(
        eq(userPermissions.userId, userId),
        or(isNull(userPermissions.projectId), eq(userPermissions.projectId, projectId))
      )
    );

  const byKey = new Map();
  for (const row of rows) {
    const existing = byKey.get(row.key);
    // Proje bazlı kayıt (projectId dolu) global kayda göre önceliklidir.
    if (!existing || (row.projectId !== null && existing.projectId === null)) {
      byKey.set(row.key, row);
    }
  }

  return Array.from(byKey.values())
    .filter((r) => r.granted)
    .map((r) => r.key);
}

module.exports = { getEffectivePermissions };
