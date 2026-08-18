const express = require('express');
const { z } = require('zod');
const { db } = require('../db/client');
const { systemSettings } = require('../db/schema');
const { requireAuth } = require('../middleware/auth');
const { requireSystemAdmin } = require('../middleware/permission');
const { asyncHandler } = require('../utils/asyncHandler');
const { ApiError } = require('../utils/apiError');
const { logAudit } = require('../utils/audit');

const router = express.Router();
router.use(requireAuth);

// Sistem ayarlarının varsayılan değerleri. Kayıt yoksa bu değerler kullanılır.
const DEFAULT_SETTINGS = {
  // Fotoğraf yüklerken "galeriden seç" seçeneği varsayılan olarak kapalıdır; yalnızca admin açabilir.
  allowGallerySelect: false,
  // Uygunsuzluk başına en fazla kaç fotoğraf yüklenebilir.
  maxPhotosPerUpload: 5,
};

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const rows = await db.select().from(systemSettings);
    const settings = { ...DEFAULT_SETTINGS };
    for (const row of rows) {
      if (row.key in settings) settings[row.key] = row.value;
    }
    res.json({ settings });
  })
);

const updateSchema = z.object({
  allowGallerySelect: z.boolean().optional(),
  maxPhotosPerUpload: z.number().int().min(1).max(20).optional(),
});

router.patch(
  '/',
  requireSystemAdmin,
  asyncHandler(async (req, res) => {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('Geçersiz ayar.', parsed.error.flatten());

    for (const [key, value] of Object.entries(parsed.data)) {
      await db
        .insert(systemSettings)
        .values({ key, value, updatedAt: new Date() })
        .onConflictDoUpdate({ target: systemSettings.key, set: { value, updatedAt: new Date() } });
    }

    await logAudit({ userId: req.user.sub, action: 'SETTINGS_UPDATE', entityType: 'system_settings', entityId: 'global', details: parsed.data, ipAddress: req.ip });

    const rows = await db.select().from(systemSettings);
    const settings = { ...DEFAULT_SETTINGS };
    for (const row of rows) {
      if (row.key in settings) settings[row.key] = row.value;
    }
    res.json({ settings });
  })
);

module.exports = router;
