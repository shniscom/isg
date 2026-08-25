import * as XLSX from 'xlsx';

// Gerçek şirket şablonuna göre Excel kolon sırası (A-N). İlk satır başlık kabul edilir,
// veriler 2. satırdan başlar. B, C, D, E, F sütunları zorunludur.
export const EXCEL_COLUMNS = [
  { col: 'A', label: 'Sıra No', required: false, note: 'Bilgi amaçlı, sistem tarafından kullanılmaz.' },
  { col: 'B', label: 'TC Kimlik No', required: true, note: 'Zorunlu, 11 haneli.' },
  { col: 'C', label: 'İşe Giriş Tarihi', required: true, note: 'Zorunlu.' },
  { col: 'D', label: 'Adı', required: true, note: 'Zorunlu.' },
  { col: 'E', label: 'Soyadı', required: true, note: 'Zorunlu.' },
  { col: 'F', label: 'SGK Görev / İş Kolu', required: true, note: 'Zorunlu. Örn: Beden İşçisi (İnşaat).' },
  { col: 'G', label: 'Eğitim Aldığı Tarih', required: false, note: 'İSG eğitiminin verildiği tarih.' },
  { col: 'H', label: 'Eğitim Geçerlilik Tarihi', required: false, note: 'İSG eğitiminin süresinin dolacağı tarih; kalan gün kartlarda otomatik hesaplanır.' },
  { col: 'I', label: 'Eğitim Kalan Gün', required: false, note: 'Bilgi amaçlı, sistem tarafından yeniden hesaplanıp dikkate alınmaz; boş bırakabilirsiniz.' },
  { col: 'J', label: 'İşe Başlama Eğitimi', required: false, note: 'Serbest metin (ör. "ATAMA YOK").' },
  { col: 'K', label: 'EK-2', required: false, note: 'Serbest metin/tarih.' },
  { col: 'L', label: 'Tetkik', required: false, note: 'Tetkik tarihi; girilirse kalan gün kartlarda otomatik hesaplanır, boşsa "Yok" gösterilir.' },
  { col: 'M', label: 'Sağlık Yetkilisi İmzası', required: false, note: 'Serbest metin (ör. "Var").' },
  { col: 'N', label: 'İSG Görevi', required: false, note: 'Örn: Çalışan Temsilcisi.' },
];

export const EXCEL_TEMPLATE_HEADER = [
  'Sıra No',
  'TC Kimlik No',
  'İşe Giriş Tarihi',
  'Adı',
  'Soyadı',
  'SGK Görev / İş Kolu',
  'Eğitim Aldığı Tarih',
  'Eğitim Geçerlilik Tarihi',
  'Eğitim Kalan Gün',
  'İşe Başlama Eğitimi',
  'EK-2',
  'Tetkik',
  'Sağlık Yetkilisi İmzası',
  'İSG Görevi',
];

const EXCEL_TEMPLATE_EXAMPLE_ROW = [
  1,
  '12345678901',
  '01.01.2026',
  'Ali',
  'Veli',
  'Beden İşçisi (İnşaat)',
  '15.05.2026',
  '15.05.2027',
  '',
  'ATAMA YOK',
  '01.01.2026',
  '20.08.2026',
  'Var',
  'Çalışan Temsilcisi',
];

export function downloadEmployeeExcelTemplate() {
  const sheet = XLSX.utils.aoa_to_sheet([EXCEL_TEMPLATE_HEADER, EXCEL_TEMPLATE_EXAMPLE_ROW]);
  sheet['!cols'] = [
    { wch: 7 },
    { wch: 14 },
    { wch: 14 },
    { wch: 14 },
    { wch: 14 },
    { wch: 20 },
    { wch: 16 },
    { wch: 18 },
    { wch: 12 },
    { wch: 16 },
    { wch: 12 },
    { wch: 12 },
    { wch: 16 },
    { wch: 18 },
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Çalışanlar');
  XLSX.writeFile(workbook, 'calisan_listesi_sablonu.xlsx');
}

function cellText(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function excelDateToIso(value) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const text = cellText(value);
  // gg.aa.yyyy gibi Türkçe tarih formatlarını da destekle
  const trMatch = text.match(/^(\d{1,2})[./](\d{1,2})[./](\d{2,4})$/);
  if (trMatch) {
    const [, d, m, y] = trMatch;
    const year = y.length === 2 ? `20${y}` : y;
    return `${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  return text;
}

/**
 * Excel kolon sırası: sıra no, TC no, işe giriş tarihi, adı, soyadı, SGK görev/iş kolu,
 * eğitim aldığı tarih, eğitim geçerlilik tarihi, eğitim kalan gün (yok sayılır), işe başlama
 * eğitimi, EK-2, tetkik, sağlık yetkilisi imzası, İSG görevi. İlk satır başlık kabul edilir.
 */
export async function parseEmployeeExcel(file) {
  const buf = await file.arrayBuffer();
  const workbook = XLSX.read(buf, { type: 'array', cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' });
  const dataRows = rows.slice(1);
  return dataRows
    .filter((r) => Array.isArray(r) && r.some((cell) => cellText(cell) !== ''))
    .map((r) => ({
      nationalId: cellText(r[1]),
      startDate: excelDateToIso(r[2]),
      fullName: `${cellText(r[3])} ${cellText(r[4])}`.replace(/\s+/g, ' ').trim(),
      position: cellText(r[5]),
      isgTrainingDate: excelDateToIso(r[6]),
      isgTrainingExpiryDate: excelDateToIso(r[7]),
      startWorkTrainingNote: cellText(r[9]),
      ek2Note: excelDateToIso(r[10]),
      medicalExamDate: excelDateToIso(r[11]),
      healthAuthoritySignatureNote: cellText(r[12]),
      isgRole: cellText(r[13]),
    }));
}

/** Bugünden verilen tarihe kaç gün kaldığını döner (geçmişse negatif). Tarih yoksa/geçersizse null. */
export function daysRemaining(dateValue) {
  if (!dateValue) return null;
  const d = new Date(dateValue);
  if (isNaN(d.getTime())) return null;
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.round((target - startOfToday) / 86400000);
}

function chipFromDays(label, days) {
  if (days === null) return { text: `${label}: Yok`, tone: 'default' };
  if (days < 0) return { text: `${label}: ${Math.abs(days)} gün önce doldu`, tone: 'danger' };
  if (days === 0) return { text: `${label}: Bugün son gün`, tone: 'danger' };
  if (days <= 30) return { text: `${label}: ${days} gün kaldı`, tone: 'warning' };
  return { text: `${label}: ${days} gün kaldı`, tone: 'success' };
}

/** Çalışan kartlarında gösterilecek İSG eğitimi kalan süre rozeti. */
export function trainingStatusChip(employee) {
  if (!employee.isgTrainingExpiryDate) {
    return employee.isgTrainingDate
      ? { text: 'İSG Eğitimi: Var (geçerlilik tarihi girilmemiş)', tone: 'default' }
      : { text: 'İSG Eğitimi: Yok', tone: 'default' };
  }
  return chipFromDays('İSG Eğitimi', daysRemaining(employee.isgTrainingExpiryDate));
}

/** Çalışan kartlarında gösterilecek tetkik kalan süre rozeti. */
export function medicalExamStatusChip(employee) {
  return chipFromDays('Tetkik', daysRemaining(employee.medicalExamDate));
}
