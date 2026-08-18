import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import apiClient, { getErrorMessage } from '../../api/client';
import { Card, Button, Input, Alert, Badge } from '../../components/ui';

export function UsersPage() {
  const [users, setUsers] = useState(null);
  const [error, setError] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ fullName: '', username: '', phone: '', email: '' });
  const [formError, setFormError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [createdCredentials, setCreatedCredentials] = useState(null);

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
  }, []);

  async function handleCreate(e) {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      const { data } = await apiClient.post('/admin/users', form);
      setCreatedCredentials({ username: data.user.username, tempPassword: data.tempPassword });
      setForm({ fullName: '', username: '', phone: '', email: '' });
      setShowForm(false);
      await load();
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

      {showForm && (
        <Card>
          <form onSubmit={handleCreate} className="space-y-4">
            {formError && <Alert>{formError}</Alert>}
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
