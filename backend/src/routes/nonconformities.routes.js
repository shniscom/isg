const express = require('express');
const { z } = require('zod');
const { eq, and, or, desc, gte, lte, ilike, isNull } = require('drizzle-orm');
const { db } = require('../db/client');
const {
  nonconformities,
  nonconformityPhotos,
  nonconformityCorrections,
  nonconformityStatusHistory,
  users,
  projects,
  categories,
  projectBlocks,
  companies,
  userProjects,
  roles,
} = require('../db/schema');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permission');
const { asyncHandler } = require('../utils/asyncHandler');
const { ApiError } = require('../utils/apiError');
const { logAudit } = require('../utils/audit');
const { generateNonconformityNumber, logStatusChange } = require('../services/nonconformity.service');
const { createViewUrl } = require('../services/storage.service');

const router = express.Router();
router.use(requireAuth);

/** İstekte bulunan kullanıcının çalışacağı proje id'sini belirler. */
function resolveProjectId(req, explicitProjectId) {
  if (req.user.isSystemAdmin) {
    if (!explicitProjectId) {
      throw ApiError.badRequest('Sistem admini için projectId parametresi zorunludur.');
    }
    return explicitProjectId;
  }
  if (!req.user.projectId) {
    throw ApiError.forbidden('Aktif bir proje bağlamınız yok. Lütfen tekrar giriş yapıp proje/görev seçin.');
  }
  return req.user.projectId;
}

function hasPermission(req, key) {
  return req.user.isSystemAdmin || (req.user.permissions || []).includes(key);
}

const photoInputSchema = z.object({
  key: z.string().min(1),
  type: z.enum(['ACILIS', 'DUZELTME', 'ITIRAZ', 'CEZA', 'DIGER']).default('DIGER'),
  originalFileName: z.string().optional().nullable(),
});

async function attachPhotos(tx, { nonconformityId, correctionId, photos, uploadedById }) {
  if (!photos || photos.length === 0) return;
  await tx.insert(nonconformityPhotos).values(
    photos.map((p) => ({
      nonconformityId,
      correctionId: correctionId || null,
      type: p.type,
      objectKey: p.key,
      originalFileName: p.originalFileName || null,
      uploadedById,
    }))
  );
}

async function withPhotoViewUrls(photos) {
  return Promise.all(
    photos.map(async (p) => ({ ...p, viewUrl: await createViewUrl(p.objectKey).catch(() => null) }))
  );
}

// ---------------------------------------------------------------------------
// Açma formu için referans veriler (kategori/blok/firma) - admin panelindeki
// yönetim uçlarından bağımsız, salt okunur ve proje bağlamına göre filtrelenmiş.
// ---------------------------------------------------------------------------
router.get(
  '/reference-data',
  asyncHandler(async (req, res) => {
    const projectId = resolveProjectId(req, req.query.projectId);
    if (!hasPermission(req, 'uygunsuzluk_acma') && !hasPermission(req, 'uygunsuzluk_gorme')) {
      throw ApiError.forbidden();
    }

    const [categoryRows, blockRows, companyRows] = await Promise.all([
      db
        .select()
        .from(categories)
        .where(and(or(eq(categories.projectId, projectId), isNull(categories.projectId)), eq(categories.isActive, true))),
      db.select().from(projectBlocks).where(eq(projectBlocks.projectId, projectId)),
      db.select().from(companies).where(and(eq(companies.projectId, projectId), eq(companies.isActive, true))),
    ]);

    res.json({ categories: categoryRows, blocks: blockRows, companies: companyRows });
  })
);

// ---------------------------------------------------------------------------
// Atanabilir kullanıcı listesi (uygunsuzluk açma formunda kullanılır)
// ---------------------------------------------------------------------------
router.get(
  '/assignable-users',
  requirePermission('uygunsuzluk_acma'),
  asyncHandler(async (req, res) => {
    const projectId = resolveProjectId(req, req.query.projectId);

    const rows = await db
      .select({
        userId: users.id,
        fullName: users.fullName,
        roleName: roles.name,
      })
      .from(userProjects)
      .innerJoin(users, eq(userProjects.userId, users.id))
      .innerJoin(roles, eq(userProjects.roleId, roles.id))
      .where(and(eq(userProjects.projectId, projectId), eq(userProjects.isActive, true), eq(users.isActive, true)));

    res.json({ users: rows });
  })
);

// ---------------------------------------------------------------------------
// Listeleme
// ---------------------------------------------------------------------------
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const projectId = resolveProjectId(req, req.query.projectId);
    const canSeeAll = hasPermission(req, 'uygunsuzluk_gorme');

    const conditions = [eq(nonconformities.projectId, projectId)];

    if (!canSeeAll && !req.user.isSystemAdmin) {
      // Genel görme yetkisi yoksa yalnızca kendi açtığı veya kendisine atanan kayıtları görebilir.
      conditions.push(or(eq(nonconformities.assignedUserId, req.user.sub), eq(nonconformities.openedById, req.user.sub)));
    }

    if (req.query.status) conditions.push(eq(nonconformities.status, req.query.status));
    if (req.query.categoryId) conditions.push(eq(nonconformities.categoryId, req.query.categoryId));
    if (req.query.blockId) conditions.push(eq(nonconformities.blockId, req.query.blockId));
    if (req.query.companyId) conditions.push(eq(nonconformities.companyId, req.query.companyId));
    if (req.query.assignedUserId) conditions.push(eq(nonconformities.assignedUserId, req.query.assignedUserId));
    if (req.query.openedById) conditions.push(eq(nonconformities.openedById, req.query.openedById));
    if (req.query.search) conditions.push(ilike(nonconformities.number, `%${req.query.search}%`));
    if (req.query.dateFrom) conditions.push(gte(nonconformities.createdAt, new Date(req.query.dateFrom)));
    if (req.query.dateTo) conditions.push(lte(nonconformities.createdAt, new Date(req.query.dateTo)));

    const openedByUsers = users; // alias yardımcı referans (okunabilirlik için)

    const rows = await db
      .select({
        id: nonconformities.id,
        number: nonconformities.number,
        status: nonconformities.status,
        priority: nonconformities.priority,
        description: nonconformities.description,
        dueDate: nonconformities.dueDate,
        createdAt: nonconformities.createdAt,
        closedAt: nonconformities.closedAt,
        categoryName: categories.name,
        blockName: projectBlocks.name,
        companyName: companies.name,
        assignedUserId: nonconformities.assignedUserId,
        assignedUserName: users.fullName,
        openedById: nonconformities.openedById,
      })
      .from(nonconformities)
      .leftJoin(categories, eq(nonconformities.categoryId, categories.id))
      .leftJoin(projectBlocks, eq(nonconformities.blockId, projectBlocks.id))
      .leftJoin(companies, eq(nonconformities.companyId, companies.id))
      .leftJoin(users, eq(nonconformities.assignedUserId, users.id))
      .where(and(...conditions))
      .orderBy(desc(nonconformities.createdAt));

    res.json({ nonconformities: rows });
  })
);

// ---------------------------------------------------------------------------
// Oluşturma (Uygunsuzluk Açma)
// ---------------------------------------------------------------------------
const createSchema = z.object({
  projectId: z.string().optional(), // sadece admin için gerekli
  categoryId: z.string().optional().nullable(),
  blockId: z.string().optional().nullable(),
  companyId: z.string().optional().nullable(),
  assignedUserId: z.string().min(1, 'Atanan kişi zorunludur.'),
  description: z.string().min(5, 'Açıklama en az 5 karakter olmalıdır.'),
  priority: z.enum(['DUSUK', 'ORTA', 'YUKSEK', 'KRITIK']).default('ORTA'),
  dueDate: z.string().datetime({ message: 'Geçerli bir termin tarihi giriniz.' }),
  photos: z.array(photoInputSchema).optional().default([]),
});

router.post(
  '/',
  requirePermission('uygunsuzluk_acma'),
  asyncHandler(async (req, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('Geçersiz uygunsuzluk bilgisi.', parsed.error.flatten());
    const data = parsed.data;
    const projectId = resolveProjectId(req, data.projectId);

    const dueDate = new Date(data.dueDate);
    if (dueDate.getTime() <= Date.now()) {
      throw ApiError.badRequest('Termin tarihi bugünden ileri bir tarih olmalıdır.');
    }

    const assignment = await db
      .select()
      .from(userProjects)
      .where(and(eq(userProjects.userId, data.assignedUserId), eq(userProjects.projectId, projectId), eq(userProjects.isActive, true)))
      .limit(1);
    if (assignment.length === 0) {
      throw ApiError.badRequest('Atanan kullanıcı bu projeye atanmamış veya pasif.');
    }

    const result = await db.transaction(async (tx) => {
      const number = await generateNonconformityNumber(tx, projectId);

      const [created] = await tx
        .insert(nonconformities)
        .values({
          number,
          projectId,
          categoryId: data.categoryId || null,
          blockId: data.blockId || null,
          companyId: data.companyId || null,
          openedById: req.user.sub,
          assignedUserId: data.assignedUserId,
          description: data.description,
          priority: data.priority,
          dueDate,
        })
        .returning();

      await attachPhotos(tx, {
        nonconformityId: created.id,
        photos: data.photos.map((p) => ({ ...p, type: 'ACILIS' })),
        uploadedById: req.user.sub,
      });

      await logStatusChange(tx, {
        nonconformityId: created.id,
        fromStatus: null,
        toStatus: 'ACIK',
        actorId: req.user.sub,
        note: 'Uygunsuzluk oluşturuldu.',
      });

      return created;
    });

    await logAudit({
      userId: req.user.sub,
      action: 'NONCONFORMITY_CREATE',
      entityType: 'nonconformity',
      entityId: result.id,
      details: { number: result.number, assignedUserId: data.assignedUserId },
      ipAddress: req.ip,
    });

    res.status(201).json({ nonconformity: result });
  })
);

// ---------------------------------------------------------------------------
// Detay
// ---------------------------------------------------------------------------
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const [nc] = await db.select().from(nonconformities).where(eq(nonconformities.id, req.params.id)).limit(1);
    if (!nc) throw ApiError.notFound('Uygunsuzluk bulunamadı.');

    if (!req.user.isSystemAdmin) {
      if (nc.projectId !== req.user.projectId) throw ApiError.forbidden();
      const canSeeAll = hasPermission(req, 'uygunsuzluk_gorme');
      const isOwnerOrAssignee = nc.assignedUserId === req.user.sub || nc.openedById === req.user.sub;
      if (!canSeeAll && !isOwnerOrAssignee) throw ApiError.forbidden();
    }

    const [project, category, block, company, openedBy, assignedUser] = await Promise.all([
      db.select().from(projects).where(eq(projects.id, nc.projectId)).limit(1).then((r) => r[0]),
      nc.categoryId ? db.select().from(categories).where(eq(categories.id, nc.categoryId)).limit(1).then((r) => r[0]) : null,
      nc.blockId ? db.select().from(projectBlocks).where(eq(projectBlocks.id, nc.blockId)).limit(1).then((r) => r[0]) : null,
      nc.companyId ? db.select().from(companies).where(eq(companies.id, nc.companyId)).limit(1).then((r) => r[0]) : null,
      db.select().from(users).where(eq(users.id, nc.openedById)).limit(1).then((r) => r[0]),
      db.select().from(users).where(eq(users.id, nc.assignedUserId)).limit(1).then((r) => r[0]),
    ]);

    const photosRaw = await db.select().from(nonconformityPhotos).where(eq(nonconformityPhotos.nonconformityId, nc.id));
    const photos = await withPhotoViewUrls(photosRaw);

    const correctionsRaw = await db
      .select()
      .from(nonconformityCorrections)
      .where(eq(nonconformityCorrections.nonconformityId, nc.id))
      .orderBy(desc(nonconformityCorrections.submittedAt));

    const corrections = await Promise.all(
      correctionsRaw.map(async (c) => {
        const [submittedBy] = await db.select({ fullName: users.fullName }).from(users).where(eq(users.id, c.submittedById)).limit(1);
        const reviewedBy = c.reviewedById
          ? await db.select({ fullName: users.fullName }).from(users).where(eq(users.id, c.reviewedById)).limit(1).then((r) => r[0])
          : null;
        const correctionPhotos = await withPhotoViewUrls(
          await db.select().from(nonconformityPhotos).where(eq(nonconformityPhotos.correctionId, c.id))
        );
        return {
          ...c,
          submittedByName: submittedBy?.fullName || null,
          reviewedByName: reviewedBy?.fullName || null,
          photos: correctionPhotos,
        };
      })
    );

    const history = await db
      .select()
      .from(nonconformityStatusHistory)
      .where(eq(nonconformityStatusHistory.nonconformityId, nc.id))
      .orderBy(nonconformityStatusHistory.createdAt);

    const historyWithActors = await Promise.all(
      history.map(async (h) => {
        const [actor] = await db.select({ fullName: users.fullName }).from(users).where(eq(users.id, h.actorId)).limit(1);
        return { ...h, actorName: actor?.fullName || null };
      })
    );

    res.json({
      nonconformity: {
        ...nc,
        projectName: project?.name,
        categoryName: category?.name || null,
        blockName: block?.name || null,
        companyName: company?.name || null,
        openedByName: openedBy?.fullName,
        assignedUserName: assignedUser?.fullName,
      },
      photos,
      corrections,
      history: historyWithActors,
    });
  })
);

// ---------------------------------------------------------------------------
// Düzeltme gönderme
// ---------------------------------------------------------------------------
const correctionSchema = z.object({
  description: z.string().min(5, 'Düzeltme açıklaması en az 5 karakter olmalıdır.'),
  photos: z.array(photoInputSchema).optional().default([]),
});

router.post(
  '/:id/corrections',
  asyncHandler(async (req, res) => {
    const parsed = correctionSchema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('Geçersiz düzeltme bilgisi.', parsed.error.flatten());

    const [nc] = await db.select().from(nonconformities).where(eq(nonconformities.id, req.params.id)).limit(1);
    if (!nc) throw ApiError.notFound('Uygunsuzluk bulunamadı.');
    if (!req.user.isSystemAdmin && nc.projectId !== req.user.projectId) throw ApiError.forbidden();

    const isAssignee = nc.assignedUserId === req.user.sub;
    if (!isAssignee && !hasPermission(req, 'uygunsuzluk_duzeltme')) {
      throw ApiError.forbidden('Bu uygunsuzluğu yalnızca atanan kişi düzeltebilir.');
    }
    if (nc.status !== 'ACIK') {
      throw ApiError.conflict('Bu uygunsuzluk düzeltme göndermeye uygun durumda değil (durum: ' + nc.status + ').');
    }

    const result = await db.transaction(async (tx) => {
      const [correction] = await tx
        .insert(nonconformityCorrections)
        .values({ nonconformityId: nc.id, description: parsed.data.description, submittedById: req.user.sub })
        .returning();

      await attachPhotos(tx, {
        nonconformityId: nc.id,
        correctionId: correction.id,
        photos: parsed.data.photos.map((p) => ({ ...p, type: 'DUZELTME' })),
        uploadedById: req.user.sub,
      });

      await tx.update(nonconformities).set({ status: 'BEKLEMEDE', updatedAt: new Date() }).where(eq(nonconformities.id, nc.id));

      await logStatusChange(tx, {
        nonconformityId: nc.id,
        fromStatus: 'ACIK',
        toStatus: 'BEKLEMEDE',
        actorId: req.user.sub,
        note: 'Düzeltme onaya gönderildi.',
      });

      return correction;
    });

    await logAudit({
      userId: req.user.sub,
      action: 'NONCONFORMITY_CORRECTION_SUBMIT',
      entityType: 'nonconformity',
      entityId: nc.id,
      details: { correctionId: result.id },
      ipAddress: req.ip,
    });

    res.status(201).json({ correction: result });
  })
);

// ---------------------------------------------------------------------------
// Düzeltmeyi onaylama
// ---------------------------------------------------------------------------
router.post(
  '/:id/corrections/:correctionId/approve',
  requirePermission('uygunsuzluk_onaylama'),
  asyncHandler(async (req, res) => {
    const [nc] = await db.select().from(nonconformities).where(eq(nonconformities.id, req.params.id)).limit(1);
    if (!nc) throw ApiError.notFound('Uygunsuzluk bulunamadı.');
    if (!req.user.isSystemAdmin && nc.projectId !== req.user.projectId) throw ApiError.forbidden();

    const [correction] = await db
      .select()
      .from(nonconformityCorrections)
      .where(and(eq(nonconformityCorrections.id, req.params.correctionId), eq(nonconformityCorrections.nonconformityId, nc.id)))
      .limit(1);
    if (!correction) throw ApiError.notFound('Düzeltme kaydı bulunamadı.');
    if (nc.status !== 'BEKLEMEDE' || correction.status !== 'BEKLEMEDE') {
      throw ApiError.conflict('Bu düzeltme onay/red için uygun durumda değil.');
    }

    await db.transaction(async (tx) => {
      await tx
        .update(nonconformityCorrections)
        .set({ status: 'ONAYLANDI', reviewedById: req.user.sub, reviewedAt: new Date() })
        .where(eq(nonconformityCorrections.id, correction.id));

      await tx
        .update(nonconformities)
        .set({ status: 'KAPALI', closedAt: new Date(), updatedAt: new Date() })
        .where(eq(nonconformities.id, nc.id));

      await logStatusChange(tx, {
        nonconformityId: nc.id,
        fromStatus: 'BEKLEMEDE',
        toStatus: 'KAPALI',
        actorId: req.user.sub,
        note: 'Düzeltme onaylandı, uygunsuzluk kapatıldı.',
      });
    });

    await logAudit({
      userId: req.user.sub,
      action: 'NONCONFORMITY_CORRECTION_APPROVE',
      entityType: 'nonconformity',
      entityId: nc.id,
      details: { correctionId: correction.id },
      ipAddress: req.ip,
    });

    res.json({ success: true });
  })
);

// ---------------------------------------------------------------------------
// Düzeltmeyi reddetme
// ---------------------------------------------------------------------------
const rejectSchema = z.object({ reviewNote: z.string().min(3, 'Red gerekçesi zorunludur.') });

router.post(
  '/:id/corrections/:correctionId/reject',
  requirePermission('uygunsuzluk_onaylama'),
  asyncHandler(async (req, res) => {
    const parsed = rejectSchema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('Red gerekçesi zorunludur.', parsed.error.flatten());

    const [nc] = await db.select().from(nonconformities).where(eq(nonconformities.id, req.params.id)).limit(1);
    if (!nc) throw ApiError.notFound('Uygunsuzluk bulunamadı.');
    if (!req.user.isSystemAdmin && nc.projectId !== req.user.projectId) throw ApiError.forbidden();

    const [correction] = await db
      .select()
      .from(nonconformityCorrections)
      .where(and(eq(nonconformityCorrections.id, req.params.correctionId), eq(nonconformityCorrections.nonconformityId, nc.id)))
      .limit(1);
    if (!correction) throw ApiError.notFound('Düzeltme kaydı bulunamadı.');
    if (nc.status !== 'BEKLEMEDE' || correction.status !== 'BEKLEMEDE') {
      throw ApiError.conflict('Bu düzeltme onay/red için uygun durumda değil.');
    }

    await db.transaction(async (tx) => {
      await tx
        .update(nonconformityCorrections)
        .set({
          status: 'REDDEDILDI',
          reviewedById: req.user.sub,
          reviewedAt: new Date(),
          reviewNote: parsed.data.reviewNote,
        })
        .where(eq(nonconformityCorrections.id, correction.id));

      await tx.update(nonconformities).set({ status: 'ACIK', updatedAt: new Date() }).where(eq(nonconformities.id, nc.id));

      await logStatusChange(tx, {
        nonconformityId: nc.id,
        fromStatus: 'BEKLEMEDE',
        toStatus: 'ACIK',
        actorId: req.user.sub,
        note: `Düzeltme reddedildi: ${parsed.data.reviewNote}`,
      });
    });

    await logAudit({
      userId: req.user.sub,
      action: 'NONCONFORMITY_CORRECTION_REJECT',
      entityType: 'nonconformity',
      entityId: nc.id,
      details: { correctionId: correction.id, reviewNote: parsed.data.reviewNote },
      ipAddress: req.ip,
    });

    res.json({ success: true });
  })
);

module.exports = router;
