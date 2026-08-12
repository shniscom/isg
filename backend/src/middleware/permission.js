const { ApiError } = require('../utils/apiError');

/**
 * Belirtilen yetki anahtarlarından en az birine (veya tümüne) sahip olmayı zorunlu kılar.
 * Sistem admini her zaman geçer.
 * @param {string|string[]} permissionKeys
 * @param {{ mode?: 'any' | 'all' }} [options]
 */
function requirePermission(permissionKeys, options = {}) {
  const keys = Array.isArray(permissionKeys) ? permissionKeys : [permissionKeys];
  const mode = options.mode || 'any';

  return function permissionMiddleware(req, res, next) {
    if (!req.user) return next(ApiError.unauthorized());
    if (req.user.isSystemAdmin) return next();

    const granted = new Set(req.user.permissions || []);
    const check = mode === 'all' ? keys.every((k) => granted.has(k)) : keys.some((k) => granted.has(k));

    if (!check) {
      return next(ApiError.forbidden(`Bu işlem için gerekli yetki bulunmuyor: ${keys.join(', ')}`));
    }
    next();
  };
}

/** Sadece sistem admini erişebilir. */
function requireSystemAdmin(req, res, next) {
  if (!req.user) return next(ApiError.unauthorized());
  if (!req.user.isSystemAdmin) return next(ApiError.forbidden('Bu işlem yalnızca sistem admini tarafından yapılabilir.'));
  next();
}

module.exports = { requirePermission, requireSystemAdmin };
