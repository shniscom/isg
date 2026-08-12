import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import apiClient, { getErrorMessage } from '../../api/client';
import { Card, Button, Input, Alert, Badge } from '../../components/ui';

export function ProjectsPage() {
  const [projects, setProjects] = useState(null);
  const [error, setError] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', code: '', address: '', employer: '' });
  const [formError, setFormError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    try {
      const { data } = await apiClient.get('/admin/projects');
      setProjects(data.projects);
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
      await apiClient.post('/admin/projects', form);
      setForm({ name: '', code: '', address: '', employer: '' });
      setShowForm(false);
      await load();
    } catch (err) {
      setFormError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleStatus(project) {
    const nextStatus = project.status === 'AKTIF' ? 'PASIF' : 'AKTIF';
    await apiClient.patch(`/admin/projects/${project.id}/status`, { status: nextStatus });
    await load();
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-800">Projeler</h1>
        <Button onClick={() => setShowForm((v) => !v)}>{showForm ? 'Vazgeç' : '+ Yeni Proje'}</Button>
      </div>

      {error && <Alert>{error}</Alert>}

      {showForm && (
        <Card>
          <form onSubmit={handleCreate} className="space-y-4">
            {formError && <Alert>{formError}</Alert>}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input label="Proje Adı" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
              <Input label="Proje Kodu" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} required />
              <Input label="Adres" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
              <Input label="İşveren" value={form.employer} onChange={(e) => setForm({ ...form, employer: e.target.value })} />
            </div>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Kaydediliyor...' : 'Projeyi Oluştur'}
            </Button>
          </form>
        </Card>
      )}

      <div className="space-y-3">
        {projects === null && <p className="text-sm text-slate-500">Yükleniyor...</p>}
        {projects?.length === 0 && <p className="text-sm text-slate-500">Henüz proje tanımlanmamış.</p>}
        {projects?.map((p) => (
          <Card key={p.id} className="flex items-center justify-between">
            <Link to={`/admin/projeler/${p.id}`} className="flex-1">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-slate-800">{p.name}</span>
                <Badge variant={p.status === 'AKTIF' ? 'success' : 'default'}>{p.status}</Badge>
              </div>
              <div className="text-sm text-slate-500">
                {p.code} {p.address ? `· ${p.address}` : ''}
              </div>
            </Link>
            <Button variant="secondary" onClick={() => toggleStatus(p)}>
              {p.status === 'AKTIF' ? 'Pasifleştir' : 'Aktifleştir'}
            </Button>
          </Card>
        ))}
      </div>
    </div>
  );
}
