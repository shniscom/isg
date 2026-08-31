require('dotenv').config();
const bcrypt = require('bcryptjs');
const { db, pool } = require('./client');
const { roles, permissions, users, companyRoleTypes } = require('./schema');
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
  { key: 'firma_goruntuleme', name: 'Firmaları Görüntüleme', description: 'Firma bilgilerini/kartlarını görüntüleyebilir ama ekleyip/düzenleyemez.' },
  { key: 'proje_yonetme', name: 'Proje Yönetme' },
  { key: 'kaza_bildirimi', name: 'Kaza / Ramak Kala Bildirimi Girme' },
];

// Firma rolü tipi kataloğu (company_role_types). Migration 0013 bu satırları FK constraint
// eklenmeden ÖNCE zaten ekliyor (deploy sırasındaki eski verilerle FK çakışmaması için); burada
// tekrar onConflictDoNothing ile eklenmesi yalnızca migration dışı/temiz kurulum senaryoları için
// bir güvenlik ağıdır, normal deploy akışında hiçbir satır eklemez (zaten var).
const DEFAULT_COMPANY_ROLE_TYPES = [
  { key: 'ISVEREN', label: 'İşveren', category: 'FIRMA_ROLU', sortOrder: 1 },
  { key: 'ISVEREN_VEKILI', label: 'İşveren Vekili', category: 'FIRMA_ROLU', sortOrder: 2 },
  { key: 'SANTIYE_SEFI', label: 'Şantiye Şefi', category: 'FIRMA_ROLU', sortOrder: 3 },
  { key: 'CALISAN_TEMSILCISI', label: 'Çalışan Temsilcisi', category: 'FIRMA_ROLU', sortOrder: 4 },
  { key: 'DESTEK_PERSONELI', label: 'Destek Personeli', category: 'FIRMA_ROLU', sortOrder: 5 },
  { key: 'PROJE_MUDURU', label: 'Proje Müdürü', category: 'FIRMA_ROLU', sortOrder: 6 },
  { key: 'ISG_UZMANI', label: 'İSG Uzmanı', category: 'FIRMA_ROLU', sortOrder: 7 },
  { key: 'ISYERI_HEKIMI', label: 'İşyeri Hekimi', category: 'FIRMA_ROLU', sortOrder: 8 },
  { key: 'DIGER_SAGLIK_PERSONELI', label: 'Diğer Sağlık Personeli', category: 'FIRMA_ROLU', sortOrder: 9 },
  { key: 'ILKYARDIM', label: 'İlkyardımcı', category: 'ACIL_EKIP', sortOrder: 1 },
  { key: 'ARAMA_KURTARMA', label: 'Arama-Kurtarma', category: 'ACIL_EKIP', sortOrder: 2 },
  { key: 'KORUMA', label: 'Koruma', category: 'ACIL_EKIP', sortOrder: 3 },
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

  console.log('Firma rolü tipleri kontrol ediliyor...');
  for (const roleType of DEFAULT_COMPANY_ROLE_TYPES) {
    await db.insert(companyRoleTypes).values(roleType).onConflictDoNothing({ target: companyRoleTypes.key });
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
