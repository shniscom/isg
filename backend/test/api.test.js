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
    body: { assignedUserId: assigneeId, description: 'test', dueDate: new Date(Date.now() + 86400000).toISOString() },
  });
  assert.equal(forbiddenCreate.status, 403);

  // Uygunsuzluk açılır
  const dueDate = new Date(Date.now() + 7 * 86400000).toISOString();
  const createNc = await api('POST', '/nonconformities', {
    token: openerToken,
    body: {
      categoryId,
      blockId,
      companyId,
      assignedUserId: assigneeId,
      description: 'Merdiven korkuluğu eksik.',
      priority: 'YUKSEK',
      dueDate,
    },
  });
  assert.equal(createNc.status, 201);
  const ncId = createNc.body.nonconformity.id;
  assert.match(createNc.body.nonconformity.number, /^\d{4}-TST-002-\d{6}$/);
  assert.equal(createNc.body.nonconformity.status, 'ACIK');

  // Atanan kişi listede kendi uygunsuzluğunu görür (uygunsuzluk_gorme yetkisi olmasa bile)
  const assigneeList = await api('GET', '/nonconformities', { token: assigneeToken });
  assert.equal(assigneeList.status, 200);
  assert.ok(assigneeList.body.nonconformities.some((n) => n.id === ncId));

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
