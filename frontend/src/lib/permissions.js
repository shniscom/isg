// Yetki anahtarlarına göre kısa açıklamalar (kullanıcı yönetimi ekranında gösterilir).
export const PERMISSION_DESCRIPTIONS = {
  uygunsuzluk_gorme: 'Projedeki tüm uygunsuzlukları görebilir (bu yetki yoksa yalnızca kendine atanan/kendi açtığı kayıtları görür).',
  uygunsuzluk_acma: 'Yeni uygunsuzluk kaydı açabilir.',
  uygunsuzluk_duzeltme: 'Kendisine atanmamış olsa dahi açık uygunsuzluklara düzeltme girebilir.',
  uygunsuzluk_kapatma_talebi: 'Yaptığı düzeltmeyi onaya/kapatmaya gönderebilir.',
  uygunsuzluk_onaylama: 'Gönderilen düzeltmeleri onaylayıp uygunsuzluğu kapatabilir veya reddedebilir.',
  uygunsuzluk_silme: 'Uygunsuzluk kaydını tamamen silebilir.',
  uygunsuzluk_duzenleme: 'Mevcut bir uygunsuzluğun bilgilerini (başlık, açıklama, öncelik vb.) düzenleyebilir.',
  itiraz_olusturma: 'Kapatılan veya reddedilen bir uygunsuzluğa itiraz açabilir.',
  itiraz_sonuclandirma: 'Açılan itirazları inceleyip sonuçlandırabilir.',
  termin_uzatma_talebi: 'Uygunsuzluk için termin (son tarih) uzatma talebi oluşturabilir.',
  termin_uzatma_onaylama: 'Termin uzatma taleplerini onaylayabilir/reddedebilir.',
  calisma_durdurma: 'İlgili alanda/imalatta çalışmayı durdurma kararı verebilir.',
  cezai_islem: 'Uygunsuzlukla ilişkili cezai işlem (kesinti vb.) kaydı oluşturabilir.',
  rapor_goruntuleme: 'Raporlama ekranlarını görüntüleyebilir.',
  rapor_alma: 'Raporları Excel/PDF olarak dışa aktarabilir.',
  kullanici_yonetme: 'Kullanıcı oluşturma, projeye/göreve atama ve yetkilendirme yapabilir.',
  firma_yonetme: 'Ana firma, taşeron ve tedarikçi tanımlarını yönetebilir.',
  proje_yonetme: 'Proje ve proje içi blok/bölge tanımlarını yönetebilir.',
  kaza_bildirimi: 'Firmalara kaza / ramak kala kaydı girebilir ve girilen kayıtları görüntüleyebilir (düzenleme/silme için Firma Yönetme yetkisi gerekir).',
  insan_kaynaklari_yonetimi: 'Çalışanlar sekmesine tam erişim: firma bazında çalışan ekleyebilir, Excel ile toplu liste yükleyebilir, çıkış/arşiv işlemi yapabilir.',
  gecici_gorevlendirme_yonetimi: 'Sahaya geçici görevle giren firma ve çalışan kayıtlarını oluşturabilir/düzenleyebilir (admin dışında yapılan değişiklikler admin onayına düşer).',
};

// Yetkileri "Yetkilerim" sayfasında düzenli göstermek için kategori grupları.
export const PERMISSION_CATEGORIES = [
  {
    title: 'Uygunsuzluk İşlemleri',
    icon: '⚠️',
    keys: [
      'uygunsuzluk_gorme',
      'uygunsuzluk_acma',
      'uygunsuzluk_duzeltme',
      'uygunsuzluk_kapatma_talebi',
      'uygunsuzluk_onaylama',
      'uygunsuzluk_duzenleme',
      'uygunsuzluk_silme',
    ],
  },
  {
    title: 'İtiraz',
    icon: '📩',
    keys: ['itiraz_olusturma', 'itiraz_sonuclandirma'],
  },
  {
    title: 'Termin Uzatma',
    icon: '⏳',
    keys: ['termin_uzatma_talebi', 'termin_uzatma_onaylama'],
  },
  {
    title: 'Saha Yaptırımları',
    icon: '🛑',
    keys: ['calisma_durdurma', 'cezai_islem'],
  },
  {
    title: 'Kaza / Ramak Kala',
    icon: '🚑',
    keys: ['kaza_bildirimi'],
  },
  {
    title: 'Raporlama',
    icon: '📊',
    keys: ['rapor_goruntuleme', 'rapor_alma'],
  },
  {
    title: 'Yönetim',
    icon: '🛠️',
    keys: ['kullanici_yonetme', 'firma_yonetme', 'proje_yonetme'],
  },
  {
    title: 'İnsan Kaynakları',
    icon: '🧑\u200d💼',
    keys: ['insan_kaynaklari_yonetimi', 'gecici_gorevlendirme_yonetimi'],
  },
];

// --- Göreve göre standart yetki şablonu ---------------------------------------------------
// "Kullanıcılar" sayfasında bir kullanıcıya proje/görev ataması yapılırken (bkz.
// UserDetailPage.jsx "Proje / Görev Atamaları"), seçilen görevin adına göre bu tablo standart
// bir yetki setini önerir; öneri "Yetkiler" bölümündeki onay kutularına otomatik işaretlenir
// ve admin dilerse (yetki ekleyip/çıkararak) manuel olarak değiştirebilir - hiçbir şey otomatik
// olarak sunucuya gönderilmez, admin yine de "Yetki Ver" butonuna basmalıdır. Görev adları admin
// tarafından serbestçe oluşturulduğu için (bkz. RolesPage.jsx "Proje Görevleri"), eşleştirme
// anahtar kelime bazlıdır - Türkçe karakterler sadeleştirilip küçük harfe çevrilerek karşılaştırılır.
function foldTr(value) {
  const map = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', İ: 'i', I: 'i' };
  return (value || '')
    .split('')
    .map((ch) => map[ch] || ch)
    .join('')
    .toLowerCase();
}

const ROLE_PERMISSION_TEMPLATES = [
  {
    keywords: ['isg uzman', 'is guvenligi uzman', 'guvenlik uzman'],
    keys: [
      'uygunsuzluk_gorme', 'uygunsuzluk_acma', 'uygunsuzluk_duzeltme', 'uygunsuzluk_kapatma_talebi',
      'uygunsuzluk_onaylama', 'uygunsuzluk_duzenleme', 'itiraz_sonuclandirma', 'termin_uzatma_onaylama',
      'calisma_durdurma', 'cezai_islem', 'kaza_bildirimi', 'rapor_goruntuleme', 'rapor_alma',
      'insan_kaynaklari_yonetimi',
    ],
  },
  {
    keywords: ['isyeri hekim', 'is yeri hekim', 'hekim', 'doktor'],
    keys: ['uygunsuzluk_gorme', 'uygunsuzluk_acma', 'kaza_bildirimi', 'rapor_goruntuleme'],
  },
  {
    keywords: ['proje muduru', 'proje yoneticisi', 'genel mudur', 'sirket yoneticisi'],
    keys: [
      'kullanici_yonetme', 'firma_yonetme', 'proje_yonetme', 'uygunsuzluk_gorme', 'uygunsuzluk_onaylama',
      'itiraz_sonuclandirma', 'termin_uzatma_onaylama', 'calisma_durdurma', 'cezai_islem',
      'rapor_goruntuleme', 'rapor_alma',
    ],
  },
  {
    keywords: ['santiye sefi', 'saha sefi', 'saha yoneticisi', 'saha muduru'],
    keys: [
      'uygunsuzluk_gorme', 'uygunsuzluk_acma', 'uygunsuzluk_duzeltme', 'uygunsuzluk_kapatma_talebi',
      'itiraz_olusturma', 'termin_uzatma_talebi', 'kaza_bildirimi', 'rapor_goruntuleme',
    ],
  },
  {
    keywords: ['formen', 'usta', 'ekip lideri', 'taseron sorumlusu', 'saha sorumlusu'],
    keys: ['uygunsuzluk_gorme', 'uygunsuzluk_duzeltme', 'uygunsuzluk_kapatma_talebi', 'itiraz_olusturma'],
  },
  {
    keywords: ['kalite'],
    keys: ['uygunsuzluk_gorme', 'uygunsuzluk_acma', 'uygunsuzluk_duzenleme', 'rapor_goruntuleme', 'rapor_alma'],
  },
  {
    keywords: ['insan kaynaklari', 'ik uzmani', 'ik sorumlusu'],
    keys: ['insan_kaynaklari_yonetimi', 'gecici_gorevlendirme_yonetimi', 'rapor_goruntuleme'],
  },
  {
    keywords: ['calisan temsilcisi', 'isci temsilcisi'],
    keys: ['uygunsuzluk_gorme', 'itiraz_olusturma'],
  },
  {
    keywords: ['destek personeli', 'dsp'],
    keys: ['uygunsuzluk_gorme', 'kaza_bildirimi'],
  },
  {
    keywords: ['ilkyardim'],
    keys: ['kaza_bildirimi'],
  },
];

/**
 * Verilen görev adına (roles.name) göre önerilen standart yetki anahtarlarını döner. Eşleşme
 * bulunamazsa asgari düzeyde görüntüleme yetkisi (uygunsuzluk_gorme) önerilir - hiçbir görev için
 * boş öneri sunulmaz, admin en azından temel görünürlükle başlayıp ekleyebilir.
 */
export function suggestPermissionsForRoleName(roleName) {
  const folded = foldTr(roleName);
  for (const template of ROLE_PERMISSION_TEMPLATES) {
    if (template.keywords.some((kw) => folded.includes(kw))) {
      return template.keys;
    }
  }
  return ['uygunsuzluk_gorme'];
}
