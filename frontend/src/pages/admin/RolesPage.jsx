import { useEffect, useState } from 'react';
import apiClient, { getErrorMessage } from '../../api/client';
import { Card, Button, Input, Alert } from '../../components/ui';

export function RolesPage() {
  const [roles, setRoles] = useState(null);
  const [error, setError] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', description: '' });
  const [formError, setFormError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    try {
      const { data } = await apiClient.get('/admin/roles');
      setRoles(data.roles);
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
      await apiClient.post('/admin/roles', form);
      setForm({ name: '', description: '' });
      setShowForm(false);
      await load();
    } catch (err) {
      setFormError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(role) {
    try {
      await apiClient.delete(`/admin/roles/${role.id}`);
      await load();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-800">Görevler</h1>
        <Button onClick={() => setShowForm((v) => !v)}>{showForm ? 'Vazgeç' : '+ Yeni Görev'}</Button>
      </div>

      <p className="text-sm text-slate-500">
        Görevler (İSG Uzmanı, Şantiye Şefi, Formen vb.) kullanıcıların projelerdeki rolünü belirler.
      </p>

      {error && <Alert>{error}</Alert>}

      {showForm && (
        <Card>
          <form onSubmit={handleCreate} className="space-y-4">
            {formError && <Alert>{formError}</Alert>}
            <Input label="Görev Adı" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            <Input label="Açıklama" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Kaydediliyor...' : 'Görevi Oluştur'}
            </Button>
          </form>
        </Card>
      )}

      <div className="space-y-3">
        {roles?.map((r) => (
          <Card key={r.id} className="flex items-center justify-between">
            <div>
              <div className="font-semibold text-slate-800">{r.name}</div>
              {r.description && <div className="text-sm text-slate-500">{r.description}</div>}
            </div>
            <Button variant="ghost" onClick={() => handleDelete(r)}>
              Sil
            </Button>
          </Card>
        ))}
      </div>
    </div>
  );
}
