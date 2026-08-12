const bcrypt = require('bcryptjs');

const SALT_ROUNDS = 12;
const MIN_LENGTH = 8;

async function hashPassword(plain) {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

async function comparePassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

function validatePasswordStrength(plain) {
  if (typeof plain !== 'string' || plain.length < MIN_LENGTH) {
    return `Şifre en az ${MIN_LENGTH} karakter olmalıdır.`;
  }
  if (!/[a-zA-Z]/.test(plain) || !/[0-9]/.test(plain)) {
    return 'Şifre en az bir harf ve bir rakam içermelidir.';
  }
  return null;
}

module.exports = { hashPassword, comparePassword, validatePasswordStrength };
