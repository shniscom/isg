import { useEffect, useState } from 'react';
import apiClient, { getErrorMessage } from '../../api/client';
import { Card, Button, Textarea, Alert, Badge } from '../../components/ui';
import { formatDateTime } from '../../lib/nonconformity';

const STATUS_LABELS = { BEKLEMEDE: 'Bekliyor', ONAYLANDI: 'Onaylandı', REDDEDILDI: 'Reddedildi' };
const STATUS_BADGE_VARIANT = { BEKLEMEDE: 'warning', ONAYLANDI: 'success', REDDEDILDI: 'danger' };
const ACTION_LABELS = {
  COMPANY_UPDATE: 'Firma Düzenleme',
  COMPANY_DELETE: 'Firma Silme',
  PROJECT_UPDATE: 'Proje Düzenleme',
  PROJECT_STATUS_CHANGE: 'Proje Durum Değişikliği',
  NONCONFORMITY_DELETE: 'Uygunsuzluk Silme',
  PENALTY_APPROVE: 'Ceza Onaylama',
  PENALTY_REJECT: 'Ceza Reddetme',
};

const TABS = ['BEKLEMEDE', 'ONAYLANDI', 'REDDEDILDI'];

export function PendingApprovalsPage() {
  const [status, setStatus] = useState('BEKLEMEDE');
  const [approvals, setApprovals] = useState(null);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [rejectingId, setRejectingId] = useState(null);
  const [rejectNote, setRejectNote] = useState('');

  async function load() {
    try {
      const { data } = await apiClient.get('/admin/approvals', { params: { status } });
      setApprovals(data.approvals);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  async function handleApprove(id) {
    setBusyId(id);
    setError(null);
    try {
      await apiClient.post(`/admin/approvals/${id}/approve`);
      await load();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  async function handleReject(id) {
    if (!rejectNote.trim()) return;
    setBusyId(id);
    setError(null);
    try {
      await apiClient.post(`/admin/approvals/${id}/reject`, { decisionNote: rejectNote });
      setRejectingId(null);
      setRejectNote('');
      await load();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Onay Bekleyenler</h1>
        <p className="mt-1 text-sm text-slate-500">
          Firma silme/düzenleme, proje değişikliği, uygunsuzluk silme, ceza onaylama gibi geri dönülmez işlemler burada
          son onayınızı bekler. Admin olmayan bir kullanıcı bu işlemlerden birini tetiklediğinde işlem hemen
          uygulanmaz; yalnızca siz onaylarsanız gerçekleşir.
        </p>
      </div>

      {error && <Alert>{error}</Alert>}

      <div className="flex gap-2">
        {TABS.map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            className={`rounded-full px-4 py-2 text-sm font-medium transition ${
              status === s ? 'bg-brand-700 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {STATUS_LABELS[s]}
          </button>
        ))}
      </div>

      {approvals?.length === 0 && <p className="text-sm text-slate-500">Bu durumda kayıt yok.</p>}

      <div className="space-y-3">
        {approvals?.map((a) => (
          <Card key={a.id}>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={STATUS_BADGE_VARIANT[a.status]}>{STATUS_LABELS[a.status]}</Badge>
              <span className="font-medium text-slate-800">{ACTION_LABELS[a.actionType] || a.actionType}</span>
              {a.projectName && <span className="text-xs text-slate-400">· {a.projectName}</span>}
            </div>

            <p className="mt-2 text-sm text-slate-700">{a.summary}</p>

            <p className="mt-1 text-xs text-slate-400">
              {a.requestedByName} tarafından {formatDateTime(a.requestedAt)} tarihinde talep edildi.
              {a.decidedByName && ` ${a.decidedByName} tarafından ${formatDateTime(a.decidedAt)} tarihinde karara bağlandı.`}
            </p>
            {a.decisionNote && <p className="mt-1 text-xs text-slate-500">Not: {a.decisionNote}</p>}

            {a.status === 'BEKLEMEDE' && (
              <div className="mt-3 border-t border-slate-100 pt-3">
                {rejectingId !== a.id ? (
                  <div className="flex gap-3">
                    <Button onClick={() => handleApprove(a.id)} disabled={busyId === a.id}>
                      ✓ Onayla ve Uygula
                    </Button>
                    <Button variant="danger" onClick={() => setRejectingId(a.id)} disabled={busyId === a.id}>
                      ✕ Reddet
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Textarea label="Red gerekçesi" value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} required />
                    <div className="flex gap-3">
                      <Button variant="danger" onClick={() => handleReject(a.id)} disabled={busyId === a.id || !rejectNote.trim()}>
                        Reddi Onayla
                      </Button>
                      <Button variant="secondary" onClick={() => { setRejectingId(null); setRejectNote(''); }}>
                        Vazgeç
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
