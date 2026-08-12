import { useEffect, useState } from 'react';
import apiClient, { getErrorMessage } from '../../api/client';
import { Card, Button, Input, Select, Alert } from '../../components/ui';

export function CategoriesPage() {
  const [projects, setProjects] = useState([]);
  const [categories, setCategories] = useState(null);
  const [error, setError] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', projectId: '' });
  const [formError, setFormError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    try {
      const [catsRes, projectsRes] = await Promise.all([
        apiClient.get('/admin/categories'),
        apiClient.get('/admin/projects'),
      ]);
      setCategories(catsRes.data.categories);
      setProjects(projectsRes.data.projects);
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
      await apiClient.post('/admin/categories', { name: form.name, projectId: form.projectId || null });
      setForm({ name: '', projectId: '' });
      setShowForm(false);
      await load();
    } catch (err) {
      setFormError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeactivate(category) {
    await apiClient.delete(`/admin/categories/${category.id}`);
    await load();
  }

  const projectName = (pid) => (pid ? projects.find((p) => p.id === pid)?.name : 'Tüm Projeler (Genel)');

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-800">Uygunsuzluk Kategorileri</h1>
        <Button onClick={() => setShowForm((v) => !v)}>{showForm ? 'Vazgeç' : '+ Yeni Kategori'}</Button>
      </div>
      <p className="text-sm text-slate-500">
        Örn: KKD, İskele, Merdiven, Elektrik, Yangın, Kazı, Yüksekte Çalışma. Bu kategoriler ilerleyen fazda
        uygunsuzluk açma formunda kullanılacaktır.
      </p>

      {error && <Alert>{error}</Alert>}

      {showForm && (
        <Card>
          <form onSubmit={handleCreate} className="space-y-4">
            {formError && <Alert>{formError}</Alert>}
            <Input label="Kategori Adı" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            <Select label="Kapsam" value={form.projectId} onChange={(e) => setForm({ ...form, projectId: e.target.value })}>
              <option value="">Tüm Projeler (Genel)</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Kaydediliyor...' : 'Kategoriyi Oluştur'}
            </Button>
          </form>
        </Card>
      )}

      <div className="space-y-3">
        {categories?.map((c) => (
          <Card key={c.id} className="flex items-center justify-between">
            <div>
              <div className="font-semibold text-slate-800">{c.name}</div>
              <div className="text-sm text-slate-500">{projectName(c.projectId)}</div>
            </div>
            {c.isActive && (
              <Button variant="ghost" onClick={() => handleDeactivate(c)}>
                Pasifleştir
              </Button>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
