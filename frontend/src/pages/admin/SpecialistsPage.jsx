import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import apiClient, { getErrorMessage } from '../../api/client';
import { Card, Alert, Badge } from '../../components/ui';

const DANGER_CLASS_LABELS = { COK_TEHLIKELI: 'Çok Tehlikeli', TEHLIKELI: 'Tehlikeli', AZ_TEHLIKELI: 'Az Tehlikeli' };
const DANGER_CLASS_ORDER = ['COK_TEHLIKELI', 'TEHLIKELI', 'AZ_TEHLIKELI'];

function formatDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('tr-TR');
}

/** Dakika değerini "X sa Y dk" biçiminde gösterir - mevzuata göre hesaplanan asgari aylık çalışma süreleri için. */
function formatMinutes(totalMinutes) {
  const minutes = Math.round(totalMinutes || 0);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} dk`;
  if (m === 0) return `${h} sa`;
  return `${h} sa ${m} dk`;
}

function SummaryPanel({ summary, typeLabel }) {
  return (
    <Card>
      <h3 className="mb-3 font-semibold text-slate-800">{typeLabel} - Genel Özet</h3>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl bg-slate-50 p-3">
          <div className="text-2xl font-bold text-slate-800">{summary.totalCompanies}</div>
          <div className="text-xs text-slate-500">Toplam Firma</div>
        </div>
        <div className="rounded-xl bg-slate-50 p-3">
          <div className="text-2xl font-bold text-slate-800">{summary.totalEmployees}</div>
          <div className="text-xs text-slate-500">Toplam Çalışan</div>
        </div>
        <div className="rounded-xl bg-red-50 p-3">
          <div className="text-2xl font-bold text-red-700">{summary.totalIncidents}</div>
          <div className="text-xs text-red-600">Kaza + Ramak Kala</div>
        </div>
        <div className="rounded-xl bg-brand-50 p-3">
          <div className="text-2xl font-bold text-brand-800">{formatMinutes(summary.requiredMonthlyMinutes)}</div>
          <div className="text-xs text-brand-700">Yasal Asgari Aylık Süre</div>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
        {DANGER_CLASS_ORDER.map((dc) => (
          <div key={dc} className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
            <span className="font-medium text-slate-700">{DANGER_CLASS_LABELS[dc]}:</span>{' '}
            <span className="text-slate-600">
              {summary.dangerClassCompanyCounts[dc]} firma · {summary.dangerClassEmployeeCounts[dc]} çalışan
            </span>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-slate-400">
        Asgari aylık süre, mevzuattaki (tehlike sınıfına göre çalışan başına dakika) tablo esas alınarak otomatik hesaplanır; gerçek
        sözleşme/hizmet süresinin bu değere eşit veya üzerinde olması gerekir.
      </p>
    </Card>
  );
}

function PersonCard({ person, type, expanded, onToggle }) {
  return (
    <Card>
      <button onClick={onToggle} className="flex w-full items-center justify-between gap-3 text-left">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-slate-800">{person.fullName || '—'}</span>
            {person.certificateClass && <Badge variant="purple">{person.certificateClass}</Badge>}
            {type === 'ISG_UZMANI' && person.classAdequacy && !person.classAdequacy.adequate && (
              <Badge variant="danger">⚠️ Sınıf Yetersiz</Badge>
            )}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
            <span>🏢 {person.companyCount} firma</span>
            <span>👷 {person.totalEmployees} çalışan</span>
            {person.certificateNo && <span>📄 Belge No: {person.certificateNo}</span>}
            {person.startDate && <span>📅 Başlangıç: {formatDate(person.startDate)}</span>}
            <span>⏱️ {formatMinutes(person.requiredMonthlyMinutes)}/ay</span>
          </div>
        </div>
        <span className="shrink-0 text-slate-400">{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <div className="mt-4 space-y-3 border-t border-slate-100 pt-4">
          {person.classAdequacy && !person.classAdequacy.adequate && (
            <Alert variant="warning">
              Bu kişinin sertifika sınıfı ({person.certificateClass}), aşağıdaki firma(lar)ın tehlike sınıfı için mevzuata göre
              yetersizdir: {person.classAdequacy.uncoveredCompanies.map((c) => `${c.companyName} (${DANGER_CLASS_LABELS[c.dangerClass]})`).join(', ')}.
            </Alert>
          )}
          <div className="space-y-2">
            {person.companies.map((c) => (
              <Link
                key={c.companyId}
                to={`/admin/firmalar/${c.companyId}`}
                className="block rounded-xl border border-slate-200 px-4 py-3 transition hover:border-brand-300 hover:bg-brand-50/40"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-slate-800">{c.companyName}</span>
                  {c.dangerClass && <Badge variant="default">{DANGER_CLASS_LABELS[c.dangerClass]}</Badge>}
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
                  <span>👷 {c.employeeCount} çalışan</span>
                  <span>📋 Son Kurul: {formatDate(c.lastKurulDate)}</span>
                  <span>📁 {c.documentCount} belge{c.expiredDocumentCount > 0 ? ` (${c.expiredDocumentCount} süresi geçmiş)` : ''}</span>
                  {(c.kazaCount > 0 || c.ramakKalaCount > 0) && (
                    <span className="text-red-600">🚨 {c.kazaCount} kaza · ⚠️ {c.ramakKalaCount} ramak kala</span>
                  )}
                  <span>
                    🔓 {c.nonconformityOpenCount} açık · 🔒 {c.nonconformityClosedCount} kapalı uygunsuzluk
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

export function SpecialistsPage() {
  const [tab, setTab] = useState('ISG_UZMANI');
  const [dataByType, setDataByType] = useState({});
  const [error, setError] = useState(null);
  const [expandedKey, setExpandedKey] = useState(null);

  async function load(type) {
    try {
      const { data } = await apiClient.get('/admin/specialists', { params: { type } });
      setDataByType((prev) => ({ ...prev, [type]: data }));
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  useEffect(() => {
    if (!dataByType[tab]) load(tab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const current = dataByType[tab];
  const typeLabel = tab === 'ISG_UZMANI' ? 'İş Güvenliği Uzmanı' : 'İşyeri Hekimi';

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Uzman / Hekim Özeti</h1>
        <p className="mt-1 text-sm text-slate-500">
          Firmalara atanmış İş Güvenliği Uzmanları ve İşyeri Hekimlerinin portföy özeti, mevzuata göre asgari çalışma süreleri ve
          sertifika sınıfı uygunluğu.
        </p>
      </div>

      {error && <Alert>{error}</Alert>}

      <div className="flex gap-2">
        <button
          onClick={() => setTab('ISG_UZMANI')}
          className={`rounded-full px-4 py-2 text-sm font-medium transition ${tab === 'ISG_UZMANI' ? 'bg-brand-700 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
        >
          🦺 İSG Uzmanı
        </button>
        <button
          onClick={() => setTab('ISYERI_HEKIMI')}
          className={`rounded-full px-4 py-2 text-sm font-medium transition ${tab === 'ISYERI_HEKIMI' ? 'bg-brand-700 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
        >
          🩺 İşyeri Hekimi
        </button>
      </div>

      {!current ? (
        <p className="text-sm text-slate-500">Yükleniyor...</p>
      ) : (
        <>
          <SummaryPanel summary={current.summary} typeLabel={typeLabel} />

          <div className="space-y-3">
            {current.people.length === 0 && (
              <p className="text-sm text-slate-500">Bu tipte henüz aktif bir atama bulunamadı.</p>
            )}
            {current.people.map((p) => (
              <PersonCard
                key={p.key}
                person={p}
                type={tab}
                expanded={expandedKey === p.key}
                onToggle={() => setExpandedKey((k) => (k === p.key ? null : p.key))}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
