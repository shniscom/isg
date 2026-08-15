import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import apiClient, { getErrorMessage } from '../api/client';
import { Card, Button, Select, Textarea, Alert } from '../components/ui';
import { PhotoUploader } from '../components/PhotoUploader';
import { PRIORITY_LABELS } from '../lib/nonconformity';

function defaultDueDate() {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  d.setHours(17, 0, 0, 0);
  return d.toISOString().slice(0, 16); // datetime-local formatı
}

export function NewNonconformityPage() {
  const navigate = useNavigate();
  const [refData, setRefData] = useState(null);
  const [users, setUsers] = useState(null);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [photos, setPhotos] = useState([]);

  const [form, setForm] = useState({
    categoryId: '',
    blockId: '',
    companyId: '',
    assignedUserId: '',
    description: '',
    priority: 'ORTA',
    dueDate: defaultDueDate(),
  });

  useEffect(() => {
    Promise.all([apiClient.get('/nonconformities/reference-data'), apiClient.get('/nonconformities/assignable-users')])
      .then(([refRes, usersRes]) => {
        setRefData(refRes.data);
        setUsers(usersRes.data.users);
      })
      .catch((err) => setError(getErrorMessage(err)));
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);

    if (!form.assignedUserId) {
      setError('Atanan kişi seçilmelidir.');
      return;
    }

    setSubmitting(true);
    try {
      const { data } = await apiClient.post('/nonconformities', {
        ...form,
        categoryId: form.categoryId || null,
        blockId: form.blockId || null,
        companyId: form.companyId || null,
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

            <Select
              label="Atanan Kişi"
              value={form.assignedUserId}
              onChange={(e) => setForm({ ...form, assignedUserId: e.target.value })}
              required
            >
              <option value="">Seçiniz</option>
              {users?.map((u) => (
                <option key={u.userId} value={u.userId}>
                  {u.fullName} — {u.roleName}
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
