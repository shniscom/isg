const express = require('express');
const { z } = require('zod');
const { db } = require('../../db/client');
const { permissions } = require('../../db/schema');
const { eq } = require('drizzle-orm');
const { asyncHandler } = require('../../utils/asyncHandler');
const { ApiError } = require('../../utils/apiError');
const { requireSystemAdmin } = require('../../middleware/permission');
const { requireAuth } = require('../../middleware/auth');
const { logAudit } = require('../../utils/audit');

const router = express.Router();

// Yetki kataloğunu görüntülemek herhangi bir yönetim yetkisine sahip kullanıcı için serbest;
// katalog değişikliği (yeni yetki tanımlama) yalnızca sistem admini içindir.
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const rows = await db.select().from(permissions).orderBy(permissions.name);
    res.json({ permissions: rows });
  })
);

const permissionSchema = z.object({
  key: z.string().min(2).regex(/^[a-z0-9_]+$/, 'Anahtar yalnızca küçük harf, rakam ve alt çizgi içerebilir.'),
  name: z.string().min(2),
  description: z.string().optional().nullable(),
});

router.post(
  '/',
  requireSystemAdmin,
  asyncHandler(async (req, res) => {
    const parsed = permissionSchema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('Geçersiz yetki bilgisi.', parsed.error.flatten());

    const existing = await db.select().from(permissions).where(eq(permissions.key, parsed.data.key)).limit(1);
    if (existing.length > 0) throw ApiError.conflict('Bu anahtara sahip bir yetki zaten mevcut.');

    const [created] = await db.insert(permissions).values(parsed.data).returning();
    await logAudit({ userId: req.user.sub, action: 'PERMISSION_CREATE', entityType: 'permission', entityId: created.id, details: parsed.data, ipAddress: req.ip });
    res.status(201).json({ permission: created });
  })
);

module.exports = router;
