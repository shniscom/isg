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
    title: 'Raporlama',
    icon: '📊',
    keys: ['rapor_goruntuleme', 'rapor_alma'],
  },
  {
    title: 'Yönetim',
    icon: '🛠️',
    keys: ['kullanici_yonetme', 'firma_yonetme', 'proje_yonetme'],
  },
];
