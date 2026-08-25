import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import * as XLSX from 'xlsx';
import apiClient, { getErrorMessage } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Card, Select, Input, Alert, Badge, Button } from '../components/ui';
import { formatDate } from '../lib/nonconformity';

const SORT_OPTIONS = [
  { value: 'fullName', label: 'İsme Göre (A-Z)' },
  { value: 'startDate', label: 'Giriş Tarihine Göre (Yeni-Eski)' },
];

function cellText(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function excelDateToIso(value) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const text = cellText(value);
  // gg.aa.yyyy gibi Türkçe tarih formatlarını da destekle
  const trMatch = text.match(/^(\d{1,2})[./](\d{1,2})[./](\d{2,4})$/);
  if (trMatch) {
    const [, d, m, y] = trMatch;
    const year = y.length === 2 ? `20${y}` : y;
    return `${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  return text;
}

/**
 * Excel kolon sırası: sıra no, ad soyad, tc no, görevi, İSG eğitimi, tetkik, giriş tarihi, çıkış tarihi.
 * İlk satır başlık kabul edilir. Ad soyad ve giriş tarihi zorunludur, boş olan satırlar backend tarafında atlanır.
 */
async function parseEmployeeExcel(file) {
  const buf = await file.arrayBuffer();
  const workbook = XLSX.read(buf, { type: 'array', cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' });
  const dataRows = rows.slice(1);
  return dataRows
    .filter((r) => Array.isArray(r) && r.some((cell) => cellText(cell) !== ''))
    .map((r) => ({
      fullName: cellText(r[1]),
      nationalId: cellText(r[2]),
      position: cellText(r[3]),
      isgTrainingCompleted: cellText(r[4]).toLowerCase() === 'var',
      medicalExamNote: cellText(r[5]),
      startDate: excelDateToIso(r[6]),
      endDate: excelDateToIso(r[7]),
    }));
}

export function EmployeesPage() {
  const { user } = useAuth();
  const fileInputRef = useRef(null);

  const [adminProjects, setAdminProjects] = useState(null);
  const [adminProjectId, setAdminProjectId] = useState('');
  const activeProjectId = user?.isSystemAdmin ? adminProjectId : 'self';

  const [companies, setCompanies] = useState(null);
  const [error, setError] = useState(null);

  const [selectedCompany, setSelectedCompany] = useState(null); // { id, name }
  const [employees, setEmployees] = useState(null);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('fullName');
  const [statusTab, setStatusTab] = useState('active'); // 'active' | 'archived'

  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [importError, setImportError] = useState(null);

  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [quickAdd, setQuickAdd] = useState({ fullName: '', nationalId: '', startDate: '' });
  const [quickAddSubmitting, setQuickAddSubmitting] = useState(false);
  const [quickAddError, setQuickAddError] = useState(null);

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

  function loadCompanies() {
    if (!activeProjectId) return;
    const params = user?.isSystemAdmin ? { projectId: activeProjectId } : {};
    apiClient
      .get('/employees/companies', { params })
      .then(({ data }) => setCompanies(data.companies))
      .catch((err) => setError(getErrorMessage(err)));
  }

  useEffect(() => {
    setSelectedCompany(null);
    setCompanies(null);
    loadCompanies();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProjectId]);

  function loadEmployees() {
    if (!activeProjectId || !selectedCompany) return;
    const params = { companyId: selectedCompany.id, status: statusTab, sortBy };
    if (user?.isSystemAdmin) params.projectId = activeProjectId;
    if (search) params.q = search;
    apiClient
      .get('/employees', { params })
      .then(({ data }) => setEmployees(data.employees))
      .catch((err) => setError(getErrorMessage(err)));
  }

  useEffect(() => {
    loadEmployees();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCompany, statusTab, sortBy, search]);

  async function handleFileChange(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !selectedCompany) return;
    setImportError(null);
    setImportResult(null);
    setImporting(true);
    try {
      const rows = await parseEmployeeExcel(file);
      if (rows.length === 0) {
        setImportError('Dosyada okunabilir satır bulunamadı. Kolon sırasının doğru olduğundan emin olun.');
        return;
      }
      const payload = { companyId: selectedCompany.id, rows };
      if (user?.isSystemAdmin) payload.projectId = activeProjectId;
      const { data } = await apiClient.post('/employees/import', payload);
      setImportResult(data);
      loadEmployees();
      loadCompanies();
    } catch (err) {
      setImportError(getErrorMessage(err));
    } finally {
      setImporting(false);
    }
  }

  async function handleQuickAdd() {
    if (!quickAdd.fullName.trim() || !quickAdd.startDate) return;
    setQuickAddSubmitting(true);
    setQuickAddError(null);
    try {
      const payload = {
        companyId: selectedCompany.id,
        fullName: quickAdd.fullName.trim(),
        nationalId: quickAdd.nationalId.trim() || null,
        startDate: quickAdd.startDate,
      };
      if (user?.isSystemAdmin) payload.projectId = activeProjectId;
      await apiClient.post('/employees', payload);
      setShowQuickAdd(false);
      setQuickAdd({ fullName: '', nationalId: '', startDate: '' });
      loadEmployees();
      loadCompanies();
    } catch (err) {
      setQuickAddError(getErrorMessage(err));
    } finally {
      setQuickAddSubmitting(false);
    }
  }

  // --- Firma seçim ekranı ---
  if (!selectedCompany) {
    return (
      <div className="mx-auto max-w-3xl space-y-5">
        <div>
          <h1 className="text-xl font-bold text-slate-800 sm:text-2xl">Çalışanlar</h1>
          <p className="text-sm text-slate-500">Bir firma seçerek çalışan listesini görüntüleyin.</p>
        </div>

        {error && <Alert>{error}</Alert>}

        {user?.isSystemAdmin && adminProjects && (
          <Select value={adminProjectId} onChange={(e) => setAdminProjectId(e.target.value)}>
            {adminProjects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        )}

        {companies === null && <p className="text-sm text-slate-500">Yükleniyor...</p>}
        {companies?.length === 0 && <p className="text-sm text-slate-500">Bu projede görüntüleyebileceğiniz bir firma yok.</p>}

        <div className="space-y-2">
          {companies?.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setSelectedCompany({ id: c.id, name: c.name })}
              className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white p-3.5 text-left transition hover:border-brand-300 active:scale-[0.99]"
            >
              <div>
                <div className="font-medium text-slate-800">{c.name}</div>
                <div className="text-xs text-slate-500">
                  {c.activeEmployeeCount} aktif çalışan
                  {c.archivedEmployeeCount > 0 ? ` · ${c.archivedEmployeeCount} arşivde` : ''}
                </div>
              </div>
              <span className="text-slate-300">›</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // --- Firma çalışanları ekranı ---
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <button type="button" onClick={() => setSelectedCompany(null)} className="text-sm text-brand-700 hover:underline">
        ‹ Firmalar
      </button>

      <h1 className="text-lg font-bold text-slate-800 sm:text-xl">{selectedCompany.name}</h1>

      {error && <Alert>{error}</Alert>}

      <div className="flex gap-2 overflow-x-auto pb-1">
        <button
          type="button"
          onClick={() => setStatusTab('active')}
          className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium transition ${
            statusTab === 'active' ? 'bg-brand-700 text-white' : 'bg-slate-100 text-slate-600'
          }`}
        >
          Aktif
        </button>
        <button
          type="button"
          onClick={() => setStatusTab('archived')}
          className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium transition ${
            statusTab === 'archived' ? 'bg-brand-700 text-white' : 'bg-slate-100 text-slate-600'
          }`}
        >
          Çıkış Yapanlar / Arşiv
        </button>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Input placeholder="İsim veya TC no ara..." value={search} onChange={(e) => setSearch(e.target.value)} className="sm:flex-1" />
        <Select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="sm:w-56">
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </div>

      {user?.isSystemAdmin && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Button type="button" variant="secondary" onClick={() => fileInputRef.current?.click()} disabled={importing}>
            {importing ? 'Yükleniyor...' : '📥 Excel ile Liste Yükle'}
          </Button>
          <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFileChange} />
          <Button type="button" variant="ghost" onClick={() => setShowQuickAdd((v) => !v)}>
            + Çalışan Ekle
          </Button>
        </div>
      )}

      {importError && <Alert>{importError}</Alert>}
      {importResult && (
        <Alert variant="success">
          {importResult.created} yeni, {importResult.updated} güncellendi, {importResult.archived} arşivlendi
          {importResult.skipped > 0 ? `, ${importResult.skipped} satır atlandı` : ''}.
          {importResult.errors?.length > 0 && (
            <span className="mt-1 block text-xs opacity-80">{importResult.errors.slice(0, 5).join(' ')}</span>
          )}
        </Alert>
      )}

      {showQuickAdd && (
        <Card className="space-y-3">
          {quickAddError && <Alert>{quickAddError}</Alert>}
          <Input
            label="Ad Soyad *"
            value={quickAdd.fullName}
            onChange={(e) => setQuickAdd((f) => ({ ...f, fullName: e.target.value }))}
          />
          <Input
            label="TC Kimlik No"
            value={quickAdd.nationalId}
            onChange={(e) => setQuickAdd((f) => ({ ...f, nationalId: e.target.value }))}
          />
          <Input
            label="Giriş Tarihi *"
            type="date"
            value={quickAdd.startDate}
            onChange={(e) => setQuickAdd((f) => ({ ...f, startDate: e.target.value }))}
          />
          <Button
            type="button"
            onClick={handleQuickAdd}
            disabled={quickAddSubmitting || !quickAdd.fullName.trim() || !quickAdd.startDate}
          >
            {quickAddSubmitting ? 'Ekleniyor...' : 'Kaydet'}
          </Button>
        </Card>
      )}

      {employees?.length === 0 && <p className="text-sm text-slate-500">Kayıt bulunamadı.</p>}

      <div className="space-y-2">
        {employees?.map((emp) => (
          <Link key={emp.id} to={`/calisanlar/${emp.id}`}>
            <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-3 transition hover:border-brand-300">
              <div className="min-w-0">
                <div className="truncate font-medium text-slate-800">{emp.fullName}</div>
                <div className="truncate text-xs text-slate-500">
                  {emp.position ? `${emp.position} · ` : ''}
                  {emp.nationalId ? `TC: ${emp.nationalId} · ` : ''}
                  {emp.startDate ? `Giriş: ${formatDate(emp.startDate)}` : 'Giriş tarihi yok'}
                  {emp.endDate ? ` · Çıkış: ${formatDate(emp.endDate)}` : ''}
                </div>
              </div>
              <Badge variant={emp.warningCount > 2 ? 'danger' : emp.warningCount > 0 ? 'warning' : 'default'}>
                {emp.warningCount} uyarı
              </Badge>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
