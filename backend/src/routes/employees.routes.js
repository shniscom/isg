const express = require('express');
const { z } = require('zod');
const { eq, and, or, count, ilike } = require('drizzle-orm');
const { db } = require('../db/client');
const { employees, nonconformities, companies, userProjects } = require('../db/schema');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../utils/asyncHandler');
const { ApiError } = require('../utils/apiError');
const { logAudit } = require('../utils/audit');

const router = express.Router();
router.use(requireAuth);

/** İstekte bulunan kullanıcının çalışacağı proje id'sini belirler (nonconformities.routes.js ile aynı mantık). */
function resolveProjectId(req, explicitProjectId) {
  if (req.user.isSystemAdmin) {
    if (!explicitProjectId) throw ApiError.badRequest('Sistem admini için projectId parametresi zorunludur.');
    return explicitProjectId;
  }
  if (!req.user.projectId) throw ApiError.forbidden('Aktif bir proje bağlamınız yok. Lütfen tekrar giriş yapıp proje/görev seçin.');
  return req.user.projectId;
}

function hasPermission(req, key) {
  return req.user.isSystemAdmin || (req.user.permissions || []).includes(key);
}

/**
 * Kullanıcının bu projede hangi firma(lar)a özel atandığını döner (userProjects.companyId dolu
 * olan satırlar). Boş dizi = firma bazlı bir kısıtlaması yok demektir.
 */
async function getScopedCompanyIds(userId, projectId) {
  const rows = await db
    .select({ companyId: userProjects.companyId })
    .from(userProjects)
    .where(and(eq(userProjects.userId, userId), eq(userProjects.projectId, projectId), eq(userProjects.isActive, true)));
  return rows.map((r) => r.companyId).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Listeleme: admin ve "uygunsuzluk_gorme" yetkisi olanlar projedeki tüm çalışanları görür;
// belirli bir firmaya atanmış kullanıcılar (firma yetkilisi) yalnızca o firmanın çalışanlarını görür.
// ---------------------------------------------------------------------------
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const projectId = resolveProjectId(req, req.query.projectId);

    let companyFilterIds = null; // null = kısıtlama yok (hepsini gör)
    if (!req.user.isSystemAdmin && !hasPermission(req, 'uygunsuzluk_gorme')) {
      const scoped = await getScopedCompanyIds(req.user.sub, projectId);
      if (scoped.length > 0) {
        companyFilterIds = scoped;
      } else if (hasPermission(req, 'uygunsuzluk_acma') && req.query.companyId) {
        // Uygunsuzluk açma yetkisi olan kişi, açma formunda seçtiği tek bir firmanın çalışan
        // listesini görebilir (mükerrer kayıt oluşturmamak için); genel gözatma yetkisi vermez.
        companyFilterIds = [req.query.companyId];
      } else {
        throw ApiError.forbidden('Çalışan listesini görüntüleme yetkiniz yok.');
      }
    }
    if (req.query.companyId) {
      companyFilterIds = companyFilterIds
        ? companyFilterIds.filter((id) => id === req.query.companyId)
        : [req.query.companyId];
    }

    const conditions = [eq(employees.projectId, projectId)];
    if (companyFilterIds) {
      if (companyFilterIds.length === 0) return res.json({ employees: [] });
      conditions.push(or(...companyFilterIds.map((id) => eq(employees.companyId, id))));
    }
    if (req.query.search) conditions.push(ilike(employees.fullName, `%${req.query.search}%`));

    const rows = await db
      .select({
        id: employees.id,
        fullName: employees.fullName,
        nationalId: employees.nationalId,
        companyId: employees.companyId,
        companyName: companies.name,
        isActive: employees.isActive,
        createdAt: employees.createdAt,
      })
      .from(employees)
      .leftJoin(companies, eq(employees.companyId, companies.id))
      .where(and(...conditions))
      .orderBy(employees.fullName);

    const warningCounts = await db
      .select({ employeeId: nonconformities.employeeId, value: count() })
      .from(nonconformities)
      .where(eq(nonconformities.projectId, projectId))
      .groupBy(nonconformities.employeeId);
    const warningByEmployee = new Map(warningCounts.filter((r) => r.employeeId).map((r) => [r.employeeId, r.value]));

    const rowsWithCounts = rows.map((r) => ({ ...r, warningCount: warningByEmployee.get(r.id) || 0 }));
    res.json({ employees: rowsWithCounts });
  })
);

// ---------------------------------------------------------------------------
// Yeni çalışan kaydı (uygunsuzluk açma akışında "isim bilinen ama kayıtlı olmayan" bir
// çalışanı hızlıca eklemek için). uygunsuzluk_acma yetkisi yeterlidir.
// ---------------------------------------------------------------------------
const createSchema = z.object({
  projectId: z.string().optional(),
  companyId: z.string().optional().nullable(),
  fullName: z.string().min(2, 'Ad soyad en az 2 karakter olmalıdır.'),
  nationalId: z
    .string()
    .regex(/^\d{11}$/, 'T.C. kimlik numarası 11 haneli olmalıdır.')
    .optional()
    .nullable()
    .or(z.literal('')),
});

router.post(
  '/',
  asyncHandler(async (req, res) => {
    if (!hasPermission(req, 'uygunsuzluk_acma')) throw ApiError.forbidden();
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('Geçersiz çalışan bilgisi.', parsed.error.flatten());
    const projectId = resolveProjectId(req, parsed.data.projectId);

    const [created] = await db
      .insert(employees)
      .values({
        projectId,
        companyId: parsed.data.companyId || null,
        fullName: parsed.data.fullName,
        nationalId: parsed.data.nationalId || null,
      })
      .returning();

    await logAudit({
      userId: req.user.sub,
      action: 'EMPLOYEE_CREATE',
      entityType: 'employee',
      entityId: created.id,
      details: { fullName: created.fullName },
      ipAddress: req.ip,
    });

    res.status(201).json({ employee: created });
  })
);

// ---------------------------------------------------------------------------
// Bir çalışana ait tüm uygunsuzluk kayıtları (detay/geçmiş görünümü)
// ---------------------------------------------------------------------------
router.get(
  '/:id/nonconformities',
  asyncHandler(async (req, res) => {
    const [employee] = await db.select().from(employees).where(eq(employees.id, req.params.id)).limit(1);
    if (!employee) throw ApiError.notFound('Çalışan bulunamadı.');

    if (!req.user.isSystemAdmin && !hasPermission(req, 'uygunsuzluk_gorme')) {
      const scoped = await getScopedCompanyIds(req.user.sub, employee.projectId);
      if (!scoped.includes(employee.companyId)) throw ApiError.forbidden();
    }

    const rows = await db
      .select({
        id: nonconformities.id,
        number: nonconformities.number,
        description: nonconformities.description,
        status: nonconformities.status,
        priority: nonconformities.priority,
        createdAt: nonconformities.createdAt,
      })
      .from(nonconformities)
      .where(eq(nonconformities.employeeId, employee.id))
      .orderBy(nonconformities.createdAt);

    res.json({ employee, nonconformities: rows });
  })
);

module.exports = router;
