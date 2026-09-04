import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import apiClient from '../api/client';
import { Select } from './ui';
import { formatDate } from '../lib/nonconformity';

/**
 * Bir firmaya atanmış İSG uzmanı / işyeri hekimi / DSP (Diğer Sağlık Personeli) rol
 * kayıtlarından (bkz. backend admin/company-roles.routes.js - company_role_assignments,
 * roleType) seçim yapılan dropdown. Çalışan ekleme/düzenleme formlarında "bu çalışana eğitimi
 * veren uzman kim" sorusuna cevap olarak kullanılır - serbest metin YERİNE firma kartındaki
 * gerçek atama kaydına (id) bağlanır, böylece "hangi tarihte hangi uzman görevdeydi" geçmişi
 * korunur. Hem aktif hem pasif (çıkışı girilmiş) kayıtlar listelenir - çünkü çalışanın eğitim
 * tarihi, o sırada görevde olan (artık ayrılmış) bir uzmana denk gelebilir.
 */
export function RoleAssignmentSelect({ companyId, roleType, label, value, onChange, allowEmpty = true, emptyLabel = 'Yok / Seçilmedi' }) {
  const [assignments, setAssignments] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!companyId) {
      setAssignments([]);
      return;
    }
    setAssignments(null);
    apiClient
      .get('/admin/company-roles', { params: { companyId } })
      .then(({ data }) => setAssignments((data.roles || []).filter((r) => r.roleType === roleType)))
      .catch(() => {
        setAssignments([]);
        setError('Liste yüklenemedi.');
      });
  }, [companyId, roleType]);

  if (!companyId) {
    return (
      <div>
        <span className="mb-1.5 block text-sm font-medium text-slate-700">{label}</span>
        <p className="text-xs text-slate-400">Önce firma seçilmelidir.</p>
      </div>
    );
  }

  if (assignments === null) {
    return (
      <div>
        <span className="mb-1.5 block text-sm font-medium text-slate-700">{label}</span>
        <p className="text-xs text-slate-400">Yükleniyor...</p>
      </div>
    );
  }

  if (assignments.length === 0) {
    return (
      <div>
        <span className="mb-1.5 block text-sm font-medium text-slate-700">{label}</span>
        <p className="text-xs text-amber-700">
          {error || (
            <>
              Bu firmada henüz kayıtlı değil.{' '}
              <Link to={`/admin/firmalar/${companyId}`} className="underline" target="_blank" rel="noreferrer">
                Firmalar &gt; Roller sekmesinden ekleyin
              </Link>
              .
            </>
          )}
        </p>
      </div>
    );
  }

  return (
    <Select label={label} value={value || ''} onChange={(e) => onChange(e.target.value)}>
      {allowEmpty && <option value="">{emptyLabel}</option>}
      {assignments.map((a) => {
        const name = a.source === 'CALISAN' ? a.employeeFullName : a.outsideFullName;
        const period = a.certificateStartDate
          ? `${formatDate(a.certificateStartDate)} - ${a.certificateEndDate ? formatDate(a.certificateEndDate) : 'Aktif'}`
          : a.certificateEndDate
            ? `... - ${formatDate(a.certificateEndDate)}`
            : null;
        const extra = [a.certificateClass, a.certificateNo ? `Belge: ${a.certificateNo}` : null, period].filter(Boolean).join(' · ');
        return (
          <option key={a.id} value={a.id}>
            {name}
            {extra ? ` (${extra})` : ''}
            {!a.certificateEndDate ? '' : ' [Ayrıldı]'}
          </option>
        );
      })}
    </Select>
  );
}
