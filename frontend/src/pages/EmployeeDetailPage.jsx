import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import apiClient, { getErrorMessage } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Card, Alert, Badge, Button, Input, Textarea } from '../components/ui';
import { STATUS_LABELS, STATUS_BADGE_VARIANT, PRIORITY_LABELS, PRIORITY_BADGE_VARIANT, formatDate } from '../lib/nonconformity';

export function EmployeeDetailPage() {
  const { id } = useParams();
  const { user, hasPermission } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const [showEdit, setShowEdit] = useState(false);
  const [editForm, setEditForm] = useState(null);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editError, setEditError] = useState(null);

  const [showExit, setShowExit] = useState(false);
  const [exitDate, setExitDate] = useState('');
  const [exitSubmitting, setExitSubmitting] = useState(false);

  function load() {
    apiClient
      .get(`/employees/${id}/nonconformities`)
      .then(({ data }) => setData(data))
      .catch((err) => setError(getErrorMessage(err)));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const canManage = user?.isSystemAdmin || hasPermission('uygunsuzluk_acma');

  function openEdit() {
    setEditError(null);
    setEditForm({
      fullName: data.employee.fullName || '',
      nationalId: data.employee.nationalId || '',
      position: data.employee.position || '',
      isgTrainingCompleted: !!data.employee.isgTrainingCompleted,
      medicalExamNote: data.employee.medicalExamNote || '',
      startDate: data.employee.startDate ? data.employee.startDate.slice(0, 10) : '',
    });
    setShowEdit(true);
  }

  async function handleSaveEdit() {
    setEditSubmitting(true);
    setEditError(null);
    try {
      await apiClient.patch(`/employees/${id}`, {
        fullName: editForm.fullName.trim(),
        nationalId: editForm.nationalId.trim() || null,
        position: editForm.position.trim() || null,
        isgTrainingCompleted: editForm.isgTrainingCompleted,
        medicalExamNote: editForm.medicalExamNote.trim() || null,
        startDate: editForm.startDate || null,
      });
      setShowEdit(false);
      load();
    } catch (err) {
      setEditError(getErrorMessage(err));
    } finally {
      setEditSubmitting(false);
    }
  }

  async function handleSetExit() {
    setExitSubmitting(true);
    setError(null);
    try {
      await apiClient.patch(`/employees/${id}`, { endDate: exitDate || null });
      setShowExit(false);
      setExitDate('');
      load();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setExitSubmitting(false);
    }
  }

  async function handleReactivate() {
    if (!window.confirm('Bu çalışanı yeniden aktif etmek istediğinize emin misiniz?')) return;
    try {
      await apiClient.patch(`/employees/${id}`, { endDate: null });
      load();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  if (error) return <Alert>{error}</Alert>;
  if (!data) return <p className="text-sm text-slate-500">Yükleniyor...</p>;

  const { employee, nonconformities } = data;

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <Link to="/calisanlar" className="text-sm text-brand-700 hover:underline">
        ‹ Çalışanlar
      </Link>

      <Card className="space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h1 className="text-xl font-bold text-slate-800">{employee.fullName}</h1>
            {employee.position && <p className="text-sm text-slate-500">{employee.position}</p>}
          </div>
          {!employee.isActive && <Badge variant="danger">Arşivde</Badge>}
        </div>

        <div className="grid grid-cols-1 gap-x-4 gap-y-1.5 text-sm text-slate-600 sm:grid-cols-2">
          {employee.nationalId && (
            <div>
              <span className="text-slate-400">TC:</span> {employee.nationalId}
            </div>
          )}
          <div>
            <span className="text-slate-400">İSG Eğitimi:</span>{' '}
            {employee.isgTrainingCompleted ? <Badge variant="success">Var</Badge> : <Badge>Yok</Badge>}
          </div>
          {employee.medicalExamNote && (
            <div className="sm:col-span-2">
              <span className="text-slate-400">Tetkik:</span> {employee.medicalExamNote}
            </div>
          )}
          <div>
            <span className="text-slate-400">Giriş Tarihi:</span> {employee.startDate ? formatDate(employee.startDate) : '—'}
          </div>
          {employee.endDate && (
            <div>
              <span className="text-slate-400">Çıkış Tarihi:</span> {formatDate(employee.endDate)}
            </div>
          )}
        </div>

        {canManage && (
          <div className="flex flex-wrap gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={openEdit}>
              Düzenle
            </Button>
            {employee.isActive ? (
              <Button type="button" variant="danger" onClick={() => setShowExit((v) => !v)}>
                Çıkış Tarihi Gir
              </Button>
            ) : (
              <Button type="button" variant="ghost" onClick={handleReactivate}>
                Yeniden Aktif Et
              </Button>
            )}
          </div>
        )}

        {showExit && (
          <div className="space-y-2 rounded-xl bg-slate-50 p-3">
            <Input label="Çıkış Tarihi" type="date" value={exitDate} onChange={(e) => setExitDate(e.target.value)} />
            <Button type="button" variant="danger" onClick={handleSetExit} disabled={exitSubmitting || !exitDate}>
              {exitSubmitting ? 'Kaydediliyor...' : 'Çıkışı Onayla ve Arşivle'}
            </Button>
          </div>
        )}

        {showEdit && editForm && (
          <div className="space-y-3 rounded-xl bg-slate-50 p-3">
            {editError && <Alert>{editError}</Alert>}
            <Input
              label="Ad Soyad"
              value={editForm.fullName}
              onChange={(e) => setEditForm((f) => ({ ...f, fullName: e.target.value }))}
            />
            <Input
              label="TC Kimlik No"
              value={editForm.nationalId}
              onChange={(e) => setEditForm((f) => ({ ...f, nationalId: e.target.value }))}
            />
            <Input
              label="Görevi"
              value={editForm.position}
              onChange={(e) => setEditForm((f) => ({ ...f, position: e.target.value }))}
            />
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={editForm.isgTrainingCompleted}
                onChange={(e) => setEditForm((f) => ({ ...f, isgTrainingCompleted: e.target.checked }))}
              />
              İSG Eğitimi Tamamlandı
            </label>
            <Textarea
              label="Tetkik"
              rows={2}
              value={editForm.medicalExamNote}
              onChange={(e) => setEditForm((f) => ({ ...f, medicalExamNote: e.target.value }))}
            />
            <Input
              label="Giriş Tarihi"
              type="date"
              value={editForm.startDate}
              onChange={(e) => setEditForm((f) => ({ ...f, startDate: e.target.value }))}
            />
            <div className="flex gap-2">
              <Button type="button" onClick={handleSaveEdit} disabled={editSubmitting}>
                {editSubmitting ? 'Kaydediliyor...' : 'Kaydet'}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setShowEdit(false)}>
                Vazgeç
              </Button>
            </div>
          </div>
        )}
      </Card>

      <Card>
        <h2 className="mb-3 font-semibold text-slate-800">Uygunsuzluk Geçmişi ({nonconformities.length})</h2>
        {nonconformities.length === 0 ? (
          <p className="text-sm text-slate-400">Bu çalışana bağlı kayıt yok.</p>
        ) : (
          <div className="space-y-2">
            {nonconformities.map((n) => (
              <Link key={n.id} to={`/uygunsuzluklar/${n.id}`}>
                <div className="rounded-xl bg-slate-50 px-4 py-3 transition hover:bg-slate-100">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-slate-400">{n.number}</span>
                    <Badge variant={STATUS_BADGE_VARIANT[n.status]}>{STATUS_LABELS[n.status]}</Badge>
                    <Badge variant={PRIORITY_BADGE_VARIANT[n.priority]}>{PRIORITY_LABELS[n.priority]}</Badge>
                    <span className="ml-auto text-xs text-slate-400">{formatDate(n.createdAt)}</span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-sm text-slate-700">{n.description}</p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
