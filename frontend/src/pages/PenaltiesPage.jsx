import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import apiClient, { getErrorMessage } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Card, Select, Textarea, Button, Alert, Badge } from '../components/ui';
import {
  PENALTY_STATUS_LABELS,
  PENALTY_STATUS_BADGE_VARIANT,
  PENALTY_SANCTION_LABELS,
  formatDateTime,
} from '../lib/nonconformity';

const STATUS_FILTERS = ['BEKLEMEDE', 'ONAYLANDI', 'REDDEDILDI'];

export function PenaltiesPage() {
  const { user } = useAuth();
  const [status, setStatus] = useState('BEKLEMEDE');
  const [penalties, setPenalties] = useState(null);
  const [error, setError] = useState(null);
  const [rejectingId, setRejectingId] = useState(null);
  const [rejectNote, setRejectNote] = useState('');
  const [busyId, setBusyId] = useState(null);

  const [adminProjects, setAdminProjects] = useState(null);
  const [adminProjectId, setAdminProjectId] = useState('');

  useEffect(() => {
    if (user?.isSystemAdmin) {
      apiClient
        .get('/admin/projects')
        .then(({ data }) => {
          setAdminProjects(data.projects);
          if (data.projects.length > 0) setAdminProjectId(data.projects[0].id);
        })
        .catch((err) => setError(getErrorMessage(err)));
    }
  }, [user]);

  async function load() {
    if (user?.isSystemAdmin && !adminProjectId) return;
    try {
      const params = { status };
      if (user?.isSystemAdmin) params.projectId = adminProjectId;
      const { data } = await apiClient.get('/penalties', { params });
      setPenalties(data.penalties);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, adminProjectId]);

  async function handleApprove(id) {
    setBusyId(id);
    setError(null);
    try {
      await apiClient.post(`/penalties/${id}/approve`);
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
      await apiClient.post(`/penalties/${id}/reject`, { decisionNote: rejectNote });
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
      <h1 className="text-2xl font-bold text-slate-800">Cezalar</h1>

      {error && <Alert>{error}</Alert>}

      {user?.isSystemAdmin && adminProjects && (
        <Select value={adminProjectId} onChange={(e) => setAdminProjectId(e.target.value)}>
          {adminProjects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      )}

      <div className="flex gap-2">
        {STATUS_FILTERS.map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            className={`rounded-full px-4 py-2 text-sm font-medium transition ${
              status === s ? 'bg-brand-700 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {PENALTY_STATUS_LABELS[s]}
          </button>
        ))}
      </div>

      {penalties?.length === 0 && <p className="text-sm text-slate-500">Bu durumda ceza kaydı yok.</p>}

      <div className="space-y-3">
        {penalties?.map((p) => (
          <Card key={p.id}>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={PENALTY_STATUS_BADGE_VARIANT[p.status]}>{PENALTY_STATUS_LABELS[p.status]}</Badge>
              <span className="font-medium text-slate-800">{PENALTY_SANCTION_LABELS[p.sanctionType]}</span>
              {p.suggestedAmount && <span className="text-sm text-slate-500">{p.suggestedAmount} TL</span>}
              <Link to={`/uygunsuzluklar/${p.nonconformityId}`} className="ml-auto text-xs font-mono text-brand-700 hover:underline">
                {p.nonconformityNumber}
              </Link>
            </div>
            {p.employeeName && (
              <div className="mt-1 text-sm text-slate-600">
                Çalışan: <strong>{p.employeeName}</strong>
                {p.employeeCompanyName && ` (${p.employeeCompanyName})`}
              </div>
            )}
            <p className="mt-2 text-sm text-slate-700">{p.reason}</p>
            <p className="mt-1 text-xs text-slate-400">
              {p.requestedByName} tarafından {formatDateTime(p.requestedAt)} tarihinde talep edildi.
              {p.decidedByName && ` ${p.decidedByName} tarafından ${formatDateTime(p.decidedAt)} tarihinde karara bağlandı.`}
            </p>
            {p.decisionNote && <p className="mt-1 text-xs text-slate-500">Not: {p.decisionNote}</p>}

            {p.status === 'BEKLEMEDE' && (
              <div className="mt-3 border-t border-slate-100 pt-3">
                {rejectingId !== p.id ? (
                  <div className="flex gap-3">
                    <Button onClick={() => handleApprove(p.id)} disabled={busyId === p.id}>
                      ✓ Onayla
                    </Button>
                    <Button variant="danger" onClick={() => setRejectingId(p.id)} disabled={busyId === p.id}>
                      ✕ Reddet
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Textarea label="Red gerekçesi" value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} required />
                    <div className="flex gap-3">
                      <Button variant="danger" onClick={() => handleReject(p.id)} disabled={busyId === p.id || !rejectNote.trim()}>
                        Reddi Onayla
                      </Button>
                      <Button variant="secondary" onClick={() => setRejectingId(null)}>
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
