// Uçtan uca entegrasyon testleri: gerçek Postgres wire-protokolü konuşan bir
// PGlite (embedded Postgres) örneğine karşı, gerçek Express uygulamasını
// gerçek HTTP üzerinden çalıştırarak test eder. Harici bir veritabanı
// sunucusu ya da Docker gerektirmez.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

let pglite;
let socketServer;
let appServer;
let baseUrl;
let db, schema, bcrypt;

test.before(async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const { PGLiteSocketServer } = await import('@electric-sql/pglite-socket');

  pglite = await PGlite.create();
  socketServer = new PGLiteSocketServer({ db: pglite, port: 0, host: '127.0.0.1', maxConnections: 5 });
  await socketServer.start();

  process.env.DATABASE_URL = `postgresql://postgres:postgres@127.0.0.1:${socketServer.port}/postgres`;
  process.env.JWT_SECRET = 'test-only-secret-value-not-for-production';
  process.env.NODE_ENV = 'test';
  process.env.DB_POOL_MAX = '5';

  // Migrasyonları uygula
  const { Pool } = require('pg');
  const { drizzle } = require('drizzle-orm/node-postgres');
  const { migrate } = require('drizzle-orm/node-postgres/migrator');
  const migPool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const migDb = drizzle(migPool);
  await migrate(migDb, { migrationsFolder: path.join(__dirname, '..', 'drizzle') });
  await migPool.end();

  // DATABASE_URL artık hazır; uygulama modüllerini şimdi require edebiliriz.
  ({ db } = require('../src/db/client'));
  schema = require('../src/db/schema');
  bcrypt = require('bcryptjs');

  // Temel test verisi: roller, izinler, admin kullanıcı
  await db.insert(schema.roles).values([
    { name: 'İSG Uzmanı', description: 'test' },
    { name: 'Formen', description: 'test' },
  ]);

  await db.insert(schema.permissions).values([
    { key: 'uygunsuzluk_gorme', name: 'Uygunsuzlukları Görme' },
    { key: 'uygunsuzluk_acma', name: 'Uygunsuzluk Açma' },
    { key: 'uygunsuzluk_duzeltme', name: 'Uygunsuzluk Düzeltme' },
    { key: 'uygunsuzluk_onaylama', name: 'Uygunsuzluk Kapatma / Onaylama' },
    { key: 'rapor_goruntuleme', name: 'Rapor Görüntüleme' },
    { key: 'rapor_alma', name: 'Rapor Alma (Excel/PDF)' },
    { key: 'cezai_islem', name: 'Cezai İşlem Oluşturma' },
    { key: 'proje_yonetme', name: 'Proje Yönetme' },
    { key: 'kullanici_yonetme', name: 'Kullanıcı Yönetme' },
    { key: 'firma_yonetme', name: 'Firma Yönetme' },
  ]);

  await db.insert(schema.users).values({
    fullName: 'Sistem Admini',
    username: 'admin',
    passwordHash: await bcrypt.hash('AdminTest123!', 4),
    isSystemAdmin: true,
    mustChangePassword: false,
  });

  const { createApp } = require('../src/app');
  const app = createApp();
  appServer = app.listen(0);
  await new Promise((resolve) => appServer.on('listening', resolve));
  const addr = appServer.address();
  baseUrl = `http://127.0.0.1:${addr.port}/api`;
});

test.after(async () => {
  if (appServer) await new Promise((resolve) => appServer.close(resolve));
  const { pool } = require('../src/db/client');
  await pool.end();
  if (socketServer) await socketServer.stop();
  if (pglite) await pglite.close();
});

async function api(method, urlPath, { token, body } = {}) {
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    // gövde olmayabilir
  }
  return { status: res.status, body: json };
}

let adminToken;
let createdProjectId;
let createdRoleId;
let regularUserId;
let regularUserTempPassword;

test('GET /api/health -> 200 ok', async () => {
  const { status, body } = await api('GET', '/health');
  assert.equal(status, 200);
  assert.equal(body.status, 'ok');
});

test('yanlış şifreyle giriş -> 401', async () => {
  const { status } = await api('POST', '/auth/login', { body: { username: 'admin', password: 'yanlis-sifre' } });
  assert.equal(status, 401);
});

test('eksik alanla giriş -> 400', async () => {
  const { status, body } = await api('POST', '/auth/login', { body: { username: 'admin' } });
  assert.equal(status, 400);
  assert.ok(body.error);
});

test('admin girişi -> doğrudan accessToken döner (proje seçimi gerekmez)', async () => {
  const { status, body } = await api('POST', '/auth/login', { body: { username: 'admin', password: 'AdminTest123!' } });
  assert.equal(status, 200);
  assert.equal(body.isSystemAdmin, true);
  assert.ok(body.accessToken);
  adminToken = body.accessToken;
});

test('token olmadan admin rotasına erişim -> 401', async () => {
  const { status } = await api('GET', '/admin/projects');
  assert.equal(status, 401);
});

test('admin: proje oluşturma', async () => {
  const { status, body } = await api('POST', '/admin/projects', {
    token: adminToken,
    body: { name: 'Ankara Konut Projesi', code: 'ANK-001', address: 'Ankara' },
  });
  assert.equal(status, 201);
  assert.equal(body.project.code, 'ANK-001');
  createdProjectId = body.project.id;
});

test('admin: aynı proje kodu ile tekrar oluşturma -> 409', async () => {
  const { status } = await api('POST', '/admin/projects', {
    token: adminToken,
    body: { name: 'Başka Proje', code: 'ANK-001' },
  });
  assert.equal(status, 409);
});

test('admin: geçersiz proje verisiyle oluşturma -> 400', async () => {
  const { status } = await api('POST', '/admin/projects', { token: adminToken, body: { name: 'A' } });
  assert.equal(status, 400);
});

test('admin: projeye blok/bölge ekleme', async () => {
  const { status, body } = await api('POST', `/admin/projects/${createdProjectId}/blocks`, {
    token: adminToken,
    body: { name: 'A Blok' },
  });
  assert.equal(status, 201);
  assert.equal(body.block.name, 'A Blok');
});

test('admin: firma oluşturma', async () => {
  const { status, body } = await api('POST', '/admin/companies', {
    token: adminToken,
    body: { projectId: createdProjectId, name: 'ABC İnşaat', type: 'ANA_FIRMA', sgkNumber: '123456' },
  });
  assert.equal(status, 201);
  assert.equal(body.company.name, 'ABC İnşaat');
});

test('admin: rol listesini görüntüleme', async () => {
  const { status, body } = await api('GET', '/admin/roles', { token: adminToken });
  assert.equal(status, 200);
  assert.ok(body.roles.some((r) => r.name === 'İSG Uzmanı'));
  createdRoleId = body.roles.find((r) => r.name === 'İSG Uzmanı').id;
});

test('admin: yeni kullanıcı oluşturma (geçici şifre döner)', async () => {
  const { status, body } = await api('POST', '/admin/users', {
    token: adminToken,
    body: { fullName: 'Ahmet Yılmaz', username: 'ahmet.yilmaz', phone: '5551112233' },
  });
  assert.equal(status, 201);
  assert.ok(body.tempPassword);
  regularUserId = body.user.id;
  regularUserTempPassword = body.tempPassword;
});

test('admin: kullanıcıyı projeye + göreve atama', async () => {
  const { status, body } = await api('POST', `/admin/users/${regularUserId}/projects`, {
    token: adminToken,
    body: { projectId: createdProjectId, roleId: createdRoleId },
  });
  assert.equal(status, 201);
  assert.equal(body.assignment.projectId, createdProjectId);
});

test('admin: kullanıcıya proje bazlı yetki verme', async () => {
  const { status: permStatus, body: permBody } = await api('GET', '/admin/permissions', { token: adminToken });
  assert.equal(permStatus, 200);
  const perm = permBody.permissions.find((p) => p.key === 'uygunsuzluk_gorme');
  assert.ok(perm);

  const { status, body } = await api('POST', `/admin/users/${regularUserId}/permissions`, {
    token: adminToken,
    body: { permissionId: perm.id, projectId: createdProjectId },
  });
  assert.equal(status, 201);
  assert.equal(body.permission.granted, true);
});

test('yeni kullanıcı geçici şifre ile giriş yapar -> contextToken + atama listesi döner', async () => {
  const { status, body } = await api('POST', '/auth/login', {
    body: { username: 'ahmet.yilmaz', password: regularUserTempPassword },
  });
  assert.equal(status, 200);
  assert.equal(body.isSystemAdmin, false);
  assert.ok(body.contextToken);
  assert.equal(body.mustChangePassword, true);
  assert.equal(body.assignments.length, 1);
  assert.equal(body.assignments[0].projectId, createdProjectId);
  assert.equal(body.assignments[0].roleName, 'İSG Uzmanı');

  // proje/görev seçimi -> tam erişim tokenı
  const select = await api('POST', '/auth/select-context', {
    body: { contextToken: body.contextToken, projectId: createdProjectId, roleId: createdRoleId },
  });
  assert.equal(select.status, 200);
  assert.ok(select.body.accessToken);
  assert.ok(select.body.context.permissions.includes('uygunsuzluk_gorme'));

  // Bu kullanıcı proje_yonetme yetkisine sahip değil -> admin rotasına erişemez
  const forbidden = await api('POST', '/admin/projects', {
    token: select.body.accessToken,
    body: { name: 'Yetkisiz Proje', code: 'YETKISIZ-1' },
  });
  assert.equal(forbidden.status, 403);
});

test('yanlış proje/görev kombinasyonu ile select-context -> 403', async () => {
  const login = await api('POST', '/auth/login', { body: { username: 'ahmet.yilmaz', password: regularUserTempPassword } });
  const select = await api('POST', '/auth/select-context', {
    body: { contextToken: login.body.contextToken, projectId: createdProjectId, roleId: 'olmayan-rol-id' },
  });
  assert.equal(select.status, 403);
});

test('şifre değiştirme akışı', async () => {
  const login = await api('POST', '/auth/login', { body: { username: 'ahmet.yilmaz', password: regularUserTempPassword } });
  const select = await api('POST', '/auth/select-context', {
    body: { contextToken: login.body.contextToken, projectId: createdProjectId, roleId: createdRoleId },
  });
  const token = select.body.accessToken;

  const badAttempt = await api('POST', '/auth/change-password', {
    token,
    body: { currentPassword: 'yanlis', newPassword: 'YeniSifre123' },
  });
  assert.equal(badAttempt.status, 400);

  const ok = await api('POST', '/auth/change-password', {
    token,
    body: { currentPassword: regularUserTempPassword, newPassword: 'YeniSifre123' },
  });
  assert.equal(ok.status, 200);

  // Eski şifreyle artık giriş yapılamaz, yenisiyle yapılabilir.
  const oldLogin = await api('POST', '/auth/login', { body: { username: 'ahmet.yilmaz', password: regularUserTempPassword } });
  assert.equal(oldLogin.status, 401);

  const newLogin = await api('POST', '/auth/login', { body: { username: 'ahmet.yilmaz', password: 'YeniSifre123' } });
  assert.equal(newLogin.status, 200);
  assert.equal(newLogin.body.mustChangePassword, false);
});

test('GET /api/auth/me -> geçerli token ile kullanıcı bilgisi döner', async () => {
  const { status, body } = await api('GET', '/auth/me', { token: adminToken });
  assert.equal(status, 200);
  assert.equal(body.user.username, 'admin');
});

test('projeyi pasif duruma alma', async () => {
  const { status, body } = await api('PATCH', `/admin/projects/${createdProjectId}/status`, {
    token: adminToken,
    body: { status: 'PASIF' },
  });
  assert.equal(status, 200);
  assert.equal(body.project.status, 'PASIF');
});

test('pasif projeye atanmış kullanıcı artık login sonrası atama göremez', async () => {
  const { status, body } = await api('POST', '/auth/login', { body: { username: 'ahmet.yilmaz', password: 'YeniSifre123' } });
  assert.equal(status, 403);
  assert.ok(body.error.message.includes('aktif projeye'));
});

// ---------------------------------------------------------------------------
// FAZ 2+3: Uygunsuzluk açma - atama - düzeltme - onay/red - tarihçe
// ---------------------------------------------------------------------------

test('FAZ2+3: uygunsuzluk açma-kapama tam döngüsü (red + tekrar + onay)', async () => {
  // Bu senaryo bilerek FAZ1 testlerinden bağımsız, tamamen yeni bir proje üzerinde çalışır
  // (FAZ1 testlerinin sonunda ilk proje PASIF durumuna alınıyor).
  const proj = await api('POST', '/admin/projects', { token: adminToken, body: { name: 'Test Şantiyesi 2', code: 'TST-002' } });
  assert.equal(proj.status, 201);
  const projectId = proj.body.project.id;

  const block = await api('POST', `/admin/projects/${projectId}/blocks`, { token: adminToken, body: { name: 'B Blok' } });
  const blockId = block.body.block.id;

  const company = await api('POST', '/admin/companies', {
    token: adminToken,
    body: { projectId, name: 'XYZ Taahhüt', type: 'TASERON' },
  });
  const companyId = company.body.company.id;

  const category = await api('POST', '/admin/categories', { token: adminToken, body: { name: 'İskele', projectId } });
  const categoryId = category.body.category.id;

  const rolesRes = await api('GET', '/admin/roles', { token: adminToken });
  const formenRoleId = rolesRes.body.roles.find((r) => r.name === 'Formen').id;
  const isgRoleId = rolesRes.body.roles.find((r) => r.name === 'İSG Uzmanı').id;

  const permsRes = await api('GET', '/admin/permissions', { token: adminToken });
  const permId = (key) => permsRes.body.permissions.find((p) => p.key === key).id;

  // Açan kullanıcı
  const openerCreate = await api('POST', '/admin/users', {
    token: adminToken,
    body: { fullName: 'Açan Kullanıcı', username: 'acan.kullanici' },
  });
  const openerId = openerCreate.body.user.id;
  await api('POST', `/admin/users/${openerId}/projects`, { token: adminToken, body: { projectId, roleId: formenRoleId } });
  await api('POST', `/admin/users/${openerId}/permissions`, {
    token: adminToken,
    body: { permissionId: permId('uygunsuzluk_acma'), projectId },
  });

  // Sorumlu (atanan) kullanıcı
  const assigneeCreate = await api('POST', '/admin/users', {
    token: adminToken,
    body: { fullName: 'Sorumlu Kullanıcı', username: 'sorumlu.kullanici' },
  });
  const assigneeId = assigneeCreate.body.user.id;
  await api('POST', `/admin/users/${assigneeId}/projects`, { token: adminToken, body: { projectId, roleId: formenRoleId } });

  // Onaylayan İSG uzmanı
  const approverCreate = await api('POST', '/admin/users', {
    token: adminToken,
    body: { fullName: 'Onaylayan Uzman', username: 'onaylayan.uzman' },
  });
  const approverId = approverCreate.body.user.id;
  await api('POST', `/admin/users/${approverId}/projects`, { token: adminToken, body: { projectId, roleId: isgRoleId } });
  await api('POST', `/admin/users/${approverId}/permissions`, {
    token: adminToken,
    body: { permissionId: permId('uygunsuzluk_onaylama'), projectId },
  });
  await api('POST', `/admin/users/${approverId}/permissions`, {
    token: adminToken,
    body: { permissionId: permId('uygunsuzluk_gorme'), projectId },
  });

  async function loginAndSelect(username, password, roleId) {
    const login = await api('POST', '/auth/login', { body: { username, password } });
    const select = await api('POST', '/auth/select-context', {
      body: { contextToken: login.body.contextToken, projectId, roleId },
    });
    return select.body.accessToken;
  }

  const openerToken = await loginAndSelect('acan.kullanici', openerCreate.body.tempPassword, formenRoleId);
  const assigneeToken = await loginAndSelect('sorumlu.kullanici', assigneeCreate.body.tempPassword, formenRoleId);
  const approverToken = await loginAndSelect('onaylayan.uzman', approverCreate.body.tempPassword, isgRoleId);

  // Referans veriler (kategori/blok/firma) açma formunda görünmeli
  const refData = await api('GET', `/nonconformities/reference-data?projectId=${projectId}`, { token: openerToken });
  assert.equal(refData.status, 200);
  assert.ok(refData.body.categories.some((c) => c.id === categoryId));
  assert.ok(refData.body.blocks.some((b) => b.id === blockId));
  assert.ok(refData.body.companies.some((c) => c.id === companyId));

  // Yetkisiz kullanıcı (uygunsuzluk_acma yok) açamaz
  const forbiddenCreate = await api('POST', '/nonconformities', {
    token: assigneeToken,
    body: { assignedUserIds: [assigneeId], description: 'test', dueDate: new Date(Date.now() + 86400000).toISOString() },
  });
  assert.equal(forbiddenCreate.status, 403);

  // Uygunsuzluk açılır (birden fazla kişiye atanabilir)
  const dueDate = new Date(Date.now() + 7 * 86400000).toISOString();
  const createNc = await api('POST', '/nonconformities', {
    token: openerToken,
    body: {
      categoryId,
      blockId,
      companyId,
      assignedUserIds: [assigneeId, approverId],
      description: 'Merdiven korkuluğu eksik.',
      priority: 'YUKSEK',
      dueDate,
    },
  });
  assert.equal(createNc.status, 201);
  const ncId = createNc.body.nonconformity.id;
  assert.match(createNc.body.nonconformity.number, /^\d{4}-TST-002-\d{6}$/);
  assert.equal(createNc.body.nonconformity.status, 'ACIK');

  // Detayda her iki atanan kişi de görünmeli
  const ncDetail = await api('GET', `/nonconformities/${ncId}`, { token: openerToken });
  assert.equal(ncDetail.status, 200);
  const assigneeUserIds = ncDetail.body.nonconformity.assignees.map((a) => a.userId);
  assert.ok(assigneeUserIds.includes(assigneeId));
  assert.ok(assigneeUserIds.includes(approverId));

  // Atanan kişi listede kendi uygunsuzluğunu görür (uygunsuzluk_gorme yetkisi olmasa bile)
  const assigneeList = await api('GET', '/nonconformities', { token: assigneeToken });
  assert.equal(assigneeList.status, 200);
  assert.ok(assigneeList.body.nonconformities.some((n) => n.id === ncId));

  // Atanan kişiye bildirim gitmiş olmalı
  const assigneeNotifications = await api('GET', '/notifications', { token: assigneeToken });
  assert.equal(assigneeNotifications.status, 200);
  assert.ok(assigneeNotifications.body.notifications.some((n) => n.nonconformityId === ncId && !n.isRead));

  const unreadCountRes = await api('GET', '/notifications/unread-count', { token: assigneeToken });
  assert.ok(unreadCountRes.body.count >= 1);

  // Atanan kişi düzeltme gönderir
  const correction1 = await api('POST', `/nonconformities/${ncId}/corrections`, {
    token: assigneeToken,
    body: { description: 'Korkuluk takıldı.' },
  });
  assert.equal(correction1.status, 201);

  // Durum BEKLEMEDE'ye geçmiş olmalı
  const afterSubmit = await api('GET', `/nonconformities/${ncId}`, { token: openerToken });
  assert.equal(afterSubmit.body.nonconformity.status, 'BEKLEMEDE');
  assert.equal(afterSubmit.body.history.length, 2);

  // BEKLEMEDEyken tekrar düzeltme gönderilemez
  const doubleSubmit = await api('POST', `/nonconformities/${ncId}/corrections`, {
    token: assigneeToken,
    body: { description: 'tekrar' },
  });
  assert.equal(doubleSubmit.status, 409);

  // Onay yetkisi olmayan biri onaylayamaz
  const openerApproveAttempt = await api('POST', `/nonconformities/${ncId}/corrections/${correction1.body.correction.id}/approve`, {
    token: openerToken,
  });
  assert.equal(openerApproveAttempt.status, 403);

  // İSG uzmanı reddeder (gerekçe zorunlu)
  const rejectNoReason = await api('POST', `/nonconformities/${ncId}/corrections/${correction1.body.correction.id}/reject`, {
    token: approverToken,
    body: {},
  });
  assert.equal(rejectNoReason.status, 400);

  const reject = await api('POST', `/nonconformities/${ncId}/corrections/${correction1.body.correction.id}/reject`, {
    token: approverToken,
    body: { reviewNote: 'Fotoğraf net değil, tekrar çekin.' },
  });
  assert.equal(reject.status, 200);

  const afterReject = await api('GET', `/nonconformities/${ncId}`, { token: openerToken });
  assert.equal(afterReject.body.nonconformity.status, 'ACIK');

  // Atanan kişi tekrar düzeltme gönderir
  const correction2 = await api('POST', `/nonconformities/${ncId}/corrections`, {
    token: assigneeToken,
    body: { description: 'Korkuluk tekrar sağlamlaştırıldı, net fotoğraf eklendi.' },
  });
  assert.equal(correction2.status, 201);

  // İSG uzmanı onaylar -> KAPALI
  const approve = await api('POST', `/nonconformities/${ncId}/corrections/${correction2.body.correction.id}/approve`, {
    token: approverToken,
  });
  assert.equal(approve.status, 200);

  const final = await api('GET', `/nonconformities/${ncId}`, { token: approverToken });
  assert.equal(final.body.nonconformity.status, 'KAPALI');
  assert.ok(final.body.nonconformity.closedAt);
  assert.equal(final.body.corrections.length, 2);
  // Tarihçe: oluşturuldu, ilk gönderim, red, ikinci gönderim, onay = 5 kayıt
  assert.equal(final.body.history.length, 5);
});

test('R2 yapılandırılmamışsa presign-upload 400 döner (bu test ortamında env yok)', async () => {
  const res = await api('POST', '/uploads/presign-upload', {
    token: adminToken,
    body: { fileName: 'foto.jpg', contentType: 'image/jpeg' },
  });
  assert.equal(res.status, 400);
});

// ---------------------------------------------------------------------------
// Regresyon: yetki değişikliği aynı oturum tokenıyla anında etkili olmalı
// (JWT'ye gömülü eski yetkilere güvenilmemeli, her istekte DB'den tazelenmeli).
// ---------------------------------------------------------------------------
test('yetki değişikliği yeniden giriş yapmadan aynı token ile anında etkili olur', async () => {
  const proj = await api('POST', '/admin/projects', { token: adminToken, body: { name: 'Test Şantiyesi 3', code: 'TST-003' } });
  const projectId = proj.body.project.id;

  const rolesRes = await api('GET', '/admin/roles', { token: adminToken });
  const formenRoleId = rolesRes.body.roles.find((r) => r.name === 'Formen').id;

  const permsRes = await api('GET', '/admin/permissions', { token: adminToken });
  const uygunsuzlukAcmaId = permsRes.body.permissions.find((p) => p.key === 'uygunsuzluk_acma').id;

  const userCreate = await api('POST', '/admin/users', {
    token: adminToken,
    body: { fullName: 'Canlı Yetki Testi', username: 'canli.yetki.testi' },
  });
  const userId = userCreate.body.user.id;
  await api('POST', `/admin/users/${userId}/projects`, { token: adminToken, body: { projectId, roleId: formenRoleId } });

  // Kişi kendisine uygunsuzluk atayamadığından, bu testte açan kişiden ayrı bir sorumlu gerekir.
  const otherUserCreate = await api('POST', '/admin/users', {
    token: adminToken,
    body: { fullName: 'Canlı Yetki Sorumlusu', username: 'canli.yetki.sorumlu' },
  });
  const otherUserId = otherUserCreate.body.user.id;
  await api('POST', `/admin/users/${otherUserId}/projects`, { token: adminToken, body: { projectId, roleId: formenRoleId } });

  const login = await api('POST', '/auth/login', { body: { username: 'canli.yetki.testi', password: userCreate.body.tempPassword } });
  const select = await api('POST', '/auth/select-context', {
    body: { contextToken: login.body.contextToken, projectId, roleId: formenRoleId },
  });
  const token = select.body.accessToken; // Bu token'ın permissions claim'i boş üretildi.

  // Henüz yetki verilmedi -> açma denemesi reddedilmeli.
  const beforeGrant = await api('POST', '/nonconformities', {
    token,
    body: { description: 'test açıklama', assignedUserIds: [otherUserId], dueDate: new Date(Date.now() + 86400000).toISOString() },
  });
  assert.equal(beforeGrant.status, 403);

  // Admin yetkiyi verir (kullanıcı hiç re-login olmaz, aynı token'ı kullanmaya devam eder).
  await api('POST', `/admin/users/${userId}/permissions`, {
    token: adminToken,
    body: { permissionId: uygunsuzlukAcmaId, projectId },
  });

  // /auth/me artık yeni yetkiyi göstermeli.
  const me = await api('GET', '/auth/me', { token });
  assert.ok(me.body.context.permissions.includes('uygunsuzluk_acma'));

  // Aynı token ile aynı işlem artık kabul edilmeli.
  const afterGrant = await api('POST', '/nonconformities', {
    token,
    body: { description: 'test açıklama', assignedUserIds: [otherUserId], dueDate: new Date(Date.now() + 86400000).toISOString() },
  });
  assert.equal(afterGrant.status, 201);

  // Yetkiyi geri al -> aynı token ile artık tekrar reddedilmeli.
  const grantedList = await api('GET', `/admin/users/${userId}`, { token: adminToken });
  const grantRowId = grantedList.body.permissions.find((p) => p.permissionId === uygunsuzlukAcmaId).id;
  await api('DELETE', `/admin/users/${userId}/permissions/${grantRowId}`, { token: adminToken });

  const afterRevoke = await api('POST', '/nonconformities', {
    token,
    body: { description: 'test açıklama 2', assignedUserIds: [otherUserId], dueDate: new Date(Date.now() + 86400000).toISOString() },
  });
  assert.equal(afterRevoke.status, 403);
});

// ---------------------------------------------------------------------------
// Rapor uç noktası: günlük/haftalık/aylık özet istatistikler
// ---------------------------------------------------------------------------
test('rapor: yetkisi olan kullanıcı kendi istatistiklerini görür, olmayan 403 alır', async () => {
  const proj = await api('POST', '/admin/projects', { token: adminToken, body: { name: 'Test Şantiyesi 4', code: 'TST-004' } });
  const projectId = proj.body.project.id;

  const rolesRes = await api('GET', '/admin/roles', { token: adminToken });
  const formenRoleId = rolesRes.body.roles.find((r) => r.name === 'Formen').id;

  const permsRes = await api('GET', '/admin/permissions', { token: adminToken });
  const permId = (key) => permsRes.body.permissions.find((p) => p.key === key).id;

  const userCreate = await api('POST', '/admin/users', {
    token: adminToken,
    body: { fullName: 'Rapor Testi', username: 'rapor.testi' },
  });
  const userId = userCreate.body.user.id;
  await api('POST', `/admin/users/${userId}/projects`, { token: adminToken, body: { projectId, roleId: formenRoleId } });
  await api('POST', `/admin/users/${userId}/permissions`, { token: adminToken, body: { permissionId: permId('uygunsuzluk_acma'), projectId } });

  // Kişi kendisine atama yapamadığından, açtığı uygunsuzluğu atayabileceği ayrı bir kullanıcı gerekir.
  const otherCreate = await api('POST', '/admin/users', { token: adminToken, body: { fullName: 'Rapor Testi Sorumlu', username: 'rapor.testi.sorumlu' } });
  const otherUserId = otherCreate.body.user.id;
  await api('POST', `/admin/users/${otherUserId}/projects`, { token: adminToken, body: { projectId, roleId: formenRoleId } });

  const login = await api('POST', '/auth/login', { body: { username: 'rapor.testi', password: userCreate.body.tempPassword } });
  const select = await api('POST', '/auth/select-context', {
    body: { contextToken: login.body.contextToken, projectId, roleId: formenRoleId },
  });
  const token = select.body.accessToken;

  // rapor_goruntuleme yetkisi henüz yok -> 403
  const forbidden = await api('GET', '/nonconformities/report?range=today', { token });
  assert.equal(forbidden.status, 403);

  // Bir uygunsuzluk açar (başka bir kişiye atar - kendine atayamaz)
  const createNc = await api('POST', '/nonconformities', {
    token,
    body: {
      description: 'Rapor testi için uygunsuzluk',
      assignedUserIds: [otherUserId],
      dueDate: new Date(Date.now() + 86400000).toISOString(),
    },
  });
  assert.equal(createNc.status, 201);

  // myAssigned istatistiğini test edebilmek için admin, bu kullanıcıya atanmış ayrı bir uygunsuzluk açar.
  const createNc2 = await api('POST', '/nonconformities', {
    token: adminToken,
    body: {
      projectId,
      description: 'Rapor testi için admin tarafından açılan uygunsuzluk',
      assignedUserIds: [userId],
      dueDate: new Date(Date.now() + 86400000).toISOString(),
    },
  });
  assert.equal(createNc2.status, 201);

  // Admin rapor_goruntuleme yetkisini verir
  await api('POST', `/admin/users/${userId}/permissions`, { token: adminToken, body: { permissionId: permId('rapor_goruntuleme'), projectId } });

  const report = await api('GET', '/nonconformities/report?range=today', { token });
  assert.equal(report.status, 200);
  assert.equal(report.body.range, 'today');
  assert.ok(report.body.totalOpened >= 2);
  assert.ok(report.body.myOpened >= 1);
  assert.ok(report.body.myAssigned >= 1);
  assert.equal(report.body.myClosed, 0);

  // Admin, projectId belirterek herhangi bir projenin raporuna erişebilir
  const adminReport = await api('GET', `/nonconformities/report?range=month&projectId=${projectId}`, { token: adminToken });
  assert.equal(adminReport.status, 200);
  assert.ok(adminReport.body.totalOpened >= 1);
});

// ---------------------------------------------------------------------------
// Çalışan + risk skoru + ceza (penalty) sistemi ve termin uyarı zamanlayıcısı
// ---------------------------------------------------------------------------
test('çalışan kaydı, risk skoru, ceza talebi ve onay akışı', async () => {
  const { eq } = require('drizzle-orm');

  const proj = await api('POST', '/admin/projects', { token: adminToken, body: { name: 'Test Şantiyesi 5', code: 'TST-005' } });
  const projectId = proj.body.project.id;

  const rolesRes = await api('GET', '/admin/roles', { token: adminToken });
  const formenRoleId = rolesRes.body.roles.find((r) => r.name === 'Formen').id;

  const permsRes = await api('GET', '/admin/permissions', { token: adminToken });
  const permId = (key) => permsRes.body.permissions.find((p) => p.key === key).id;

  const company = await api('POST', '/admin/companies', { token: adminToken, body: { projectId, name: 'Ceza Taşeron', type: 'TASERON' } });
  const companyId = company.body.company.id;

  // Açan + onaylayan (uygunsuzluk_onaylama ve cezai_islem yetkileriyle)
  const openerCreate = await api('POST', '/admin/users', { token: adminToken, body: { fullName: 'Ceza Açan', username: 'ceza.acan' } });
  const openerId = openerCreate.body.user.id;
  await api('POST', `/admin/users/${openerId}/projects`, { token: adminToken, body: { projectId, roleId: formenRoleId } });
  await api('POST', `/admin/users/${openerId}/permissions`, { token: adminToken, body: { permissionId: permId('uygunsuzluk_acma'), projectId } });

  const approverCreate = await api('POST', '/admin/users', { token: adminToken, body: { fullName: 'Ceza Onaylayan', username: 'ceza.onaylayan' } });
  const approverId = approverCreate.body.user.id;
  await api('POST', `/admin/users/${approverId}/projects`, { token: adminToken, body: { projectId, roleId: formenRoleId } });
  await api('POST', `/admin/users/${approverId}/permissions`, { token: adminToken, body: { permissionId: permId('cezai_islem'), projectId } });

  async function loginAndSelect(username, password) {
    const login = await api('POST', '/auth/login', { body: { username, password } });
    const select = await api('POST', '/auth/select-context', {
      body: { contextToken: login.body.contextToken, projectId, roleId: formenRoleId },
    });
    return select.body.accessToken;
  }
  const openerToken = await loginAndSelect('ceza.acan', openerCreate.body.tempPassword);
  const approverToken = await loginAndSelect('ceza.onaylayan', approverCreate.body.tempPassword);

  // Çalışan oluştur
  const empCreate = await api('POST', '/employees', {
    token: openerToken,
    body: { companyId, fullName: 'Uygunsuz Davranış Sergileyen Çalışan', nationalId: '12345678901' },
  });
  assert.equal(empCreate.status, 201);
  const employeeId = empCreate.body.employee.id;

  // Çalışan firma filtresiyle listede görünmeli
  const empList = await api('GET', `/employees?companyId=${companyId}`, { token: openerToken });
  assert.equal(empList.status, 200);
  assert.ok(empList.body.employees.some((e) => e.id === employeeId));

  // Risk skorlu, çalışana bağlı, düzeltme önerili uygunsuzluk açılır
  const createNc = await api('POST', '/nonconformities', {
    token: openerToken,
    body: {
      companyId,
      employeeId,
      description: 'Baret takılmadan çalışma tespit edildi.',
      correctionSuggestion: 'Çalışma durdurulmalı, baret temin edilmeden devam edilmemeli.',
      riskScore: 4,
      assignedUserIds: [approverId],
      dueDate: new Date(Date.now() + 86400000).toISOString(),
    },
  });
  assert.equal(createNc.status, 201);
  const ncId = createNc.body.nonconformity.id;

  const detailBefore = await api('GET', `/nonconformities/${ncId}`, { token: openerToken });
  assert.equal(detailBefore.body.nonconformity.riskScore, 4);
  assert.equal(detailBefore.body.nonconformity.employeeName, 'Uygunsuz Davranış Sergileyen Çalışan');
  assert.equal(detailBefore.body.nonconformity.canRequestPenalty, false); // termin henüz dolmadı

  // Termin süresini geçmişe al (gerçek zamanlayıcıyı beklemeden test etmek için)
  await db.update(schema.nonconformities).set({ dueDate: new Date(Date.now() - 1000) }).where(eq(schema.nonconformities.id, ncId));

  const detailAfter = await api('GET', `/nonconformities/${ncId}`, { token: openerToken });
  assert.equal(detailAfter.body.nonconformity.canRequestPenalty, true);

  // Açan kişi olmayan biri ceza talep edemez
  const otherAttempt = await api('POST', `/nonconformities/${ncId}/penalty-request`, {
    token: approverToken,
    body: { reason: 'test gerekçe metni', sanctionType: 'PARA_CEZASI' },
  });
  assert.equal(otherAttempt.status, 403);

  // Açan kişi ceza talep eder
  const penaltyReq = await api('POST', `/nonconformities/${ncId}/penalty-request`, {
    token: openerToken,
    body: { reason: 'Termin süresi aşıldı, uygunsuzluk hâlâ açık.', sanctionType: 'PARA_CEZASI', suggestedAmount: 2500 },
  });
  assert.equal(penaltyReq.status, 201);
  assert.equal(penaltyReq.body.employeePriorApprovedCount, 0);
  const penaltyId = penaltyReq.body.penalty.id;

  // cezai_islem yetkisi olmayan biri onaylayamaz
  const openerApproveAttempt = await api('POST', `/penalties/${penaltyId}/approve`, { token: openerToken });
  assert.equal(openerApproveAttempt.status, 403);

  // Ceza listesinde görünmeli (BEKLEMEDE)
  const pendingList = await api('GET', `/penalties?projectId=${projectId}&status=BEKLEMEDE`, { token: approverToken });
  assert.equal(pendingList.status, 200);
  assert.ok(pendingList.body.penalties.some((p) => p.id === penaltyId));

  // Yetkili onaylar
  const approve = await api('POST', `/penalties/${penaltyId}/approve`, { token: approverToken, body: { decisionNote: 'Onaylandı.' } });
  assert.equal(approve.status, 200);

  const finalizedList = await api('GET', `/penalties?projectId=${projectId}&status=ONAYLANDI`, { token: approverToken });
  assert.ok(finalizedList.body.penalties.some((p) => p.id === penaltyId && p.decidedByName === 'Ceza Onaylayan'));

  // İkinci bir ceza talebinde tekrar suç sayısı 1 olmalı (bu çalışan için 1 onaylanmış ceza var)
  await db.update(schema.nonconformities).set({ status: 'ACIK' }).where(eq(schema.nonconformities.id, ncId));
  const secondPenaltyReq = await api('POST', `/nonconformities/${ncId}/penalty-request`, {
    token: openerToken,
    body: { reason: 'Tekrar termin aşımı.', sanctionType: 'UYARI' },
  });
  assert.equal(secondPenaltyReq.status, 201);
  assert.equal(secondPenaltyReq.body.employeePriorApprovedCount, 1);
});

test('zamanlayıcı: termin %66 dolduğunda atanan kişiye bildirim gönderir', async () => {
  const { eq } = require('drizzle-orm');
  const { checkDeadlineReminders } = require('../src/services/scheduler.service');

  const proj = await api('POST', '/admin/projects', { token: adminToken, body: { name: 'Test Şantiyesi 6', code: 'TST-006' } });
  const projectId = proj.body.project.id;
  const rolesRes = await api('GET', '/admin/roles', { token: adminToken });
  const formenRoleId = rolesRes.body.roles.find((r) => r.name === 'Formen').id;
  const permsRes = await api('GET', '/admin/permissions', { token: adminToken });
  const permId = (key) => permsRes.body.permissions.find((p) => p.key === key).id;

  const userCreate = await api('POST', '/admin/users', { token: adminToken, body: { fullName: 'Zamanlayıcı Testi', username: 'zamanlayici.testi' } });
  const userId = userCreate.body.user.id;
  await api('POST', `/admin/users/${userId}/projects`, { token: adminToken, body: { projectId, roleId: formenRoleId } });
  await api('POST', `/admin/users/${userId}/permissions`, { token: adminToken, body: { permissionId: permId('uygunsuzluk_acma'), projectId } });

  // Kişi kendisine atama yapamadığından, bildirimi alacak ayrı bir sorumlu kullanıcı gerekir.
  const assigneeCreate = await api('POST', '/admin/users', { token: adminToken, body: { fullName: 'Zamanlayıcı Sorumlusu', username: 'zamanlayici.sorumlu' } });
  const assigneeId = assigneeCreate.body.user.id;
  await api('POST', `/admin/users/${assigneeId}/projects`, { token: adminToken, body: { projectId, roleId: formenRoleId } });

  const login = await api('POST', '/auth/login', { body: { username: 'zamanlayici.testi', password: userCreate.body.tempPassword } });
  const select = await api('POST', '/auth/select-context', { body: { contextToken: login.body.contextToken, projectId, roleId: formenRoleId } });
  const token = select.body.accessToken;

  const assigneeLogin = await api('POST', '/auth/login', { body: { username: 'zamanlayici.sorumlu', password: assigneeCreate.body.tempPassword } });
  const assigneeSelect = await api('POST', '/auth/select-context', { body: { contextToken: assigneeLogin.body.contextToken, projectId, roleId: formenRoleId } });
  const assigneeToken = assigneeSelect.body.accessToken;

  const createNc = await api('POST', '/nonconformities', {
    token,
    body: { description: 'Zamanlayıcı testi için uygunsuzluk', assignedUserIds: [assigneeId], dueDate: new Date(Date.now() + 86400000).toISOString() },
  });
  const ncId = createNc.body.nonconformity.id;

  // Oluşturulma zamanını geriye alarak süresinin %66'sının dolmuş gibi görünmesini sağla
  // (createdAt 20 saat önce, dueDate 4 saat sonra -> toplam 24 saat, geçen %83).
  await db
    .update(schema.nonconformities)
    .set({ createdAt: new Date(Date.now() - 20 * 3600000), dueDate: new Date(Date.now() + 4 * 3600000) })
    .where(eq(schema.nonconformities.id, ncId));

  await checkDeadlineReminders();

  const notifs = await api('GET', '/notifications', { token: assigneeToken });
  assert.ok(notifs.body.notifications.some((n) => n.nonconformityId === ncId && n.title === 'Termin süresi dolmak üzere'));

  // İkinci çalıştırmada tekrar bildirim gitmemeli (deadlineReminderSentAt işaretlendi)
  await checkDeadlineReminders();
  const notifsAfter = await api('GET', '/notifications', { token: assigneeToken });
  const reminderCount = notifsAfter.body.notifications.filter((n) => n.nonconformityId === ncId && n.title === 'Termin süresi dolmak üzere').length;
  assert.equal(reminderCount, 1);
});

test('push: subscription kaydet/sil ve vapid public key uçları', async () => {
  const proj = await api('POST', '/admin/projects', { token: adminToken, body: { name: 'Test Şantiyesi 7', code: 'TST-007' } });
  const projectId = proj.body.project.id;
  const rolesRes = await api('GET', '/admin/roles', { token: adminToken });
  const formenRoleId = rolesRes.body.roles.find((r) => r.name === 'Formen').id;

  const userCreate = await api('POST', '/admin/users', { token: adminToken, body: { fullName: 'Push Testi', username: 'push.testi' } });
  const userId = userCreate.body.user.id;
  await api('POST', `/admin/users/${userId}/projects`, { token: adminToken, body: { projectId, roleId: formenRoleId } });

  const login = await api('POST', '/auth/login', { body: { username: 'push.testi', password: userCreate.body.tempPassword } });
  const select = await api('POST', '/auth/select-context', { body: { contextToken: login.body.contextToken, projectId, roleId: formenRoleId } });
  const token = select.body.accessToken;

  const vapid = await api('GET', '/push/vapid-public-key', { token });
  assert.equal(vapid.status, 200);
  assert.ok('publicKey' in vapid.body);

  const sub = await api('POST', '/push/subscribe', {
    token,
    body: {
      endpoint: 'https://fcm.googleapis.com/fcm/send/test-endpoint-1',
      keys: { p256dh: 'test-p256dh-key', auth: 'test-auth-key' },
    },
  });
  assert.equal(sub.status, 200);

  // Aynı endpoint tekrar gönderilirse hata vermemeli (upsert)
  const subAgain = await api('POST', '/push/subscribe', {
    token,
    body: {
      endpoint: 'https://fcm.googleapis.com/fcm/send/test-endpoint-1',
      keys: { p256dh: 'test-p256dh-key-2', auth: 'test-auth-key-2' },
    },
  });
  assert.equal(subAgain.status, 200);

  const unsub = await api('POST', '/push/unsubscribe', {
    token,
    body: { endpoint: 'https://fcm.googleapis.com/fcm/send/test-endpoint-1' },
  });
  assert.equal(unsub.status, 200);

  // Token yoksa 401
  const noAuth = await api('GET', '/push/vapid-public-key', {});
  assert.equal(noAuth.status, 401);
});

test('davet bağlantısı: oluşturma, geçerli token ile şifre belirleme, tek kullanımlık olması', async () => {
  const proj = await api('POST', '/admin/projects', { token: adminToken, body: { name: 'Test Şantiyesi 8', code: 'TST-008' } });
  const projectId = proj.body.project.id;
  const rolesRes = await api('GET', '/admin/roles', { token: adminToken });
  const formenRoleId = rolesRes.body.roles.find((r) => r.name === 'Formen').id;

  const userCreate = await api('POST', '/admin/users', {
    token: adminToken,
    body: { fullName: 'Davet Testi', username: 'davet.testi', phone: '0555 111 22 33' },
  });
  const userId = userCreate.body.user.id;
  await api('POST', `/admin/users/${userId}/projects`, { token: adminToken, body: { projectId, roleId: formenRoleId } });

  const invite = await api('POST', `/admin/users/${userId}/invite-link`, { token: adminToken });
  assert.equal(invite.status, 200);
  assert.ok(invite.body.token);
  assert.equal(invite.body.username, 'davet.testi');
  assert.equal(invite.body.whatsappPhone, '905551112233');

  // Token ile kullanıcı bilgisi görüntülenebilmeli (auth gerektirmez)
  const lookup = await api('GET', `/auth/invite/${invite.body.token}`, {});
  assert.equal(lookup.status, 200);
  assert.equal(lookup.body.username, 'davet.testi');

  // Zayıf şifre reddedilmeli
  const weak = await api('POST', `/auth/invite/${invite.body.token}`, { body: { password: 'abc' } });
  assert.equal(weak.status, 400);

  // Geçerli şifre kabul edilmeli
  const setPw = await api('POST', `/auth/invite/${invite.body.token}`, { body: { password: 'YeniSifre123' } });
  assert.equal(setPw.status, 200);

  // Aynı token tekrar kullanılamamalı
  const reuse = await api('POST', `/auth/invite/${invite.body.token}`, { body: { password: 'BaskaSifre456' } });
  assert.equal(reuse.status, 400);

  // Belirlenen şifreyle giriş yapılabilmeli, mustChangePassword false olmalı
  const login = await api('POST', '/auth/login', { body: { username: 'davet.testi', password: 'YeniSifre123' } });
  assert.equal(login.status, 200);
  assert.equal(login.body.mustChangePassword, false);

  // Geçersiz token 400 dönmeli
  const invalid = await api('GET', '/auth/invite/gecersiz-token-xyz', {});
  assert.equal(invalid.status, 400);
});

test('atanabilir kişiler: firma seçilince yalnızca o firmaya özel + genel atanmış kişiler listelenir', async () => {
  const proj = await api('POST', '/admin/projects', { token: adminToken, body: { name: 'Test Şantiyesi 9', code: 'TST-009' } });
  const projectId = proj.body.project.id;

  const companyA = await api('POST', '/admin/companies', { token: adminToken, body: { projectId, name: 'A Taşeron', type: 'TASERON' } });
  const companyAId = companyA.body.company.id;
  const companyB = await api('POST', '/admin/companies', { token: adminToken, body: { projectId, name: 'B Taşeron', type: 'TASERON' } });
  const companyBId = companyB.body.company.id;

  const rolesRes = await api('GET', '/admin/roles', { token: adminToken });
  const formenRoleId = rolesRes.body.roles.find((r) => r.name === 'Formen').id;
  const permsRes = await api('GET', '/admin/permissions', { token: adminToken });
  const permId = (key) => permsRes.body.permissions.find((p) => p.key === key).id;

  async function createProjectUser(username, companyId) {
    const created = await api('POST', '/admin/users', { token: adminToken, body: { fullName: username, username } });
    const userId = created.body.user.id;
    await api('POST', `/admin/users/${userId}/projects`, { token: adminToken, body: { projectId, roleId: formenRoleId, companyId: companyId || undefined } });
    return userId;
  }

  const userA = await createProjectUser('firma.a.calisani', companyAId);
  const userB = await createProjectUser('firma.b.calisani', companyBId);
  const userGeneral = await createProjectUser('genel.yetkili', null);

  // Açan kullanıcı (genel kapsamda, uygunsuzluk_acma yetkili)
  const openerCreate = await api('POST', '/admin/users', { token: adminToken, body: { fullName: 'Açan Kişi 2', username: 'acan.kisi.2' } });
  const openerId = openerCreate.body.user.id;
  await api('POST', `/admin/users/${openerId}/projects`, { token: adminToken, body: { projectId, roleId: formenRoleId } });
  await api('POST', `/admin/users/${openerId}/permissions`, { token: adminToken, body: { permissionId: permId('uygunsuzluk_acma'), projectId } });

  const login = await api('POST', '/auth/login', { body: { username: 'acan.kisi.2', password: openerCreate.body.tempPassword } });
  const select = await api('POST', '/auth/select-context', { body: { contextToken: login.body.contextToken, projectId, roleId: formenRoleId } });
  const openerToken = select.body.accessToken;

  // companyId verilmezse projedeki herkes listelenir
  const allUsers = await api('GET', `/nonconformities/assignable-users?projectId=${projectId}`, { token: openerToken });
  assert.equal(allUsers.status, 200);
  const allIds = allUsers.body.users.map((u) => u.userId);
  assert.ok(allIds.includes(userA) && allIds.includes(userB) && allIds.includes(userGeneral));

  // companyId=A verilince: A çalışanı + genel yetkili görünür, B çalışanı görünmez
  const forCompanyA = await api('GET', `/nonconformities/assignable-users?projectId=${projectId}&companyId=${companyAId}`, { token: openerToken });
  assert.equal(forCompanyA.status, 200);
  const idsForA = forCompanyA.body.users.map((u) => u.userId);
  assert.ok(idsForA.includes(userA), 'A firmasına atanmış kişi listede olmalı');
  assert.ok(idsForA.includes(userGeneral), 'Genel yetkili kişi listede olmalı');
  assert.ok(!idsForA.includes(userB), 'B firmasına atanmış kişi A firması listesinde olmamalı');

  // Aynı kullanıcı tekilleştirilmiş olmalı (tek satır)
  assert.equal(idsForA.filter((id) => id === userA).length, 1);
});

test('ceza onaylama: gerçek tarayıcı isteği gibi Content-Type/gövde olmadan da çalışmalı; talep sahibi kendi talebini onaylayamaz', async () => {
  const { eq } = require('drizzle-orm');

  const proj = await api('POST', '/admin/projects', { token: adminToken, body: { name: 'Test Şantiyesi 10', code: 'TST-010' } });
  const projectId = proj.body.project.id;
  const rolesRes = await api('GET', '/admin/roles', { token: adminToken });
  const formenRoleId = rolesRes.body.roles.find((r) => r.name === 'Formen').id;
  const permsRes = await api('GET', '/admin/permissions', { token: adminToken });
  const permId = (key) => permsRes.body.permissions.find((p) => p.key === key).id;

  // Açan kişi hem uygunsuzluk_acma hem cezai_islem yetkisine sahip (kendi talebini
  // onaylamaya çalışacak, engellenmeli).
  const openerCreate = await api('POST', '/admin/users', { token: adminToken, body: { fullName: 'Çift Yetkili Açan', username: 'cift.yetkili.acan' } });
  const openerId = openerCreate.body.user.id;
  await api('POST', `/admin/users/${openerId}/projects`, { token: adminToken, body: { projectId, roleId: formenRoleId } });
  await api('POST', `/admin/users/${openerId}/permissions`, { token: adminToken, body: { permissionId: permId('uygunsuzluk_acma'), projectId } });
  await api('POST', `/admin/users/${openerId}/permissions`, { token: adminToken, body: { permissionId: permId('cezai_islem'), projectId } });

  const assigneeCreate = await api('POST', '/admin/users', { token: adminToken, body: { fullName: 'Diğer Sorumlu', username: 'diger.sorumlu.10' } });
  const assigneeId = assigneeCreate.body.user.id;
  await api('POST', `/admin/users/${assigneeId}/projects`, { token: adminToken, body: { projectId, roleId: formenRoleId } });

  const login = await api('POST', '/auth/login', { body: { username: 'cift.yetkili.acan', password: openerCreate.body.tempPassword } });
  const select = await api('POST', '/auth/select-context', { body: { contextToken: login.body.contextToken, projectId, roleId: formenRoleId } });
  const openerToken = select.body.accessToken;

  const createNc = await api('POST', '/nonconformities', {
    token: openerToken,
    body: {
      description: 'Yangın söndürme tüpü eksik.',
      assignedUserIds: [assigneeId],
      dueDate: new Date(Date.now() + 86400000).toISOString(),
    },
  });
  const ncId = createNc.body.nonconformity.id;
  await db.update(schema.nonconformities).set({ dueDate: new Date(Date.now() - 1000) }).where(eq(schema.nonconformities.id, ncId));

  const penaltyReq = await api('POST', `/nonconformities/${ncId}/penalty-request`, {
    token: openerToken,
    body: { reason: 'Termin süresi aşıldı.', sanctionType: 'UYARI' },
  });
  assert.equal(penaltyReq.status, 201);
  const penaltyId = penaltyReq.body.penalty.id;

  // Talep sahibi, cezai_islem yetkisi olsa dahi kendi talebini onaylayamaz.
  const selfApprove = await fetch(`${baseUrl}/penalties/${penaltyId}/approve`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${openerToken}` },
  });
  assert.equal(selfApprove.status, 403);

  // Aynı şekilde kendi talebini reddedemez.
  const selfReject = await fetch(`${baseUrl}/penalties/${penaltyId}/reject`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${openerToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ decisionNote: 'kendi kendine red denemesi' }),
  });
  assert.equal(selfReject.status, 403);

  // Admin, tarayıcının gerçekte gönderdiği gibi Content-Type/gövde OLMADAN onaylayabilmeli
  // (bu, "onayla butonu çalışmıyor" hatasının tam olarak sebebiydi: axios.post(url) gövdesiz
  // istek atınca Content-Type göndermiyor, req.body undefined kalıyor, zod parse'ı 400 veriyordu).
  const adminApprove = await fetch(`${baseUrl}/penalties/${penaltyId}/approve`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.equal(adminApprove.status, 200);

  const check = await api('GET', `/penalties?projectId=${projectId}&status=ONAYLANDI`, { token: openerToken });
  assert.ok(check.body.penalties.some((p) => p.id === penaltyId));
});

test('bekleyen ceza talebi varken tekrar talep oluşturulamaz; canRequestPenalty/hasPendingPenalty doğru yansır', async () => {
  const { eq } = require('drizzle-orm');

  const proj = await api('POST', '/admin/projects', { token: adminToken, body: { name: 'Test Şantiyesi 11', code: 'TST-011' } });
  const projectId = proj.body.project.id;
  const rolesRes = await api('GET', '/admin/roles', { token: adminToken });
  const formenRoleId = rolesRes.body.roles.find((r) => r.name === 'Formen').id;
  const permsRes = await api('GET', '/admin/permissions', { token: adminToken });
  const permId = (key) => permsRes.body.permissions.find((p) => p.key === key).id;

  const openerCreate = await api('POST', '/admin/users', { token: adminToken, body: { fullName: 'Tekrar Talep Açan', username: 'tekrar.talep.acan' } });
  const openerId = openerCreate.body.user.id;
  await api('POST', `/admin/users/${openerId}/projects`, { token: adminToken, body: { projectId, roleId: formenRoleId } });
  await api('POST', `/admin/users/${openerId}/permissions`, { token: adminToken, body: { permissionId: permId('uygunsuzluk_acma'), projectId } });

  const assigneeCreate = await api('POST', '/admin/users', { token: adminToken, body: { fullName: 'Tekrar Talep Sorumlu', username: 'tekrar.talep.sorumlu' } });
  const assigneeId = assigneeCreate.body.user.id;
  await api('POST', `/admin/users/${assigneeId}/projects`, { token: adminToken, body: { projectId, roleId: formenRoleId } });

  const login = await api('POST', '/auth/login', { body: { username: 'tekrar.talep.acan', password: openerCreate.body.tempPassword } });
  const select = await api('POST', '/auth/select-context', { body: { contextToken: login.body.contextToken, projectId, roleId: formenRoleId } });
  const openerToken = select.body.accessToken;

  const createNc = await api('POST', '/nonconformities', {
    token: openerToken,
    body: { description: 'Elektrik panosu açık bırakılmış.', assignedUserIds: [assigneeId], dueDate: new Date(Date.now() + 86400000).toISOString() },
  });
  const ncId = createNc.body.nonconformity.id;
  await db.update(schema.nonconformities).set({ dueDate: new Date(Date.now() - 1000) }).where(eq(schema.nonconformities.id, ncId));

  const before = await api('GET', `/nonconformities/${ncId}`, { token: openerToken });
  assert.equal(before.body.nonconformity.canRequestPenalty, true);
  assert.equal(before.body.nonconformity.hasPendingPenalty, false);

  const first = await api('POST', `/nonconformities/${ncId}/penalty-request`, {
    token: openerToken,
    body: { reason: 'Termin süresi aşıldı, ilk talep.', sanctionType: 'UYARI' },
  });
  assert.equal(first.status, 201);

  const after = await api('GET', `/nonconformities/${ncId}`, { token: openerToken });
  assert.equal(after.body.nonconformity.canRequestPenalty, false);
  assert.equal(after.body.nonconformity.hasPendingPenalty, true);

  // İkinci talep, birincisi hâlâ beklemedeyken reddedilmeli
  const second = await api('POST', `/nonconformities/${ncId}/penalty-request`, {
    token: openerToken,
    body: { reason: 'Termin süresi aşıldı, ikinci talep.', sanctionType: 'UYARI' },
  });
  assert.equal(second.status, 409);
});

test('beni hatırla: işaretlenince uzun ömürlü (30 gün), işaretlenmeyince kısa ömürlü (12 saat) token verilir', async () => {
  const jwt = require('jsonwebtoken');

  const proj = await api('POST', '/admin/projects', { token: adminToken, body: { name: 'Test Şantiyesi 12', code: 'TST-012' } });
  const projectId = proj.body.project.id;
  const rolesRes = await api('GET', '/admin/roles', { token: adminToken });
  const formenRoleId = rolesRes.body.roles.find((r) => r.name === 'Formen').id;

  const userCreate = await api('POST', '/admin/users', { token: adminToken, body: { fullName: 'Hatırla Testi', username: 'hatirla.testi' } });
  const userId = userCreate.body.user.id;
  await api('POST', `/admin/users/${userId}/projects`, { token: adminToken, body: { projectId, roleId: formenRoleId } });

  // rememberMe: true
  const loginRemember = await api('POST', '/auth/login', { body: { username: 'hatirla.testi', password: userCreate.body.tempPassword, rememberMe: true } });
  const selectRemember = await api('POST', '/auth/select-context', {
    body: { contextToken: loginRemember.body.contextToken, projectId, roleId: formenRoleId },
  });
  assert.equal(selectRemember.body.rememberMe, true);
  const decodedRemember = jwt.decode(selectRemember.body.accessToken);
  const remainingRemember = decodedRemember.exp - decodedRemember.iat;
  assert.ok(remainingRemember > 20 * 86400, 'Beni hatırla işaretliyse token en az ~20 gün geçerli olmalı');

  // rememberMe: false
  const loginNoRemember = await api('POST', '/auth/login', { body: { username: 'hatirla.testi', password: userCreate.body.tempPassword, rememberMe: false } });
  const selectNoRemember = await api('POST', '/auth/select-context', {
    body: { contextToken: loginNoRemember.body.contextToken, projectId, roleId: formenRoleId },
  });
  assert.equal(selectNoRemember.body.rememberMe, false);
  const decodedNoRemember = jwt.decode(selectNoRemember.body.accessToken);
  const remainingNoRemember = decodedNoRemember.exp - decodedNoRemember.iat;
  assert.ok(remainingNoRemember < 13 * 3600, 'Beni hatırla işaretli değilse token ~12 saat geçerli olmalı');
});

test('kişi kendisine uygunsuzluk atayamaz', async () => {
  const proj = await api('POST', '/admin/projects', { token: adminToken, body: { name: 'Test Şantiyesi 13', code: 'TST-013' } });
  const projectId = proj.body.project.id;
  const rolesRes = await api('GET', '/admin/roles', { token: adminToken });
  const formenRoleId = rolesRes.body.roles.find((r) => r.name === 'Formen').id;
  const permsRes = await api('GET', '/admin/permissions', { token: adminToken });
  const permId = (key) => permsRes.body.permissions.find((p) => p.key === key).id;

  const userCreate = await api('POST', '/admin/users', { token: adminToken, body: { fullName: 'Kendine Atama Testi', username: 'kendine.atama.testi' } });
  const userId = userCreate.body.user.id;
  await api('POST', `/admin/users/${userId}/projects`, { token: adminToken, body: { projectId, roleId: formenRoleId } });
  await api('POST', `/admin/users/${userId}/permissions`, { token: adminToken, body: { permissionId: permId('uygunsuzluk_acma'), projectId } });

  const login = await api('POST', '/auth/login', { body: { username: 'kendine.atama.testi', password: userCreate.body.tempPassword } });
  const select = await api('POST', '/auth/select-context', { body: { contextToken: login.body.contextToken, projectId, roleId: formenRoleId } });
  const token = select.body.accessToken;

  const attempt = await api('POST', '/nonconformities', {
    token,
    body: { description: 'Kendime atama denemesi', assignedUserIds: [userId], dueDate: new Date(Date.now() + 86400000).toISOString() },
  });
  assert.equal(attempt.status, 400);
});

test('uygunsuzluk düzenleme/silme: admin ve açan kişi yapabilir, başkası yapamaz; kapalı kayıt yalnızca admin tarafından silinebilir', async () => {
  const { eq } = require('drizzle-orm');
  const proj = await api('POST', '/admin/projects', { token: adminToken, body: { name: 'Test Şantiyesi 14', code: 'TST-014' } });
  const projectId = proj.body.project.id;
  const rolesRes = await api('GET', '/admin/roles', { token: adminToken });
  const formenRoleId = rolesRes.body.roles.find((r) => r.name === 'Formen').id;
  const permsRes = await api('GET', '/admin/permissions', { token: adminToken });
  const permId = (key) => permsRes.body.permissions.find((p) => p.key === key).id;

  const openerCreate = await api('POST', '/admin/users', { token: adminToken, body: { fullName: 'Düzenleme Açan', username: 'duzenleme.acan' } });
  const openerId = openerCreate.body.user.id;
  await api('POST', `/admin/users/${openerId}/projects`, { token: adminToken, body: { projectId, roleId: formenRoleId } });
  await api('POST', `/admin/users/${openerId}/permissions`, { token: adminToken, body: { permissionId: permId('uygunsuzluk_acma'), projectId } });

  const assigneeCreate = await api('POST', '/admin/users', { token: adminToken, body: { fullName: 'Düzenleme Sorumlu', username: 'duzenleme.sorumlu' } });
  const assigneeId = assigneeCreate.body.user.id;
  await api('POST', `/admin/users/${assigneeId}/projects`, { token: adminToken, body: { projectId, roleId: formenRoleId } });

  const otherCreate = await api('POST', '/admin/users', { token: adminToken, body: { fullName: 'İlgisiz Kullanıcı', username: 'ilgisiz.kullanici' } });
  const otherId = otherCreate.body.user.id;
  await api('POST', `/admin/users/${otherId}/projects`, { token: adminToken, body: { projectId, roleId: formenRoleId } });

  async function loginAndSelect(username, password) {
    const login = await api('POST', '/auth/login', { body: { username, password } });
    const select = await api('POST', '/auth/select-context', { body: { contextToken: login.body.contextToken, projectId, roleId: formenRoleId } });
    return select.body.accessToken;
  }
  const openerToken = await loginAndSelect('duzenleme.acan', openerCreate.body.tempPassword);
  const otherToken = await loginAndSelect('ilgisiz.kullanici', otherCreate.body.tempPassword);

  const createNc = await api('POST', '/nonconformities', {
    token: openerToken,
    body: { description: 'Düzenlenecek uygunsuzluk.', assignedUserIds: [assigneeId], dueDate: new Date(Date.now() + 86400000).toISOString() },
  });
  const ncId = createNc.body.nonconformity.id;

  // İlgisiz kullanıcı düzenleyemez/silemez
  const forbiddenEdit = await api('PATCH', `/nonconformities/${ncId}`, { token: otherToken, body: { description: 'Yetkisiz düzenleme denemesi metni' } });
  assert.equal(forbiddenEdit.status, 403);
  const forbiddenDelete = await api('DELETE', `/nonconformities/${ncId}`, { token: otherToken });
  assert.equal(forbiddenDelete.status, 403);

  // Açan kişi düzenleyebilir
  const edit = await api('PATCH', `/nonconformities/${ncId}`, { token: openerToken, body: { description: 'Güncellenmiş açıklama metni.', priority: 'KRITIK' } });
  assert.equal(edit.status, 200);
  assert.equal(edit.body.nonconformity.description, 'Güncellenmiş açıklama metni.');
  assert.equal(edit.body.nonconformity.priority, 'KRITIK');

  // Açan kişi kendini sorumlu olarak ataması engellenir (edit sırasında da)
  const editSelfAssign = await api('PATCH', `/nonconformities/${ncId}`, { token: openerToken, body: { assignedUserIds: [openerId] } });
  assert.equal(editSelfAssign.status, 400);

  // Açan kişi silebilir (henüz kapalı değil)
  const deleteByOpener = await api('DELETE', `/nonconformities/${ncId}`, { token: openerToken });
  assert.equal(deleteByOpener.status, 200);

  const afterDelete = await api('GET', `/nonconformities/${ncId}`, { token: openerToken });
  assert.equal(afterDelete.status, 404);

  // Kapalı bir kaydı açan kişi silemez, yalnızca admin silebilir
  const createNc2 = await api('POST', '/nonconformities', {
    token: openerToken,
    body: { description: 'Kapatılacak uygunsuzluk.', assignedUserIds: [assigneeId], dueDate: new Date(Date.now() + 86400000).toISOString() },
  });
  const ncId2 = createNc2.body.nonconformity.id;
  await db.update(schema.nonconformities).set({ status: 'KAPALI' }).where(eq(schema.nonconformities.id, ncId2));

  const deleteClosedByOpener = await api('DELETE', `/nonconformities/${ncId2}`, { token: openerToken });
  assert.equal(deleteClosedByOpener.status, 403);

  const deleteClosedByAdmin = await api('DELETE', `/nonconformities/${ncId2}`, { token: adminToken });
  assert.equal(deleteClosedByAdmin.status, 200);
});

test('admin: proje sıfırlama, proje kodu onayı ile tüm uygunsuzlukları siler', async () => {
  const proj = await api('POST', '/admin/projects', { token: adminToken, body: { name: 'Test Şantiyesi 15', code: 'TST-015' } });
  const projectId = proj.body.project.id;
  const rolesRes = await api('GET', '/admin/roles', { token: adminToken });
  const formenRoleId = rolesRes.body.roles.find((r) => r.name === 'Formen').id;
  const permsRes = await api('GET', '/admin/permissions', { token: adminToken });
  const permId = (key) => permsRes.body.permissions.find((p) => p.key === key).id;

  const openerCreate = await api('POST', '/admin/users', { token: adminToken, body: { fullName: 'Sıfırlama Açan', username: 'sifirlama.acan' } });
  const openerId = openerCreate.body.user.id;
  await api('POST', `/admin/users/${openerId}/projects`, { token: adminToken, body: { projectId, roleId: formenRoleId } });
  await api('POST', `/admin/users/${openerId}/permissions`, { token: adminToken, body: { permissionId: permId('uygunsuzluk_acma'), projectId } });

  const assigneeCreate = await api('POST', '/admin/users', { token: adminToken, body: { fullName: 'Sıfırlama Sorumlu', username: 'sifirlama.sorumlu' } });
  const assigneeId = assigneeCreate.body.user.id;
  await api('POST', `/admin/users/${assigneeId}/projects`, { token: adminToken, body: { projectId, roleId: formenRoleId } });

  const login = await api('POST', '/auth/login', { body: { username: 'sifirlama.acan', password: openerCreate.body.tempPassword } });
  const select = await api('POST', '/auth/select-context', { body: { contextToken: login.body.contextToken, projectId, roleId: formenRoleId } });
  const openerToken = select.body.accessToken;

  await api('POST', '/nonconformities', { token: openerToken, body: { description: 'Sıfırlanacak kayıt 1.', assignedUserIds: [assigneeId], dueDate: new Date(Date.now() + 86400000).toISOString() } });
  await api('POST', '/nonconformities', { token: openerToken, body: { description: 'Sıfırlanacak kayıt 2.', assignedUserIds: [assigneeId], dueDate: new Date(Date.now() + 86400000).toISOString() } });

  // proje_yonetme yetkisi olsa dahi sistem admini olmayan biri sıfırlayamaz
  await api('POST', `/admin/users/${openerId}/permissions`, { token: adminToken, body: { permissionId: permId('proje_yonetme'), projectId } });
  const nonAdminAttempt = await api('POST', `/admin/projects/${projectId}/reset-nonconformities`, { token: openerToken, body: { confirmCode: 'TST-015' } });
  assert.equal(nonAdminAttempt.status, 403);

  // Yanlış proje kodu ile sıfırlama reddedilir
  const wrongCode = await api('POST', `/admin/projects/${projectId}/reset-nonconformities`, { token: adminToken, body: { confirmCode: 'YANLIS-KOD' } });
  assert.equal(wrongCode.status, 400);

  // Doğru kodla admin sıfırlayabilir
  const reset = await api('POST', `/admin/projects/${projectId}/reset-nonconformities`, { token: adminToken, body: { confirmCode: 'TST-015' } });
  assert.equal(reset.status, 200);
  assert.equal(reset.body.deletedCount, 2);

  const listAfter = await api('GET', `/nonconformities?projectId=${projectId}`, { token: adminToken });
  assert.equal(listAfter.body.nonconformities.length, 0);
});

test('ek süre talebi: atanan talep eder, açan onaylar/reddeder, admin doğrudan uzatabilir', async () => {
  const { eq } = require('drizzle-orm');

  const proj = await api('POST', '/admin/projects', { token: adminToken, body: { name: 'Test Şantiyesi 16', code: 'TST-016' } });
  const projectId = proj.body.project.id;
  const rolesRes = await api('GET', '/admin/roles', { token: adminToken });
  const formenRoleId = rolesRes.body.roles.find((r) => r.name === 'Formen').id;
  const permsRes = await api('GET', '/admin/permissions', { token: adminToken });
  const permId = (key) => permsRes.body.permissions.find((p) => p.key === key).id;

  const openerCreate = await api('POST', '/admin/users', { token: adminToken, body: { fullName: 'Ek Süre Açan', username: 'eksure.acan' } });
  const openerId = openerCreate.body.user.id;
  await api('POST', `/admin/users/${openerId}/projects`, { token: adminToken, body: { projectId, roleId: formenRoleId } });
  await api('POST', `/admin/users/${openerId}/permissions`, { token: adminToken, body: { permissionId: permId('uygunsuzluk_acma'), projectId } });

  const assigneeCreate = await api('POST', '/admin/users', { token: adminToken, body: { fullName: 'Ek Süre Sorumlu', username: 'eksure.sorumlu' } });
  const assigneeId = assigneeCreate.body.user.id;
  await api('POST', `/admin/users/${assigneeId}/projects`, { token: adminToken, body: { projectId, roleId: formenRoleId } });

  const otherCreate = await api('POST', '/admin/users', { token: adminToken, body: { fullName: 'Ek Süre İlgisiz', username: 'eksure.ilgisiz' } });
  const otherId = otherCreate.body.user.id;
  await api('POST', `/admin/users/${otherId}/projects`, { token: adminToken, body: { projectId, roleId: formenRoleId } });

  async function loginAndSelect(username, password) {
    const login = await api('POST', '/auth/login', { body: { username, password } });
    const select = await api('POST', '/auth/select-context', { body: { contextToken: login.body.contextToken, projectId, roleId: formenRoleId } });
    return select.body.accessToken;
  }
  const openerToken = await loginAndSelect('eksure.acan', openerCreate.body.tempPassword);
  const assigneeToken = await loginAndSelect('eksure.sorumlu', assigneeCreate.body.tempPassword);
  const otherToken = await loginAndSelect('eksure.ilgisiz', otherCreate.body.tempPassword);

  const createNc = await api('POST', '/nonconformities', {
    token: openerToken,
    body: { description: 'Ek süre testi için uygunsuzluk.', assignedUserIds: [assigneeId], dueDate: new Date(Date.now() + 86400000).toISOString() },
  });
  const ncId = createNc.body.nonconformity.id;
  const originalDueDate = createNc.body.nonconformity.dueDate;

  // İlgisiz biri (atanmamış, admin değil) talep edemez
  const forbiddenReq = await api('POST', `/nonconformities/${ncId}/extension-request`, {
    token: otherToken,
    body: { requestedNewDueDate: new Date(Date.now() + 5 * 86400000).toISOString(), reason: 'İlgisiz kişi denemesi' },
  });
  assert.equal(forbiddenReq.status, 403);

  // Atanan kişi talep eder
  const newDate1 = new Date(Date.now() + 5 * 86400000).toISOString();
  const extReq1 = await api('POST', `/nonconformities/${ncId}/extension-request`, {
    token: assigneeToken,
    body: { requestedNewDueDate: newDate1, reason: 'Malzeme tedariki bekleniyor.' },
  });
  assert.equal(extReq1.status, 201);
  const extId1 = extReq1.body.extension.id;

  // Bekleyen talep varken ikinci talep reddedilir
  const dupReq = await api('POST', `/nonconformities/${ncId}/extension-request`, {
    token: assigneeToken,
    body: { requestedNewDueDate: newDate1, reason: 'Tekrar deneme.' },
  });
  assert.equal(dupReq.status, 409);

  const detailPending = await api('GET', `/nonconformities/${ncId}`, { token: assigneeToken });
  assert.equal(detailPending.body.nonconformity.hasPendingExtension, true);
  assert.equal(detailPending.body.dueDateExtensions.length, 1);

  // İlgisiz biri (açan değil, admin değil) onaylayamaz
  const forbiddenApprove = await api('POST', `/nonconformities/${ncId}/extension-request/${extId1}/approve`, { token: otherToken });
  assert.equal(forbiddenApprove.status, 403);

  // Açan kişi reddeder
  const reject1 = await api('POST', `/nonconformities/${ncId}/extension-request/${extId1}/reject`, {
    token: openerToken,
    body: { decisionNote: 'Yeterli gerekçe değil.' },
  });
  assert.equal(reject1.status, 200);

  const afterReject = await api('GET', `/nonconformities/${ncId}`, { token: openerToken });
  assert.equal(afterReject.body.nonconformity.dueDate, originalDueDate); // termin değişmedi
  assert.equal(afterReject.body.nonconformity.hasPendingExtension, false);

  // Yeni bir talep açılır, bu kez açan kişi onaylar
  const newDate2 = new Date(Date.now() + 10 * 86400000).toISOString();
  const extReq2 = await api('POST', `/nonconformities/${ncId}/extension-request`, {
    token: assigneeToken,
    body: { requestedNewDueDate: newDate2, reason: 'Hava koşulları nedeniyle iş durduruldu.' },
  });
  assert.equal(extReq2.status, 201);
  const extId2 = extReq2.body.extension.id;

  const approve2 = await api('POST', `/nonconformities/${ncId}/extension-request/${extId2}/approve`, {
    token: openerToken,
    body: { decisionNote: 'Uygun, onaylandı.' },
  });
  assert.equal(approve2.status, 200);

  const afterApprove = await api('GET', `/nonconformities/${ncId}`, { token: openerToken });
  assert.equal(new Date(afterApprove.body.nonconformity.dueDate).toISOString(), newDate2);
  assert.equal(afterApprove.body.dueDateExtensions.find((e) => e.id === extId2).status, 'ONAYLANDI');

  // Admin doğrudan (bekleyen talep olmadan) termin uzatabilir
  const newDate3 = new Date(Date.now() + 20 * 86400000).toISOString();
  const adminExtend = await api('POST', `/nonconformities/${ncId}/extend-due-date`, {
    token: adminToken,
    body: { newDueDate: newDate3, note: 'Saha koşulları nedeniyle admin kararı.' },
  });
  assert.equal(adminExtend.status, 200);

  const finalDetail = await api('GET', `/nonconformities/${ncId}`, { token: openerToken });
  assert.equal(new Date(finalDetail.body.nonconformity.dueDate).toISOString(), newDate3);
  assert.equal(finalDetail.body.dueDateExtensions.length, 3);

  // proje_yonetme dahil, admin olmayan biri /extend-due-date kullanamaz
  await api('POST', `/admin/users/${openerId}/permissions`, { token: adminToken, body: { permissionId: permId('proje_yonetme'), projectId } });
  const nonAdminExtend = await api('POST', `/nonconformities/${ncId}/extend-due-date`, {
    token: openerToken,
    body: { newDueDate: new Date(Date.now() + 30 * 86400000).toISOString() },
  });
  assert.equal(nonAdminExtend.status, 403);
});

test('zamanlayıcı: termin dolunca açana ve atanana ayrı bildirimler gönderir', async () => {
  const { eq } = require('drizzle-orm');
  const { checkDeadlineExpirations } = require('../src/services/scheduler.service');

  const proj = await api('POST', '/admin/projects', { token: adminToken, body: { name: 'Test Şantiyesi 17', code: 'TST-017' } });
  const projectId = proj.body.project.id;
  const rolesRes = await api('GET', '/admin/roles', { token: adminToken });
  const formenRoleId = rolesRes.body.roles.find((r) => r.name === 'Formen').id;
  const permsRes = await api('GET', '/admin/permissions', { token: adminToken });
  const permId = (key) => permsRes.body.permissions.find((p) => p.key === key).id;

  const openerCreate = await api('POST', '/admin/users', { token: adminToken, body: { fullName: 'Dolum Testi Açan', username: 'dolum.testi.acan' } });
  const openerId = openerCreate.body.user.id;
  await api('POST', `/admin/users/${openerId}/projects`, { token: adminToken, body: { projectId, roleId: formenRoleId } });
  await api('POST', `/admin/users/${openerId}/permissions`, { token: adminToken, body: { permissionId: permId('uygunsuzluk_acma'), projectId } });

  const assigneeCreate = await api('POST', '/admin/users', { token: adminToken, body: { fullName: 'Dolum Testi Sorumlu', username: 'dolum.testi.sorumlu' } });
  const assigneeId = assigneeCreate.body.user.id;
  await api('POST', `/admin/users/${assigneeId}/projects`, { token: adminToken, body: { projectId, roleId: formenRoleId } });

  async function loginAndSelect(username, password) {
    const login = await api('POST', '/auth/login', { body: { username, password } });
    const select = await api('POST', '/auth/select-context', { body: { contextToken: login.body.contextToken, projectId, roleId: formenRoleId } });
    return select.body.accessToken;
  }
  const openerToken = await loginAndSelect('dolum.testi.acan', openerCreate.body.tempPassword);
  const assigneeToken = await loginAndSelect('dolum.testi.sorumlu', assigneeCreate.body.tempPassword);

  const createNc = await api('POST', '/nonconformities', {
    token: openerToken,
    body: { description: 'Dolum testi için uygunsuzluk.', assignedUserIds: [assigneeId], dueDate: new Date(Date.now() + 86400000).toISOString() },
  });
  const ncId = createNc.body.nonconformity.id;

  await db.update(schema.nonconformities).set({ dueDate: new Date(Date.now() - 1000) }).where(eq(schema.nonconformities.id, ncId));

  await checkDeadlineExpirations();

  const openerNotifs = await api('GET', '/notifications', { token: openerToken });
  assert.ok(openerNotifs.body.notifications.some((n) => n.nonconformityId === ncId && n.message.includes('Cezai işlem başlatabilirsiniz')));

  const assigneeNotifs = await api('GET', '/notifications', { token: assigneeToken });
  assert.ok(assigneeNotifs.body.notifications.some((n) => n.nonconformityId === ncId && n.message.includes('ek süre talep ediniz')));

  // İkinci çalıştırmada tekrar bildirim gitmemeli
  await checkDeadlineExpirations();
  const openerNotifsAfter = await api('GET', '/notifications', { token: openerToken });
  const count = openerNotifsAfter.body.notifications.filter((n) => n.nonconformityId === ncId && n.title === 'Termin süresi doldu').length;
  assert.equal(count, 1);
});

test('GET /penalties/mine: talep ettiğim ve hakkımda olabilecek cezaları (özel yetki gerektirmeden) döner', async () => {
  const { eq } = require('drizzle-orm');

  const proj = await api('POST', '/admin/projects', { token: adminToken, body: { name: 'Test Şantiyesi 18', code: 'TST-018' } });
  const projectId = proj.body.project.id;
  const rolesRes = await api('GET', '/admin/roles', { token: adminToken });
  const formenRoleId = rolesRes.body.roles.find((r) => r.name === 'Formen').id;
  const permsRes = await api('GET', '/admin/permissions', { token: adminToken });
  const permId = (key) => permsRes.body.permissions.find((p) => p.key === key).id;

  const openerCreate = await api('POST', '/admin/users', { token: adminToken, body: { fullName: 'Cezalarım Açan', username: 'cezalarim.acan' } });
  const openerId = openerCreate.body.user.id;
  await api('POST', `/admin/users/${openerId}/projects`, { token: adminToken, body: { projectId, roleId: formenRoleId } });
  await api('POST', `/admin/users/${openerId}/permissions`, { token: adminToken, body: { permissionId: permId('uygunsuzluk_acma'), projectId } });

  const assigneeCreate = await api('POST', '/admin/users', { token: adminToken, body: { fullName: 'Cezalarım Sorumlu', username: 'cezalarim.sorumlu' } });
  const assigneeId = assigneeCreate.body.user.id;
  await api('POST', `/admin/users/${assigneeId}/projects`, { token: adminToken, body: { projectId, roleId: formenRoleId } });

  const login = await api('POST', '/auth/login', { body: { username: 'cezalarim.acan', password: openerCreate.body.tempPassword } });
  const select = await api('POST', '/auth/select-context', { body: { contextToken: login.body.contextToken, projectId, roleId: formenRoleId } });
  const openerToken = select.body.accessToken;

  const assigneeLogin = await api('POST', '/auth/login', { body: { username: 'cezalarim.sorumlu', password: assigneeCreate.body.tempPassword } });
  const assigneeSelect = await api('POST', '/auth/select-context', { body: { contextToken: assigneeLogin.body.contextToken, projectId, roleId: formenRoleId } });
  const assigneeToken = assigneeSelect.body.accessToken;

  const createNc = await api('POST', '/nonconformities', {
    token: openerToken,
    body: { description: 'Cezalarım testi için uygunsuzluk.', assignedUserIds: [assigneeId], dueDate: new Date(Date.now() + 86400000).toISOString() },
  });
  const ncId = createNc.body.nonconformity.id;
  await db.update(schema.nonconformities).set({ dueDate: new Date(Date.now() - 1000) }).where(eq(schema.nonconformities.id, ncId));

  const penaltyReq = await api('POST', `/nonconformities/${ncId}/penalty-request`, {
    token: openerToken,
    body: { reason: 'Termin süresi aşıldı.', sanctionType: 'UYARI' },
  });
  assert.equal(penaltyReq.status, 201);

  // Atanan kişi (cezai_islem yetkisi yok) kendi hakkında olabilecek cezayı /mine üzerinden görebilmeli
  const assigneeMine = await api('GET', '/penalties/mine', { token: assigneeToken });
  assert.equal(assigneeMine.status, 200);
  assert.ok(assigneeMine.body.penalties.some((p) => p.nonconformityId === ncId && p.openedByName === 'Cezalarım Açan' && p.requestedByName === 'Cezalarım Açan'));

  // Açan kişi de (talep sahibi olarak) /mine üzerinden görebilmeli
  const openerMine = await api('GET', '/penalties/mine', { token: openerToken });
  assert.ok(openerMine.body.penalties.some((p) => p.nonconformityId === ncId));

  // İlgisiz biri /penalties (genel liste) uçuna cezai_islem yetkisi olmadan erişemez, ama /mine herkese açık
  const otherCreate = await api('POST', '/admin/users', { token: adminToken, body: { fullName: 'Cezalarım İlgisiz', username: 'cezalarim.ilgisiz' } });
  const otherId = otherCreate.body.user.id;
  await api('POST', `/admin/users/${otherId}/projects`, { token: adminToken, body: { projectId, roleId: formenRoleId } });
  const otherLogin = await api('POST', '/auth/login', { body: { username: 'cezalarim.ilgisiz', password: otherCreate.body.tempPassword } });
  const otherSelect = await api('POST', '/auth/select-context', { body: { contextToken: otherLogin.body.contextToken, projectId, roleId: formenRoleId } });
  const otherToken = otherSelect.body.accessToken;

  const forbiddenList = await api('GET', `/penalties?projectId=${projectId}&status=BEKLEMEDE`, { token: otherToken });
  assert.equal(forbiddenList.status, 403);

  const otherMine = await api('GET', '/penalties/mine', { token: otherToken });
  assert.equal(otherMine.status, 200);
  assert.ok(!otherMine.body.penalties.some((p) => p.nonconformityId === ncId));
});

test('rapor: özel tarih aralığı ve admin için tam kayıt dışa aktarma (full-export)', async () => {
  const proj = await api('POST', '/admin/projects', { token: adminToken, body: { name: 'Test Şantiyesi 19', code: 'TST-019' } });
  const projectId = proj.body.project.id;
  const rolesRes = await api('GET', '/admin/roles', { token: adminToken });
  const formenRoleId = rolesRes.body.roles.find((r) => r.name === 'Formen').id;
  const permsRes = await api('GET', '/admin/permissions', { token: adminToken });
  const permId = (key) => permsRes.body.permissions.find((p) => p.key === key).id;

  const openerCreate = await api('POST', '/admin/users', { token: adminToken, body: { fullName: 'Özel Aralık Açan', username: 'ozel.aralik.acan' } });
  const openerId = openerCreate.body.user.id;
  await api('POST', `/admin/users/${openerId}/projects`, { token: adminToken, body: { projectId, roleId: formenRoleId } });
  await api('POST', `/admin/users/${openerId}/permissions`, { token: adminToken, body: { permissionId: permId('uygunsuzluk_acma'), projectId } });
  await api('POST', `/admin/users/${openerId}/permissions`, { token: adminToken, body: { permissionId: permId('rapor_goruntuleme'), projectId } });

  const assigneeCreate = await api('POST', '/admin/users', { token: adminToken, body: { fullName: 'Özel Aralık Sorumlu', username: 'ozel.aralik.sorumlu' } });
  const assigneeId = assigneeCreate.body.user.id;
  await api('POST', `/admin/users/${assigneeId}/projects`, { token: adminToken, body: { projectId, roleId: formenRoleId } });

  const login = await api('POST', '/auth/login', { body: { username: 'ozel.aralik.acan', password: openerCreate.body.tempPassword } });
  const select = await api('POST', '/auth/select-context', { body: { contextToken: login.body.contextToken, projectId, roleId: formenRoleId } });
  const token = select.body.accessToken;

  await api('POST', '/nonconformities', {
    token,
    body: { description: 'Özel aralık raporu testi.', assignedUserIds: [assigneeId], dueDate: new Date(Date.now() + 86400000).toISOString() },
  });

  const from = new Date(Date.now() - 3600000).toISOString();
  const to = new Date(Date.now() + 3600000).toISOString();

  // from/to eksikse 400
  const missingRange = await api('GET', '/nonconformities/report?range=custom', { token });
  assert.equal(missingRange.status, 400);

  const customReport = await api('GET', `/nonconformities/report?range=custom&from=${from}&to=${to}`, { token });
  assert.equal(customReport.status, 200);
  assert.equal(customReport.body.range, 'custom');
  assert.ok(customReport.body.totalOpened >= 1);

  // Aralık dışında (geçmişte kalan) bir pencere seçilirse kayıt görünmemeli
  const pastFrom = new Date(Date.now() - 10 * 86400000).toISOString();
  const pastTo = new Date(Date.now() - 5 * 86400000).toISOString();
  const emptyRangeReport = await api('GET', `/nonconformities/report?range=custom&from=${pastFrom}&to=${pastTo}`, { token });
  assert.equal(emptyRangeReport.body.totalOpened, 0);

  // full-export: proje_yonetme dahil admin olmayanlar kullanamaz
  await api('POST', `/admin/users/${openerId}/permissions`, { token: adminToken, body: { permissionId: permId('proje_yonetme'), projectId } });
  const nonAdminExport = await api('GET', `/nonconformities/full-export?projectId=${projectId}&from=${from}&to=${to}`, { token });
  assert.equal(nonAdminExport.status, 403);

  // Admin tam listeyi çekebilir
  const fullExport = await api('GET', `/nonconformities/full-export?projectId=${projectId}&from=${from}&to=${to}`, { token: adminToken });
  assert.equal(fullExport.status, 200);
  assert.ok(fullExport.body.nonconformities.length >= 1);
  const row = fullExport.body.nonconformities[0];
  assert.equal(row.openedByName, 'Özel Aralık Açan');
  assert.equal(row.assigneeNames, 'Özel Aralık Sorumlu');
});


// ---------------------------------------------------------------------------
// Çalışanlar sekmesi: firma bazlı liste, arama/sıralama, Excel içe aktarma (diff ile arşivleme),
// manuel çıkış tarihi girme ve yeniden aktif etme.
// ---------------------------------------------------------------------------

test('çalışanlar: Excel içe aktarma (gerçek şablon formatı, oluşturma/güncelleme/tarihsiz arşivleme), arama, sıralama, manuel çıkış', async () => {
  const proj = await api('POST', '/admin/projects', { token: adminToken, body: { name: 'Test Şantiyesi 20', code: 'TST-020' } });
  const projectId = proj.body.project.id;

  const companyA = await api('POST', '/admin/companies', { token: adminToken, body: { projectId, name: 'Çalışan Firması A', type: 'TASERON' } });
  const companyAId = companyA.body.company.id;
  await api('POST', '/admin/companies', { token: adminToken, body: { projectId, name: 'Çalışan Firması B', type: 'TASERON' } });

  const rolesRes = await api('GET', '/admin/roles', { token: adminToken });
  const formenRoleId = rolesRes.body.roles.find((r) => r.name === 'Formen').id;
  const permsRes = await api('GET', '/admin/permissions', { token: adminToken });
  const permId = (key) => permsRes.body.permissions.find((p) => p.key === key).id;

  // İlk yükleme: 2 geçerli satır + 1 eksik (görevi olmayan, bu yüzden atlanması gereken) satır.
  const firstImport = await api('POST', '/employees/import', {
    token: adminToken,
    body: {
      projectId,
      companyId: companyAId,
      rows: [
        {
          fullName: 'Ali Veli',
          nationalId: '11111111110',
          position: 'Elektrikçi',
          startDate: '2024-01-10',
          isgTrainingDate: '2024-01-05',
          isgTrainingExpiryDate: '2099-01-05',
          medicalExamDate: '2099-06-01',
          startWorkTrainingNote: 'ATAMA YOK',
          ek2Note: '2024-01-10',
          healthAuthoritySignatureNote: 'Var',
          isgRole: 'Çalışan Temsilcisi',
        },
        { fullName: 'Ayşe Kaya', nationalId: '22222222220', position: 'Boyacı', startDate: '2024-02-01' },
        { fullName: 'Eksik Görevli', nationalId: '33333333330', position: '', startDate: '2024-01-01' },
      ],
    },
  });
  assert.equal(firstImport.status, 200);
  assert.equal(firstImport.body.created, 2);
  assert.equal(firstImport.body.skipped, 1);
  assert.equal(firstImport.body.archived, 0);
  assert.equal(firstImport.body.errors.length, 1);

  // Firma listesi: aktif çalışan sayısı doğru yansımalı.
  const companiesList = await api('GET', `/employees/companies?projectId=${projectId}`, { token: adminToken });
  assert.equal(companiesList.status, 200);
  const companyARow = companiesList.body.companies.find((c) => c.id === companyAId);
  assert.equal(companyARow.activeEmployeeCount, 2);

  // Arama: TC no veya ada göre.
  const searchByName = await api('GET', `/employees?projectId=${projectId}&companyId=${companyAId}&q=Ali`, { token: adminToken });
  assert.equal(searchByName.body.employees.length, 1);
  assert.equal(searchByName.body.employees[0].fullName, 'Ali Veli');
  assert.equal(searchByName.body.employees[0].isgRole, 'Çalışan Temsilcisi');
  assert.ok(searchByName.body.employees[0].isgTrainingExpiryDate);
  assert.ok(searchByName.body.employees[0].medicalExamDate);

  const searchByTc = await api('GET', `/employees?projectId=${projectId}&companyId=${companyAId}&q=11111111110`, { token: adminToken });
  assert.equal(searchByTc.body.employees.length, 1);

  // Sıralama: giriş tarihine göre azalan (en yeni önce) -> Ayşe (02-01) önce gelmeli.
  const sortedByDate = await api('GET', `/employees?projectId=${projectId}&companyId=${companyAId}&sortBy=startDate`, { token: adminToken });
  assert.equal(sortedByDate.body.employees[0].fullName, 'Ayşe Kaya');

  const aliId = searchByName.body.employees[0].id;
  const ayseId = sortedByDate.body.employees[0].fullName === 'Ayşe Kaya' ? sortedByDate.body.employees[0].id : null;
  assert.ok(ayseId);

  // İkinci yükleme: yalnızca Ali var -> Ayşe yeni listede yok, tarihsiz arşivlenmeli.
  const secondImport = await api('POST', '/employees/import', {
    token: adminToken,
    body: {
      projectId,
      companyId: companyAId,
      rows: [{ fullName: 'Ali Veli', nationalId: '11111111110', position: 'Elektrikçi', startDate: '2024-01-10' }],
    },
  });
  assert.equal(secondImport.status, 200);
  assert.equal(secondImport.body.archived, 1);
  assert.equal(secondImport.body.updated, 1);

  const activeAfterSecond = await api('GET', `/employees?projectId=${projectId}&companyId=${companyAId}&status=active`, { token: adminToken });
  assert.equal(activeAfterSecond.body.employees.length, 1);
  assert.equal(activeAfterSecond.body.employees[0].fullName, 'Ali Veli');

  const archivedAfterSecond = await api('GET', `/employees?projectId=${projectId}&companyId=${companyAId}&status=archived`, { token: adminToken });
  assert.equal(archivedAfterSecond.body.employees.length, 1);
  assert.equal(archivedAfterSecond.body.employees[0].fullName, 'Ayşe Kaya');
  assert.equal(archivedAfterSecond.body.employees[0].endDate, null);

  // Manuel çıkış tarihi girme (Ali için).
  const manualExit = await api('PATCH', `/employees/${aliId}`, { token: adminToken, body: { endDate: '2024-06-01' } });
  assert.equal(manualExit.status, 200);
  assert.equal(manualExit.body.employee.isActive, false);

  const archivedAfterManual = await api('GET', `/employees?projectId=${projectId}&companyId=${companyAId}&status=archived`, { token: adminToken });
  assert.equal(archivedAfterManual.body.employees.length, 2);

  // Yeniden aktif etme (endDate temizlenince isActive tekrar true olmalı).
  const reactivate = await api('PATCH', `/employees/${aliId}`, { token: adminToken, body: { endDate: null } });
  assert.equal(reactivate.status, 200);
  assert.equal(reactivate.body.employee.isActive, true);

  // Admin olmayan (yalnızca uygunsuzluk_acma yetkili) kullanıcı içe aktarma ve silme yapamaz.
  const openerCreate = await api('POST', '/admin/users', { token: adminToken, body: { fullName: 'Çalışan Listesi Açan', username: 'calisan.listesi.acan' } });
  const openerId = openerCreate.body.user.id;
  await api('POST', `/admin/users/${openerId}/projects`, { token: adminToken, body: { projectId, roleId: formenRoleId, companyId: companyAId } });
  await api('POST', `/admin/users/${openerId}/permissions`, { token: adminToken, body: { permissionId: permId('uygunsuzluk_acma'), projectId } });

  const login = await api('POST', '/auth/login', { body: { username: 'calisan.listesi.acan', password: openerCreate.body.tempPassword } });
  const select = await api('POST', '/auth/select-context', { body: { contextToken: login.body.contextToken, projectId, roleId: formenRoleId } });
  const openerToken = select.body.accessToken;

  const forbiddenImport = await api('POST', '/employees/import', {
    token: openerToken,
    body: { companyId: companyAId, rows: [{ fullName: 'Yasak Kayıt', nationalId: '44444444440', position: 'Test', startDate: '2024-01-01' }] },
  });
  assert.equal(forbiddenImport.status, 403);

  const forbiddenDelete = await api('DELETE', `/employees/${ayseId}`, { token: openerToken });
  assert.equal(forbiddenDelete.status, 403);

  // Firmaya özel atanmış kullanıcı, yalnızca kendi firmasını /employees/companies üzerinden görür.
  const scopedCompanies = await api('GET', '/employees/companies', { token: openerToken });
  assert.equal(scopedCompanies.status, 200);
  assert.equal(scopedCompanies.body.companies.length, 1);
  assert.equal(scopedCompanies.body.companies[0].id, companyAId);

  // Admin: tekil silme.
  const singleDelete = await api('DELETE', `/employees/${ayseId}`, { token: adminToken });
  assert.equal(singleDelete.status, 200);
  const afterSingleDelete = await api('GET', `/employees?projectId=${projectId}&companyId=${companyAId}&status=archived`, { token: adminToken });
  assert.equal(afterSingleDelete.body.employees.length, 0);

  // Admin: toplu silme.
  const bulkDelete = await api('POST', '/employees/bulk-delete', { token: adminToken, body: { projectId, ids: [aliId] } });
  assert.equal(bulkDelete.status, 200);
  assert.equal(bulkDelete.body.deletedCount, 1);
  const afterBulkDelete = await api('GET', `/employees?projectId=${projectId}&companyId=${companyAId}&status=all`, { token: adminToken });
  assert.equal(afterBulkDelete.body.employees.length, 0);
});

test('çalışanlar: büyük Excel listesi (50 satır) tek seferde tamamen içe aktarılır, sınır/hata yok', async () => {
  const proj = await api('POST', '/admin/projects', { token: adminToken, body: { name: 'Test Şantiyesi 21', code: 'TST-021' } });
  const projectId = proj.body.project.id;
  const company = await api('POST', '/admin/companies', { token: adminToken, body: { projectId, name: 'Büyük Liste Firması', type: 'TASERON' } });
  const companyId = company.body.company.id;

  const rows = Array.from({ length: 50 }, (_, i) => ({
    fullName: `Test Çalışan ${String(i + 1).padStart(3, '0')}`,
    nationalId: String(10000000000 + i),
    position: 'Beden İşçisi (İnşaat)',
    startDate: '2024-01-01',
  }));

  const importRes = await api('POST', '/employees/import', { token: adminToken, body: { projectId, companyId, rows } });
  assert.equal(importRes.status, 200);
  assert.equal(importRes.body.created, 50);
  assert.equal(importRes.body.skipped, 0);

  const all = await api('GET', `/employees?projectId=${projectId}&companyId=${companyId}&status=all`, { token: adminToken });
  assert.equal(all.body.employees.length, 50);
});

test('çalışanlar: sayfalama - page/pageSize verilince sayfa sayfa döner, verilmezse tüm liste döner', async () => {
  const proj = await api('POST', '/admin/projects', { token: adminToken, body: { name: 'Test Şantiyesi 22', code: 'TST-022' } });
  const projectId = proj.body.project.id;
  const company = await api('POST', '/admin/companies', { token: adminToken, body: { projectId, name: 'Sayfalama Firması', type: 'TASERON' } });
  const companyId = company.body.company.id;

  const rows = Array.from({ length: 5 }, (_, i) => ({
    fullName: `Sayfa Çalışan ${String.fromCharCode(65 + i)}`,
    nationalId: String(20000000000 + i),
    position: 'Boyacı',
    startDate: '2024-01-01',
  }));
  await api('POST', '/employees/import', { token: adminToken, body: { projectId, companyId, rows } });

  const noPage = await api('GET', `/employees?projectId=${projectId}&companyId=${companyId}`, { token: adminToken });
  assert.equal(noPage.body.employees.length, 5);
  assert.equal(noPage.body.total, undefined);

  const page1 = await api('GET', `/employees?projectId=${projectId}&companyId=${companyId}&page=1&pageSize=2`, { token: adminToken });
  assert.equal(page1.body.employees.length, 2);
  assert.equal(page1.body.total, 5);
  assert.equal(page1.body.totalPages, 3);

  const page3 = await api('GET', `/employees?projectId=${projectId}&companyId=${companyId}&page=3&pageSize=2`, { token: adminToken });
  assert.equal(page3.body.employees.length, 1);

  const namesPage1 = page1.body.employees.map((e) => e.fullName);
  const namesPage2 = (await api('GET', `/employees?projectId=${projectId}&companyId=${companyId}&page=2&pageSize=2`, { token: adminToken })).body.employees.map((e) => e.fullName);
  const namesPage3 = page3.body.employees.map((e) => e.fullName);
  const allNames = [...namesPage1, ...namesPage2, ...namesPage3];
  assert.equal(new Set(allNames).size, 5);
});

test('atanabilir kişiler: bölge (blok) ataması ve firma+genel/tüm kullanıcı filtreleri', async () => {
  const proj = await api('POST', '/admin/projects', { token: adminToken, body: { name: 'Test Şantiyesi 23', code: 'TST-023' } });
  const projectId = proj.body.project.id;

  const block = await api('POST', `/admin/projects/${projectId}/blocks`, { token: adminToken, body: { name: '5. Parsel' } });
  const blockId = block.body.block.id;

  const companyA = await api('POST', '/admin/companies', { token: adminToken, body: { projectId, name: 'Bölge Test Firması A', type: 'TASERON' } });
  const companyAId = companyA.body.company.id;
  const companyB = await api('POST', '/admin/companies', { token: adminToken, body: { projectId, name: 'Bölge Test Firması B', type: 'TASERON' } });
  const companyBId = companyB.body.company.id;

  const rolesRes = await api('GET', '/admin/roles', { token: adminToken });
  const formenRoleId = rolesRes.body.roles.find((r) => r.name === 'Formen').id;
  const permsRes = await api('GET', '/admin/permissions', { token: adminToken });
  const permId = (key) => permsRes.body.permissions.find((p) => p.key === key).id;

  // Firma A + 5. Parsel'e özel atanmış kullanıcı.
  const userA = await api('POST', '/admin/users', { token: adminToken, body: { fullName: 'Bölge Kullanıcı A', username: 'bolge.kullanici.a' } });
  const userAId = userA.body.user.id;
  const assignA = await api('POST', `/admin/users/${userAId}/projects`, {
    token: adminToken,
    body: { projectId, roleId: formenRoleId, companyId: companyAId, blockId },
  });
  assert.equal(assignA.status, 201);

  // Firma B'ye atanmış (bölgesiz) kullanıcı.
  const userB = await api('POST', '/admin/users', { token: adminToken, body: { fullName: 'Bölge Kullanıcı B', username: 'bolge.kullanici.b' } });
  const userBId = userB.body.user.id;
  await api('POST', `/admin/users/${userBId}/projects`, { token: adminToken, body: { projectId, roleId: formenRoleId, companyId: companyBId } });

  // Genel kapsamda (firma/bölge belirtilmeden) atanmış kullanıcı.
  const userGeneral = await api('POST', '/admin/users', { token: adminToken, body: { fullName: 'Bölge Kullanıcı Genel', username: 'bolge.kullanici.genel' } });
  const userGeneralId = userGeneral.body.user.id;
  await api('POST', `/admin/users/${userGeneralId}/projects`, { token: adminToken, body: { projectId, roleId: formenRoleId } });

  // Kullanıcı detay ekranı bölge adını doğru göstermeli.
  const userADetail = await api('GET', `/admin/users/${userAId}`, { token: adminToken });
  assert.equal(userADetail.body.assignments[0].blockName, '5. Parsel');

  // Açan kullanıcı.
  const openerCreate = await api('POST', '/admin/users', { token: adminToken, body: { fullName: 'Bölge Açan', username: 'bolge.acan' } });
  const openerId = openerCreate.body.user.id;
  await api('POST', `/admin/users/${openerId}/projects`, { token: adminToken, body: { projectId, roleId: formenRoleId } });
  await api('POST', `/admin/users/${openerId}/permissions`, { token: adminToken, body: { permissionId: permId('uygunsuzluk_acma'), projectId } });

  const login = await api('POST', '/auth/login', { body: { username: 'bolge.acan', password: openerCreate.body.tempPassword } });
  const select = await api('POST', '/auth/select-context', { body: { contextToken: login.body.contextToken, projectId, roleId: formenRoleId } });
  const openerToken = select.body.accessToken;

  // companyId=A verilince: A firmasına atanmış + genel kapsamlı görünmeli, B firmasına atanmış görünmemeli.
  const forCompanyA = await api('GET', `/nonconformities/assignable-users?projectId=${projectId}&companyId=${companyAId}`, { token: openerToken });
  const idsForA = forCompanyA.body.users.map((u) => u.userId);
  assert.ok(idsForA.includes(userAId));
  assert.ok(idsForA.includes(userGeneralId));
  assert.ok(!idsForA.includes(userBId));
  const rowA = forCompanyA.body.users.find((u) => u.userId === userAId);
  assert.equal(rowA.blockName, '5. Parsel');
  assert.equal(rowA.companyName, 'Bölge Test Firması A');

  // companyId verilmezse (Tüm Kullanıcılar) projedeki herkes görünmeli.
  const allUsers = await api('GET', `/nonconformities/assignable-users?projectId=${projectId}`, { token: openerToken });
  const allIds = allUsers.body.users.map((u) => u.userId);
  assert.ok(allIds.includes(userAId) && allIds.includes(userBId) && allIds.includes(userGeneralId));
});

test('arşivleme: preview + generate (zip) + confirm-delete akışı', async () => {
  const dueDate = new Date(Date.now() + 5 * 86400000).toISOString();

  // Admin, mevcut proje (createdProjectId) ve mevcut kullanıcıyı (regularUserId) kullanarak
  // bir uygunsuzluk açar (admin izin kontrolünü atlar, ama projectId açıkça belirtmesi gerekir).
  const createNc = await api('POST', '/nonconformities', {
    token: adminToken,
    body: {
      projectId: createdProjectId,
      assignedUserIds: [regularUserId],
      description: 'Arşivleme testi için örnek uygunsuzluk kaydı.',
      dueDate,
    },
  });
  assert.equal(createNc.status, 201);
  const archiveNcId = createNc.body.nonconformity.id;

  const periodLabel = new Date().toISOString().slice(0, 7); // 'YYYY-MM'

  // Sistem admini olmayan biri arşiv rotalarına erişemez.
  const forbiddenPreview = await api('GET', `/admin/archives/preview?projectId=${createdProjectId}&periodLabel=${periodLabel}`, {});
  assert.equal(forbiddenPreview.status, 401);

  // Önizleme: bu dönemde en az 1 kayıt olmalı.
  const preview = await api('GET', `/admin/archives/preview?projectId=${createdProjectId}&periodLabel=${periodLabel}`, {
    token: adminToken,
  });
  assert.equal(preview.status, 200);
  assert.ok(preview.body.recordCount >= 1);
  assert.equal(preview.body.existingArchive, null);

  // Geçersiz dönem formatı -> 400
  const badPeriod = await api('GET', `/admin/archives/preview?projectId=${createdProjectId}&periodLabel=2026-13`, {
    token: adminToken,
  });
  assert.equal(badPeriod.status, 400);

  // Zip üretimi: doğrudan fetch ile çağırıp header + gövdeyi kontrol ederiz (api() helper'ı
  // JSON bekliyor, zip için uygun değil).
  const genRes = await fetch(
    `${baseUrl}/admin/archives/generate?projectId=${createdProjectId}&periodLabel=${periodLabel}`,
    { headers: { Authorization: `Bearer ${adminToken}` } }
  );
  assert.equal(genRes.status, 200);
  assert.match(genRes.headers.get('content-type') || '', /zip/);
  const zipBuffer = Buffer.from(await genRes.arrayBuffer());
  assert.ok(zipBuffer.length > 100, 'zip dosyası boş olmamalı');
  // Zip yerel dosya imzası ("PK") ile başlamalı.
  assert.equal(zipBuffer.slice(0, 2).toString('ascii'), 'PK');

  // Arşiv kaydı artık listede OLUSTURULDU durumunda görünmeli.
  const archiveList = await api('GET', `/admin/archives?projectId=${createdProjectId}`, { token: adminToken });
  assert.equal(archiveList.status, 200);
  const archiveRow = archiveList.body.archives.find((a) => a.periodLabel === periodLabel);
  assert.ok(archiveRow);
  assert.equal(archiveRow.status, 'OLUSTURULDU');
  assert.ok(archiveRow.recordCount >= 1);

  // Silme onayından önce uygunsuzluk hâlâ sistemde olmalı.
  const beforeDelete = await api('GET', `/nonconformities/${archiveNcId}`, { token: adminToken });
  assert.equal(beforeDelete.status, 200);

  // Onaylı silme: kayıtlar sunucudan kalıcı olarak kaldırılır.
  const confirmDelete = await api('POST', `/admin/archives/${archiveRow.id}/confirm-delete`, { token: adminToken });
  assert.equal(confirmDelete.status, 200);
  assert.ok(confirmDelete.body.deletedRecordCount >= 1);

  const afterDelete = await api('GET', `/nonconformities/${archiveNcId}`, { token: adminToken });
  assert.equal(afterDelete.status, 404);

  // Aynı arşiv tekrar silinmeye çalışılırsa -> 409 (zaten silinmiş).
  const secondDelete = await api('POST', `/admin/archives/${archiveRow.id}/confirm-delete`, { token: adminToken });
  assert.equal(secondDelete.status, 409);

  // Silinen dönem artık listede SILINDI durumunda görünmeli.
  const archiveListAfter = await api('GET', `/admin/archives?projectId=${createdProjectId}`, { token: adminToken });
  const archiveRowAfter = archiveListAfter.body.archives.find((a) => a.id === archiveRow.id);
  assert.equal(archiveRowAfter.status, 'SILINDI');
});

test('zamanlayıcı: geçen ayın arşivlenmemiş kayıtları için adminlere hatırlatma gönderir, tekrar çalıştırınca mükerrer göndermez', async () => {
  const { eq } = require('drizzle-orm');
  const { checkArchiveReminders } = require('../src/services/scheduler.service');

  const proj = await api('POST', '/admin/projects', { token: adminToken, body: { name: 'Arşiv Hatırlatma Test Projesi', code: 'TST-ARC-001' } });
  const projectId = proj.body.project.id;
  const rolesRes = await api('GET', '/admin/roles', { token: adminToken });
  const formenRoleId = rolesRes.body.roles.find((r) => r.name === 'Formen').id;

  const userCreate = await api('POST', '/admin/users', { token: adminToken, body: { fullName: 'Hatırlatma Testi Kullanıcı', username: 'hatirlatma.testi' } });
  const userId = userCreate.body.user.id;
  await api('POST', `/admin/users/${userId}/projects`, { token: adminToken, body: { projectId, roleId: formenRoleId } });

  // Bir uygunsuzluk açılır, sonra oluşturulma tarihi geçen aya çekilir.
  const createNc = await api('POST', '/nonconformities', {
    token: adminToken,
    body: { projectId, assignedUserIds: [userId], description: 'Geçen ay açılmış gibi davranacak test kaydı.', dueDate: new Date(Date.now() + 86400000).toISOString() },
  });
  const ncId = createNc.body.nonconformity.id;

  const now = new Date();
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 15, 10, 0, 0);
  await db.update(schema.nonconformities).set({ createdAt: lastMonth }).where(eq(schema.nonconformities.id, ncId));

  await checkArchiveReminders();

  const adminNotifsAfterFirst = await api('GET', '/notifications', { token: adminToken });
  const reminderNotifs = adminNotifsAfterFirst.body.notifications.filter((n) => n.title === 'Aylık arşivleme hatırlatması');
  assert.equal(reminderNotifs.length, 1);

  // Aynı dönem+proje için ikinci kez çalıştırıldığında mükerrer bildirim gönderilmemeli.
  await checkArchiveReminders();
  const adminNotifsAfterSecond = await api('GET', '/notifications', { token: adminToken });
  const reminderNotifsAfterSecond = adminNotifsAfterSecond.body.notifications.filter((n) => n.title === 'Aylık arşivleme hatırlatması');
  assert.equal(reminderNotifsAfterSecond.length, 1);

  // Arşiv üretilip kaydedildikten sonra bir sonraki kontrolde artık hatırlatma tekrarlanmamalı
  // (zaten OLUSTURULDU durumunda bir archives satırı var).
  const periodLabel = `${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, '0')}`;
  await db.insert(schema.archives).values({ projectId, periodLabel, recordCount: 1, status: 'OLUSTURULDU', createdById: (await db.select().from(schema.users).where(eq(schema.users.username, 'admin')).limit(1))[0].id });
  await checkArchiveReminders();
  const adminNotifsAfterArchived = await api('GET', '/notifications', { token: adminToken });
  const reminderNotifsAfterArchived = adminNotifsAfterArchived.body.notifications.filter((n) => n.title === 'Aylık arşivleme hatırlatması');
  assert.equal(reminderNotifsAfterArchived.length, 1, 'arşiv oluşturulduktan sonra yeni bir hatırlatma eklenmemeli');
});

test('firma güvenlik genişlemesi: roller, kaza/ramak kala, belgeler, İSG kurulu, ekipman, MYK, firma detay bundle', async () => {
  const proj = await api('POST', '/admin/projects', { token: adminToken, body: { name: 'Güvenlik Genişleme Projesi', code: 'TST-SAFETY-001' } });
  const projectId = proj.body.project.id;

  const companyCreate = await api('POST', '/admin/companies', {
    token: adminToken,
    body: { projectId, name: 'Genişleme Test Firması', type: 'TASERON' },
  });
  assert.equal(companyCreate.status, 201);
  const companyId = companyCreate.body.company.id;

  // Tehlike sınıfı + kurul zorunluluğu ayarlanır.
  const companyUpdate = await api('PATCH', `/admin/companies/${companyId}`, {
    token: adminToken,
    body: { requiresBoard: true, dangerClass: 'TEHLIKELI' },
  });
  assert.equal(companyUpdate.status, 200);
  assert.equal(companyUpdate.body.company.dangerClass, 'TEHLIKELI');

  const emp1 = await api('POST', '/employees', { token: adminToken, body: { projectId, companyId, fullName: 'Roller Testi Çalışan', nationalId: '11111111111' } });
  const employeeId = emp1.body.employee.id;
  const emp2 = await api('POST', '/employees', { token: adminToken, body: { projectId, companyId, fullName: 'Kaza Testi Çalışan', nationalId: '22222222222' } });
  const employeeId2 = emp2.body.employee.id;

  // --- Firma rolleri + acil durum ekipleri ---
  const roleForbidden = await api('POST', '/admin/company-roles', { body: { companyId, roleType: 'DESTEK_PERSONELI', employeeId } });
  assert.equal(roleForbidden.status, 401);

  const roleCreate = await api('POST', '/admin/company-roles', {
    token: adminToken,
    body: { companyId, roleType: 'DESTEK_PERSONELI', source: 'CALISAN', employeeId },
  });
  assert.equal(roleCreate.status, 201);

  const ilkyardimCreate = await api('POST', '/admin/company-roles', {
    token: adminToken,
    body: {
      companyId,
      roleType: 'ILKYARDIM',
      source: 'CALISAN',
      employeeId,
      certificateNo: 'IY-2026-001',
      certificateStartDate: new Date().toISOString(),
      certificateEndDate: new Date(Date.now() + 365 * 86400000).toISOString(),
    },
  });
  assert.equal(ilkyardimCreate.status, 201);

  // Dışarıdan (OSGB) İSG uzmanı - çalışan seçimi zorunlu değil.
  const outsideRole = await api('POST', '/admin/company-roles', {
    token: adminToken,
    body: { companyId, roleType: 'ISG_UZMANI', source: 'DISARIDAN', outsideFullName: 'Dış OSGB Uzmanı', outsideCompanyName: 'ABC OSGB', certificateClass: 'B Sınıfı' },
  });
  assert.equal(outsideRole.status, 201);

  // Firma bünyesinden bir rol için çalışan seçilmezse hata vermeli (İşveren/Vekili hariç).
  const roleMissingEmployee = await api('POST', '/admin/company-roles', {
    token: adminToken,
    body: { companyId, roleType: 'SANTIYE_SEFI', source: 'CALISAN' },
  });
  assert.equal(roleMissingEmployee.status, 400);

  const rolesList = await api('GET', `/admin/company-roles?companyId=${companyId}`, { token: adminToken });
  assert.equal(rolesList.status, 200);
  assert.equal(rolesList.body.roles.length, 3);
  assert.ok(rolesList.body.roles.some((r) => r.roleType === 'ILKYARDIM' && r.certificateNo === 'IY-2026-001'));
  assert.ok(rolesList.body.roles.some((r) => r.roleType === 'ISG_UZMANI' && r.outsideCompanyName === 'ABC OSGB'));

  const roleDelete = await api('DELETE', `/admin/company-roles/${outsideRole.body.role.id}`, { token: adminToken });
  assert.equal(roleDelete.status, 200);
  const rolesAfterDelete = await api('GET', `/admin/company-roles?companyId=${companyId}`, { token: adminToken });
  assert.equal(rolesAfterDelete.body.roles.length, 2);

  // --- Kaza / ramak kala ---
  const incidentCreate = await api('POST', '/admin/incidents', {
    token: adminToken,
    body: {
      companyId,
      type: 'KAZA',
      eventDateTime: new Date().toISOString(),
      employeeId: employeeId2,
      eventDescription: 'Merdivenden düşme.',
      location: 'A Blok 3. kat',
      cause: 'Kaygan zemin',
      referredToHospital: true,
      hospitalName: 'Devlet Hastanesi',
      firstAidGiven: true,
      firstAidGivenBy: 'Sağlık personeli',
      reportDaysOff: 5,
      actionsTaken: 'Zemin uyarı levhası konuldu.',
    },
  });
  assert.equal(incidentCreate.status, 201);
  const incidentId = incidentCreate.body.incident.id;

  const ramakKalaCreate = await api('POST', '/admin/incidents', {
    token: adminToken,
    body: { companyId, type: 'RAMAK_KALA', eventDateTime: new Date().toISOString(), eventDescription: 'Düşen malzeme az kalsın çarpıyordu.' },
  });
  assert.equal(ramakKalaCreate.status, 201);

  const incidentsList = await api('GET', `/admin/incidents?companyId=${companyId}`, { token: adminToken });
  assert.equal(incidentsList.status, 200);
  assert.equal(incidentsList.body.incidents.length, 2);

  const incidentPatch = await api('PATCH', `/admin/incidents/${incidentId}`, { token: adminToken, body: { returnToWorkDate: new Date(Date.now() + 5 * 86400000).toISOString() } });
  assert.equal(incidentPatch.status, 200);
  assert.ok(incidentPatch.body.incident.returnToWorkDate);

  // Çalışan listesinde kazaya karışan çalışanın incidentCount'u 1 olmalı.
  const empListWithIncidents = await api('GET', `/employees?projectId=${projectId}&companyId=${companyId}`, { token: adminToken });
  const empRow2 = empListWithIncidents.body.employees.find((e) => e.id === employeeId2);
  assert.equal(empRow2.incidentCount, 1);
  const empRow1 = empListWithIncidents.body.employees.find((e) => e.id === employeeId);
  assert.equal(empRow1.incidentCount, 0);

  // --- Risk analizi / acil durum eylem planı belgeleri ---
  const docCreate = await api('POST', '/admin/company-documents', {
    token: adminToken,
    body: { companyId, docType: 'RISK_ANALIZI', preparedDate: new Date().toISOString(), approved: true, approvedDate: new Date().toISOString(), validUntil: new Date(Date.now() + 365 * 86400000).toISOString() },
  });
  assert.equal(docCreate.status, 201);

  const docsList = await api('GET', `/admin/company-documents?companyId=${companyId}`, { token: adminToken });
  assert.equal(docsList.status, 200);
  assert.equal(docsList.body.documents.length, 1);
  assert.equal(docsList.body.documents[0].approved, true);

  // --- İSG Kurulu toplantıları ---
  const now = new Date();
  const currentPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const meetingCreate = await api('POST', '/admin/board-meetings', {
    token: adminToken,
    body: { companyId, meetingDate: now.toISOString(), periodLabel: currentPeriod, isExtraordinary: false },
  });
  assert.equal(meetingCreate.status, 201);

  // Aynı dönem için ikinci bir normal toplantı -> 409.
  const duplicateMeeting = await api('POST', '/admin/board-meetings', {
    token: adminToken,
    body: { companyId, meetingDate: now.toISOString(), periodLabel: currentPeriod, isExtraordinary: false },
  });
  assert.equal(duplicateMeeting.status, 409);

  // Olağanüstü toplantı aynı dönemde eklenebilir.
  const extraordinaryMeeting = await api('POST', '/admin/board-meetings', {
    token: adminToken,
    body: { companyId, meetingDate: now.toISOString(), periodLabel: currentPeriod, isExtraordinary: true, notes: 'Kaza sonrası olağanüstü toplantı.' },
  });
  assert.equal(extraordinaryMeeting.status, 201);

  const meetingsList = await api('GET', `/admin/board-meetings?companyId=${companyId}`, { token: adminToken });
  assert.equal(meetingsList.status, 200);
  assert.equal(meetingsList.body.meetings.length, 2);
  // Firma TEHLİKELİ sınıfta (2 ayda bir); içinde bulunulan dönem tamamlanmış (done) görünmeli.
  const currentBin = meetingsList.body.boardStatus.find((b) => b.startMonth <= now.getMonth() + 1 && b.endMonth >= now.getMonth() + 1);
  assert.ok(currentBin);
  assert.equal(currentBin.done, true);

  // --- Ekipman ---
  const equipmentCreate = await api('POST', '/admin/equipment', {
    token: adminToken,
    body: {
      projectId,
      companyId,
      name: 'Kule Vinç',
      serialNumber: 'KV-2026-001',
      periodicInspectionDate: new Date().toISOString(),
      periodicInspectionValidUntil: new Date(Date.now() + 180 * 86400000).toISOString(),
      fitForUse: true,
      assignedTo: 'FIRMA',
      operatorSource: 'CALISAN',
      operatorEmployeeId: employeeId,
    },
  });
  assert.equal(equipmentCreate.status, 201);

  const equipmentOutsideOperator = await api('POST', '/admin/equipment', {
    token: adminToken,
    body: {
      projectId,
      companyId,
      name: 'Ekskavatör',
      assignedTo: 'KISI',
      assignedEmployeeId: employeeId,
      operatorSource: 'DISARIDAN',
      operatorOutsideFullName: 'Dışarıdan Operatör',
      operatorOutsideCompanyName: 'XYZ Taşeron',
      operatorOutsideNationalId: '33333333333',
      operatorCertificateNo: 'OP-2026-99',
    },
  });
  assert.equal(equipmentOutsideOperator.status, 201);

  const equipmentByCompany = await api('GET', `/admin/equipment?companyId=${companyId}`, { token: adminToken });
  assert.equal(equipmentByCompany.status, 200);
  assert.equal(equipmentByCompany.body.equipment.length, 2);

  const equipmentByProject = await api('GET', `/admin/equipment?projectId=${projectId}`, { token: adminToken });
  assert.equal(equipmentByProject.body.equipment.length, 2);

  // --- MYK belgesi ---
  await api('PATCH', `/employees/${employeeId}`, { token: adminToken, body: { mykCertificateNo: 'MYK-2026-001', mykCertificateDate: new Date().toISOString() } });

  // --- Firma detay bundle: her şey tek çağrıda birleşmiş olmalı ---
  const companyDetail = await api('GET', `/admin/companies/${companyId}`, { token: adminToken });
  assert.equal(companyDetail.status, 200);
  assert.equal(companyDetail.body.roleAssignments.length, 2);
  assert.equal(companyDetail.body.incidents.counts.kazaCount, 1);
  assert.equal(companyDetail.body.incidents.counts.ramakKalaCount, 1);
  assert.equal(companyDetail.body.documents.length, 1);
  assert.equal(companyDetail.body.boardMeetings.length, 2);
  assert.ok(Array.isArray(companyDetail.body.boardStatus) && companyDetail.body.boardStatus.length > 0);
  assert.equal(companyDetail.body.equipmentCount, 2);
  assert.equal(companyDetail.body.mykStats.total, 2);
  assert.equal(companyDetail.body.mykStats.withCertificate, 1);
});
