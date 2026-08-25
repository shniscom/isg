import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import apiClient, { getErrorMessage } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Card, Select, Input, Alert, Badge, Button } from '../components/ui';
import { formatDate } from '../lib/nonconformity';
import {
  EXCEL_COLUMNS,
  parseEmployeeExcel,
  downloadEmployeeExcelTemplate,
  trainingStatusChip,
  medicalExamStatusChip,
} from '../lib/employee';

const SORT_OPTIONS = [
  { value: 'fullName', label: 'İsme Göre (A-Z)' },
  { value: 'startDate', label: 'Giriş Tarihine Göre (Yeni-Eski)' },
];

const CHIP_TONE_CLASS = {
  default: 'bg-slate-100 text-slate-600',
  success: 'bg-emerald-100 text-emerald-700',
  warning: 'bg-amber-100 text-amber-800',
  danger: 'bg-red-100 text-red-700',
};

function StatusChip({ chip }) {
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${CHIP_TONE_CLASS[chip.tone] || CHIP_TONE_CLASS.default}`}>{chip.text}</span>;
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
  const [showFormatGuide, setShowFormatGuide] = useState(false);

  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [quickAdd, setQuickAdd] = useState({ fullName: '', nationalId: '', position: '', startDate: '' });
  const [quickAddSubmitting, setQuickAddSubmitting] = useState(false);
  const [quickAddError, setQuickAddError] = useState(null);

  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [rowDeletingId, setRowDeletingId] = useState(null);

  const PAGE_SIZE = 30;
  const [page, setPage] = useState(1);
  const [pageInfo, setPageInfo] = useState(null); // { total, totalPages }

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

  function loadEmployees(targetPage) {
    if (!activeProjectId || !selectedCompany) return;
    const params = { companyId: selectedCompany.id, status: statusTab, sortBy, page: targetPage || page, pageSize: PAGE_SIZE };
    if (user?.isSystemAdmin) params.projectId = activeProjectId;
    if (search) params.q = search;
    apiClient
      .get('/employees', { params })
      .then(({ data }) => {
        setEmployees(data.employees);
        setPageInfo({ total: data.total ?? data.employees.length, totalPages: data.totalPages ?? 1 });
        setSelectedIds(new Set());
      })
      .catch((err) => setError(getErrorMessage(err)));
  }

  // Firma, durum, sıralama veya arama değişince ilk sayfaya dön.
  useEffect(() => {
    setPage(1);
    loadEmployees(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCompany, statusTab, sortBy, search]);

  useEffect(() => {
    if (page > 1) loadEmployees(page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

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
    if (!quickAdd.fullName.trim() || !quickAdd.nationalId.trim() || !quickAdd.position.trim() || !quickAdd.startDate) return;
    setQuickAddSubmitting(true);
    setQuickAddError(null);
    try {
      const payload = {
        companyId: selectedCompany.id,
        fullName: quickAdd.fullName.trim(),
        nationalId: quickAdd.nationalId.trim(),
        position: quickAdd.position.trim(),
        startDate: quickAdd.startDate,
      };
      if (user?.isSystemAdmin) payload.projectId = activeProjectId;
      await apiClient.post('/employees', payload);
      setShowQuickAdd(false);
      setQuickAdd({ fullName: '', nationalId: '', position: '', startDate: '' });
      loadEmployees();
      loadCompanies();
    } catch (err) {
      setQuickAddError(getErrorMessage(err));
    } finally {
      setQuickAddSubmitting(false);
    }
  }

  function toggleSelected(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelectedIds((prev) => {
      if (employees && prev.size === employees.length) return new Set();
      return new Set(employees?.map((e) => e.id));
    });
  }

  async function handleDeleteOne(emp) {
    if (!window.confirm(`${emp.fullName} kalıcı olarak silinsin mi? Bu işlem geri alınamaz.`)) return;
    setRowDeletingId(emp.id);
    setError(null);
    try {
      await apiClient.delete(`/employees/${emp.id}`);
      loadEmployees();
      loadCompanies();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setRowDeletingId(null);
    }
  }

  async function handleBulkDelete() {
    if (selectedIds.size === 0) return;
    if (!window.confirm(`${selectedIds.size} çalışan kalıcı olarak silinsin mi? Bu işlem geri alınamaz.`)) return;
    setBulkDeleting(true);
    setError(null);
    try {
      const payload = { ids: Array.from(selectedIds) };
      if (user?.isSystemAdmin) payload.projectId = activeProjectId;
      await apiClient.post('/employees/bulk-delete', payload);
      loadEmployees();
      loadCompanies();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBulkDeleting(false);
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

  const allSelected = employees && employees.length > 0 && selectedIds.size === employees.length;

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

      {user?.isSystemAdmin && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <button type="button" onClick={() => setShowFormatGuide((v) => !v)} className="font-medium text-brand-700 hover:underline">
            {showFormatGuide ? 'Excel formatını gizle ▲' : 'ℹ️ Excel formatı nasıl olmalı? ▼'}
          </button>
          <button type="button" onClick={downloadEmployeeExcelTemplate} className="font-medium text-brand-700 hover:underline">
            📄 Boş şablon indir
          </button>
        </div>
      )}

      {user?.isSystemAdmin && showFormatGuide && (
        <Card className="space-y-2 text-sm">
          <p className="text-slate-600">
            İlk satır <span className="font-medium">başlık</span> kabul edilir ve okunmaz; veriler{' '}
            <span className="font-medium">2. satırdan</span> itibaren, sütunlar aşağıdaki sırada olmalıdır:
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[460px] border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-1.5 pr-3 font-medium">Sütun</th>
                  <th className="py-1.5 pr-3 font-medium">Alan</th>
                  <th className="py-1.5 pr-3 font-medium">Zorunlu</th>
                  <th className="py-1.5 font-medium">Açıklama</th>
                </tr>
              </thead>
              <tbody>
                {EXCEL_COLUMNS.map((c) => (
                  <tr key={c.col} className="border-b border-slate-100 align-top">
                    <td className="py-1.5 pr-3 font-mono font-semibold text-slate-700">{c.col}</td>
                    <td className="py-1.5 pr-3 text-slate-800">{c.label}</td>
                    <td className="py-1.5 pr-3">{c.required ? <Badge variant="danger">Zorunlu</Badge> : <Badge>Opsiyonel</Badge>}</td>
                    <td className="py-1.5 text-slate-500">{c.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-500">
            Not: TC no, ad soyad, görev veya giriş tarihi boş olan satırlar atlanır. Daha önce yüklenmiş, aktif bir
            çalışan yeni listede yer almazsa otomatik olarak (tarihsiz) arşive alınır. Kolayca başlamak için "Boş
            şablon indir" butonuyla örnek bir Excel dosyası indirip üzerine yazabilirsiniz.
          </p>
        </Card>
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
            label="TC Kimlik No *"
            value={quickAdd.nationalId}
            onChange={(e) => setQuickAdd((f) => ({ ...f, nationalId: e.target.value }))}
          />
          <Input
            label="Görevi (SGK İş Kolu) *"
            value={quickAdd.position}
            onChange={(e) => setQuickAdd((f) => ({ ...f, position: e.target.value }))}
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
            disabled={
              quickAddSubmitting ||
              !quickAdd.fullName.trim() ||
              !quickAdd.nationalId.trim() ||
              !quickAdd.position.trim() ||
              !quickAdd.startDate
            }
          >
            {quickAddSubmitting ? 'Ekleniyor...' : 'Kaydet'}
          </Button>
        </Card>
      )}

      {employees?.length === 0 && <p className="text-sm text-slate-500">Kayıt bulunamadı.</p>}

      {user?.isSystemAdmin && employees?.length > 0 && (
        <div className="flex items-center justify-between rounded-xl bg-slate-100 px-3 py-2 text-xs">
          <label className="flex items-center gap-2 font-medium text-slate-600">
            <input type="checkbox" checked={!!allSelected} onChange={toggleSelectAll} />
            Tümünü seç ({selectedIds.size}/{employees.length})
          </label>
          {selectedIds.size > 0 && (
            <button
              type="button"
              onClick={handleBulkDelete}
              disabled={bulkDeleting}
              className="font-semibold text-red-600 hover:underline disabled:opacity-50"
            >
              {bulkDeleting ? 'Siliniyor...' : `🗑 Seçilenleri Sil (${selectedIds.size})`}
            </button>
          )}
        </div>
      )}

      <div className="space-y-2">
        {employees?.map((emp) => {
          const trainingChip = trainingStatusChip(emp);
          const medicalChip = medicalExamStatusChip(emp);
          return (
            <div key={emp.id} className="rounded-xl border border-slate-200 bg-white p-3 transition hover:border-brand-300">
              <div className="flex items-start gap-2">
                {user?.isSystemAdmin && (
                  <input
                    type="checkbox"
                    className="mt-1.5 shrink-0"
                    checked={selectedIds.has(emp.id)}
                    onChange={() => toggleSelected(emp.id)}
                  />
                )}
                <Link to={`/calisanlar/${emp.id}`} className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="truncate font-medium text-slate-800">{emp.fullName}</div>
                    <Badge variant={emp.warningCount > 2 ? 'danger' : emp.warningCount > 0 ? 'warning' : 'default'}>
                      {emp.warningCount} uyarı
                    </Badge>
                  </div>
                  <div className="truncate text-xs text-slate-500">
                    {emp.position ? `${emp.position} · ` : ''}
                    {emp.nationalId ? `TC: ${emp.nationalId} · ` : ''}
                    {emp.startDate ? `Giriş: ${formatDate(emp.startDate)}` : 'Giriş tarihi yok'}
                    {emp.endDate ? ` · Çıkış: ${formatDate(emp.endDate)}` : ''}
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <StatusChip chip={trainingChip} />
                    <StatusChip chip={medicalChip} />
                    {emp.isgRole && <span className="rounded-full bg-purple-100 px-2 py-0.5 text-[11px] font-medium text-purple-700">🦺 {emp.isgRole}</span>}
                  </div>
                </Link>
                {user?.isSystemAdmin && (
                  <button
                    type="button"
                    onClick={() => handleDeleteOne(emp)}
                    disabled={rowDeletingId === emp.id}
                    className="mt-1 shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                    aria-label="Çalışanı sil"
                  >
                    🗑
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {pageInfo && pageInfo.totalPages > 1 && (
        <div className="flex items-center justify-between gap-2 pt-1 text-sm">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="rounded-lg px-3 py-1.5 font-medium text-brand-700 hover:bg-brand-50 disabled:opacity-40"
          >
            ‹ Önceki
          </button>
          <span className="text-slate-500">
            Sayfa {page} / {pageInfo.totalPages} · {pageInfo.total} kayıt
          </span>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(pageInfo.totalPages, p + 1))}
            disabled={page >= pageInfo.totalPages}
            className="rounded-lg px-3 py-1.5 font-medium text-brand-700 hover:bg-brand-50 disabled:opacity-40"
          >
            Sonraki ›
          </button>
        </div>
      )}
    </div>
  );
}
