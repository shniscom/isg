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

export const RISK_SCORE_LABELS = {
  1: '1 - Düşük',
  2: '2 - Orta-Düşük',
  3: '3 - Orta',
  4: '4 - Yüksek',
  5: '5 - Kritik',
};

// Risk skoruna göre önerilen termin süresi (gün). Kritik skorlar daha kısa süre önerir.
const RISK_SCORE_DUE_DAYS = { 1: 30, 2: 14, 3: 7, 4: 3, 5: 1 };

export function riskScoreSuggestedDueDate(riskScore) {
  const days = RISK_SCORE_DUE_DAYS[riskScore];
  if (!days) return null;
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(17, 0, 0, 0);
  return d;
}

export const PENALTY_STATUS_LABELS = { BEKLEMEDE: 'Onay Bekliyor', ONAYLANDI: 'Onaylandı', REDDEDILDI: 'Reddedildi' };
export const PENALTY_STATUS_BADGE_VARIANT = { BEKLEMEDE: 'warning', ONAYLANDI: 'success', REDDEDILDI: 'danger' };

export const PENALTY_SANCTION_LABELS = {
  PARA_CEZASI: 'Para Cezası',
  UYARI: 'Uyarı',
  CALISMADAN_UZAKLASTIRMA: 'Çalışmadan Uzaklaştırma',
  IS_AKDI_FESHI: 'İş Akdine Son Verilmesi (kayıt)',
  DIGER: 'Diğer',
};

// Risk skoruna göre önerilen para cezası tutarı (TL) - yalnızca bir başlangıç önerisidir.
const RISK_SCORE_PENALTY_AMOUNT = { 1: 500, 2: 1000, 3: 2500, 4: 5000, 5: 10000 };
export function riskScoreSuggestedPenaltyAmount(riskScore) {
  return RISK_SCORE_PENALTY_AMOUNT[riskScore] || null;
}
