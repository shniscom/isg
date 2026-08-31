import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import apiClient, { getErrorMessage } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { Card, Button, Input, Select, Alert, Badge } from '../../components/ui';

const COMPANY_TYPES = [
  { value: 'ANA_FIRMA', label: 'Ana Firma' },
  { value: 'ALT_ISVEREN', label: 'Alt İşveren' },
  { value: 'TASERON', label: 'Taşeron' },
  { value: 'UCUNCU_SAHIS_HIZMET_VEREN', label: '3. Şahıs Hizmet Veren' },
  { value: 'TEDARIKCI', label: 'Tedarikçi' },
  { value: 'DIGER', label: 'Diğer' },
];

const typeLabel = (value) => COMPANY_TYPES.find((t) => t.value === value)?.label || value;

const EMPTY_FORM = { name: '', type: 'DIGER', taxNumber: '', sgkNumber: '', phone: '', scopeOfWork: '', blockIds: [] };

/** Bölge seçim listesi: checkbox'lar. Hiçbiri seçilmezse "Tüm Bölgeler" (proje genelinden sorumlu) anlamına gelir. */
function BlockSelector({ blocks, value, onChange }) {
  if (!blocks || blocks.length === 0) {
    return <p className="text-xs text-slate-400">Bu projede henüz bölge/blok tanımlanmamış - firma varsayılan olarak tüm proje kapsamında sorumlu sayılır.</p>;
  }
  function toggle(blockId) {
    onChange(value.includes(blockId) ? value.filter((id) => id !== blockId) : [...value, blockId]);
  }
  return (
    <div>
      <span className="mb-1.5 block text-sm font-medium text-slate-700">
        Sorumlu Olduğu Bölgeler <span className="font-normal text-slate-400">(hiçbiri seçilmezse "Tüm Bölgeler" sayılır)</span>
      </span>
      <div className="flex flex-wrap gap-2">
        {blocks.map((b) => {
          const selected = value.includes(b.id);
          return (
            <button
              key={b.id}
              type="button"
              onClick={() => toggle(b.id)}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                selected ? 'border-brand-600 bg-brand-50 text-brand-800' : 'border-slate-300 text-slate-600 hover:border-brand-300'
              }`}
            >
              {selected ? '✓ ' : ''}
              {b.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function CompanySummaryBadges({ summary }) {
  if (!summary) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
      {summary.blocks.length > 0 ? (
        summary.blocks.map((b) => (
          <span key={b.id} className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">
            📍 {b.name}
          </span>
        ))
      ) : (
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-500">📍 Tüm Bölgeler</span>
      )}
      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">👷 {summary.employeeCount} çalışan</span>
      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">🔧 {summary.equipmentCount} ekipman</span>
      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">🎯 {summary.roleAssignmentCount} rol ataması</span>
      {summary.kazaCount > 0 && <span className="rounded-full bg-red-100 px-2 py-0.5 text-red-700">🚨 {summary.kazaCount} kaza</span>}
      {summary.ramakKalaCount > 0 && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-800">⚠️ {summary.ramakKalaCount} ramak kala</span>}
    </div>
  );
}

export function CompaniesPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('firma_yonetme');

  const [projects, setProjects] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [projectBlocks, setProjectBlocks] = useState([]);
  const [companies, setCompanies] = useState(null);
  const [error, setError] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [formError, setFormError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [editError, setEditError] = useState(null);
  const [editSubmitting, setEditSubmitting] = useState(false);

  useEffect(() => {
    apiClient
      .get('/admin/projects')
      .then(({ data }) => {
        setProjects(data.projects);
        if (data.projects.length > 0) setSelectedProjectId(data.projects[0].id);
      })
      .catch((err) => setError(getErrorMessage(err)));
  }, []);

  async function loadCompanies(projectId) {
    if (!projectId) return;
    try {
      const { data } = await apiClient.get('/admin/companies', { params: { projectId } });
      setCompanies(data.companies);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  async function loadBlocks(projectId) {
    if (!projectId) {
      setProjectBlocks([]);
      return;
    }
    try {
      const { data } = await apiClient.get(`/admin/projects/${projectId}/blocks`);
      setProjectBlocks(data.blocks);
    } catch {
      setProjectBlocks([]);
    }
  }

  useEffect(() => {
    loadCompanies(selectedProjectId);
    loadBlocks(selectedProjectId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProjectId]);

  async function handleCreate(e) {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      await apiClient.post('/admin/companies', { ...form, projectId: selectedProjectId });
      setForm(EMPTY_FORM);
      setShowForm(false);
      await loadCompanies(selectedProjectId);
    } catch (err) {
      setFormError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeactivate(company) {
    await apiClient.delete(`/admin/companies/${company.id}`);
    await loadCompanies(selectedProjectId);
  }

  function openEdit(company) {
    setEditingId(company.id);
    setEditError(null);
    setEditForm({
      name: company.name || '',
      type: company.type || 'DIGER',
      taxNumber: company.taxNumber || '',
      sgkNumber: company.sgkNumber || '',
      phone: company.phone || '',
      scopeOfWork: company.scopeOfWork || '',
      blockIds: (company.summary?.blocks || []).map((b) => b.id),
    });
  }

  function closeEdit() {
    setEditingId(null);
    setEditForm(null);
    setEditError(null);
  }

  async function handleSaveEdit(e) {
    e.preventDefault();
    if (!editingId || !editForm) return;
    setEditError(null);
    setEditSubmitting(true);
    try {
      await apiClient.patch(`/admin/companies/${editingId}`, editForm);
      closeEdit();
      await loadCompanies(selectedProjectId);
    } catch (err) {
      setEditError(getErrorMessage(err));
    } finally {
      setEditSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-800">Firmalar</h1>
        {canManage && (
          <Button onClick={() => setShowForm((v) => !v)} disabled={!selectedProjectId}>
            {showForm ? 'Vazgeç' : '+ Yeni Firma'}
          </Button>
        )}
      </div>

      {error && <Alert>{error}</Alert>}

      {projects.length === 0 ? (
        <Alert variant="warning">Firma tanımlayabilmek için önce bir proje oluşturmalısınız.</Alert>
      ) : (
        <Select label="Proje" value={selectedProjectId} onChange={(e) => setSelectedProjectId(e.target.value)}>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      )}

      {showForm && canManage && (
        <Card>
          <form onSubmit={handleCreate} className="space-y-4">
            {formError && <Alert>{formError}</Alert>}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input label="Firma Adı" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
              <Select label="Firma Türü" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                {COMPANY_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </Select>
              <Input label="Vergi Numarası" value={form.taxNumber} onChange={(e) => setForm({ ...form, taxNumber: e.target.value })} />
              <Input label="SGK Sicil Numarası" value={form.sgkNumber} onChange={(e) => setForm({ ...form, sgkNumber: e.target.value })} />
              <Input label="Telefon" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              <Input
                label="Projede Yaptığı İş"
                value={form.scopeOfWork}
                onChange={(e) => setForm({ ...form, scopeOfWork: e.target.value })}
              />
            </div>
            <BlockSelector blocks={projectBlocks} value={form.blockIds} onChange={(blockIds) => setForm({ ...form, blockIds })} />
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Kaydediliyor...' : 'Firmayı Oluştur'}
            </Button>
          </form>
        </Card>
      )}

      <div className="space-y-3">
        {companies?.length === 0 && <p className="text-sm text-slate-500">Bu projede henüz firma tanımlanmamış.</p>}
        {companies?.map((c) => (
          <div key={c.id}>
            <Link to={`/admin/firmalar/${c.id}`}>
              <Card className="transition hover:border-brand-300 hover:shadow-md">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-slate-800">{c.name}</span>
                      <Badge>{typeLabel(c.type)}</Badge>
                      {!c.isActive && <Badge variant="danger">Pasif</Badge>}
                    </div>
                    <div className="text-sm text-slate-500">
                      {c.sgkNumber ? `SGK: ${c.sgkNumber}` : ''} {c.phone ? `· ${c.phone}` : ''}
                    </div>
                    <CompanySummaryBadges summary={c.summary} />
                  </div>
                  {canManage && (
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        aria-label="Firmayı düzenle"
                        title="Düzenle"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          if (editingId === c.id) closeEdit();
                          else openEdit(c);
                        }}
                        className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                      >
                        ✏️
                      </button>
                      {c.isActive && (
                        <button
                          type="button"
                          aria-label="Firmayı pasifleştir"
                          title="Pasifleştir"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            handleDeactivate(c);
                          }}
                          className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"
                        >
                          ⏸️
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </Card>
            </Link>

            {canManage && editingId === c.id && editForm && (
              <Card className="mt-2">
                <form onSubmit={handleSaveEdit} className="space-y-4">
                  {editError && <Alert>{editError}</Alert>}
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Input
                      label="Firma Adı"
                      value={editForm.name}
                      onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                      required
                    />
                    <Select
                      label="Firma Türü"
                      value={editForm.type}
                      onChange={(e) => setEditForm({ ...editForm, type: e.target.value })}
                    >
                      {COMPANY_TYPES.map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                        </option>
                      ))}
                    </Select>
                    <Input
                      label="Vergi Numarası"
                      value={editForm.taxNumber}
                      onChange={(e) => setEditForm({ ...editForm, taxNumber: e.target.value })}
                    />
                    <Input
                      label="SGK Sicil Numarası"
                      value={editForm.sgkNumber}
                      onChange={(e) => setEditForm({ ...editForm, sgkNumber: e.target.value })}
                    />
                    <Input
                      label="Telefon"
                      value={editForm.phone}
                      onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                    />
                    <Input
                      label="Projede Yaptığı İş"
                      value={editForm.scopeOfWork}
                      onChange={(e) => setEditForm({ ...editForm, scopeOfWork: e.target.value })}
                    />
                  </div>
                  <BlockSelector blocks={projectBlocks} value={editForm.blockIds} onChange={(blockIds) => setEditForm({ ...editForm, blockIds })} />
                  <div className="flex gap-2">
                    <Button type="submit" disabled={editSubmitting}>
                      {editSubmitting ? 'Kaydediliyor...' : 'Değişiklikleri Kaydet'}
                    </Button>
                    <Button type="button" variant="secondary" onClick={closeEdit}>
                      Vazgeç
                    </Button>
                  </div>
                </form>
              </Card>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
