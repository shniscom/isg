import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import apiClient, { getErrorMessage } from '../../api/client';
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

export function CompaniesPage() {
  const [projects, setProjects] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [companies, setCompanies] = useState(null);
  const [error, setError] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [formError, setFormError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({ name: '', type: 'DIGER', taxNumber: '', sgkNumber: '', phone: '', scopeOfWork: '' });

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

  useEffect(() => {
    loadCompanies(selectedProjectId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProjectId]);

  async function handleCreate(e) {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      await apiClient.post('/admin/companies', { ...form, projectId: selectedProjectId });
      setForm({ name: '', type: 'DIGER', taxNumber: '', sgkNumber: '', phone: '', scopeOfWork: '' });
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

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-800">Firmalar</h1>
        <Button onClick={() => setShowForm((v) => !v)} disabled={!selectedProjectId}>
          {showForm ? 'Vazgeç' : '+ Yeni Firma'}
        </Button>
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

      {showForm && (
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
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Kaydediliyor...' : 'Firmayı Oluştur'}
            </Button>
          </form>
        </Card>
      )}

      <div className="space-y-3">
        {companies?.length === 0 && <p className="text-sm text-slate-500">Bu projede henüz firma tanımlanmamış.</p>}
        {companies?.map((c) => (
          <Link key={c.id} to={`/admin/firmalar/${c.id}`}>
            <Card className="flex items-center justify-between transition hover:border-brand-300 hover:shadow-md">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-slate-800">{c.name}</span>
                  <Badge>{typeLabel(c.type)}</Badge>
                  {!c.isActive && <Badge variant="danger">Pasif</Badge>}
                </div>
                <div className="text-sm text-slate-500">
                  {c.sgkNumber ? `SGK: ${c.sgkNumber}` : ''} {c.phone ? `· ${c.phone}` : ''}
                </div>
              </div>
              {c.isActive && (
                <Button
                  variant="secondary"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleDeactivate(c);
                  }}
                >
                  Pasifleştir
                </Button>
              )}
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
