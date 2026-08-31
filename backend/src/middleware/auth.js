const { verifyToken } = require('../utils/jwt');
const { ApiError } = require('../utils/apiError');
const { asyncHandler } = require('../utils/asyncHandler');
const { getEffectivePermissions } = require('../services/permissions.service');
const { db } = require('../db/client');
const { users } = require('../db/schema');
const { eq } = require('drizzle-orm');

function extractToken(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  return null;
}

/**
 * Geçerli bir "access" token zorunlu kılar; req.user doldurulur.
 *
 * Not: Yetkiler JWT'ye gömülü olarak GÜVENİLMEZ; her istekte veritabanından tazelenir.
 * Aksi halde admin bir kullanıcının yetkisini değiştirdiğinde, o kullanıcı mevcut oturum
 * tokenı (12 saate kadar) geçerli olduğu sürece eski yetkilerle işlem yapmaya devam ederdi.
 */
const requireAuth = asyncHandler(async (req, res, next) => {
  const token = extractToken(req);
  if (!token) throw ApiError.unauthorized('Oturum bilgisi bulunamadı.');

  let decoded;
  try {
    decoded = verifyToken(token);
  } catch (err) {
    throw ApiError.unauthorized('Oturum süresi dolmuş veya geçersiz. Lütfen tekrar giriş yapın.');
  }

  if (decoded.type !== 'access') {
    throw ApiError.unauthorized('Geçersiz oturum türü.');
  }

  // Yetkiler gibi aktiflik durumu da JWT'ye güvenilmeden her istekte veritabanından
  // doğrulanır. Aksi halde arşivlenen/silinen bir kullanıcı, elindeki geçerli token süresi
  // (12 saate kadar) dolana kadar sisteme müdahale etmeye devam edebilirdi.
  const [dbUser] = await db.select({ isActive: users.isActive }).from(users).where(eq(users.id, decoded.sub)).limit(1);
  if (!dbUser || !dbUser.isActive) {
    throw ApiError.unauthorized('Hesabınız pasif veya arşivlenmiş. Sisteme giriş yapamazsınız.');
  }

  let permissions = decoded.permissions || [];
  if (!decoded.isSystemAdmin && decoded.projectId) {
    permissions = await getEffectivePermissions(decoded.sub, decoded.projectId);
  }

  req.user = { ...decoded, permissions }; // { sub, isSystemAdmin, projectId, roleId, permissions, iat, exp }
  next();
});

/** Sadece geçici "context" token (proje/görev seçim aşaması) için kullanılır. */
function verifyContextToken(token) {
  let decoded;
  try {
    decoded = verifyToken(token);
  } catch (err) {
    throw ApiError.unauthorized('Oturum süresi dolmuş, lütfen tekrar giriş yapın.');
  }
  if (decoded.type !== 'context') {
    throw ApiError.unauthorized('Geçersiz oturum türü.');
  }
  return decoded;
}

module.exports = { requireAuth, verifyContextToken, extractToken };
