const express = require('express');
const { z } = require('zod');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../utils/asyncHandler');
const { ApiError } = require('../utils/apiError');
const { createUploadUrl, ALLOWED_CONTENT_TYPES } = require('../services/storage.service');

const router = express.Router();
router.use(requireAuth);

const presignSchema = z.object({
  fileName: z.string().min(1),
  contentType: z.string().min(1),
  nonconformityId: z.string().optional(),
});

// Fotoğraf yüklemeden önce tarayıcının doğrudan R2'ye PUT edebileceği kısa ömürlü bir link üretir.
// Böylece fotoğraf trafiği sunucu diskinden/bant genişliğinden hiç geçmez.
router.post(
  '/presign-upload',
  asyncHandler(async (req, res) => {
    const parsed = presignSchema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('Geçersiz istek.', parsed.error.flatten());

    if (!ALLOWED_CONTENT_TYPES.has(parsed.data.contentType)) {
      throw ApiError.badRequest('Desteklenmeyen dosya türü. Sadece JPEG, PNG, WEBP veya HEIC yükleyebilirsiniz.');
    }

    try {
      const result = await createUploadUrl(parsed.data);
      res.json(result);
    } catch (err) {
      throw ApiError.badRequest(err.message);
    }
  })
);

module.exports = router;
