require('dotenv').config();
const bcrypt = require('bcryptjs');
const { db, pool } = require('./client');
const { roles, permissions, users } = require('./schema');
const { eq } = require('drizzle-orm');

const DEFAULT_ROLES = [
  { name: 'İSG Uzmanı', description: 'Uygunsuzluk açabilir, düzeltmeleri kontrol edip onaylayabilir.' },
  { name: 'Şantiye Şefi', description: 'Şantiye sahasından sorumlu yetkili.' },
  { name: 'Firma Yetkilisi', description: 'Firmasına atanan uygunsuzlukları yönetir.' },
  { name: 'İşveren Vekili', description: 'İşveren adına yetki kullanan kişi.' },
  { name: 'Formen', description: 'Saha ekip sorumlusu.' },
  { name: 'Saha Sorumlusu', description: 'Sahadaki günlük operasyonlardan sorumlu.' },
  { name: 'Alt İşveren Yetkilisi', description: 'Alt işveren firmasını temsil eder.' },
  { name: 'İSG Teknikeri', description: 'Saha İSG denetimlerine destek verir.' },
];

const DEFAULT_PERMISSIONS = [
  { key: 'uygunsuzluk_gorme', name: 'Uygunsuzlukları Görme' },
  { key: 'uygunsuzluk_acma', name: 'Uygunsuzluk Açma' },
  { key: 'uygunsuzluk_duzeltme', name: 'Uygunsuzluk Düzeltme' },
  { key: 'uygunsuzluk_kapatma_talebi', name: 'Uygunsuzluk Kapatma Talebi Gönderme' },
  { key: 'uygunsuzluk_onaylama', name: 'Uygunsuzluk Kapatma / Onaylama' },
  { key: 'uygunsuzluk_silme', name: 'Uygunsuzluk Silme' },
  { key: 'uygunsuzluk_duzenleme', name: 'Uygunsuzluk Düzenleme' },
  { key: 'itiraz_olusturma', name: 'İtiraz Oluşturma' },
  { key: 'itiraz_sonuclandirma', name: 'İtiraz Sonuçlandırma' },
  { key: 'termin_uzatma_talebi', name: 'Termin Uzatma Talebi Oluşturma' },
  { key: 'termin_uzatma_onaylama', name: 'Termin Uzatma Onaylama' },
  { key: 'calisma_durdurma', name: 'Çalışma Durdurma' },
  { key: 'cezai_islem', name: 'Cezai İşlem Oluşturma' },
  { key: 'rapor_goruntuleme', name: 'Rapor Görüntüleme' },
  { key: 'rapor_alma', name: 'Rapor Alma (Excel/PDF)' },
  { key: 'kullanici_yonetme', name: 'Kullanıcı Yönetme' },
  { key: 'firma_yonetme', name: 'Firma Yönetme' },
  { key: 'proje_yonetme', name: 'Proje Yönetme' },
  { key: 'kaza_bildirimi', name: 'Kaza / Ramak Kala Bildirimi Girme' },
];

async function seed() {
  console.log('Roller ekleniyor...');
  for (const role of DEFAULT_ROLES) {
    await db.insert(roles).values(role).onConflictDoNothing({ target: roles.name });
  }

  console.log('İzinler ekleniyor...');
  for (const perm of DEFAULT_PERMISSIONS) {
    await db.insert(permissions).values(perm).onConflictDoNothing({ target: permissions.key });
  }

  const adminUsername = process.env.SEED_ADMIN_USERNAME || 'admin';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || 'DegistirilmesiGerekenSifre123!';

  const existing = await db.select().from(users).where(eq(users.username, adminUsername)).limit(1);
  if (existing.length === 0) {
    const passwordHash = await bcrypt.hash(adminPassword, 12);
    await db.insert(users).values({
      fullName: 'Sistem Admini',
      username: adminUsername,
      passwordHash,
      isSystemAdmin: true,
      isActive: true,
      mustChangePassword: true,
    });
    console.log(`Admin kullanıcı oluşturuldu -> kullanıcı adı: ${adminUsername}`);
    console.log('İlk girişte şifrenizi değiştirmeniz istenecektir.');
  } else {
    console.log('Admin kullanıcı zaten mevcut, atlanıyor.');
  }

  console.log('Seed işlemi tamamlandı.');
  await pool.end();
}

seed().catch((err) => {
  console.error('Seed hatası:', err);
  process.exit(1);
});
