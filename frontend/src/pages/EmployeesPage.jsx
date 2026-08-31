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

const EMPTY_TEMP_EMPLOYEE = {
  fullName: '',
  nationalId: '',
  position: '',
  startDate: '',
  endDate: '',
  assignmentFormExists: false,
  sgkEntryDocExists: false,
  isgTrainingDate: '',
  isgTrainingExpiryDate: '',
  orientationTrainingDate: '',
  ppeHandoverDocExists: false,
};

export function EmployeesPage() {
  const { user, hasPermission, context } = useAuth();
  // Admin ile aynı şekilde tam yazma yetkisi (ekleme/Excel içe aktarma/arşivleme): sistem admini
  // ya da İnsan Kaynakları Yönetimi yetkisi olan kişiler - bkz. backend employees.routes.js.
  const canManageEmployees = user?.isSystemAdmin || hasPermission('insan_kaynaklari_yonetimi');
  // Geçici görevlendirme firma/çalışan kayıtlarını oluşturma-düzenleme yetkisi (bkz. backend
  // employees.routes.js + admin/companies.routes.js - admin dışındaki değişiklikler admin
  // onayına gider). insan_kaynaklari_yonetimi/uygunsuzluk_acma yetkisi olanlar zaten her firmaya
  // (temp dahil) erişebildiği için onlar da bu kapsamda sayılır.
  const canManageTemp = canManageEmployees || hasPermission('gecici_gorevlendirme_yonetimi');
  const fileInputRef = useRef(null);

  const [adminProjects, setAdminProjects] = useState(null);
  const [adminProjectId, setAdminProjectId] = useState('');
  const activeProjectId = user?.isSystemAdmin ? adminProjectId : 'self';
  // /admin/companies gibi projectId body alanı zorunlu olan uçlar için gerçek proje id'si
  // ('self' burada işe yaramaz - bkz. resolveProjectId).
  const effectiveProjectId = user?.isSystemAdmin ? adminProjectId : context?.projectId;

  const [showTempPanel, setShowTempPanel] = useState(false);
  const [showAddTempCompany, setShowAddTempCompany] = useState(false);
  const [newTempCompanyName, setNewTempCompanyName] = useState('');
  const [addTempCompanySubmitting, setAddTempCompanySubmitting] = useState(false);
  const [addTempCompanyError, setAddTempCompanyError] = useState(null);
  const [tempNotice, setTempNotice] = useState(null);

  const [showTempEmployeeAdd, setShowTempEmployeeAdd] = useState(false);
  const [tempEmployeeForm, setTempEmployeeForm] = useState(EMPTY_TEMP_EMPLOYEE);
  const [tempEmployeeSubmitting, setTempEmployeeSubmitting] = useState(false);
  const [tempEmployeeError, setTempEmployeeError] = useState(null);

  const [companies, setCompanies] = useState(null);
  const [error, setError] = useState(null);

  const [selectedCompany, setSelectedCompany] = useState(null); // { id, name }
  const [employees, setEmployees] = useState(null);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('fullName');
  const [statusTab, setStatusTab] = useState('active'); // 'active' | 'archived'
  const [filterTab, setFilterTab] = useState('all'); // 'all' | 'myk' | 'untrained' | 'medicalExam' | 'isgRole'
  const [stats, setStats] = useState(null);

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

  const [duplicateGroups, setDuplicateGroups] = useState(null);
  const [showDuplicates, setShowDuplicates] = useState(false);
  const [duplicateRemovingId, setDuplicateRemovingId] = useState(null);

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

  function loadDuplicates() {
    if (!activeProjectId || !canManageEmployees) return;
    const params = user?.isSystemAdmin ? { projectId: activeProjectId } : {};
    apiClient
      .get('/employees/duplicates', { params })
      .then(({ data }) => setDuplicateGroups(data.groups))
      .catch(() => setDuplicateGroups(null));
  }

  useEffect(() => {
    setSelectedCompany(null);
    setCompanies(null);
    setDuplicateGroups(null);
    setShowDuplicates(false);
    loadCompanies();
    loadDuplicates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProjectId]);

  async function handleRemoveDuplicate(emp) {
    if (!window.confirm(`${emp.fullName} (${emp.companyName}) firma çalışan listesinden kaldırılsın mı? Bu işlem geri alınamaz.`)) return;
    setDuplicateRemovingId(emp.id);
    try {
      await apiClient.delete(`/employees/${emp.id}`);
      loadDuplicates();
      loadCompanies();
      if (selectedCompany?.id === emp.companyId) loadEmployees();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setDuplicateRemovingId(null);
    }
  }

  function loadEmployees() {
    if (!activeProjectId || !selectedCompany) return;
    const params = { companyId: selectedCompany.id, status: statusTab, sortBy };
    if (filterTab !== 'all') params.filter = filterTab;
    if (user?.isSystemAdmin) params.projectId = activeProjectId;
    if (search) params.q = search;
    apiClient
      .get('/employees', { params })
      .then(({ data }) => {
        setEmployees(data.employees);
        setSelectedIds(new Set());
      })
      .catch((err) => setError(getErrorMessage(err)));
  }

  function loadStats() {
    if (!activeProjectId || !selectedCompany) return;
    const params = { companyId: selectedCompany.id, status: statusTab };
    if (user?.isSystemAdmin) params.projectId = activeProjectId;
    if (search) params.q = search;
    apiClient
      .get('/employees/stats', { params })
      .then(({ data }) => setStats(data))
      .catch((err) => setError(getErrorMessage(err)));
  }

  useEffect(() => {
    loadEmployees();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCompany, statusTab, sortBy, search, filterTab]);

  useEffect(() => {
    loadStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCompany, statusTab, search]);

  useEffect(() => {
    setFilterTab('all');
  }, [selectedCompany, statusTab]);

  const FILTER_TABS = [
    { value: 'all', label: 'Tümü', count: stats?.total },
    { value: 'myk', label: 'MYK', count: stats?.myk },
    { value: 'untrained', label: 'Eğitimsiz', count: stats?.untrained },
    { value: 'medicalExam', label: 'Tetkik', count: stats?.medicalExam },
    { value: 'isgRole', label: 'İSG Görevi', count: stats?.isgRole },
  ];

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
      loadStats();
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
      loadStats();
    } catch (err) {
      setQuickAddError(getErrorMessage(err));
    } finally {
      setQuickAddSubmitting(false);
    }
  }

  async function handleAddTempCompany() {
    if (!newTempCompanyName.trim() || !effectiveProjectId) return;
    setAddTempCompanySubmitting(true);
    setAddTempCompanyError(null);
    try {
      const { data } = await apiClient.post('/admin/companies', {
        projectId: effectiveProjectId,
        name: newTempCompanyName.trim(),
        isTemporaryAssignment: true,
      });
      setShowAddTempCompany(false);
      setNewTempCompanyName('');
      if (data?.queued) {
        setTempNotice(data.message || 'Firma admin onayına gönderildi.');
      } else {
        loadCompanies();
      }
    } catch (err) {
      setAddTempCompanyError(getErrorMessage(err));
    } finally {
      setAddTempCompanySubmitting(false);
    }
  }

  async function handleAddTempEmployee() {
    if (!tempEmployeeForm.fullName.trim() || !selectedCompany) return;
    setTempEmployeeSubmitting(true);
    setTempEmployeeError(null);
    try {
      const payload = {
        companyId: selectedCompany.id,
        fullName: tempEmployeeForm.fullName.trim(),
        nationalId: tempEmployeeForm.nationalId.trim() || null,
        position: tempEmployeeForm.position.trim() || null,
        startDate: tempEmployeeForm.startDate || null,
        endDate: tempEmployeeForm.endDate || null,
        assignmentFormExists: tempEmployeeForm.assignmentFormExists,
        sgkEntryDocExists: tempEmployeeForm.sgkEntryDocExists,
        isgTrainingDate: tempEmployeeForm.isgTrainingDate || null,
        isgTrainingExpiryDate: tempEmployeeForm.isgTrainingExpiryDate || null,
        orientationTrainingDate: tempEmployeeForm.orientationTrainingDate || null,
        ppeHandoverDocExists: tempEmployeeForm.ppeHandoverDocExists,
      };
      if (user?.isSystemAdmin) payload.projectId = activeProjectId;
      const { data } = await apiClient.post('/employees', payload);
      setShowTempEmployeeAdd(false);
      setTempEmployeeForm(EMPTY_TEMP_EMPLOYEE);
      if (data?.queued) {
        setTempNotice(data.message || 'Çalışan admin onayına gönderildi.');
      } else {
        loadEmployees();
        loadCompanies();
        loadStats();
      }
    } catch (err) {
      setTempEmployeeError(getErrorMessage(err));
    } finally {
      setTempEmployeeSubmitting(false);
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
      loadStats();
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
      loadStats();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBulkDeleting(false);
    }
  }

  const tempCompanies = (companies || []).filter((c) => c.isTemporaryAssignment);
  const regularCompanies = (companies || []).filter((c) => !c.isTemporaryAssignment);
  const tempEmployeeTotal = tempCompanies.reduce((sum, c) => sum + (c.activeEmployeeCount || 0), 0);

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

        {canManageEmployees && duplicateGroups?.length > 0 && (
          <Card className="space-y-2 border-amber-200 bg-amber-50">
            <button type="button" onClick={() => setShowDuplicates((v) => !v)} className="flex w-full items-center justify-between text-left">
              <span className="text-sm font-semibold text-amber-800">
                ⚠️ {duplicateGroups.length} çalışan birden fazla firmada kayıtlı
              </span>
              <span className="text-xs font-medium text-amber-700">{showDuplicates ? 'Gizle ▲' : 'Göster ▼'}</span>
            </button>
            {showDuplicates && (
              <div className="space-y-3 pt-1">
                {duplicateGroups.map((group, idx) => (
                  <div key={idx} className="rounded-lg border border-amber-200 bg-surface p-2.5">
                    <div className="mb-1.5 text-xs font-medium text-slate-600">TC: {group[0].nationalId}</div>
                    <div className="space-y-1.5">
                      {group.map((emp) => (
                        <div key={emp.id} className="flex items-center justify-between gap-2 text-xs">
                          <div className="min-w-0">
                            <div className="truncate font-medium text-slate-800">{emp.fullName}</div>
                            <div className="truncate text-slate-500">
                              {emp.companyName}
                              {emp.position ? ` · ${emp.position}` : ''}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleRemoveDuplicate(emp)}
                            disabled={duplicateRemovingId === emp.id}
                            className="shrink-0 rounded-lg px-2 py-1 font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
                          >
                            {duplicateRemovingId === emp.id ? 'Kaldırılıyor...' : 'Bu firmadan kaldır'}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        )}

        {tempNotice && <Alert variant="success">{tempNotice}</Alert>}

        {companies === null && <p className="text-sm text-slate-500">Yükleniyor...</p>}

        {companies !== null && (canManageTemp || tempCompanies.length > 0) && (
          <Card className="space-y-3 border-amber-200 bg-amber-50">
            <button type="button" onClick={() => setShowTempPanel((v) => !v)} className="flex w-full items-center justify-between text-left">
              <div>
                <span className="text-sm font-semibold text-amber-800">🕐 Geçici Görevlendirme</span>
                <p className="text-xs text-amber-700">
                  {tempCompanies.length} firma · {tempEmployeeTotal} çalışan
                </p>
              </div>
              <span className="text-xs font-medium text-amber-700">{showTempPanel ? 'Gizle ▲' : 'Göster ▼'}</span>
            </button>

            {showTempPanel && (
              <div className="space-y-2 pt-1">
                {tempCompanies.length === 0 && <p className="text-xs text-amber-700">Henüz geçici görevlendirme firması eklenmemiş.</p>}
                {tempCompanies.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setSelectedCompany({ id: c.id, name: c.name, isTemporaryAssignment: true })}
                    className="flex w-full items-center justify-between rounded-xl border border-amber-200 bg-surface p-3 text-left transition hover:border-amber-400 active:scale-[0.99]"
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

                {canManageTemp && (
                  <>
                    {addTempCompanyError && <Alert>{addTempCompanyError}</Alert>}
                    {!showAddTempCompany ? (
                      <Button type="button" variant="ghost" onClick={() => setShowAddTempCompany(true)}>
                        + Geçici Görevli Firma Ekle
                      </Button>
                    ) : (
                      <div className="space-y-2 rounded-lg border border-amber-200 bg-surface p-2.5">
                        <Input
                          label="Firma Adı"
                          value={newTempCompanyName}
                          onChange={(e) => setNewTempCompanyName(e.target.value)}
                        />
                        <div className="flex gap-2">
                          <Button type="button" onClick={handleAddTempCompany} disabled={addTempCompanySubmitting || !newTempCompanyName.trim()}>
                            {addTempCompanySubmitting ? 'Ekleniyor...' : 'Kaydet'}
                          </Button>
                          <Button type="button" variant="ghost" onClick={() => setShowAddTempCompany(false)}>
                            Vazgeç
                          </Button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </Card>
        )}

        {companies?.length === 0 && <p className="text-sm text-slate-500">Bu projede görüntüleyebileceğiniz bir firma yok.</p>}

        <div className="space-y-2">
          {regularCompanies.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setSelectedCompany({ id: c.id, name: c.name, isTemporaryAssignment: false })}
              className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-surface p-3.5 text-left transition hover:border-brand-300 active:scale-[0.99]"
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

      <div className="flex items-center gap-2">
        <h1 className="text-lg font-bold text-slate-800 sm:text-xl">{selectedCompany.name}</h1>
        {selectedCompany.isTemporaryAssignment && <Badge variant="warning">🕐 Geçici Görevlendirme</Badge>}
      </div>

      {error && <Alert>{error}</Alert>}
      {tempNotice && <Alert variant="success">{tempNotice}</Alert>}

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

      <div className="flex gap-2 overflow-x-auto pb-1">
        {FILTER_TABS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setFilterTab(f.value)}
            className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition ${
              filterTab === f.value ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600'
            }`}
          >
            {f.label} ({f.count ?? '…'})
          </button>
        ))}
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

      {canManageEmployees && !selectedCompany.isTemporaryAssignment && (
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

      {canManageTemp && selectedCompany.isTemporaryAssignment && (
        <Button type="button" variant="secondary" onClick={() => setShowTempEmployeeAdd((v) => !v)}>
          + Çalışan Ekle
        </Button>
      )}

      {canManageEmployees && !selectedCompany.isTemporaryAssignment && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <button type="button" onClick={() => setShowFormatGuide((v) => !v)} className="font-medium text-brand-700 hover:underline">
            {showFormatGuide ? 'Excel formatını gizle ▲' : 'ℹ️ Excel formatı nasıl olmalı? ▼'}
          </button>
          <button type="button" onClick={downloadEmployeeExcelTemplate} className="font-medium text-brand-700 hover:underline">
            📄 Boş şablon indir
          </button>
        </div>
      )}

      {canManageEmployees && showFormatGuide && (
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
          {importResult.rejoined > 0 ? ` (${importResult.rejoined} yeniden giriş)` : ''}
          {importResult.skipped > 0 ? `, ${importResult.skipped} satır atlandı` : ''}.
          {importResult.errors?.length > 0 && (
            <span className="mt-1 block text-xs opacity-80">{importResult.errors.slice(0, 5).join(' ')}</span>
          )}
        </Alert>
      )}
      {importResult?.needsExitDateReview && (
        <Alert variant="warning">
          ⚠️ {importResult.archived} çalışan yeni listede yer almadığı için <strong>tarihsiz</strong> olarak arşive
          alındı. Gerçek çıkış tarihlerini biliyorsanız Çalışanlar &gt; Çıkış Yapanlar / Arşiv sekmesinden ilgili
          kişiyi açıp girmenizi öneririz.
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

      {showTempEmployeeAdd && (
        <Card className="space-y-3">
          <p className="text-xs text-slate-500">
            Mevzuata uygun geçici görevlendirme kaydı (bkz. 6331 sayılı İSG Kanunu / 5510 sayılı Kanun kapsamında sahaya
            geçici görevle giren personel için gereken bilgiler).
          </p>
          {tempEmployeeError && <Alert>{tempEmployeeError}</Alert>}
          <Input
            label="Ad Soyad *"
            value={tempEmployeeForm.fullName}
            onChange={(e) => setTempEmployeeForm((f) => ({ ...f, fullName: e.target.value }))}
          />
          <Input
            label="TC Kimlik No"
            value={tempEmployeeForm.nationalId}
            onChange={(e) => setTempEmployeeForm((f) => ({ ...f, nationalId: e.target.value }))}
          />
          <Input
            label="Görevi"
            value={tempEmployeeForm.position}
            onChange={(e) => setTempEmployeeForm((f) => ({ ...f, position: e.target.value }))}
          />
          <Input
            label="Görevlendirme Tarihi"
            type="date"
            value={tempEmployeeForm.startDate}
            onChange={(e) => setTempEmployeeForm((f) => ({ ...f, startDate: e.target.value }))}
          />
          <Input
            label="Görev Bitiş Tarihi"
            type="date"
            value={tempEmployeeForm.endDate}
            onChange={(e) => setTempEmployeeForm((f) => ({ ...f, endDate: e.target.value }))}
          />
          <Input
            label="İş Güvenliği Eğitim Sertifika Tarihi"
            type="date"
            value={tempEmployeeForm.isgTrainingDate}
            onChange={(e) => setTempEmployeeForm((f) => ({ ...f, isgTrainingDate: e.target.value }))}
          />
          <Input
            label="Eğitim Sertifikası Geçerlilik Tarihi"
            type="date"
            value={tempEmployeeForm.isgTrainingExpiryDate}
            onChange={(e) => setTempEmployeeForm((f) => ({ ...f, isgTrainingExpiryDate: e.target.value }))}
          />
          <Input
            label="Oryantasyon Eğitim Tarihi"
            type="date"
            value={tempEmployeeForm.orientationTrainingDate}
            onChange={(e) => setTempEmployeeForm((f) => ({ ...f, orientationTrainingDate: e.target.value }))}
          />
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={tempEmployeeForm.assignmentFormExists}
              onChange={(e) => setTempEmployeeForm((f) => ({ ...f, assignmentFormExists: e.target.checked }))}
            />
            Görevlendirme formu var
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={tempEmployeeForm.sgkEntryDocExists}
              onChange={(e) => setTempEmployeeForm((f) => ({ ...f, sgkEntryDocExists: e.target.checked }))}
            />
            SGK giriş belgesi var
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={tempEmployeeForm.ppeHandoverDocExists}
              onChange={(e) => setTempEmployeeForm((f) => ({ ...f, ppeHandoverDocExists: e.target.checked }))}
            />
            KKD zimmet tutanağı var
          </label>
          <div className="flex gap-2">
            <Button type="button" onClick={handleAddTempEmployee} disabled={tempEmployeeSubmitting || !tempEmployeeForm.fullName.trim()}>
              {tempEmployeeSubmitting ? 'Ekleniyor...' : 'Kaydet'}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setShowTempEmployeeAdd(false)}>
              Vazgeç
            </Button>
          </div>
        </Card>
      )}

      {employees?.length === 0 && <p className="text-sm text-slate-500">Kayıt bulunamadı.</p>}

      {canManageEmployees && employees?.length > 0 && (
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
            <div key={emp.id} className="rounded-xl border border-slate-200 bg-surface p-3 transition hover:border-brand-300">
              <div className="flex items-start gap-2">
                {canManageEmployees && (
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
                {(canManageEmployees || (canManageTemp && selectedCompany.isTemporaryAssignment)) && (
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
    </div>
  );
}
