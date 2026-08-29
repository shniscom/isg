// İSG Kurulları Hakkında Yönetmelik'e göre kurul toplantı periyotları: çok tehlikeli sınıfta
// ayda bir, tehlikeli sınıfta iki ayda bir, az tehlikeli sınıfta üç ayda bir toplanır. Burada
// takvim yılı içinde bu periyoda göre "dönem"ler (ör. 2 aylık: Oca-Şub, Mar-Nis, ...) oluşturulup
// her dönem için normal (olağanüstü olmayan) bir toplantı yapılıp yapılmadığı hesaplanır.
const BOARD_FREQUENCY_MONTHS = { COK_TEHLIKELI: 1, TEHLIKELI: 2, AZ_TEHLIKELI: 3 };

/**
 * Firmanın tehlike sınıfına göre, içinde bulunulan yılın başından bugüne kadar hangi
 * dönemlerde kurul toplantısı yapılması gerektiğini ve yapılıp yapılmadığını hesaplar.
 * @param {string|null} dangerClass
 * @param {Array<{ periodLabel: string, isExtraordinary: boolean }>} meetings
 * @param {Date} [referenceDate]
 * @returns {Array<{ label: string, year: number, startMonth: number, endMonth: number, done: boolean }>}
 *   En yeni dönem listenin başında olacak şekilde sıralanır.
 */
function computeBoardStatus(dangerClass, meetings, referenceDate = new Date()) {
  const freq = BOARD_FREQUENCY_MONTHS[dangerClass];
  if (!freq) return [];

  const year = referenceDate.getFullYear();
  const currentMonthIndex = referenceDate.getMonth(); // 0-11

  const doneBins = new Set(
    meetings
      .filter((m) => !m.isExtraordinary && typeof m.periodLabel === 'string' && m.periodLabel.startsWith(`${year}-`))
      .map((m) => Math.floor((parseInt(m.periodLabel.slice(5, 7), 10) - 1) / freq))
  );

  const bins = [];
  for (let binIndex = 0; binIndex * freq <= currentMonthIndex; binIndex++) {
    const startMonth = binIndex * freq + 1;
    const endMonth = Math.min(startMonth + freq - 1, 12);
    bins.push({
      label:
        startMonth === endMonth
          ? `${year}-${String(startMonth).padStart(2, '0')}`
          : `${year}-${String(startMonth).padStart(2, '0')}/${String(endMonth).padStart(2, '0')}`,
      year,
      startMonth,
      endMonth,
      done: doneBins.has(binIndex),
    });
  }
  return bins.reverse();
}

module.exports = { computeBoardStatus, BOARD_FREQUENCY_MONTHS };
