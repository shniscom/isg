const jwt = require('jsonwebtoken');

const CONTEXT_TOKEN_TTL = '10m';
const ACCESS_TOKEN_TTL = '12h';

function getSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error('JWT_SECRET tanımlı değil veya çok kısa (.env dosyasını kontrol edin, en az 16 karakter olmalı).');
  }
  return secret;
}

function signContextToken(payload) {
  return jwt.sign({ ...payload, type: 'context' }, getSecret(), { expiresIn: CONTEXT_TOKEN_TTL });
}

function signAccessToken(payload) {
  return jwt.sign({ ...payload, type: 'access' }, getSecret(), { expiresIn: ACCESS_TOKEN_TTL });
}

function verifyToken(token) {
  return jwt.verify(token, getSecret());
}

module.exports = { signContextToken, signAccessToken, verifyToken };
