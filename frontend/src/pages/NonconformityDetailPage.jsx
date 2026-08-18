import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import apiClient, { getErrorMessage } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Card, Button, Textarea, Select, Input, Alert, Badge } from '../components/ui';
import { PhotoUploader } from '../components/PhotoUploader';
import { PhotoGallery } from '../components/PhotoGallery';
import {
  STATUS_LABELS,
  STATUS_BADGE_VARIANT,
  PRIORITY_LABELS,
  PRIORITY_BADGE_VARIANT,
  RISK_SCORE_LABELS,
  PENALTY_STATUS_LABELS,
  PENALTY_STATUS_BADGE_VARIANT,
  PENALTY_SANCTION_LABELS,
  riskScoreSuggestedPenaltyAmount,
  formatDateTime,
  remainingDaysLabel,
} from '../lib/nonconformity';

function InfoRow({ label, value }) {
  if (!value) return null;
  return (
    <div>
      <dt className="text-xs text-slate-400">{label}</dt>
      <dd className="text-sm text-slate-800">{value}</dd>
    </div>
  );
}

export function NonconformityDetailPage() {
  const { id } = useParams();
  const { user, hasPermission } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  // Düzeltme formu
  const [correctionText, setCorrectionText] = useState('');
  const [correctionPhotos, setCorrectionPhotos] = useState([]);
  const [submittingCorrection, setSubmittingCorrection] = useState(false);

  // Onay/Red
  const [rejectNote, setRejectNote] = useState('');
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [reviewing, setReviewing] = useState(false);

  // Ceza talebi
  const [showPenaltyForm, setShowPenaltyForm] = useState(false);
  const [penaltyForm, setPenaltyForm] = useState({ reason: '', sanctionType: 'PARA_CEZASI', suggestedAmount: '' });
  const [penaltySubmitting, setPenaltySubmitting] = useState(false);

  async function load() {
    try {
      const { data } = await apiClient.get(`/nonconformities/${id}`);
      setData(data);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (error) return <Alert>{error}</Alert>;
  if (!data) return <p className="text-sm text-slate-500">Yükleniyor...</p>;

  const { nonconformity: nc, photos, corrections, history, penalties } = data;
  const isAssignee = (nc.assignees || []).some((a) => a.userId === user?.id);
  const canReview = hasPermission('uygunsuzluk_onaylama');
  const pendingCorrection = corrections.find((c) => c.status === 'BEKLEMEDE');
  const remaining = remainingDaysLabel(nc.dueDate, nc.status);

  async function handleSubmitCorrection(e) {
    e.preventDefault();
    setError(null);
    setSubmittingCorrection(true);
    try {
      await apiClient.post(`/nonconformities/${id}/corrections`, {
        description: correctionText,
        photos: correctionPhotos.map((p) => ({ key: p.key, originalFileName: p.originalFileName })),
      });
      setCorrectionText('');
      setCorrectionPhotos([]);
      setNotice('Düzeltme onaya gönderildi.');
      await load();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSubmittingCorrection(false);
    }
  }

  async function handleApprove() {
    setReviewing(true);
    setError(null);
    try {
      await apiClient.post(`/nonconformities/${id}/corrections/${pendingCorrection.id}/approve`);
      setNotice('Düzeltme onaylandı, uygunsuzluk kapatıldı.');
      await load();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setReviewing(false);
    }
  }

  async function handleReject(e) {
    e.preventDefault();
    setReviewing(true);
    setError(null);
    try {
      await apiClient.post(`/nonconformities/${id}/corrections/${pendingCorrection.id}/reject`, { reviewNote: rejectNote });
      setRejectNote('');
      setShowRejectForm(false);
      setNotice('Düzeltme reddedildi, uygunsuzluk tekrar açıldı.');
      await load();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setReviewing(false);
    }
  }

  async function handleRequestPenalty(e) {
    e.preventDefault();
    setPenaltySubmitting(true);
    setError(null);
    try {
      const { data: result } = await apiClient.post(`/nonconformities/${id}/penalty-request`, {
        reason: penaltyForm.reason,
        sanctionType: penaltyForm.sanctionType,
        suggestedAmount: penaltyForm.suggestedAmount ? Number(penaltyForm.suggestedAmount) : null,
      });
      let noticeMsg = 'Cezai işlem talebi oluşturuldu, onay bekliyor.';
      if (result.employeePriorApprovedCount > 0) {
        noticeMsg += ` Uyarı: bu çalışan için ${result.employeePriorApprovedCount} adet daha önce onaylanmış ceza kaydı var.`;
      }
      setNotice(noticeMsg);
      setShowPenaltyForm(false);
      setPenaltyForm({ reason: '', sanctionType: 'PARA_CEZASI', suggestedAmount: '' });
      await load();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setPenaltySubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link to="/uygunsuzluklar" className="text-sm text-brand-700 hover:underline">
        ‹ Uygunsuzluklar
      </Link>

      {notice && <Alert variant="success">{notice}</Alert>}
      {error && <Alert>{error}</Alert>}

      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm text-slate-400">{nc.number}</span>
          <Badge variant={STATUS_BADGE_VARIANT[nc.status]}>{STATUS_LABELS[nc.status]}</Badge>
          <Badge variant={PRIORITY_BADGE_VARIANT[nc.priority]}>{PRIORITY_LABELS[nc.priority]}</Badge>
          {remaining && (
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                remaining.tone === 'danger' ? 'bg-red-100 text-red-700' : remaining.tone === 'warning' ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'
              }`}
            >
              {remaining.text}
            </span>
          )}
        </div>

        <p className="mt-3 whitespace-pre-wrap text-slate-800">{nc.description}</p>

        <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-100 pt-4 sm:grid-cols-3">
          <InfoRow label="Proje" value={nc.projectName} />
          <InfoRow label="Kategori" value={nc.categoryName} />
          <InfoRow label="Blok / Bölge" value={nc.blockName} />
          <InfoRow label="Sorumlu Firma" value={nc.companyName} />
          <InfoRow label="Açan Kişi" value={nc.openedByName} />
          <InfoRow
            label={(nc.assignees || []).length > 1 ? 'Atanan Kişiler' : 'Atanan Kişi'}
            value={(nc.assignees || []).map((a) => a.fullName).join(', ') || null}
          />
          <InfoRow label="Açılış Tarihi" value={formatDateTime(nc.createdAt)} />
          <InfoRow label="Termin Tarihi" value={formatDateTime(nc.dueDate)} />
          {nc.closedAt && <InfoRow label="Kapanış Tarihi" value={formatDateTime(nc.closedAt)} />}
          {nc.riskScore && <InfoRow label="Risk / Şiddet Skoru" value={RISK_SCORE_LABELS[nc.riskScore]} />}
          {nc.employeeName && (
            <InfoRow
              label="İlgili Çalışan"
              value={nc.employeeNationalId ? `${nc.employeeName} (${nc.employeeNationalId})` : nc.employeeName}
            />
          )}
        </dl>

        {nc.correctionSuggestion && (
          <div className="mt-4 border-t border-slate-100 pt-4">
            <h3 className="mb-1 text-sm font-semibold text-slate-700">Düzeltme Önerisi</h3>
            <p className="whitespace-pre-wrap text-sm text-slate-600">{nc.correctionSuggestion}</p>
          </div>
        )}

        <div className="mt-4 border-t border-slate-100 pt-4">
          <h3 className="mb-2 text-sm font-semibold text-slate-700">Fotoğraflar</h3>
          <PhotoGallery photos={photos} />
        </div>
      </Card>

      {/* Düzeltme gönderme formu: yalnızca atanan kişi, durum ACIK iken görür */}
      {isAssignee && nc.status === 'ACIK' && (
        <Card>
          <h2 className="mb-3 font-semibold text-slate-800">Düzeltmeyi Bildir</h2>
          <form onSubmit={handleSubmitCorrection} className="space-y-4">
            <Textarea
              label="Nasıl çözdünüz?"
              value={correctionText}
              onChange={(e) => setCorrectionText(e.target.value)}
              placeholder="Yapılan düzeltmeyi açıklayın..."
              required
            />
            <div>
              <span className="mb-1.5 block text-sm font-medium text-slate-700">Kanıt Fotoğrafı</span>
              <PhotoUploader photos={correctionPhotos} onChange={setCorrectionPhotos} label="Fotoğraf Ekle" />
            </div>
            <Button type="submit" className="w-full" disabled={submittingCorrection}>
              {submittingCorrection ? 'Gönderiliyor...' : 'Düzeltmeyi Tamamla ve Onaya Gönder'}
            </Button>
          </form>
        </Card>
      )}

      {/* Onay/Red: yalnızca yetkili kişi, durum BEKLEMEDE iken görür */}
      {canReview && nc.status === 'BEKLEMEDE' && pendingCorrection && (
        <Card className="border-amber-200 bg-amber-50">
          <h2 className="mb-2 font-semibold text-amber-900">Onayınızı Bekliyor</h2>
          <p className="text-sm text-amber-800">
            <strong>{pendingCorrection.submittedByName}</strong> tarafından {formatDateTime(pendingCorrection.submittedAt)} tarihinde gönderildi.
          </p>
          <p className="mt-2 whitespace-pre-wrap text-sm text-slate-800">{pendingCorrection.description}</p>
          {pendingCorrection.photos?.length > 0 && (
            <div className="mt-2">
              <PhotoGallery photos={pendingCorrection.photos} />
            </div>
          )}

          {!showRejectForm ? (
            <div className="mt-4 flex gap-3">
              <Button onClick={handleApprove} disabled={reviewing}>
                ✓ Onayla
              </Button>
              <Button variant="danger" onClick={() => setShowRejectForm(true)} disabled={reviewing}>
                ✕ Reddet
              </Button>
            </div>
          ) : (
            <form onSubmit={handleReject} className="mt-4 space-y-3">
              <Textarea
                label="Red gerekçesi"
                value={rejectNote}
                onChange={(e) => setRejectNote(e.target.value)}
                placeholder="Neden yetersiz olduğunu açıklayın..."
                required
              />
              <div className="flex gap-3">
                <Button type="submit" variant="danger" disabled={reviewing}>
                  Reddi Onayla
                </Button>
                <Button type="button" variant="secondary" onClick={() => setShowRejectForm(false)}>
                  Vazgeç
                </Button>
              </div>
            </form>
          )}
        </Card>
      )}

      {/* Cezai işlem talepleri */}
      {(penalties?.length > 0 || nc.canRequestPenalty) && (
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold text-slate-800">Cezai İşlem</h2>
            {nc.canRequestPenalty && !showPenaltyForm && (
              <Button variant="danger" onClick={() => setShowPenaltyForm(true)}>
                Cezai İşlem Talep Et
              </Button>
            )}
          </div>

          {nc.canRequestPenalty && (
            <p className="mb-3 text-xs text-slate-500">
              Termin süresi doldu ve uygunsuzluk hâlâ kapatılmadı. Cezai işlem talebi admine ve ceza onaylama
              yetkisi olan kişilere onay için gönderilir; bu yalnızca bir talep kaydıdır, otomatik bir işlem
              uygulanmaz.
            </p>
          )}

          {showPenaltyForm && (
            <form onSubmit={handleRequestPenalty} className="mb-4 space-y-3 rounded-xl border border-red-200 bg-red-50 p-4">
              <Textarea
                label="Gerekçe"
                value={penaltyForm.reason}
                onChange={(e) => setPenaltyForm({ ...penaltyForm, reason: e.target.value })}
                placeholder="Termin süresi aşıldı, uygunsuzluk hâlâ açık..."
                required
              />
              <Select
                label="Yaptırım Türü"
                value={penaltyForm.sanctionType}
                onChange={(e) => {
                  const sanctionType = e.target.value;
                  const suggested = riskScoreSuggestedPenaltyAmount(nc.riskScore);
                  setPenaltyForm({
                    ...penaltyForm,
                    sanctionType,
                    suggestedAmount: sanctionType === 'PARA_CEZASI' && suggested ? String(suggested) : penaltyForm.suggestedAmount,
                  });
                }}
              >
                {Object.entries(PENALTY_SANCTION_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
              {penaltyForm.sanctionType === 'PARA_CEZASI' && (
                <Input
                  label="Önerilen Tutar (TL, opsiyonel)"
                  type="number"
                  min="0"
                  value={penaltyForm.suggestedAmount}
                  onChange={(e) => setPenaltyForm({ ...penaltyForm, suggestedAmount: e.target.value })}
                />
              )}
              <div className="flex gap-3">
                <Button type="submit" variant="danger" disabled={penaltySubmitting}>
                  {penaltySubmitting ? 'Gönderiliyor...' : 'Talebi Gönder'}
                </Button>
                <Button type="button" variant="secondary" onClick={() => setShowPenaltyForm(false)}>
                  Vazgeç
                </Button>
              </div>
            </form>
          )}

          {penalties?.length > 0 && (
            <div className="space-y-2">
              {penalties.map((p) => (
                <div key={p.id} className="rounded-xl bg-slate-50 px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={PENALTY_STATUS_BADGE_VARIANT[p.status]}>{PENALTY_STATUS_LABELS[p.status]}</Badge>
                    <span className="text-sm font-medium text-slate-800">{PENALTY_SANCTION_LABELS[p.sanctionType]}</span>
                    {p.suggestedAmount && <span className="text-sm text-slate-500">{p.suggestedAmount} TL</span>}
                  </div>
                  <p className="mt-1 text-sm text-slate-600">{p.reason}</p>
                  <p className="mt-1 text-xs text-slate-400">
                    {p.requestedByName} tarafından {formatDateTime(p.requestedAt)} tarihinde talep edildi.
                    {p.decidedByName && ` ${p.decidedByName} tarafından ${formatDateTime(p.decidedAt)} tarihinde karara bağlandı.`}
                  </p>
                  {p.decisionNote && <p className="mt-1 text-xs text-slate-500">Not: {p.decisionNote}</p>}
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* Tarihçe */}
      <Card>
        <h2 className="mb-3 font-semibold text-slate-800">Tarihçe</h2>
        <ol className="space-y-3 border-l-2 border-slate-200 pl-4">
          {history.map((h) => (
            <li key={h.id} className="relative">
              <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-brand-600" />
              <div className="text-xs text-slate-400">{formatDateTime(h.createdAt)}</div>
              <div className="text-sm text-slate-800">
                <strong>{h.actorName}</strong>
                {h.note ? ` — ${h.note}` : ` — ${STATUS_LABELS[h.toStatus]} durumuna geçti.`}
              </div>
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}
