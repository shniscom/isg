// Uygunsuzluk durum/öncelik sabitleri ve yardımcı fonksiyonlar (FAZ2+3 kapsamı).

export const STATUS_LABELS = {
  ACIK: 'Açık',
  BEKLEMEDE: 'Beklemede',
  KAPALI: 'Kapalı',
  TERMIN_ASIMI: 'Termin Aşımı',
  ITIRAZ: 'İtiraz',
};

// Doküman renk kodu: Açık=kırmızı, Beklemede=sarı, Kapalı=yeşil, Termin Aşımı=turuncu, İtiraz=mor
export const STATUS_BADGE_VARIANT = {
  ACIK: 'danger',
  BEKLEMEDE: 'warning',
  KAPALI: 'success',
  TERMIN_ASIMI: 'orange',
  ITIRAZ: 'purple',
};

export const STATUS_DOT_COLOR = {
  ACIK: 'bg-red-500',
  BEKLEMEDE: 'bg-amber-400',
  KAPALI: 'bg-emerald-500',
  TERMIN_ASIMI: 'bg-orange-500',
  ITIRAZ: 'bg-purple-500',
};

export const PRIORITY_LABELS = {
  DUSUK: 'Düşük',
  ORTA: 'Orta',
  YUKSEK: 'Yüksek',
  KRITIK: 'Kritik',
};

export const PRIORITY_BADGE_VARIANT = {
  DUSUK: 'default',
  ORTA: 'info',
  YUKSEK: 'warning',
  KRITIK: 'danger',
};

export function formatDateTime(value) {
  if (!value) return '-';
  return new Date(value).toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'short' });
}

export function formatDate(value) {
  if (!value) return '-';
  return new Date(value).toLocaleDateString('tr-TR', { dateStyle: 'medium' });
}

export function remainingDaysLabel(dueDate, status) {
  if (status === 'KAPALI') return null;
  const diffMs = new Date(dueDate).getTime() - Date.now();
  const days = Math.ceil(diffMs / 86400000);
  if (days < 0) return { text: `${Math.abs(days)} gün gecikti`, tone: 'danger' };
  if (days === 0) return { text: 'Bugün son gün', tone: 'warning' };
  if (days <= 3) return { text: `${days} gün kaldı`, tone: 'warning' };
  return { text: `${days} gün kaldı`, tone: 'default' };
}
