const crypto = require('crypto');
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const ALLOWED_CONTENT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);

const UPLOAD_URL_TTL_SECONDS = 5 * 60; // yükleme linki 5 dakika geçerli
const VIEW_URL_TTL_SECONDS = 15 * 60; // görüntüleme linki 15 dakika geçerli

let client = null;

function getConfig() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET_NAME;

  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    throw new Error(
      'R2 depolama yapılandırması eksik. R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME ortam değişkenlerini kontrol edin.'
    );
  }

  return { accountId, accessKeyId, secretAccessKey, bucket };
}

function getClient() {
  if (client) return client;
  const { accountId, accessKeyId, secretAccessKey } = getConfig();
  client = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
  return client;
}

function sanitizeFileName(fileName) {
  return String(fileName || 'dosya')
    .normalize('NFKD')
    .replace(/[^\w.\-]+/g, '_')
    .slice(-100);
}

/**
 * Bir dosya için doğrudan tarayıcıdan R2'ye PUT edilecek, kısa ömürlü bir presigned URL üretir.
 * @param {{ nonconformityId?: string, fileName: string, contentType: string }} params
 * @returns {Promise<{ key: string, uploadUrl: string, expiresIn: number }>}
 */
async function createUploadUrl({ nonconformityId, fileName, contentType }) {
  if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
    throw new Error('Desteklenmeyen dosya türü. Sadece JPEG, PNG, WEBP veya HEIC yükleyebilirsiniz.');
  }

  const { bucket } = getConfig();
  const datePrefix = new Date().toISOString().slice(0, 10);
  const scope = nonconformityId ? `nonconformities/${nonconformityId}` : 'uploads/pending';
  const key = `${scope}/${datePrefix}/${crypto.randomUUID()}-${sanitizeFileName(fileName)}`;

  const command = new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType });
  const uploadUrl = await getSignedUrl(getClient(), command, { expiresIn: UPLOAD_URL_TTL_SECONDS });

  return { key, uploadUrl, expiresIn: UPLOAD_URL_TTL_SECONDS };
}

/**
 * Verilen object key için kısa ömürlü bir görüntüleme (GET) URL'i üretir.
 * @param {string} key
 * @returns {Promise<string>}
 */
async function createViewUrl(key) {
  const { bucket } = getConfig();
  const command = new GetObjectCommand({ Bucket: bucket, Key: key });
  return getSignedUrl(getClient(), command, { expiresIn: VIEW_URL_TTL_SECONDS });
}

module.exports = { createUploadUrl, createViewUrl, ALLOWED_CONTENT_TYPES };
