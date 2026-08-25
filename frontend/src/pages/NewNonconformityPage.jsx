import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import apiClient, { getErrorMessage } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Card, Button, Select, Textarea, Input, Alert } from '../components/ui';
import { PhotoUploader } from '../components/PhotoUploader';
import { PRIORITY_LABELS, RISK_SCORE_LABELS, riskScoreSuggestedDueDate } from '../lib/nonconformity';

function defaultDueDate() {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  d.setHours(17, 0, 0, 0);
  return d.toISOString().slice(0, 16); // datetime-local formatı
}

export function NewNonconformityPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [refData, setRefData] = useState(null);
  const [users, setUsers] = useState(null);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [photos, setPhotos] = useState([]);
  const [assignedUserIds, setAssignedUserIds] = useState([]);

  // Çalışan (uygunsuz davranışta bulunan kişi) - opsiyonel
  const [companyEmployees, setCompanyEmployees] = useState([]);
  const [employeeId, setEmployeeId] = useState('');
  const [showNewEmployee, setShowNewEmployee] = useState(false);
  const [newEmployee, setNewEmployee] = useState({ fullName: '', nationalId: '' });
  const [employeeSubmitting, setEmployeeSubmitting] = useState(false);

  // Sistem admini belirli bir projeye önceden bağlı olmadığından, uygunsuzluk açmadan
  // önce hangi proje için açtığını seçmesi gerekir.
  const [adminProjects, setAdminProjects] = useState(null);
  const [adminProjectId, setAdminProjectId] = useState('');
  const activeProjectId = user?.isSystemAdmin ? adminProjectId : 'self';

  const [form, setForm] = useState({
    categoryId: '',
    blockId: '',
    companyId: '',
    description: '',
    correctionSuggestion: '',
    riskScore: '',
    priority: 'ORTA',
    dueDate: defaultDueDate(),
  });

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

  useEffect(() => {
    if (!activeProjectId) return;
    const params = user?.isSystemAdmin ? { projectId: activeProjectId } : {};
    setRefData(null);
    apiClient
      .get('/nonconformities/reference-data', { params })
      .then(({ data }) => setRefData(data))
      .catch((err) => setError(getErrorMessage(err)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProjectId]);

  // Atanabilir kişi listesi, seçilen sorumlu firmaya göre daraltılır: yalnızca o firmaya özel
  // atanmış kişiler + proje genelinde (tüm firmalar kapsamında) atanmış kişiler listelenir.
  // Böylece ilgisiz bir firmanın çalışanına yanlışlıkla atama yapılması önlenir.
  useEffect(() => {
    if (!activeProjectId) return;
    const params = user?.isSystemAdmin ? { projectId: activeProjectId } : {};
    if (form.companyId) params.companyId = form.companyId;
    setUsers(null);
    apiClient
      .get('/nonconformities/assignable-users', { params })
      .then(({ data }) => {
        // Kişi kendisine uygunsuzluk atayamaz; kendi kaydını listeden çıkar.
        const filtered = data.users.filter((u) => u.userId !== user?.id);
        setUsers(filtered);
        // Firma değişince artık listede olmayan seçimler otomatik kaldırılır.
        const validIds = new Set(filtered.map((u) => u.userId));
        setAssignedUserIds((prev) => prev.filter((id) => validIds.has(id)));
      })
      .catch((err) => setError(getErrorMessage(err)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProjectId, form.companyId]);

  // Sorumlu firma seçilince, o firmanın kayıtlı çalışanları listelenir (mükerrer kayıt önlemek için).
  useEffect(() => {
    setEmployeeId('');
    setShowNewEmployee(false);
    if (!form.companyId || !activeProjectId) {
      setCompanyEmployees([]);
      return;
    }
    const params = { companyId: form.companyId };
    if (user?.isSystemAdmin) params.projectId = activeProjectId;
    apiClient
      .get('/employees', { params })
      .then(({ data }) => setCompanyEmployees(data.employees))
      .catch(() => setCompanyEmployees([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.companyId, activeProjectId]);

  async function handleCreateEmployee() {
    if (!newEmployee.fullName.trim()) return;
    setEmployeeSubmitting(true);
    setError(null);
    try {
      const { data } = await apiClient.post('/employees', {
        projectId: user?.isSystemAdmin ? adminProjectId : undefined,
        companyId: form.companyId || null,
        fullName: newEmployee.fullName.trim(),
        nationalId: newEmployee.nationalId.trim() || null,
      });
      setCompanyEmployees((prev) => [...prev, data.employee]);
      setEmployeeId(data.employee.id);
      setShowNewEmployee(false);
      setNewEmployee({ fullName: '', nationalId: '' });
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setEmployeeSubmitting(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);

    if (user?.isSystemAdmin && !adminProjectId) {
      setError('Proje seçilmelidir.');
      return;
    }

    if (assignedUserIds.length === 0) {
      setError('En az bir atanan kişi seçilmelidir.');
      return;
    }

    setSubmitting(true);
    try {
      const { data } = await apiClient.post('/nonconformities', {
        ...form,
        projectId: user?.isSystemAdmin ? adminProjectId : undefined,
        categoryId: form.categoryId || null,
        blockId: form.blockId || null,
        companyId: form.companyId || null,
        employeeId: employeeId || null,
        riskScore: form.riskScore ? Number(form.riskScore) : null,
        correctionSuggestion: form.correctionSuggestion || null,
        assignedUserIds,
        dueDate: new Date(form.dueDate).toISOString(),
        photos: photos.map((p) => ({ key: p.key, originalFileName: p.originalFileName })),
      });
      navigate(`/uygunsuzluklar/${data.nonconformity.id}`);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link to="/uygunsuzluklar" className="text-sm text-brand-700 hover:underline">
        ‹ Uygunsuzluklar
      </Link>
      <h1 className="text-2xl font-bold text-slate-800">Yeni Uygunsuzluk</h1>

      <Card>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <Alert>{error}</Alert>}

          {user?.isSystemAdmin && adminProjects && (
            <Select label="Proje" value={adminProjectId} onChange={(e) => setAdminProjectId(e.target.value)} required>
              <option value="">Seçiniz</option>
              {adminProjects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          )}

          <Textarea
            label="Açıklama"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="Tespit edilen uygunsuzluğu detaylı açıklayın..."
            required
          />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Select label="Kategori" value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
              <option value="">Seçiniz</option>
              {refData?.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>

            <Select label="Blok / Bölge" value={form.blockId} onChange={(e) => setForm({ ...form, blockId: e.target.value })}>
              <option value="">Seçiniz</option>
              {refData?.blocks.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>

            <Select label="Sorumlu Firma" value={form.companyId} onChange={(e) => setForm({ ...form, companyId: e.target.value })}>
              <option value="">Seçiniz</option>
              {refData?.companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>

            <Select label="Öncelik" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
              {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>

            <Select
              label="Risk / Şiddet Skoru (opsiyonel)"
              value={form.riskScore}
              onChange={(e) => setForm({ ...form, riskScore: e.target.value })}
            >
              <option value="">Seçiniz</option>
              {Object.entries(RISK_SCORE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>

            <div className="sm:col-span-2">
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-slate-700">Termin Tarihi</span>
                <input
                  type="datetime-local"
                  className="w-full rounded-xl border border-slate-300 px-4 py-3 text-base outline-none transition focus:ring-2 focus:ring-brand-500"
                  value={form.dueDate}
                  onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
                  required
                />
              </label>
              {form.riskScore && (
                <button
                  type="button"
                  className="mt-1 text-xs font-medium text-brand-700 hover:underline"
                  onClick={() => {
                    const suggested = riskScoreSuggestedDueDate(Number(form.riskScore));
                    if (suggested) setForm({ ...form, dueDate: suggested.toISOString().slice(0, 16) });
                  }}
                >
                  Risk skoruna göre termin öner
                </button>
              )}
            </div>
          </div>

          <Textarea
            label="Düzeltme Önerisi (opsiyonel)"
            value={form.correctionSuggestion}
            onChange={(e) => setForm({ ...form, correctionSuggestion: e.target.value })}
            placeholder="Örn: Çalışma durdurulmalı, ehil kişilerce gerekli güvenlik önlemleri alınarak korkuluk monte edilmelidir."
          />

          <div>
            <span className="mb-1.5 block text-sm font-medium text-slate-700">
              Uygunsuz Davranışta Bulunan Çalışan (opsiyonel)
            </span>
            {!form.companyId ? (
              <p className="text-sm text-slate-400">Çalışan seçmek için önce sorumlu firmayı seçin.</p>
            ) : (
              <div className="space-y-2">
                <Select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
                  <option value="">Seçiniz (yok)</option>
                  {companyEmployees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.fullName}
                      {emp.warningCount > 0 ? ` (${emp.warningCount} önceki kayıt)` : ''}
                    </option>
                  ))}
                </Select>
                {!showNewEmployee ? (
                  <button
                    type="button"
                    className="text-sm font-medium text-brand-700 hover:underline"
                    onClick={() => setShowNewEmployee(true)}
                  >
                    + Listede yok, yeni çalışan ekle
                  </button>
                ) : (
                  <div className="space-y-2 rounded-xl border border-slate-200 p-3">
                    <Input
                      label="Ad Soyad"
                      value={newEmployee.fullName}
                      onChange={(e) => setNewEmployee({ ...newEmployee, fullName: e.target.value })}
                    />
                    <Input
                      label="T.C. Kimlik No (opsiyonel)"
                      value={newEmployee.nationalId}
                      onChange={(e) => setNewEmployee({ ...newEmployee, nationalId: e.target.value })}
                    />
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={handleCreateEmployee}
                        disabled={employeeSubmitting || !newEmployee.fullName.trim()}
                      >
                        {employeeSubmitting ? 'Ekleniyor...' : 'Çalışanı Ekle'}
                      </Button>
                      <Button type="button" variant="ghost" onClick={() => setShowNewEmployee(false)}>
                        Vazgeç
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div>
            <span className="mb-1.5 block text-sm font-medium text-slate-700">Atanan Kişi(ler)</span>
            <p className="mb-1.5 text-xs text-slate-500">
              {form.companyId
                ? 'Yalnızca seçili sorumlu firmaya atanmış kişiler ve proje genelinde yetkili olanlar listelenir.'
                : 'Önce sorumlu firmayı seçerseniz liste yalnızca o firmayla ilgili kişilere daralır.'}
            </p>
            {users && users.length === 0 && (
              <p className="text-sm text-slate-400">Bu kapsamda atanabilir kullanıcı yok (kendinize atama yapamazsınız).</p>
            )}
            <div className="max-h-56 space-y-1 overflow-y-auto rounded-xl border border-slate-300 p-2">
              {users?.map((u) => (
                <label key={u.userId} className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 hover:bg-slate-50">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-slate-300 text-brand-700 focus:ring-brand-500"
                    checked={assignedUserIds.includes(u.userId)}
                    onChange={() =>
                      setAssignedUserIds((prev) =>
                        prev.includes(u.userId) ? prev.filter((id) => id !== u.userId) : [...prev, u.userId]
                      )
                    }
                  />
                  <span className="text-sm text-slate-800">
                    {u.fullName} — {u.roleName}
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <span className="mb-1.5 block text-sm font-medium text-slate-700">Fotoğraf (opsiyonel)</span>
            <PhotoUploader photos={photos} onChange={setPhotos} />
          </div>

          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? 'Kaydediliyor...' : 'Uygunsuzluğu Aç'}
          </Button>
        </form>
      </Card>
    </div>
  );
}
