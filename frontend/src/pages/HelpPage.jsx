import { useMemo, useState } from 'react';
import { Card, Input } from '../components/ui';

// Kullanım Kılavuzu içeriği. Tüm alanlar/adımlar mevcut ekranlardaki gerçek alan adlarına göre yazılmıştır.
// Yeni bir ekran/alan eklendiğinde bu listeyi de güncellemeyi unutmayın.
const TOPICS = [
  {
    id: 'baslangic',
    icon: '🏠',
    title: 'Başlarken',
    summary: 'Giriş yapma, proje/görev seçimi ve ana sayfanın kullanımı.',
    sections: [
      {
        heading: 'Giriş yapma',
        paragraphs: [
          'Kullanıcı adınız ve şifrenizle giriş yapın. "Beni Hatırla" işaretlerseniz oturumunuz cihazınızda saklanır ve bir sonraki açılışta otomatik giriş yapılır.',
          'İlk girişinizde veya admin sizin için geçici bir şifre oluşturduysa, giriş sonrası otomatik olarak "Şifre Değiştir" ekranı açılır; yeni bir şifre belirlemeden diğer sayfalara geçemezsiniz.',
        ],
      },
      {
        heading: 'Proje / görev seçimi',
        paragraphs: [
          'Birden fazla projede veya birden fazla görevde yer alıyorsanız giriş sonrasında "Proje / Görev Seçimi" ekranı çıkar; çalışacağınız bağlamı seçmeniz gerekir.',
          'Sistem admini iseniz bu adım atlanır; bunun yerine ilgili sayfaların üstünde bir "Proje" seçici görürsünüz ve istediğiniz zaman proje değiştirebilirsiniz.',
        ],
      },
      {
        heading: 'Ana sayfa ve menü',
        paragraphs: [
          'Ana sayfa; size atanmış açık uygunsuzlukları, onayınızı bekleyen kayıtları, cezalarınızı ve bildirimlerinizi özetler.',
          'Soldaki menüde (mobilde ☰ ikonuyla açılır) gördüğünüz sekmeler hesabınızın yetkilerine göre değişir: örneğin "Raporlar" yalnızca rapor görüntüleme yetkiniz varsa, "Kullanıcılar" yalnızca kullanıcı yönetme yetkiniz varsa görünür.',
        ],
      },
    ],
  },
  {
    id: 'uygunsuzluk-acma',
    icon: '⚠️',
    title: 'Uygunsuzluk Açma',
    summary: 'Sahada tespit edilen bir uygunsuzluğu kayda geçirme.',
    sections: [
      {
        heading: 'Kim açabilir',
        paragraphs: ['"Uygunsuzluk Açma" yetkisine sahip kullanıcılar açabilir.'],
      },
      {
        heading: 'Nereden açılır',
        paragraphs: ['Sol menüden Uygunsuzluklar sekmesine, ardından "+ Yeni Uygunsuzluk" butonuna girin. Sistem admini iseniz formu doldurmadan önce üstteki Proje alanından ilgili projeyi seçmelisiniz (zorunlu).'],
      },
      {
        heading: 'Zorunlu alanlar',
        bullets: ['Açıklama', 'Termin Tarihi (son düzeltme tarihi)'],
      },
      {
        heading: 'Opsiyonel alanlar',
        bullets: [
          'Kategori, Blok / Bölge, Sorumlu Firma',
          'Öncelik (varsayılan bir değerle gelir)',
          'Risk / Şiddet Skoru — seçilirse formda "Risk skoruna göre termin öner" bağlantısı belirir ve tıklandığında Termin Tarihi otomatik hesaplanıp doldurulur',
          'Düzeltme Önerisi (yapılması gereken düzeltmeyi öneren serbest metin)',
          'Uygunsuz Davranışta Bulunan Çalışan — önce Sorumlu Firma seçilmelidir; çalışan aranabilir listeden seçilir. Kişi listede yoksa "+ Listede yok, yeni çalışan ekle" ile Ad Soyad (zorunlu) ve T.C. Kimlik No (opsiyonel) girilerek anında eklenip seçilebilir',
          'Fotoğraf — en fazla 5 adet, kameradan veya (ayarlarda açıksa) galeriden eklenebilir',
        ],
      },
      {
        heading: 'Atanan kişi(ler)',
        paragraphs: [
          '"Kimler listelensin?" filtresiyle kapsamı daraltabilirsiniz: varsayılan "Sorumlu Firma + Genel", ya da "Tüm Kullanıcılar", ya da belirli bir firma.',
          'Listeden bir veya birden fazla kişi işaretlenerek atanır. Kendinize atama yapamazsınız.',
        ],
      },
      {
        heading: 'Kaydetme',
        paragraphs: ['"Uygunsuzluğu Aç" butonuna basınca kayıt "Açık" durumunda oluşturulur ve atanan kişilere bildirim gider.'],
      },
    ],
  },
  {
    id: 'uygunsuzluk-duzeltme',
    icon: '✅',
    title: 'Düzeltme Bildirme, Onay ve Red',
    summary: 'Atanan kişinin düzeltmeyi bildirmesi, yetkilinin onaylaması veya reddetmesi.',
    sections: [
      {
        heading: 'Düzeltmeyi bildirme',
        paragraphs: [
          'Uygunsuzluk detay sayfasında, yalnızca atanan kişi(ler) ve kayıt "Açık" durumdayken "Düzeltmeyi Bildir" formu görünür.',
          'Zorunlu alan: "Nasıl çözdünüz?" açıklaması. Opsiyonel: kanıt fotoğrafı.',
          '"Düzeltmeyi Tamamla ve Onaya Gönder" butonuna basınca kayıt "Beklemede" durumuna geçer ve onay yetkisi olan kişilere bildirim gider.',
        ],
      },
      {
        heading: 'Onaylama / reddetme',
        paragraphs: [
          'Onay yetkisi olan kişi, "Onayınızı Bekliyor" kutusunda gönderilen açıklamayı ve fotoğrafları görür.',
          '"✓ Onayla" ile uygunsuzluk kapanır (Kapanış Tarihi kaydedilir).',
          '"✕ Reddet" seçilirse Red Gerekçesi yazılması zorunludur; kayıt tekrar "Açık" durumuna döner ve atanan kişi düzeltmeyi düzenleyip yeniden gönderebilir. Sistemde ayrı bir "itiraz" ekranı bulunmaz — reddedilen bir düzeltmeye itiraz etme, düzeltmeyi yeniden düzenleyip tekrar göndermek şeklinde işler.',
        ],
      },
      {
        heading: 'Düzenleme ve silme',
        paragraphs: ['Uygunsuzluk kaydının bilgilerini (açıklama, öncelik, risk skoru, düzeltme önerisi vb.) değiştirmek veya kaydı tamamen silmek için ayrı yetkiler (Düzenleme, Silme) gerekir; bu yetkilere sahip kullanıcılar detay sayfasında "Düzenle" / "Sil" butonlarını görür.'],
      },
    ],
  },
  {
    id: 'termin-uzatma',
    icon: '⏳',
    title: 'Termin (Süre) Uzatma',
    summary: 'Termin tarihi yetmeyecekse ek süre talep etme ve onaylama.',
    sections: [
      {
        heading: 'Talep etme',
        paragraphs: ['Uygunsuzluk detay sayfasındaki "Ek Süre" bölümünden "Ek Süre Talep Et" ile açılan formda Gerekçe alanı zorunludur.'],
      },
      {
        heading: 'Onaylama / reddetme',
        paragraphs: ['Termin uzatma onaylama yetkisi olan kişi talebi onaylayabilir veya reddedebilir; red için gerekçe yazılması zorunludur.'],
      },
      {
        heading: 'Admin doğrudan uzatma',
        paragraphs: ['Yetkili/admin, onay sürecini beklemeden "Admin: Doğrudan Uzat" seçeneğiyle opsiyonel bir Not girip termini anında değiştirebilir.'],
      },
      {
        heading: 'Geçmiş',
        paragraphs: ['Daha önce yapılan tüm ek süre talepleri ve sonuçları aynı kart altında listelenir.'],
      },
    ],
  },
  {
    id: 'ceza',
    icon: '⚖️',
    title: 'Cezai İşlem',
    summary: 'Termin geçtiği halde kapatılmayan uygunsuzluklar için ceza talebi ve onayı.',
    sections: [
      {
        heading: 'Talep koşulu',
        paragraphs: [
          '"Cezai İşlem Talep Et" butonu yalnızca termin tarihi geçmiş ve uygunsuzluk hâlâ kapatılmamışsa görünür.',
          'Bu yalnızca bir talep kaydıdır — onaylanmadan hiçbir kesinti veya yaptırım otomatik uygulanmaz.',
        ],
      },
      {
        heading: 'Zorunlu / opsiyonel alanlar',
        bullets: [
          'Gerekçe — zorunlu',
          'Yaptırım Türü — zorunlu, listeden seçilir',
          'Önerilen Tutar (TL) — yalnızca "Para Cezası" seçilince görünür, opsiyoneldir; risk skoruna göre otomatik bir öneri gelir',
        ],
      },
      {
        heading: 'Onaylama',
        paragraphs: [
          'Ceza onaylama yetkisi olan kişi "Cezalar" sekmesinden veya uygunsuzluk detayından talebi Onaylar veya Reddeder (red gerekçesi zorunludur).',
          'Talebi açan kişi kendi talebini onaylayamaz.',
        ],
      },
      {
        heading: 'Cezalar sekmesi',
        paragraphs: ['Durum filtreleriyle (Beklemede / Onaylandı / Reddedildi / Tümü) listelenir; her filtrenin yanında kayıt sayısı gösterilir.'],
      },
    ],
  },
  {
    id: 'calisanlar',
    icon: '👷',
    title: 'Çalışanlar',
    summary: 'Firma bazlı çalışan listesi, arama, filtreler ve çalışan kartı.',
    sections: [
      {
        heading: 'Erişim',
        paragraphs: [
          'Çalışanlar sekmesini görüntülemek için Uygunsuzluk Görme, Firma Görüntüleme, Uygunsuzluk Açma veya İnsan Kaynakları Yönetimi yetkilerinden en az birine sahip olmanız yeterlidir.',
          'Ekleme, düzenleme, Excel ile içe aktarma, silme ve toplu silme işlemleri yalnızca sistem admini veya İnsan Kaynakları Yönetimi yetkisi olan kullanıcılara açıktır (bkz. "İnsan Kaynakları" başlığı).',
        ],
      },
      {
        heading: 'Kullanım',
        paragraphs: [
          'Önce firma kartlarından bir firma seçilir, ardından o firmanın çalışan listesi açılır.',
          'Arama kutusu, sütun sıralama ve filtre sekmeleri (Tümü / MYK Belgeli / Eğitimsiz / Tetkik / İSG Görevi) ile listeyi daraltabilirsiniz.',
        ],
      },
      {
        heading: 'Mükerrer kayıt uyarısı',
        paragraphs: ['Aynı proje içinde birden fazla firmada, aynı ad-soyad ve T.C. kimlik numarasıyla kayıtlı çalışan varsa, firma seçim ekranında sarı bir uyarı kartı görünür. Buradan mükerrer kayıtları inceleyip gereksiz olanı silebilirsiniz.'],
      },
      {
        heading: 'Çalışan kartı (detay sayfası)',
        paragraphs: [
          'Bir çalışana tıklayınca detay sayfası açılır: kişisel bilgiler, MYK belgesi, İSG görevi ve varsa giriş/çıkış geçmişi gösterilir.',
          'Kişi daha önce arşivlenmiş ve sonradan yeniden aktif edilmişse, mavi bir "Yeniden İşe Alım" kutusunda İlk Giriş Tarihi, (önceki) Çıkış Tarihi ve Yeniden Giriş Tarihi birlikte gösterilir.',
        ],
      },
    ],
  },
  {
    id: 'ik',
    icon: '🧑‍💼',
    title: 'İnsan Kaynakları',
    summary: 'Firma çalışan rosterlarını güncel tutma: ekleme, çıkış, Excel ile toplu güncelleme.',
    sections: [
      {
        heading: 'Yetki',
        paragraphs: ['Bu bölüme erişim, "İnsan Kaynakları Yönetimi" yetkisine bağlıdır ve yalnızca admin tarafından kullanıcıya atanabilir (Kullanıcılar > ilgili kullanıcı > yetki ver ekranından).'],
      },
      {
        heading: 'Tekil çalışan ekleme / düzenleme',
        paragraphs: [
          'Çalışanlar sekmesinde ilgili firma seçilip "+ Çalışan Ekle" ile Ad Soyad (zorunlu) ve diğer bilgiler girilir.',
          'Bir çalışanın "Çıkış Tarihi" girilip kaydedilmesi, o çalışanı arşivler (pasif duruma alır). Çıkış tarihini boşaltıp kaydetmek çalışanı yeniden aktif eder.',
        ],
      },
      {
        heading: 'Excel ile toplu içe aktarma',
        paragraphs: [
          'Sayfadaki "Excel Formatı" rehberinden şablon indirilip doldurulur, ardından dosya yüklenir.',
          'Sistem, yüklenen listeyi o firmanın mevcut aktif çalışan listesiyle otomatik karşılaştırır:',
        ],
        bullets: [
          'Önceden aktif olup yeni listede olmayan kişiler otomatik arşivlenir; gerçek çıkış tarihi bilinmediği için çıkış tarihi "belirsiz/tarihsiz" bırakılır ve içe aktarma sonucunda bunun için ayrıca sarı bir uyarı gösterilir — bu kişilerin gerçek çıkış tarihini daha sonra çalışan kartından tek tek girmeniz gerekir.',
          'Yeni listede olup sistemde kaydı bulunmayan kişiler yeni çalışan olarak eklenir.',
          'Daha önce arşivlenmiş bir kişi yeni listede tekrar görünürse "yeniden giriş" olarak işaretlenip aktif hale getirilir; ilk giriş tarihi ve önceki çıkış tarihi korunur, kart üzerinde her ikisi de yeni giriş tarihiyle birlikte gösterilir.',
          'Bu karşılaştırma mantığı, yeni liste eskisinden daha küçük olsa da (net çıkışlar) daha büyük olsa da (net yeni işe alımlar) aynı şekilde çalışır.',
        ],
      },
      {
        heading: 'İçe aktarma sonucu',
        paragraphs: ['İşlem bitince ekranda kaç kişinin eklendiği, güncellendiği, arşivlendiği, yeniden giriş yaptığı, atlandığı ve varsa hataların dökümü gösterilir. Tarihsiz arşivlenen kişi olduğunda bunu bildiren uyarı mutlaka okunmalı ve ilgili kişilerin çıkış tarihleri sonradan tamamlanmalıdır.'],
      },
    ],
  },
  {
    id: 'kullanicilar',
    icon: '👤',
    title: 'Kullanıcı ve Yetki Yönetimi',
    summary: 'Yeni kullanıcı oluşturma (roster tabanlı) ve yetki atama.',
    sections: [
      {
        heading: 'Yeni kullanıcı oluşturma',
        paragraphs: [
          'Kullanıcı Yönetme yetkisi (genelde admin) gerekir. Kullanıcılar sekmesinde "+ Yeni Kullanıcı" ile önce Proje seçilir.',
          'Kullanıcılar yalnızca o projedeki firmaların çalışan rosterından — yani sistemde kayıtlı, henüz kullanıcı hesabı olmayan aktif bir çalışandan — seçilebilir.',
          'Liste kalabalıklaşmasın diye önce (opsiyonel) bir Firma seçilir; ardından açılan aranabilir kutuya isim veya T.C. kimlik no yazılarak istenen kişi bulunur — bu kutu gerçek bir metin alanı olduğundan mobilde dokununca klavye otomatik açılır.',
          'Eklenecek kişi roster\'da yoksa (örn. henüz çalışan kaydı girilmemiş biri), "Roster dışı" kutusu işaretlenip bilgiler elle girilir. Bu durumda hesap hemen oluşmaz; talep admin onayına düşer (Onay Bekleyenler sayfasında görünür) ve admin onaylayınca hesap açılır.',
          'Roster\'dan seçilen kişi için hesap anında oluşturulur ve geçici bir şifre üretilir; kullanıcı ilk girişinde şifresini değiştirmek zorundadır.',
        ],
      },
      {
        heading: 'Yetki ve görev atama',
        paragraphs: [
          'Kullanıcı detay sayfasından kişiye proje/görev ataması yapılır ve verilecek yetkiler işaretlenir.',
          'Verilecek yetkiler listesi kategori başlıklarına göre gruplanmıştır (Uygunsuzluk İşlemleri, İtiraz, Termin Uzatma, Saha Yaptırımları, Kaza/Ramak Kala, Raporlama, Yönetim, İnsan Kaynakları vb.); aradığınız yetkiyi kategori başlığından hızlıca bulabilir, "Tümünü Seç" ile listedeki tüm yetkileri tek seferde işaretleyebilirsiniz. Örneğin bir çalışana yalnızca çalışan roster\'ını güncelleme yetkisi vermek için "İnsan Kaynakları" kategorisi altındaki "İnsan Kaynakları Yönetimi" yetkisini işaretlemeniz yeterlidir.',
          'Her kullanıcı, "Yetkilerim" sayfasından kendi hesabına tanımlı yetkileri kategori bazlı ve açıklamalı olarak görebilir.',
        ],
      },
    ],
  },
  {
    id: 'kullanici-arsivleme',
    icon: '📦',
    title: 'Kullanıcı Arşivleme',
    summary: 'Kullanıcılar silinmez; "Çıkış" ya da "Görev Değişikliği" modlarıyla arşivlenir.',
    sections: [
      {
        heading: 'Genel',
        paragraphs: ['Bu programda kullanıcı hesapları silinmez, arşivlenir. Kullanıcı detay sayfasında "Arşivle" kartı bulunur (kendi hesabınız ve zaten pasif olan kullanıcılar için bu kart gizlenir).'],
      },
      {
        heading: 'Açık kayıt kontrolü',
        paragraphs: ['Arşivlemeden önce sistem, kullanıcının üzerinde açık uygunsuzluk ataması olup olmadığını kontrol eder. Varsa uyarı gösterilir ve arşivleme işlemine devam etmeden önce bu kayıtları başka bir kullanıcıya yeniden atayabilirsiniz.'],
      },
      {
        heading: 'İki mod',
        bullets: [
          'Çıkış — kişi hem sistemden hem firmadan ayrılıyorsa kullanılır. Çıkış Tarihi girilir; hem kullanıcı hesabı hem (varsa) bağlı çalışan kaydı birlikte arşivlenir.',
          'Görev değişikliği — kişi firmada çalışmaya devam ediyor ama artık bu sistemi kullanmayacaksa / farklı bir göreve geçtiyse kullanılır. Yalnızca kullanıcı hesabı pasifleşir, tüm yetki ve proje atamaları kaldırılır; bağlı çalışan kaydına dokunulmaz.',
        ],
      },
      {
        heading: 'Sonuç',
        paragraphs: ['Arşivlenen kullanıcı, detay sayfasında "Arşivde / Pasif" rozetiyle işaretlenir ve artık sisteme giriş yapamaz.'],
      },
    ],
  },
  {
    id: 'firmalar',
    icon: '🏢',
    title: 'Firmalar',
    summary: 'Firma tanımlama, düzenleme, pasifleştirme ve firma detay sayfası.',
    sections: [
      {
        heading: 'Yetki',
        paragraphs: ['Firma ekleme/düzenleme/pasifleştirme için Firma Yönetme; yalnızca görüntülemek için Firma Görüntüleme yetkisi yeterlidir.'],
      },
      {
        heading: 'Yeni firma',
        paragraphs: ['Proje seçilip "+ Yeni Firma" ile form açılır. Zorunlu alan: Firma Adı. Opsiyonel: Firma Türü, Vergi Numarası, SGK Sicil Numarası, Telefon, Projede Yaptığı İş.'],
      },
      {
        heading: 'Düzenleme ve pasifleştirme',
        paragraphs: ['Firma kartındaki kalem ikonuyla bilgiler düzenlenir. Pasifleştir/yeniden aktifleştir ikonlarıyla firma geçici olarak devre dışı bırakılabilir; pasif firmalar çalışan ve kullanıcı atama listelerinde artık görünmez.'],
      },
      {
        heading: 'Firma detay sayfası',
        paragraphs: ['Firma kartına tıklanınca açılan detay sayfasında bölgeler (bloklar), firma rolleri, acil durum ekipleri ile MYK/eğitim oranları gibi özet bilgiler sekmeler halinde yer alır.'],
      },
    ],
  },
  {
    id: 'gorevler',
    icon: '🎯',
    title: 'Görevler ve Firma Rolleri',
    summary: 'Kullanıcılara ve firmalara atanabilecek görev/rol tanımları.',
    sections: [
      {
        heading: 'Proje görevleri',
        paragraphs: ['Kullanıcılara atanan görevlerdir (örn. Şantiye Şefi, İSG Uzmanı). "+ Yeni Görev" ile Görev Adı (zorunlu) ve Açıklama (opsiyonel) girilir; listedeki Düzenle/Sil ikonlarıyla yönetilir.'],
      },
      {
        heading: 'Firma rolleri',
        paragraphs: ['Firmalara atanan rollerdir (örn. Ana Yüklenici, Taşeron). "+ Yeni Firma Rolü" ile Rol Adı (zorunlu) ve Kategori seçilir; aynı şekilde düzenlenip silinebilir.'],
      },
    ],
  },
  {
    id: 'kaza',
    icon: '🚑',
    title: 'Kaza / Ramak Kala Bildirimi',
    summary: 'Sahada yaşanan kaza veya ramak kala olaylarının kaydı.',
    sections: [
      {
        heading: 'Erişim',
        paragraphs: ['Kaza Bildirimi yetkisi gerekir. Sol menüden "Kaza Bildir" sayfasına girilir.'],
      },
      {
        heading: 'Zorunlu alanlar',
        bullets: ['Proje (sistem admini ise)', 'Firma', 'Olay Tarihi / Saati'],
      },
      {
        heading: 'Diğer alanlar (opsiyonel ama doldurulması önerilir)',
        bullets: [
          'Tür (Kaza / Ramak Kala), Olay Şekli, Olay Yeri, Sebebi',
          'Kazazedenin Mesleği, Görgü Tanığı İfadesi',
          'Sevk Edilen Hastane, Kim Tarafından Yapıldı (ilk müdahale)',
          'Doktor Raporu (görsel/PDF), Rapor (gün), İşe Başlama Tarihi',
          'Alınan Aksiyon',
        ],
      },
      {
        heading: 'Görüntüleme ve yönetim',
        paragraphs: ['Girilen kayıtlar firma detay sayfasında ve istatistiklerde görüntülenebilir. Kaydı düzenlemek veya silmek için Firma Yönetme yetkisi gerekir.'],
      },
    ],
  },
  {
    id: 'raporlar',
    icon: '📊',
    title: 'Raporlar',
    summary: 'Dönemsel istatistikler ve dışa aktarma.',
    sections: [
      {
        heading: 'Erişim',
        paragraphs: ['Rapor Görüntüleme yetkisi gerekir; Excel/PDF olarak dışa aktarmak için ayrıca Rapor Alma yetkisi gerekir.'],
      },
      {
        heading: 'Kullanım',
        paragraphs: [
          'Sistem admini önce Proje seçer. Sayfada günlük/haftalık/aylık istatistikler ve firma bazlı kırılım gösterilir.',
          'Özel bir tarih aralığı (Başlangıç / Bitiş) seçip "Dışa Aktar" ile o aralığın özetini, "Tam Liste Dışa Aktar" ile tüm kayıtların ayrıntılı listesini indirebilirsiniz.',
        ],
      },
    ],
  },
  {
    id: 'arsiv',
    icon: '🗄️',
    title: 'Aylık Arşiv',
    summary: 'Dönemsel kayıtların (fotoğraflar dahil) dışa aktarılıp saklanması.',
    sections: [
      {
        heading: 'Erişim',
        paragraphs: ['Yalnızca sistem admini kullanabilir.'],
      },
      {
        heading: 'Kullanım',
        paragraphs: [
          'Proje ve Dönem (ay) seçilince o döneme ait kayıtların önizlemesi gösterilir.',
          '"Arşivi Oluştur" butonuyla o dönemin tüm uygunsuzluk kayıtları, fotoğrafları dahil olmak üzere dışa aktarılıp saklanır.',
          'Projenin geçmiş arşiv oluşturma kayıtları sayfanın altında listelenir.',
        ],
      },
    ],
  },
  {
    id: 'onaylar',
    icon: '✅',
    title: 'Onay Bekleyenler (Admin Onayı)',
    summary: 'Kritik işlemlerin admin onayından geçmesi.',
    sections: [
      {
        heading: 'Ne zaman kullanılır',
        paragraphs: ['Bazı kritik işlemler (örneğin roster dışı yeni kullanıcı ekleme) doğrudan uygulanmaz; önce bu sayfada bekleyen bir talep olarak listelenir.'],
      },
      {
        heading: 'Kullanım',
        paragraphs: ['Yalnızca sistem admini görebilir. Talep incelenip Onayla veya Reddet seçilir; onaylanan işlem o anda otomatik olarak uygulanır.'],
      },
    ],
  },
  {
    id: 'profil',
    icon: '⚙️',
    title: 'Profil, Yetkilerim, Görünüm',
    summary: 'Hesap bilgileri, yetki listesi ve tema ayarları.',
    sections: [
      {
        heading: 'Profil',
        paragraphs: ['Ad soyad ve telefon gibi bilgilerinizi görüntüleyebilir, şifrenizi değiştirebilirsiniz.'],
      },
      {
        heading: 'Yetkilerim',
        paragraphs: ['Hesabınıza tanımlı tüm yetkilerin, kategori başlıkları altında kısa açıklamalarla listelendiği sayfadır. Bir işlemi neden yapamadığınızı anlamak için buraya bakabilirsiniz.'],
      },
      {
        heading: 'Görünüm',
        paragraphs: ['Uygulama temasını (5 renk seçeneği), açık/koyu modu ve görünüm yoğunluğunu (sıkışık/normal) buradan kişiselleştirebilirsiniz.'],
      },
    ],
  },
];

function normalize(text) {
  return (text || '').toLocaleLowerCase('tr');
}

function topicMatches(topic, query) {
  if (!query) return true;
  const q = normalize(query);
  if (normalize(topic.title).includes(q) || normalize(topic.summary).includes(q)) return true;
  return topic.sections.some((section) => {
    if (normalize(section.heading).includes(q)) return true;
    if (section.paragraphs?.some((p) => normalize(p).includes(q))) return true;
    if (section.bullets?.some((b) => normalize(b).includes(q))) return true;
    return false;
  });
}

export function HelpPage() {
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState(TOPICS[0].id);

  const filteredTopics = useMemo(() => TOPICS.filter((t) => topicMatches(t, query)), [query]);
  const selectedTopic = TOPICS.find((t) => t.id === selectedId) || TOPICS[0];

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Kullanım Kılavuzu</h1>
        <p className="mt-1 text-sm text-slate-500">
          Programı nasıl kullanacağınızı öğrenmek için aşağıdan bir konu seçin. Her başlık, o işlemi hangi
          sayfadan, hangi bilgilerle ve hangi sırayla yapacağınızı adım adım anlatır.
        </p>
      </div>

      <Input
        label="Konu ara"
        placeholder="Örn: uygunsuzluk, çalışan, ceza, arşiv..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[280px_1fr]">
        <div className="space-y-2 lg:max-h-[70vh] lg:overflow-y-auto lg:pr-1">
          {filteredTopics.length === 0 && <p className="text-sm text-slate-400">Eşleşen konu bulunamadı.</p>}
          {filteredTopics.map((topic) => (
            <button
              key={topic.id}
              type="button"
              onClick={() => setSelectedId(topic.id)}
              className={`flex w-full items-start gap-3 rounded-xl border px-4 py-3 text-left transition ${
                selectedTopic.id === topic.id
                  ? 'border-brand-700 bg-brand-50'
                  : 'border-slate-200 bg-surface hover:bg-slate-50'
              }`}
            >
              <span className="text-lg leading-none">{topic.icon}</span>
              <span>
                <span className="block text-sm font-semibold text-slate-800">{topic.title}</span>
                <span className="block text-xs text-slate-500">{topic.summary}</span>
              </span>
            </button>
          ))}
        </div>

        <Card>
          <div className="mb-4 flex items-center gap-3">
            <span className="text-2xl leading-none">{selectedTopic.icon}</span>
            <div>
              <h2 className="text-lg font-bold text-slate-800">{selectedTopic.title}</h2>
              <p className="text-sm text-slate-500">{selectedTopic.summary}</p>
            </div>
          </div>

          <div className="space-y-5">
            {selectedTopic.sections.map((section) => (
              <div key={section.heading}>
                <h3 className="mb-1.5 text-sm font-semibold text-slate-700">{section.heading}</h3>
                {section.paragraphs?.map((p) => (
                  <p key={p} className="mb-1.5 text-sm leading-relaxed text-slate-600">
                    {p}
                  </p>
                ))}
                {section.bullets && (
                  <ul className="list-disc space-y-1 pl-5 text-sm leading-relaxed text-slate-600">
                    {section.bullets.map((b) => (
                      <li key={b}>{b}</li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
