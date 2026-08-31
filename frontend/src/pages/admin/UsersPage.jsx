import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import apiClient, { getErrorMessage } from '../../api/client';
import { Card, Button, Input, Select, Alert, Badge } from '../../components/ui';
import { EmployeeCombobox } from '../../components/EmployeeCombobox';

const EMPTY_FORM = { fullName: '', username: '', phone: '', email: '' };

export function UsersPage() {
  const [users, setUsers] = useState(null);
  const [error, setError] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [createdCredentials, setCreatedCredentials] = useState(null);
  const [queuedNotice, setQueuedNotice] = useState(null);

  // Roster (firma çalışan listesi) içinden seçim: "kullanıcılar sadece firmalardaki çalışanlar
  // arasından seçilebilmeli" kuralı için - bkz. backend admin/users.routes.js.
  const [projects, setProjects] = useState(null);
  const [rosterProjectId, setRosterProjectId] = useState('');
  const [rosterCompanies, setRosterCompanies] = useState(null);
  const [rosterCompanyId, setRosterCompanyId] = useState('');
  const [candidates, setCandidates] = useState(null);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('');
  const [offRoster, setOffRoster] = useState(false);

  async function load() {
    try {
      const { data } = await apiClient.get('/admin/users');
      setUsers(data.users);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  useEffect(() => {
    load();
    apiClient
      .get('/admin/projects')
      .then(({ data }) => {
        setProjects(data.projects);
        if (data.projects.length > 0) setRosterProjectId(data.projects[0].id);
      })
      .catch(() => setProjects([]));
  }, []);

  // Proje değişince firma listesi yeniden yüklenir; firma ve çalışan seçimi sıfırlanır.
  useEffect(() => {
    if (!rosterProjectId) return;
    setRosterCompanies(null);
    setRosterCompanyId('');
    setCandidates(null);
    setSelectedEmployeeId('');
    apiClient
      .get('/admin/users/roster-companies', { params: { projectId: rosterProjectId } })
      .then(({ data }) => setRosterCompanies(data.companies))
      .catch(() => setRosterCompanies([]));
  }, [rosterProjectId]);

  // Firma seçimine göre (veya "Tüm Firmalar" için firma seçilmeden) çalışan adayları yüklenir -
  // liste önce firmaya göre daraltılır, ardından aranabilir kutuda isim/TC ile filtrelenir.
  useEffect(() => {
    if (!rosterProjectId) return;
    setCandidates(null);
    setSelectedEmployeeId('');
    const params = { projectId: rosterProjectId };
    if (rosterCompanyId) params.companyId = rosterCompanyId;
    apiClient
      .get('/admin/users/employee-candidates', { params })
      .then(({ data }) => setCandidates(data.employees))
      .catch(() => setCandidates([]));
  }, [rosterProjectId, rosterCompanyId]);

  function resetForm() {
    setForm(EMPTY_FORM);
    setSelectedEmployeeId('');
    setOffRoster(false);
    setShowForm(false);
  }

  async function handleCreate(e) {
    e.preventDefault();
    setFormError(null);
    setQueuedNotice(null);
    if (!offRoster && !selectedEmployeeId) {
      setFormError('Lütfen çalışan listesinden bir kişi seçin, ya da "Listede yok" seçeneğini işaretleyin.');
      return;
    }
    setSubmitting(true);
    try {
      const payload = { ...form, employeeId: offRoster ? null : selectedEmployeeId };
      const { data } = await apiClient.post('/admin/users', payload);
      if (data.queued) {
        setQueuedNotice(data.message);
      } else {
        setCreatedCredentials({ username: data.user.username, tempPassword: data.tempPassword });
      }
      resetForm();
      await load();
      if (rosterProjectId) {
        const params = { projectId: rosterProjectId };
        if (rosterCompanyId) params.companyId = rosterCompanyId;
        apiClient
          .get('/admin/users/employee-candidates', { params })
          .then(({ data: d }) => setCandidates(d.employees))
          .catch(() => {});
      }
    } catch (err) {
      setFormError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-800">Kullanıcılar</h1>
        <Button onClick={() => setShowForm((v) => !v)}>{showForm ? 'Vazgeç' : '+ Yeni Kullanıcı'}</Button>
      </div>

      {error && <Alert>{error}</Alert>}

      {createdCredentials && (
        <Alert variant="success">
          <strong>{createdCredentials.username}</strong> kullanıcısı oluşturuldu. Geçici şifre:{' '}
          <code className="rounded bg-emerald-100 px-2 py-0.5 font-mono">{createdCredentials.tempPassword}</code>
          <br />
          Bu şifreyi kullanıcıya güvenli bir yolla iletin; ilk girişte değiştirmesi istenecektir.
          <div className="mt-2">
            <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => setCreatedCredentials(null)}>
              Kapat
            </Button>
          </div>
        </Alert>
      )}

      {queuedNotice && (
        <Alert variant="warning">
          {queuedNotice}
          <div className="mt-2">
            <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => setQueuedNotice(null)}>
              Kapat
            </Button>
          </div>
        </Alert>
      )}

      {showForm && (
        <Card>
          <form onSubmit={handleCreate} className="space-y-4">
            {formError && <Alert>{formError}</Alert>}

            {projects && projects.length > 0 && (
              <Select label="Proje (çalışan listesi buradan gelir)" value={rosterProjectId} onChange={(e) => setRosterProjectId(e.target.value)}>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            )}

            {!offRoster && (
              <div className="space-y-4">
                {rosterCompanies && rosterCompanies.length > 0 && (
                  <Select
                    label="Firma (listeyi daraltmak için seçin, opsiyonel)"
                    value={rosterCompanyId}
                    onChange={(e) => setRosterCompanyId(e.target.value)}
                  >
                    <option value="">Tüm Firmalar</option>
                    {rosterCompanies.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                )}
                <div className="space-y-1.5">
                  <span className="mb-1.5 block text-sm font-medium text-slate-700">Çalışan</span>
                  <EmployeeCombobox
                    employees={candidates || []}
                    value={selectedEmployeeId}
                    onChange={setSelectedEmployeeId}
                    placeholder={candidates === null ? 'Yükleniyor...' : 'İsim veya TC no yazarak arayın...'}
                  />
                  {candidates?.length === 0 && (
                    <p className="text-xs text-slate-500">
                      {rosterCompanyId
                        ? 'Bu firmada henüz bir kullanıcıya bağlanmamış aktif çalışan bulunamadı.'
                        : 'Bu projede henüz bir kullanıcıya bağlanmamış aktif çalışan bulunamadı.'}
                    </p>
                  )}
                </div>
              </div>
            )}

            <label className="flex items-start gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={offRoster}
                onChange={(e) => {
                  setOffRoster(e.target.checked);
                  setSelectedEmployeeId('');
                }}
              />
              <span>
                Listede yok / roster dışı bir kişi ekliyorum
                <span className="block text-xs text-slate-500">
                  Bu kişi projedeki hiçbir firmanın çalışan listesinde bulunmuyorsa işaretleyin. Bu durum kritik
                  sayılır ve admin onayına gönderilir (siz adminseniz doğrudan uygulanır).
                </span>
              </span>
            </label>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input label="Ad Soyad" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} required />
              <Input label="Kullanıcı Adı" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required />
              <Input label="Telefon" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              <Input label="E-posta" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Kaydediliyor...' : 'Kullanıcıyı Oluştur'}
            </Button>
          </form>
        </Card>
      )}

      <div className="space-y-3">
        {users?.map((u) => (
          <Link key={u.id} to={`/admin/kullanicilar/${u.id}`}>
            <Card className="flex items-center justify-between transition hover:border-brand-300">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-slate-800">{u.fullName}</span>
                  {u.isSystemAdmin && <Badge variant="info">Admin</Badge>}
                  {!u.isActive && <Badge variant="danger">Pasif</Badge>}
                  {u.mustChangePassword && <Badge variant="warning">Şifre değişikliği bekliyor</Badge>}
                </div>
                <div className="text-sm text-slate-500">@{u.username}</div>
                {!u.isSystemAdmin && (
                  <div className="mt-1 flex gap-3 text-xs text-slate-500">
                    <span>📂 {u.openedCount} açtı</span>
                    <span>✅ {u.closedCount} kapattı</span>
                  </div>
                )}
              </div>
              <span className="text-slate-400">›</span>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
