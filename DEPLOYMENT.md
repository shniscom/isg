# Coolify Uzerinden Yayina Alma (isg.shnai.cloud)

Bu proje `docker-compose.yml` ile tanimlanmis 3 servisten olusur: `postgres`, `backend` (API)
ve `frontend` (statik React uygulamasi + nginx). Sadece `frontend` servisi disariya acilir;
`backend` ve `postgres` yalnizca Docker ic aginda erisilebilir durumdadir. Bu sayede API
dogrudan internetten erisilemez, tum trafik frontend'in nginx'i uzerinden `/api` proxy'si ile gecer.

## 1. On Kosullar

- Bir VPS uzerinde kurulu Coolify (guncel surum).
- `isg.shnai.cloud` alan adinin VPS'in IP adresine yonlendirilmis (A kaydi) olmasi.
- Proje kodunun bir GitHub reposunda bulunmasi.

## 2. GitHub'a Yukleme

```bash
cd isg-takip-sistemi
git init
git add .
git commit -m "FAZ 1: temel altyapi (auth, admin panel)"
git branch -M main
git remote add origin git@github.com:<kullanici-adiniz>/isg-takip-sistemi.git
git push -u origin main
```

`.env` dosyasini **asla** repoya eklemeyin (`.gitignore` icinde zaten haric tutulmustur).

## 3. Coolify'da Yeni Kaynak Olusturma

1. Coolify panelinde **New Resource -> Docker Compose** secin.
2. GitHub reposunu baglayin, branch olarak `main` secin.
3. Compose dosyasi yolu: `docker-compose.yml` (repo kok dizininde).
4. **Environment Variables** bolumune `.env.example` dosyasindaki degiskenleri gercek
   degerleriyle girin:
   - `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`
   - `JWT_SECRET` -> `openssl rand -hex 32` ile uretin
   - `CORS_ORIGIN` -> `https://isg.shnai.cloud`
   - `SEED_ADMIN_USERNAME`, `SEED_ADMIN_PASSWORD` -> ilk admin hesabi (kurulumdan hemen
     sonra uygulama icinden sifreyi degistirin)
5. **Domains** bolumunde `frontend` servisine `isg.shnai.cloud` alan adini atayin.
   Coolify, Let's Encrypt ile otomatik SSL sertifikasi olusturacaktir.
6. **Deploy** butonuna basin.

Container ilk ayaga kalktiginda `backend` servisi otomatik olarak veritabani
migrasyonlarini uygular ve rol/izin kataloglarini + admin kullaniciyi olusturur
(`docker-entrypoint.sh`). Bu islemler tekrar calistirildiginda da guvenlidir (idempotent),
mevcut kayitlari tekrar olusturmaz.

## 4. Ilk Giris

1. `https://isg.shnai.cloud` adresine gidin.
2. `SEED_ADMIN_USERNAME` / `SEED_ADMIN_PASSWORD` ile giris yapin.
3. Sistem sizden ilk girişte şifrenizi değiştirmenizi isteyecektir.
4. Admin panelinden proje, firma, kullanici ve gorev/yetki tanimlarina baslayabilirsiniz.

## 5. Erisim Guvenligi

- **Herkese acik kayit yoktur.** Kullanicilar yalnizca admin paneli uzerinden
  olusturulabilir; her yeni kullaniciya rastgele bir gecici sifre atanir ve ilk
  girişte degistirilmesi zorunlu kilinir.
- Oturumlar JWT ile yonetilir (12 saat gecerlilik), sifreler bcrypt ile hashlenir.
- `/api/auth/login` ucu IP basina 15 dakikada 20 denemeyle sinirlandirilmistir
  (kaba kuvvet saldirilarina karsi).
- Backend, Docker ic aginda kalir; disaridan yalnizca frontend'in nginx'i uzerinden
  `/api` proxy'si ile erisilebilir.
- Tum kritik islemler (giris, olusturma, guncelleme, silme, yetki degisikligi)
  `audit_logs` tablosuna degistirilemez sekilde kaydedilir.

### Ek guvenlik onerileri (istege bagli)

Ozellikle hassas bir sahada kullanilacaksa, ek bir katman icin su seceneklerden
birini degerlendirebilirsiniz:
- Coolify'in kendi erisim kisitlama / IP allowlist ozelligini kullanmak,
- Cloudflare Access (veya benzeri bir zero-trust proxy) ile alan adinin onune
  ek bir kimlik dogrulama katmani koymak,
- VPN uzerinden erisimi zorunlu kilmak.

Bu adimlar opsiyoneldir; uygulamanin kendi icinde zaten tam bir kimlik dogrulama
ve yetkilendirme katmani bulunmaktadir.

## 6. Yedekleme

`postgres` verisi `isg_postgres_data` adli bir Docker volume icinde tutulur. Coolify
panelinden bu servis icin **Scheduled Backups** ozelligini etkinlestirebilir, ya da
manuel olarak asagidaki gibi yedek alabilirsiniz:

```bash
docker exec <postgres-container-adi> pg_dump -U isg_user isg_takip > yedek-$(date +%F).sql
```

## 7. Guncelleme Yayinlama

GitHub'daki `main` dalina yeni bir commit push edildiginde, Coolify'da otomatik
deploy (webhook) etkinse yeni surum otomatik yayinlanir. Migrasyon dosyalari
`backend/drizzle/` altina eklenmeye devam ettikce, container her yeniden
baslatildiginda otomatik olarak uygulanir.
