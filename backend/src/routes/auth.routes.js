const express = require('express');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const { z } = require('zod');
const { db } = require('../db/client');
const { users, userProjects, projects, roles, userInvites } = require('../db/schema');
const { eq, and } = require('drizzle-orm');
const { comparePassword, hashPassword, validatePasswordStrength } = require('../utils/password');
const { signContextToken, signAccessToken } = require('../utils/jwt');
const { requireAuth, verifyContextToken } = require('../middleware/auth');
const { asyncHandler } = require('../utils/asyncHandler');
const { ApiError } = require('../utils/apiError');
const { getEffectivePermissions } = require('../services/permissions.service');
const { logAudit } = require('../utils/audit');

const router = express.Router();

// Kaba kuvvet saldırılarına karşı giriş denemelerini sınırla.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  // Test ortamında tek bir test dosyası onlarca senaryoda giriş yapar (gerçek bir kullanıcının
  // 15 dakikada yapacağı denemeden çok daha fazla); bu yüzden test'te limit gevşetilir.
  // Üretimde kaba kuvvet korumasına dokunulmaz.
  max: process.env.NODE_ENV === 'test' ? 100000 : 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { message: 'Çok fazla giriş denemesi yapıldı. Lütfen daha sonra tekrar deneyin.' } },
});

// Davet bağlantısı uçları için ayrı, biraz daha gevşek bir sınır (link tıklama + form denemesi).
const inviteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { message: 'Çok fazla deneme yapıldı. Lütfen daha sonra tekrar deneyin.' } },
});

function hashInviteToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function loadValidInvite(token) {
  const tokenHash = hashInviteToken(token);
  const [invite] = await db.select().from(userInvites).where(eq(userInvites.tokenHash, tokenHash)).limit(1);
  if (!invite || invite.usedAt || invite.expiresAt < new Date()) return null;
  return invite;
}

const loginSchema = z.object({
  username: z.string().min(1, 'Kullanıcı adı zorunludur.'),
  password: z.string().min(1, 'Şifre zorunludur.'),
  rememberMe: z.boolean().optional().default(false),
});

// ADIM 1: kullanıcı adı + şifre doğrulama.
// Sistem admini ise doğrudan tam erişim tokenı döner.
// Diğer kullanıcılar için atanmış proje/görev listesi ile birlikte kısa ömürlü bir "context" token döner.
router.post(
  '/login',
  loginLimiter,
  asyncHandler(async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      throw ApiError.badRequest('Geçersiz giriş bilgisi.', parsed.error.flatten());
    }
    const { username, password, rememberMe } = parsed.data;

    const [user] = await db.select().from(users).where(eq(users.username, username)).limit(1);

    if (!user || !user.isActive) {
      throw ApiError.unauthorized('Kullanıcı adı veya şifre hatalı.');
    }

    const passwordOk = await comparePassword(password, user.passwordHash);
    if (!passwordOk) {
      throw ApiError.unauthorized('Kullanıcı adı veya şifre hatalı.');
    }

    await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));

    if (user.isSystemAdmin) {
      const accessToken = signAccessToken({ sub: user.id, isSystemAdmin: true, permissions: [] }, { rememberMe });
      await logAudit({ userId: user.id, action: 'LOGIN_ADMIN', ipAddress: req.ip });
      return res.json({
        isSystemAdmin: true,
        accessToken,
        rememberMe,
        mustChangePassword: user.mustChangePassword,
        user: { id: user.id, fullName: user.fullName, username: user.username },
      });
    }

    const assignments = await db
      .select({
        projectId: projects.id,
        projectName: projects.name,
        projectCode: projects.code,
        roleId: roles.id,
        roleName: roles.name,
      })
      .from(userProjects)
      .innerJoin(projects, eq(userProjects.projectId, projects.id))
      .innerJoin(roles, eq(userProjects.roleId, roles.id))
      .where(and(eq(userProjects.userId, user.id), eq(userProjects.isActive, true), eq(projects.status, 'AKTIF')));

    if (assignments.length === 0) {
      throw ApiError.forbidden('Herhangi bir aktif projeye/göreve atanmamışsınız. Lütfen sistem yöneticinizle iletişime geçin.');
    }

    const contextToken = signContextToken({ sub: user.id, rememberMe });
    await logAudit({ userId: user.id, action: 'LOGIN_CREDENTIALS_OK', ipAddress: req.ip });

    res.json({
      isSystemAdmin: false,
      contextToken,
      mustChangePassword: user.mustChangePassword,
      user: { id: user.id, fullName: user.fullName, username: user.username },
      assignments,
    });
  })
);

const selectContextSchema = z.object({
  contextToken: z.string().min(1),
  projectId: z.string().min(1),
  roleId: z.string().min(1),
});

// ADIM 2: kullanıcı proje + görev seçimini yapar, tam erişim tokenı üretilir.
router.post(
  '/select-context',
  asyncHandler(async (req, res) => {
    const parsed = selectContextSchema.safeParse(req.body);
    if (!parsed.success) {
      throw ApiError.badRequest('Geçersiz istek.', parsed.error.flatten());
    }
    const { contextToken, projectId, roleId } = parsed.data;
    const decoded = verifyContextToken(contextToken);

    const [assignment] = await db
      .select()
      .from(userProjects)
      .where(
        and(
          eq(userProjects.userId, decoded.sub),
          eq(userProjects.projectId, projectId),
          eq(userProjects.roleId, roleId),
          eq(userProjects.isActive, true)
        )
      )
      .limit(1);

    if (!assignment) {
      throw ApiError.forbidden('Seçilen proje/görev kombinasyonu için yetkiniz bulunmuyor.');
    }

    const [user] = await db.select().from(users).where(eq(users.id, decoded.sub)).limit(1);
    if (!user || !user.isActive) {
      throw ApiError.unauthorized('Kullanıcı bulunamadı veya pasif.');
    }

    const permissionKeys = await getEffectivePermissions(user.id, projectId);

    const accessToken = signAccessToken(
      {
        sub: user.id,
        isSystemAdmin: false,
        projectId,
        roleId,
        permissions: permissionKeys,
      },
      { rememberMe: !!decoded.rememberMe }
    );

    await logAudit({
      userId: user.id,
      action: 'LOGIN_CONTEXT_SELECTED',
      entityType: 'project',
      entityId: projectId,
      details: { roleId },
      ipAddress: req.ip,
    });

    res.json({
      accessToken,
      rememberMe: !!decoded.rememberMe,
      mustChangePassword: user.mustChangePassword,
      user: { id: user.id, fullName: user.fullName, username: user.username },
      context: { projectId, roleId, permissions: permissionKeys },
    });
  })
);

router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const [user] = await db.select().from(users).where(eq(users.id, req.user.sub)).limit(1);
    if (!user) throw ApiError.notFound('Kullanıcı bulunamadı.');

    res.json({
      user: {
        id: user.id,
        fullName: user.fullName,
        username: user.username,
        phone: user.phone,
        email: user.email,
        isSystemAdmin: user.isSystemAdmin,
        mustChangePassword: user.mustChangePassword,
      },
      context: req.user.isSystemAdmin
        ? null
        : { projectId: req.user.projectId, roleId: req.user.roleId, permissions: req.user.permissions },
    });
  })
);

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(1),
});

router.post(
  '/change-password',
  requireAuth,
  asyncHandler(async (req, res) => {
    const parsed = changePasswordSchema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('Geçersiz istek.', parsed.error.flatten());
    const { currentPassword, newPassword } = parsed.data;

    const [user] = await db.select().from(users).where(eq(users.id, req.user.sub)).limit(1);
    if (!user) throw ApiError.notFound('Kullanıcı bulunamadı.');

    const ok = await comparePassword(currentPassword, user.passwordHash);
    if (!ok) throw ApiError.badRequest('Mevcut şifre hatalı.');

    const strengthError = validatePasswordStrength(newPassword);
    if (strengthError) throw ApiError.badRequest(strengthError);

    const passwordHash = await hashPassword(newPassword);
    await db.update(users).set({ passwordHash, mustChangePassword: false }).where(eq(users.id, user.id));

    await logAudit({ userId: user.id, action: 'PASSWORD_CHANGED', ipAddress: req.ip });

    res.json({ success: true });
  })
);

// Davet bağlantısı geçerliyse kullanıcı adı/tam ad gösterilir (şifre belirleme ekranı için).
router.get(
  '/invite/:token',
  inviteLimiter,
  asyncHandler(async (req, res) => {
    const invite = await loadValidInvite(req.params.token);
    if (!invite) throw ApiError.badRequest('Bu davet bağlantısının süresi dolmuş veya daha önce kullanılmış.');

    const [user] = await db.select().from(users).where(eq(users.id, invite.userId)).limit(1);
    if (!user || !user.isActive) throw ApiError.badRequest('Bu davet bağlantısı artık geçerli değil.');

    res.json({ fullName: user.fullName, username: user.username });
  })
);

const inviteSetPasswordSchema = z.object({
  password: z.string().min(1, 'Şifre zorunludur.'),
});

// Kullanıcı davet linki üzerinden kendi şifresini belirler; link tek kullanımlıktır.
router.post(
  '/invite/:token',
  inviteLimiter,
  asyncHandler(async (req, res) => {
    const parsed = inviteSetPasswordSchema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('Geçersiz istek.', parsed.error.flatten());

    const invite = await loadValidInvite(req.params.token);
    if (!invite) throw ApiError.badRequest('Bu davet bağlantısının süresi dolmuş veya daha önce kullanılmış.');

    const [user] = await db.select().from(users).where(eq(users.id, invite.userId)).limit(1);
    if (!user || !user.isActive) throw ApiError.badRequest('Bu davet bağlantısı artık geçerli değil.');

    const strengthError = validatePasswordStrength(parsed.data.password);
    if (strengthError) throw ApiError.badRequest(strengthError);

    const passwordHash = await hashPassword(parsed.data.password);
    await db.update(users).set({ passwordHash, mustChangePassword: false }).where(eq(users.id, user.id));
    await db.update(userInvites).set({ usedAt: new Date() }).where(eq(userInvites.id, invite.id));

    await logAudit({ userId: user.id, action: 'INVITE_PASSWORD_SET', entityType: 'user', entityId: user.id, ipAddress: req.ip });

    res.json({ success: true, username: user.username });
  })
);

module.exports = router;
