const { verifyToken } = require('../utils/jwt');
const { ApiError } = require('../utils/apiError');
const { asyncHandler } = require('../utils/asyncHandler');

function extractToken(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  return null;
}

/** Geçerli bir "access" token zorunlu kılar; req.user doldurulur. */
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

  req.user = decoded; // { sub, isSystemAdmin, projectId, roleId, permissions, iat, exp }
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
