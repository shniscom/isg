import { useEffect, useState } from 'react';
import apiClient, { getErrorMessage } from '../../api/client';
import { Card, Button, Input, Select, Alert, Badge } from '../../components/ui';

const CATEGORY_LABELS = { FIRMA_ROLU: 'Firma Rolü', ACIL_EKIP: 'Acil Durum Ekibi' };

/** Türkçe bir rol adından, company_role_types.key için ALT_CIZGILI_BUYUK_HARF bir anahtar üretir. */
function labelToKey(label) {
  const map = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', Ç: 'C', Ğ: 'G', İ: 'I', Ö: 'O', Ş: 'S', Ü: 'U' };
  return label
    .split('')
    .map((ch) => map[ch] || ch)
    .join('')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function RolesPage() {
  const [roles, setRoles] = useState(null);
  const [error, setError] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', description: '' });
  const [formError, setFormError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const [roleTypes, setRoleTypes] = useState(null);
  const [roleTypesError, setRoleTypesError] = useState(null);
  const [showRoleTypeForm, setShowRoleTypeForm] = useState(false);
  const [roleTypeForm, setRoleTypeForm] = useState({ label: '', category: 'FIRMA_ROLU' });
  const [roleTypeFormError, setRoleTypeFormError] = useState(null);
  const [roleTypeSubmitting, setRoleTypeSubmitting] = useState(false);

  async function load() {
    try {
      const { data } = await apiClient.get('/admin/roles');
      setRoles(data.roles);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  async function loadRoleTypes() {
    try {
      const { data } = await apiClient.get('/admin/company-role-types');
      setRoleTypes(data.roleTypes);
    } catch (err) {
      setRoleTypesError(getErrorMessage(err));
    }
  }

  useEffect(() => {
    load();
    loadRoleTypes();
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

  async function handleCreateRoleType(e) {
    e.preventDefault();
    setRoleTypeFormError(null);
    if (!roleTypeForm.label.trim()) return;
    setRoleTypeSubmitting(true);
    try {
      await apiClient.post('/admin/company-role-types', {
        key: labelToKey(roleTypeForm.label),
        label: roleTypeForm.label.trim(),
        category: roleTypeForm.category,
      });
      setRoleTypeForm({ label: '', category: 'FIRMA_ROLU' });
      setShowRoleTypeForm(false);
      await loadRoleTypes();
    } catch (err) {
      setRoleTypeFormError(getErrorMessage(err));
    } finally {
      setRoleTypeSubmitting(false);
    }
  }

  async function handleDeleteRoleType(roleType) {
    if (!window.confirm(`"${roleType.label}" rolü silinsin mi?`)) return;
    try {
      await apiClient.delete(`/admin/company-role-types/${roleType.id}`);
      await loadRoleTypes();
    } catch (err) {
      setRoleTypesError(getErrorMessage(err));
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Görevler</h1>
        <p className="mt-1 text-sm text-slate-500">
          Görevler ve firma rolleri, kullanıcıların ve firma bünyesindeki kişilerin projelerdeki/firmalardaki rolünü belirler.
        </p>
      </div>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-800">Proje Görevleri</h2>
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
      </section>

      <section className="space-y-4 border-t border-slate-200 pt-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-800">Firma Rolleri</h2>
          <Button onClick={() => setShowRoleTypeForm((v) => !v)}>{showRoleTypeForm ? 'Vazgeç' : '+ Yeni Firma Rolü'}</Button>
        </div>

        <p className="text-sm text-slate-500">
          Firma rolleri (İşveren, Şantiye Şefi, İSG Uzmanı, İlkyardımcı vb.), bir firmanın "Roller & Ekipler" sekmesinde
          kişilere atanabilen rol listesini belirler. Burada eklenen/silinen bir rol, o dropdown'a anında yansır.
        </p>

        {roleTypesError && <Alert>{roleTypesError}</Alert>}

        {showRoleTypeForm && (
          <Card>
            <form onSubmit={handleCreateRoleType} className="space-y-4">
              {roleTypeFormError && <Alert>{roleTypeFormError}</Alert>}
              <Input
                label="Rol Adı"
                value={roleTypeForm.label}
                onChange={(e) => setRoleTypeForm({ ...roleTypeForm, label: e.target.value })}
                placeholder="ör. Vinç Operatörü"
                required
              />
              <Select label="Kategori" value={roleTypeForm.category} onChange={(e) => setRoleTypeForm({ ...roleTypeForm, category: e.target.value })}>
                <option value="FIRMA_ROLU">Firma Rolü</option>
                <option value="ACIL_EKIP">Acil Durum Ekibi</option>
              </Select>
              <Button type="submit" disabled={roleTypeSubmitting}>
                {roleTypeSubmitting ? 'Kaydediliyor...' : 'Firma Rolü Oluştur'}
              </Button>
            </form>
          </Card>
        )}

        <div className="space-y-3">
          {roleTypes?.length === 0 && <p className="text-sm text-slate-500">Henüz firma rolü tanımlanmamış.</p>}
          {roleTypes?.map((rt) => (
            <Card key={rt.id} className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-slate-800">{rt.label}</span>
                <Badge variant={rt.category === 'ACIL_EKIP' ? 'orange' : 'purple'}>{CATEGORY_LABELS[rt.category] || rt.category}</Badge>
              </div>
              <Button variant="ghost" onClick={() => handleDeleteRoleType(rt)}>
                Sil
              </Button>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}
