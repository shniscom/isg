# Yerel Uygunsuzluk ve İSG Takip Sistemi

İnşaat şantiyeleri için İSG uygunsuzluklarının açılması, atanması, düzeltilmesi, onaylanması,
itiraz edilmesi, termin takibi ve cezai işlem süreçlerini tek bir sistemde yöneten uygulama.
Bu depo **FAZ 1** kapsamını içerir: giriş sistemi, admin paneli, proje/blok, firma, kullanıcı
ve rol/yetki altyapısı. Uygunsuzluk açma-kapama, itiraz, termin ve ceza modülleri sonraki
fazlarda bu temelin üzerine eklenecektir (bkz. "Yol Haritası" altında).

Uygulama PWA (Progressive Web App) olarak tasarlanmıştır; Android ve iOS'ta tarayıcıdan
"Ana Ekrana Ekle" ile native uygulama gibi kullanılabilir.

## Teknoloji Yığını

- **Backend:** Node.js + Express 5, PostgreSQL, Drizzle ORM, JWT tabanlı kimlik doğrulama, bcrypt
- **Frontend:** React 19 + Vite, React Router, Tailwind CSS, vite-plugin-pwa
- **Dağıtım:** Docker + Docker Compose, Coolify üzerinden `isg.shnai.cloud` alan adına yayın

## Proje Yapısı

```
isg-takip-sistemi/
├── backend/            Express API (Drizzle ORM + PostgreSQL)
│   ├── src/
│   │   ├── db/         Şema, migrasyon, seed, veritabanı istemcisi
│   │   ├── middleware/ Kimlik doğrulama, yetki kontrolü, hata yönetimi
│   │   ├── routes/     /api/auth ve /api/admin/* uç noktaları
│   │   ├── services/   Etkin yetki hesaplama vb. iş mantığı
│   │   └── utils/      JWT, şifre, audit log yardımcıları
│   ├── drizzle/        Üretilen SQL migrasyon dosyaları
│   ├── test/           Gerçek (embedded) PostgreSQL'e karşı uçtan uca testler
│   └── Dockerfile
├── frontend/            React PWA
│   ├── src/
│   │   ├── pages/       Giriş, proje/görev seçimi, admin paneli sayfaları
│   │   ├── context/      Kimlik doğrulama durumu (AuthContext)
│   │   └── components/   Ortak arayüz bileşenleri, korumalı rotalar
│   └── Dockerfile
├── docker-compose.yml
└── DEPLOYMENT.md        Coolify üzerinden yayına alma rehberi
```

## Yerelde Çalıştırma (Geliştirme)

### Gereksinimler
- Node.js 20+
- PostgreSQL 14+ (yerel kurulum veya Docker ile: `docker run -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:16-alpine`)

### Backend

```bash
cd backend
cp .env.example .env      # DATABASE_URL, JWT_SECRET vb. değerleri doldurun
npm install
npm run db:generate        # şema değiştiğinde yeni migrasyon üretir (zaten üretilmiş durumda)
npm run db:migrate         # migrasyonları veritabanına uygular
npm run db:seed            # roller, izinler ve admin kullanıcıyı oluşturur
npm run dev                 # http://localhost:4000
```

### Frontend

```bash
cd frontend
npm install
npm run dev                 # http://localhost:5173 (backend'e http://localhost:4000/api üzerinden bağlanır)
```

### Testler

```bash
cd backend
npm test
```

Testler, gerçek bir PostgreSQL sunucusuna ihtiyaç duymadan, PostgreSQL ile aynı bağlantı
protokolünü konuşan gömülü bir veritabanı (`@electric-sql/pglite`) üzerinde HTTP seviyesinde
uçtan uca çalışır: giriş akışı, proje/görev seçimi, yetki kontrolü, admin CRUD işlemleri ve
şifre değiştirme dahil 20 senaryoyu kapsar.

## Dağıtım

Üretim ortamına (Coolify + `isg.shnai.cloud`) nasıl yayınlanacağı için **[DEPLOYMENT.md](./DEPLOYMENT.md)**
dosyasına bakın.

## Giriş Akışı (FAZ 1)

1. Kullanıcı adı + şifre ile giriş yapılır.
2. Sistem admini ise doğrudan admin paneline yönlendirilir.
3. Diğer kullanıcılar, atanmış oldukları projeler arasından birini seçer.
4. Ardından o projedeki görevlerinden (İSG Uzmanı, Formen, Şantiye Şefi vb.) birini seçer.
5. Seçilen proje + görev bağlamına göre yetkileri belirlenir ve oturum başlatılır.
6. İlk girişte (geçici şifreyle) şifre değişikliği zorunlu kılınır.

## Yol Haritası

- **FAZ 1 (bu depo):** Giriş, admin panel, proje, firma, kullanıcı, rol/yetki sistemi ✅
- **FAZ 2:** Uygunsuzluk açma, atama, listeleme, durum sistemi, fotoğraf yükleme
- **FAZ 3:** Düzeltme, onay/red, değiştirilemez tarihçe
- **FAZ 4:** Bildirim merkezi, termin takibi, ek termin talebi, termin aşımı
- **FAZ 5:** İtiraz sistemi, cezai işlem, çalışma durdurma
- **FAZ 6:** Dashboard istatistikleri, kullanıcı profil istatistikleri, PDF/Excel raporlama
- **FAZ 7:** Yedekleme otomasyonu, gelişmiş log/performans/güvenlik iyileştirmeleri

Veritabanı şeması bu fazlar göz önünde bulundurularak (bkz. proje gereksinim dokümanındaki
"Veritabanı Ana Tabloları" bölümü) genişletilebilir şekilde tasarlanmıştır.
