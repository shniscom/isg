import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import apiClient, { getErrorMessage } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { Card, Button, Input, Select, Textarea, Alert, Badge } from '../../components/ui';
import { EmployeeCombobox } from '../../components/EmployeeCombobox';

const COMPANY_TYPE_LABELS = {
  ANA_FIRMA: 'Ana Firma',
  ALT_ISVEREN: 'Alt İşveren',
  TASERON: 'Taşeron',
  UCUNCU_SAHIS_HIZMET_VEREN: '3. Şahıs Hizmet Veren',
  TEDARIKCI: 'Tedarikçi',
  DIGER: 'Diğer',
};

const DANGER_CLASS_LABELS = { COK_TEHLIKELI: 'Çok Tehlikeli', TEHLIKELI: 'Tehlikeli', AZ_TEHLIKELI: 'Az Tehlikeli' };
const INCIDENT_TYPE_LABELS = { KAZA: 'Kaza', RAMAK_KALA: 'Ramak Kala' };
const DOC_TYPE_LABELS = { RISK_ANALIZI: 'Risk Analizi', ACIL_DURUM_EYLEM_PLANI: 'Acil Durum Eylem Planı' };
const PENALTY_STATUS_LABELS = { BEKLEMEDE: 'Onay Bekliyor', ONAYLANDI: 'Onaylandı', REDDEDILDI: 'Reddedildi' };
const PENALTY_STATUS_VARIANT = { BEKLEMEDE: 'warning', ONAYLANDI: 'success', REDDEDILDI: 'danger' };

const TABS = [
  { key: 'genel', label: 'Genel' },
  { key: 'roller', label: 'Roller & Ekipler' },
  { key: 'kaza', label: 'Kaza / Ramak Kala' },
  { key: 'belgeler', label: 'Belgeler' },
  { key: 'kurul', label: 'İSG Kurulu' },
  { key: 'ekipman', label: 'Ekipman' },
];

function formatDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('tr-TR');
}
function formatDateTime(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString('tr-TR');
}
function toInputDate(value) {
  if (!value) return '';
  return new Date(value).toISOString().slice(0, 10);
}

/** Tek bir dosya (görsel veya PDF) seçip R2'ye presigned URL ile yükler, elde edilen key'i döner. */
function SingleFileUploader({ onUploaded, label = 'Dosya Yükle (Fotoğraf/PDF)' }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const [fileName, setFileName] = useState(null);

  async function handleFile(file) {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const { data } = await apiClient.post('/uploads/presign-upload', { fileName: file.name, contentType: file.type });
      const putRes = await fetch(data.uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
      if (!putRes.ok) throw new Error(`"${file.name}" yüklenemedi.`);
      setFileName(file.name);
      onUploaded(data.key, file.name);
    } catch (err) {
      setError(err.message || 'Dosya yüklenirken hata oluştu.');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-slate-700">{label}</label>
      <label className="flex min-h-[48px] cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 px-4 py-3 text-sm font-medium text-slate-600 transition hover:border-brand-400 hover:bg-brand-50">
        {uploading ? 'Yükleniyor...' : fileName ? `✓ ${fileName}` : '📎 Dosya Seç'}
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf"
          className="hidden"
          disabled={uploading}
          onChange={(e) => {
            handleFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </label>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

export function CompanyDetailPage() {
  const { id } = useParams();
  const { hasPermission } = useAuth();
  const [detail, setDetail] = useState(null);
  const [employees, setEmployees] = useState([]);
  const [equipmentList, setEquipmentList] = useState(null);
  const [projectBlocks, setProjectBlocks] = useState([]);
  const [roleTypes, setRoleTypes] = useState([]);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [tab, setTab] = useState('genel');

  async function loadDetail() {
    try {
      const { data } = await apiClient.get(`/admin/companies/${id}`);
      setDetail(data);
      const empRes = await apiClient.get('/employees', { params: { projectId: data.company.projectId, companyId: id, status: 'active' } });
      setEmployees(empRes.data.employees);
      const blocksRes = await apiClient.get(`/admin/projects/${data.company.projectId}/blocks`);
      setProjectBlocks(blocksRes.data.blocks);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  async function loadEquipment() {
    try {
      const { data } = await apiClient.get('/admin/equipment', { params: { companyId: id } });
      setEquipmentList(data.equipment);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  useEffect(() => {
    loadDetail();
    loadEquipment();
    apiClient
      .get('/admin/company-role-types')
      .then(({ data }) => setRoleTypes(data.roleTypes))
      .catch(() => setRoleTypes([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (error && !detail) return <Alert>{error}</Alert>;
  if (!detail) return <p className="text-sm text-slate-500">Yükleniyor...</p>;

  const { company, blocks, roleAssignments, incidents, documents, boardMeetings, boardStatus, equipmentCount, mykStats, penalties } = detail;
  // Normalde firma düzenleme 'firma_yonetme' gerektirir. Ancak geçici görevlendirme firmaları
  // (company.isTemporaryAssignment=true) için 'gecici_gorevlendirme_yonetimi' yetkisi de yeterlidir
  // - backend (companies.routes.js / company-roles.routes.js) aynı dallanmayı zaten uyguluyor,
  // buradaki canManage de ona uygun hesaplanmalı, aksi halde bu yetkiye sahip kullanıcılar
  // firma detayında hiçbir şeyi düzenleyemez/rol atayamaz.
  const canManage = hasPermission('firma_yonetme') || (company.isTemporaryAssignment && hasPermission('gecici_gorevlendirme_yonetimi'));

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link to="/admin/firmalar" className="text-xs text-brand-700 hover:underline">
            ← Firmalar
          </Link>
          <h1 className="mt-1 text-2xl font-bold text-slate-800">{company.name}</h1>
          <p className="flex flex-wrap items-center gap-1.5 text-sm text-slate-500">
            <span>{COMPANY_TYPE_LABELS[company.type]}</span>
            {company.isTemporaryAssignment && <Badge variant="warning">🕐 Geçici Görevlendirme</Badge>}
            {!company.isActive && <Badge variant="danger">Pasif</Badge>}
          </p>
        </div>
      </div>

      {error && <Alert>{error}</Alert>}
      {notice && <Alert variant="success">{notice}</Alert>}

      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0 sm:flex-wrap">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`shrink-0 whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium transition ${
              tab === t.key ? 'bg-brand-700 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'genel' && (
        <GenelTab
          company={company}
          blocks={blocks}
          projectBlocks={projectBlocks}
          mykStats={mykStats}
          penalties={penalties}
          incidents={incidents}
          equipmentCount={equipmentCount}
          canManage={canManage}
          onUpdated={(c) => setDetail((d) => ({ ...d, company: c }))}
          onBlocksUpdated={(newBlocks) => setDetail((d) => ({ ...d, blocks: newBlocks }))}
          setError={setError}
          setNotice={setNotice}
        />
      )}
      {tab === 'roller' && (
        <RollerTab
          companyId={id}
          roles={roleAssignments}
          employees={employees}
          roleTypes={roleTypes}
          canManage={canManage}
          onChange={loadDetail}
          setError={setError}
          setNotice={setNotice}
        />
      )}
      {tab === 'kaza' && (
        <KazaTab companyId={id} incidents={incidents.recent} employees={employees} onChange={loadDetail} setError={setError} setNotice={setNotice} />
      )}
      {tab === 'belgeler' && (
        <BelgelerTab companyId={id} documents={documents} onChange={loadDetail} setError={setError} setNotice={setNotice} />
      )}
      {tab === 'kurul' && (
        <KurulTab companyId={id} meetings={boardMeetings} boardStatus={boardStatus} dangerClass={company.dangerClass} onChange={loadDetail} setError={setError} setNotice={setNotice} />
      )}
      {tab === 'ekipman' && (
        <EkipmanTab projectId={company.projectId} companyId={id} equipment={equipmentList} employees={employees} onChange={loadEquipment} setError={setError} setNotice={setNotice} />
      )}
    </div>
  );
}

function StatCard({ label, value, tone = 'default' }) {
  const tones = {
    default: 'bg-slate-50 text-slate-700',
    warning: 'bg-amber-50 text-amber-800',
    danger: 'bg-red-50 text-red-700',
    success: 'bg-emerald-50 text-emerald-700',
  };
  return (
    <div className={`rounded-xl p-4 ${tones[tone]}`}>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs">{label}</div>
    </div>
  );
}

function GenelTab({ company, blocks, projectBlocks, mykStats, penalties, incidents, equipmentCount, canManage, onUpdated, onBlocksUpdated, setError, setNotice }) {
  const [form, setForm] = useState({
    name: company.name || '',
    taxNumber: company.taxNumber || '',
    sgkNumber: company.sgkNumber || '',
    phone: company.phone || '',
    scopeOfWork: company.scopeOfWork || '',
    requiresBoard: company.requiresBoard,
    dangerClass: company.dangerClass || '',
  });
  const [saving, setSaving] = useState(false);
  const [blockIds, setBlockIds] = useState((blocks || []).map((b) => b.id));
  const [savingBlocks, setSavingBlocks] = useState(false);

  function toggleBlock(blockId) {
    setBlockIds((prev) => (prev.includes(blockId) ? prev.filter((id) => id !== blockId) : [...prev, blockId]));
  }

  async function handleSaveBlocks() {
    setSavingBlocks(true);
    setError(null);
    try {
      const { data } = await apiClient.patch(`/admin/companies/${company.id}`, { blockIds });
      if (data.queued) {
        setNotice('Bölge değişikliği admin onayına gönderildi. Admin onaylarsa uygulanacak.');
      } else {
        onBlocksUpdated((projectBlocks || []).filter((b) => blockIds.includes(b.id)));
        onUpdated(data.company);
        setNotice('Sorumlu bölgeler güncellendi.');
      }
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSavingBlocks(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const { data } = await apiClient.patch(`/admin/companies/${company.id}`, {
        name: form.name,
        taxNumber: form.taxNumber || null,
        sgkNumber: form.sgkNumber || null,
        phone: form.phone || null,
        scopeOfWork: form.scopeOfWork || null,
        requiresBoard: form.requiresBoard,
        dangerClass: form.dangerClass || null,
      });
      if (data.queued) {
        setNotice('Firma düzenlemesi admin onayına gönderildi. Admin onaylarsa uygulanacak.');
      } else {
        onUpdated(data.company);
        setNotice('Firma bilgileri güncellendi.');
      }
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleArchiveToggle() {
    setError(null);
    setNotice(null);
    try {
      if (company.isActive) {
        const { data } = await apiClient.delete(`/admin/companies/${company.id}`);
        if (data.queued) setNotice('Firmanın pasife alınması admin onayına gönderildi.');
        else {
          onUpdated({ ...company, isActive: false });
          setNotice('Firma pasife alındı.');
        }
      } else {
        const { data } = await apiClient.patch(`/admin/companies/${company.id}`, { isActive: true });
        if (data.queued) setNotice('Firmanın yeniden aktifleştirilmesi admin onayına gönderildi.');
        else {
          onUpdated(data.company);
          setNotice('Firma yeniden aktifleştirildi.');
        }
      }
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  const mykRatio = mykStats.total > 0 ? `${mykStats.withCertificate}/${mykStats.total}` : '0/0';

  return (
    <div className="space-y-4">
      {!company.isActive && <Alert variant="warning">Bu firma pasif durumda.</Alert>}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="MYK Belgeli Çalışan" value={mykRatio} tone={mykStats.withCertificate > 0 ? 'success' : 'default'} />
        <StatCard label="Kaza" value={incidents.counts.kazaCount} tone={incidents.counts.kazaCount > 0 ? 'danger' : 'default'} />
        <StatCard label="Ramak Kala" value={incidents.counts.ramakKalaCount} tone={incidents.counts.ramakKalaCount > 0 ? 'warning' : 'default'} />
        <StatCard label="Ekipman" value={equipmentCount} />
      </div>

      <Card>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-semibold text-slate-800">Firma Bilgileri</h3>
          {canManage && (
            <button
              type="button"
              onClick={handleArchiveToggle}
              className={`text-xs font-medium ${company.isActive ? 'text-red-600 hover:underline' : 'text-emerald-700 hover:underline'}`}
            >
              {company.isActive ? 'Firmayı Pasife Al (Sil)' : 'Firmayı Yeniden Aktifleştir'}
            </button>
          )}
        </div>
        {canManage ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input label="Firma Adı" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            <Input label="Telefon" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
            <Input label="Vergi Numarası" value={form.taxNumber} onChange={(e) => setForm((f) => ({ ...f, taxNumber: e.target.value }))} />
            <Input label="SGK Sicil Numarası" value={form.sgkNumber} onChange={(e) => setForm((f) => ({ ...f, sgkNumber: e.target.value }))} />
            <Input label="Sahada Yaptığı İş / İş Kolu" value={form.scopeOfWork} onChange={(e) => setForm((f) => ({ ...f, scopeOfWork: e.target.value }))} />
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
            <div><span className="text-slate-500">Telefon:</span> {company.phone || '-'}</div>
            <div><span className="text-slate-500">Vergi No:</span> {company.taxNumber || '-'}</div>
            <div><span className="text-slate-500">SGK No:</span> {company.sgkNumber || '-'}</div>
            <div><span className="text-slate-500">İş Kolu:</span> {company.scopeOfWork || '-'}</div>
          </div>
        )}
      </Card>

      <Card>
        <h3 className="mb-3 font-semibold text-slate-800">Sorumlu Olduğu Bölgeler</h3>
        {!projectBlocks || projectBlocks.length === 0 ? (
          <p className="text-sm text-slate-500">Bu projede henüz bölge/blok tanımlanmamış - firma varsayılan olarak tüm proje kapsamında sorumlu sayılır.</p>
        ) : canManage ? (
          <div className="space-y-3">
            <p className="text-xs text-slate-500">Hiçbiri seçilmezse firma "Tüm Bölgeler"den sorumlu sayılır.</p>
            <div className="flex flex-wrap gap-2">
              {projectBlocks.map((b) => {
                const selected = blockIds.includes(b.id);
                return (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => toggleBlock(b.id)}
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
            <Button variant="secondary" onClick={handleSaveBlocks} disabled={savingBlocks}>
              {savingBlocks ? 'Kaydediliyor...' : 'Bölgeleri Kaydet'}
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {blocks && blocks.length > 0 ? (
              blocks.map((b) => (
                <Badge key={b.id} variant="default">
                  📍 {b.name}
                </Badge>
              ))
            ) : (
              <Badge variant="default">📍 Tüm Bölgeler</Badge>
            )}
          </div>
        )}
      </Card>

      <Card>
        <h3 className="mb-3 font-semibold text-slate-800">Ceza Durumu</h3>
        <div className="mb-3 flex flex-wrap gap-2">
          <Badge variant="warning">Onay Bekliyor – {penalties.counts.pending}</Badge>
          <Badge variant="success">Onaylandı – {penalties.counts.approved}</Badge>
          <Badge variant="danger">Reddedildi – {penalties.counts.rejected}</Badge>
        </div>
        <div className="space-y-2">
          {penalties.recent.length === 0 && <p className="text-sm text-slate-500">Ceza kaydı yok.</p>}
          {penalties.recent.map((p) => (
            <div key={p.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
              <div>
                <span className="font-medium text-slate-800">{p.employeeFullName}</span>
                <span className="ml-2 text-slate-500">{p.reason}</span>
              </div>
              <Badge variant={PENALTY_STATUS_VARIANT[p.status]}>{PENALTY_STATUS_LABELS[p.status]}</Badge>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <h3 className="mb-3 font-semibold text-slate-800">Tehlike Sınıfı ve İSG Kurulu</h3>
        <div className="space-y-3">
          <Select label="Tehlike Sınıfı" value={form.dangerClass} disabled={!canManage} onChange={(e) => setForm((f) => ({ ...f, dangerClass: e.target.value }))}>
            <option value="">Seçilmedi</option>
            {Object.entries(DANGER_CLASS_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
          <p className="text-xs text-slate-500">
            Tehlike sınıfı, İSG kurulu zorunluluğundan bağımsız olarak, eğitim/tetkik/Ek-2 süresi dolma bildirimlerinin doğru hesaplanabilmesi için de kullanılır.
          </p>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              disabled={!canManage}
              checked={form.requiresBoard}
              onChange={(e) => setForm((f) => ({ ...f, requiresBoard: e.target.checked }))}
            />
            Bu firma için İSG kurulu kurulması gerekiyor
          </label>
          {canManage && (
            <Button onClick={handleSave} disabled={saving}>
              {saving ? 'Kaydediliyor...' : 'Kaydet'}
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}

const EMPTY_ROLE_FORM = {
  roleType: '',
  source: 'CALISAN',
  employeeId: '',
  outsideFullName: '',
  outsideCompanyName: '',
  outsideNationalId: '',
  outsidePhone: '',
  certificateNo: '',
  certificateClass: '',
  certificateStartDate: '',
  certificateEndDate: '',
};

const ISG_UZMANI_CLASSES = ['A Sınıfı', 'B Sınıfı', 'C Sınıfı'];

function RollerTab({ companyId, roles, employees, roleTypes, canManage, onChange, setError, setNotice }) {
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const roleLabel = (key) => roleTypes.find((rt) => rt.key === key)?.label || key;
  const firmaRolleri = roleTypes.filter((rt) => rt.category === 'FIRMA_ROLU');
  const acilEkipleri = roleTypes.filter((rt) => rt.category === 'ACIL_EKIP');
  const [form, setForm] = useState(EMPTY_ROLE_FORM);
  const [submitting, setSubmitting] = useState(false);

  // Rol kataloğu yüklenince (veya değişince), formdaki seçili rolün hâlâ geçerli olduğundan
  // emin ol; değilse ilk seçeneğe düş - Görevler sayfasından yeni bir rol eklenip silinmiş
  // olabileceği için bu form aynı sekmede uzun süre açık kalırsa da tutarlı kalır.
  useEffect(() => {
    if (roleTypes.length === 0 || editingId) return;
    if (!roleTypes.some((rt) => rt.key === form.roleType)) {
      setForm((f) => ({ ...f, roleType: roleTypes[0].key }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roleTypes]);

  function openAddForm() {
    setEditingId(null);
    setForm({ ...EMPTY_ROLE_FORM, roleType: roleTypes[0]?.key || '' });
    setShowForm(true);
  }

  function openEditForm(r) {
    setEditingId(r.id);
    setForm({
      roleType: r.roleType,
      source: r.source,
      employeeId: r.employeeId || '',
      outsideFullName: r.outsideFullName || '',
      outsideCompanyName: r.outsideCompanyName || '',
      outsideNationalId: r.outsideNationalId || '',
      outsidePhone: r.outsidePhone || '',
      certificateNo: r.certificateNo || '',
      certificateClass: r.certificateClass || '',
      certificateStartDate: r.certificateStartDate ? toInputDate(r.certificateStartDate) : '',
      certificateEndDate: r.certificateEndDate ? toInputDate(r.certificateEndDate) : '',
    });
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditingId(null);
    setForm(EMPTY_ROLE_FORM);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      if (editingId) {
        await apiClient.patch(`/admin/company-roles/${editingId}`, {
          outsideFullName: form.outsideFullName,
          outsideCompanyName: form.outsideCompanyName,
          outsideNationalId: form.outsideNationalId,
          outsidePhone: form.outsidePhone,
          certificateNo: form.certificateNo,
          certificateClass: form.certificateClass,
          certificateStartDate: form.certificateStartDate,
          certificateEndDate: form.certificateEndDate,
        });
        setNotice('Rol kaydı güncellendi.');
      } else {
        await apiClient.post('/admin/company-roles', { companyId, ...form });
        setNotice('Rol eklendi.');
      }
      closeForm();
      onChange();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(roleId) {
    if (!window.confirm('Bu rol kaydı silinsin mi?')) return;
    try {
      await apiClient.delete(`/admin/company-roles/${roleId}`);
      onChange();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  // Görevden ayrılan bir uzman/hekim/DSP için hızlıca "bugün itibarıyla çıkış" işaretlemek üzere -
  // kayıt silinmez (geçmişte kalır), sadece bitiş tarihi girilir; ardından "+ Rol Ekle" ile yeni
  // gelen kişi için taze bir kayıt açılabilir (bkz. kullanıcı isteği: "yeni gelen uzman için
  // yeniden bu işlemin yapılması lazım").
  async function handleQuickExit(r) {
    const today = new Date().toISOString().slice(0, 10);
    if (!window.confirm(`${roleLabel(r.roleType)} - ${r.source === 'CALISAN' ? r.employeeFullName : r.outsideFullName} için bugünün tarihiyle (${formatDate(today)}) çıkış işlensin mi?`)) return;
    try {
      await apiClient.patch(`/admin/company-roles/${r.id}`, { certificateEndDate: today });
      setNotice('Çıkış tarihi girildi.');
      onChange();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  function RoleGroup({ title, types }) {
    const typeKeys = new Set(types.map((t) => t.key));
    const rows = roles.filter((r) => typeKeys.has(r.roleType));
    const now = new Date();
    return (
      <Card>
        <h3 className="mb-3 font-semibold text-slate-800">{title}</h3>
        {rows.length === 0 && <p className="text-sm text-slate-500">Henüz kayıt yok.</p>}
        <div className="space-y-2">
          {rows.map((r) => {
            const isPast = r.certificateEndDate && new Date(r.certificateEndDate) < now;
            return (
              <div key={r.id} className={`rounded-lg px-3 py-2 text-sm ${isPast ? 'bg-slate-50 opacity-70' : 'bg-slate-50'}`}>
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <Badge variant="purple">{roleLabel(r.roleType)}</Badge>
                    {isPast && <Badge variant="default">Pasif</Badge>}
                    <span className="ml-2 font-medium text-slate-800">
                      {r.source === 'CALISAN' ? r.employeeFullName : r.outsideFullName}
                    </span>
                    {r.source === 'DISARIDAN' && r.outsideCompanyName && (
                      <span className="ml-1 text-xs text-slate-500">({r.outsideCompanyName})</span>
                    )}
                  </div>
                  {canManage && (
                    <div className="flex shrink-0 gap-2 text-xs">
                      {!r.certificateEndDate && (
                        <button onClick={() => handleQuickExit(r)} className="text-amber-700 hover:underline">
                          Çıkış Ver
                        </button>
                      )}
                      <button onClick={() => openEditForm(r)} className="text-brand-700 hover:underline">
                        Düzenle
                      </button>
                      <button onClick={() => handleDelete(r.id)} className="text-red-600 hover:underline">
                        Sil
                      </button>
                    </div>
                  )}
                </div>
                {(r.certificateNo || r.certificateClass || r.certificateStartDate) && (
                  <div className="mt-1 text-xs text-slate-500">
                    {r.certificateNo && <>Belge No: {r.certificateNo} · </>}
                    {r.certificateClass && <>{r.certificateClass} · </>}
                    {r.certificateStartDate && <>{formatDate(r.certificateStartDate)} - {r.certificateEndDate ? formatDate(r.certificateEndDate) : 'Aktif'}</>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <RoleGroup title="Firma Rolleri" types={firmaRolleri} />
      <RoleGroup title="Acil Durum Ekipleri" types={acilEkipleri} />

      {!canManage ? null : !showForm ? (
        <Button variant="secondary" onClick={openAddForm}>
          + Rol Ekle
        </Button>
      ) : (
        <Card>
          <form onSubmit={handleSubmit} className="space-y-3">
            <h4 className="font-medium text-slate-800">{editingId ? 'Rol Kaydını Düzenle' : 'Yeni Rol Ekle'}</h4>
            <Select label="Rol" value={form.roleType} disabled={!!editingId} onChange={(e) => setForm((f) => ({ ...f, roleType: e.target.value }))}>
              <optgroup label="Firma Rolleri">
                {firmaRolleri.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.label}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Acil Durum Ekipleri">
                {acilEkipleri.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.label}
                  </option>
                ))}
              </optgroup>
            </Select>
            {editingId ? (
              <p className="text-xs text-slate-500">
                {form.source === 'CALISAN' ? employees.find((e) => e.id === form.employeeId)?.fullName || 'Firma çalışanı' : form.outsideFullName}
              </p>
            ) : (
              <>
                <Select label="Kaynak" value={form.source} onChange={(e) => setForm((f) => ({ ...f, source: e.target.value }))}>
                  <option value="CALISAN">Firma çalışanlarından</option>
                  <option value="DISARIDAN">Dışarıdan (OSGB vb.)</option>
                </Select>
                {form.source === 'CALISAN' ? (
                  <div className="space-y-1.5">
                    <span className="mb-1.5 block text-sm font-medium text-slate-700">Çalışan</span>
                    <EmployeeCombobox employees={employees} value={form.employeeId} onChange={(id) => setForm((f) => ({ ...f, employeeId: id }))} />
                  </div>
                ) : (
                  <Input label="Ad Soyad" value={form.outsideFullName} onChange={(e) => setForm((f) => ({ ...f, outsideFullName: e.target.value }))} />
                )}
              </>
            )}
            {(editingId ? form.source === 'DISARIDAN' : form.source === 'DISARIDAN') && (
              <>
                <Input label="Firma (ör. OSGB adı)" value={form.outsideCompanyName} onChange={(e) => setForm((f) => ({ ...f, outsideCompanyName: e.target.value }))} />
                <div className="grid grid-cols-2 gap-3">
                  <Input label="T.C. Kimlik No" value={form.outsideNationalId} onChange={(e) => setForm((f) => ({ ...f, outsideNationalId: e.target.value }))} />
                  <Input label="Telefon" value={form.outsidePhone} onChange={(e) => setForm((f) => ({ ...f, outsidePhone: e.target.value }))} />
                </div>
              </>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Input label="Sertifika/Belge No" value={form.certificateNo} onChange={(e) => setForm((f) => ({ ...f, certificateNo: e.target.value }))} />
              {form.roleType === 'ISG_UZMANI' ? (
                <Select label="Sınıf" value={form.certificateClass} onChange={(e) => setForm((f) => ({ ...f, certificateClass: e.target.value }))}>
                  <option value="">Seçilmedi</option>
                  {ISG_UZMANI_CLASSES.map((cls) => (
                    <option key={cls} value={cls}>
                      {cls}
                    </option>
                  ))}
                </Select>
              ) : (
                <Input label="Sınıf (varsa)" value={form.certificateClass} onChange={(e) => setForm((f) => ({ ...f, certificateClass: e.target.value }))} />
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input label="Atama/Başlangıç Tarihi" type="date" value={form.certificateStartDate} onChange={(e) => setForm((f) => ({ ...f, certificateStartDate: e.target.value }))} />
              <Input label="Çıkış Tarihi (varsa)" type="date" value={form.certificateEndDate} onChange={(e) => setForm((f) => ({ ...f, certificateEndDate: e.target.value }))} />
            </div>
            <div className="flex gap-2">
              <Button type="submit" disabled={submitting}>
                {submitting ? 'Kaydediliyor...' : editingId ? 'Güncelle' : 'Ekle'}
              </Button>
              <Button type="button" variant="secondary" onClick={closeForm}>
                Vazgeç
              </Button>
            </div>
          </form>
        </Card>
      )}
    </div>
  );
}

function KazaTab({ companyId, incidents, employees, onChange, setError, setNotice }) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    type: 'KAZA',
    eventDateTime: '',
    employeeId: '',
    eventDescription: '',
    location: '',
    cause: '',
    witnessEmployeeId: '',
    witnessStatement: '',
    referredToHospital: false,
    hospitalName: '',
    firstAidGiven: false,
    firstAidGivenBy: '',
    victimProfession: '',
    doctorReportPhotoKey: '',
    reportDaysOff: '',
    returnToWorkDate: '',
    actionsTaken: '',
  });
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.eventDateTime || !form.eventDescription) {
      setError('Olay tarihi ve olay şekli açıklaması zorunludur.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await apiClient.post('/admin/incidents', {
        companyId,
        ...form,
        eventDateTime: new Date(form.eventDateTime).toISOString(),
        returnToWorkDate: form.returnToWorkDate ? new Date(form.returnToWorkDate).toISOString() : null,
        reportDaysOff: form.reportDaysOff ? Number(form.reportDaysOff) : null,
        employeeId: form.employeeId || null,
        witnessEmployeeId: form.witnessEmployeeId || null,
      });
      setShowForm(false);
      setNotice('Kayıt eklendi.');
      onChange();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {incidents.length === 0 && <p className="text-sm text-slate-500">Kaza/ramak kala kaydı yok.</p>}
        {incidents.map((inc) => (
          <Card key={inc.id}>
            <div className="flex items-center gap-2">
              <Badge variant={inc.type === 'KAZA' ? 'danger' : 'warning'}>{INCIDENT_TYPE_LABELS[inc.type]}</Badge>
              <span className="text-xs text-slate-500">{formatDateTime(inc.eventDateTime)}</span>
            </div>
            <p className="mt-1 text-sm text-slate-700">{inc.eventDescription}</p>
            {inc.employeeFullName && <p className="mt-1 text-xs text-slate-500">Çalışan: {inc.employeeFullName}</p>}
            {inc.reportDaysOff != null && <p className="text-xs text-slate-500">Rapor: {inc.reportDaysOff} gün</p>}
          </Card>
        ))}
      </div>

      {!showForm ? (
        <Button variant="secondary" onClick={() => setShowForm(true)}>
          + Kaza / Ramak Kala Ekle
        </Button>
      ) : (
        <Card>
          <form onSubmit={handleSubmit} className="space-y-3">
            <Select label="Tür" value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}>
              <option value="KAZA">Kaza</option>
              <option value="RAMAK_KALA">Ramak Kala</option>
            </Select>
            <Input label="Olay Tarihi/Saati" type="datetime-local" value={form.eventDateTime} onChange={(e) => setForm((f) => ({ ...f, eventDateTime: e.target.value }))} required />
            <Textarea label="Olay Şekli" value={form.eventDescription} onChange={(e) => setForm((f) => ({ ...f, eventDescription: e.target.value }))} required />
            <Input label="Olay Yeri" value={form.location} onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))} />
            <Textarea label="Sebebi" value={form.cause} onChange={(e) => setForm((f) => ({ ...f, cause: e.target.value }))} />
            {form.type === 'KAZA' && (
              <>
                <div className="space-y-1.5">
                  <span className="mb-1.5 block text-sm font-medium text-slate-700">Kazayı Geçiren Çalışan</span>
                  <EmployeeCombobox employees={employees} value={form.employeeId} onChange={(id) => setForm((f) => ({ ...f, employeeId: id }))} />
                </div>
                <Input label="Kazazedenin Mesleği" value={form.victimProfession} onChange={(e) => setForm((f) => ({ ...f, victimProfession: e.target.value }))} />
              </>
            )}
            <div className="space-y-1.5">
              <span className="mb-1.5 block text-sm font-medium text-slate-700">Görgü Tanığı</span>
              <EmployeeCombobox
                employees={employees}
                value={form.witnessEmployeeId}
                onChange={(id) => setForm((f) => ({ ...f, witnessEmployeeId: id }))}
                placeholder="Yok - isim veya TC no yazarak arayın..."
              />
            </div>
            {form.witnessEmployeeId && (
              <Textarea label="Görgü Tanığı İfadesi" value={form.witnessStatement} onChange={(e) => setForm((f) => ({ ...f, witnessStatement: e.target.value }))} />
            )}
            {form.type === 'KAZA' && (
              <>
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" checked={form.referredToHospital} onChange={(e) => setForm((f) => ({ ...f, referredToHospital: e.target.checked }))} />
                  Hastaneye sevk edildi
                </label>
                {form.referredToHospital && (
                  <Input label="Sevk Edilen Hastane" value={form.hospitalName} onChange={(e) => setForm((f) => ({ ...f, hospitalName: e.target.value }))} />
                )}
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" checked={form.firstAidGiven} onChange={(e) => setForm((f) => ({ ...f, firstAidGiven: e.target.checked }))} />
                  İlk yardım müdahalesi yapıldı
                </label>
                {form.firstAidGiven && (
                  <Input label="Kim Tarafından Yapıldı" value={form.firstAidGivenBy} onChange={(e) => setForm((f) => ({ ...f, firstAidGivenBy: e.target.value }))} />
                )}
                <SingleFileUploader label="Doktor Raporu (Görsel/PDF)" onUploaded={(key) => setForm((f) => ({ ...f, doctorReportPhotoKey: key }))} />
                <div className="grid grid-cols-2 gap-3">
                  <Input label="Rapor (Gün)" type="number" min="0" value={form.reportDaysOff} onChange={(e) => setForm((f) => ({ ...f, reportDaysOff: e.target.value }))} />
                  <Input label="İşe Başlama Tarihi" type="date" value={form.returnToWorkDate} onChange={(e) => setForm((f) => ({ ...f, returnToWorkDate: e.target.value }))} />
                </div>
              </>
            )}
            <Textarea label="Alınan Aksiyon" value={form.actionsTaken} onChange={(e) => setForm((f) => ({ ...f, actionsTaken: e.target.value }))} />
            <div className="flex gap-2">
              <Button type="submit" disabled={submitting}>
                {submitting ? 'Ekleniyor...' : 'Kaydet'}
              </Button>
              <Button type="button" variant="secondary" onClick={() => setShowForm(false)}>
                Vazgeç
              </Button>
            </div>
          </form>
        </Card>
      )}
    </div>
  );
}

function BelgelerTab({ companyId, documents, onChange, setError, setNotice }) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ docType: 'RISK_ANALIZI', preparedDate: '', approved: false, approvedDate: '', validUntil: '', fileObjectKey: '', notes: '' });
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await apiClient.post('/admin/company-documents', {
        companyId,
        ...form,
        preparedDate: form.preparedDate ? new Date(form.preparedDate).toISOString() : null,
        approvedDate: form.approvedDate ? new Date(form.approvedDate).toISOString() : null,
        validUntil: form.validUntil ? new Date(form.validUntil).toISOString() : null,
      });
      setShowForm(false);
      setNotice('Belge eklendi.');
      onChange();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(docId) {
    if (!window.confirm('Bu belge silinsin mi?')) return;
    try {
      await apiClient.delete(`/admin/company-documents/${docId}`);
      onChange();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {documents.length === 0 && <p className="text-sm text-slate-500">Belge kaydı yok.</p>}
        {documents.map((d) => (
          <Card key={d.id}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Badge variant="purple">{DOC_TYPE_LABELS[d.docType]}</Badge>
                <Badge variant={d.approved ? 'success' : 'warning'}>{d.approved ? 'Onaylı' : 'Onay Bekliyor'}</Badge>
              </div>
              <button onClick={() => handleDelete(d.id)} className="text-xs text-red-600 hover:underline">
                Sil
              </button>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Hazırlanma: {formatDate(d.preparedDate)} · Geçerlilik: {formatDate(d.validUntil)}
            </p>
            {d.fileViewUrl && (
              <a href={d.fileViewUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs text-brand-700 hover:underline">
                Dosyayı görüntüle
              </a>
            )}
          </Card>
        ))}
      </div>

      {!showForm ? (
        <Button variant="secondary" onClick={() => setShowForm(true)}>
          + Belge Ekle
        </Button>
      ) : (
        <Card>
          <form onSubmit={handleSubmit} className="space-y-3">
            <Select label="Belge Türü" value={form.docType} onChange={(e) => setForm((f) => ({ ...f, docType: e.target.value }))}>
              {Object.entries(DOC_TYPE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
            <div className="grid grid-cols-2 gap-3">
              <Input label="Hazırlanma Tarihi" type="date" value={form.preparedDate} onChange={(e) => setForm((f) => ({ ...f, preparedDate: e.target.value }))} />
              <Input label="Geçerlilik Tarihi" type="date" value={form.validUntil} onChange={(e) => setForm((f) => ({ ...f, validUntil: e.target.value }))} />
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={form.approved} onChange={(e) => setForm((f) => ({ ...f, approved: e.target.checked }))} />
              Onaylandı
            </label>
            {form.approved && (
              <Input label="Onay Tarihi" type="date" value={form.approvedDate} onChange={(e) => setForm((f) => ({ ...f, approvedDate: e.target.value }))} />
            )}
            <SingleFileUploader onUploaded={(key) => setForm((f) => ({ ...f, fileObjectKey: key }))} />
            <Textarea label="Not" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
            <div className="flex gap-2">
              <Button type="submit" disabled={submitting}>
                {submitting ? 'Ekleniyor...' : 'Kaydet'}
              </Button>
              <Button type="button" variant="secondary" onClick={() => setShowForm(false)}>
                Vazgeç
              </Button>
            </div>
          </form>
        </Card>
      )}
    </div>
  );
}

function KurulTab({ companyId, meetings, boardStatus, dangerClass, onChange, setError, setNotice }) {
  const [showForm, setShowForm] = useState(false);
  const now = new Date();
  const defaultPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const [form, setForm] = useState({ meetingDate: '', periodLabel: defaultPeriod, isExtraordinary: false, attendanceFormFileKey: '', notes: '' });
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.meetingDate) {
      setError('Toplantı tarihi zorunludur.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await apiClient.post('/admin/board-meetings', { companyId, ...form, meetingDate: new Date(form.meetingDate).toISOString() });
      setShowForm(false);
      setNotice('Toplantı kaydedildi.');
      onChange();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(meetingId) {
    if (!window.confirm('Bu toplantı kaydı silinsin mi?')) return;
    try {
      await apiClient.delete(`/admin/board-meetings/${meetingId}`);
      onChange();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  return (
    <div className="space-y-4">
      {!dangerClass ? (
        <Alert variant="info">Kurul periyodu takibi için "Genel" sekmesinden tehlike sınıfı seçilmelidir.</Alert>
      ) : (
        <Card>
          <h3 className="mb-3 font-semibold text-slate-800">{now.getFullYear()} Dönem Durumu ({DANGER_CLASS_LABELS[dangerClass]})</h3>
          <div className="space-y-2">
            {boardStatus.map((b) => (
              <div key={b.label} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
                <span>{b.label}</span>
                <Badge variant={b.done ? 'success' : 'danger'}>{b.done ? 'Yapıldı' : 'Henüz Yapılmadı'}</Badge>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="space-y-2">
        {meetings.length === 0 && <p className="text-sm text-slate-500">Toplantı kaydı yok.</p>}
        {meetings.map((m) => (
          <Card key={m.id}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="font-medium text-slate-800">{formatDate(m.meetingDate)}</span>
                <Badge variant="default">{m.periodLabel}</Badge>
                {m.isExtraordinary && <Badge variant="orange">Olağanüstü</Badge>}
              </div>
              <button onClick={() => handleDelete(m.id)} className="text-xs text-red-600 hover:underline">
                Sil
              </button>
            </div>
            {m.notes && <p className="mt-1 text-sm text-slate-600">{m.notes}</p>}
            {m.attendanceFormViewUrl && (
              <a href={m.attendanceFormViewUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs text-brand-700 hover:underline">
                Katılım formunu görüntüle
              </a>
            )}
          </Card>
        ))}
      </div>

      {!showForm ? (
        <Button variant="secondary" onClick={() => setShowForm(true)}>
          + Toplantı Ekle
        </Button>
      ) : (
        <Card>
          <form onSubmit={handleSubmit} className="space-y-3">
            <Input label="Toplantı Tarihi" type="date" value={form.meetingDate} onChange={(e) => setForm((f) => ({ ...f, meetingDate: e.target.value }))} required />
            <Input label="Dönem (YYYY-MM)" value={form.periodLabel} onChange={(e) => setForm((f) => ({ ...f, periodLabel: e.target.value }))} required />
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={form.isExtraordinary} onChange={(e) => setForm((f) => ({ ...f, isExtraordinary: e.target.checked }))} />
              Olağanüstü toplantı
            </label>
            <SingleFileUploader label="İmzalı Katılım Formu (Görsel/PDF)" onUploaded={(key) => setForm((f) => ({ ...f, attendanceFormFileKey: key }))} />
            <Textarea label="Not" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
            <div className="flex gap-2">
              <Button type="submit" disabled={submitting}>
                {submitting ? 'Ekleniyor...' : 'Kaydet'}
              </Button>
              <Button type="button" variant="secondary" onClick={() => setShowForm(false)}>
                Vazgeç
              </Button>
            </div>
          </form>
        </Card>
      )}
    </div>
  );
}

function EkipmanTab({ projectId, companyId, equipment, employees, onChange, setError, setNotice }) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    name: '',
    serialNumber: '',
    licenseNumber: '',
    periodicInspectionDate: '',
    periodicInspectionValidUntil: '',
    hasDamage: false,
    damageDescription: '',
    fitForUse: true,
    assignedTo: 'FIRMA',
    assignedEmployeeId: '',
    operatorSource: 'YOK',
    operatorEmployeeId: '',
    operatorOutsideFullName: '',
    operatorOutsideCompanyName: '',
    operatorOutsideNationalId: '',
    operatorOutsideSgkNo: '',
    operatorCertificateNo: '',
  });
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.name) {
      setError('Ekipman adı zorunludur.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await apiClient.post('/admin/equipment', { projectId, companyId, ...form });
      setShowForm(false);
      setNotice('Ekipman eklendi.');
      onChange();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(equipmentId) {
    if (!window.confirm('Bu ekipman kaydı silinsin mi?')) return;
    try {
      await apiClient.delete(`/admin/equipment/${equipmentId}`);
      onChange();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {(!equipment || equipment.length === 0) && <p className="text-sm text-slate-500">Ekipman kaydı yok.</p>}
        {equipment?.map((eq) => (
          <Card key={eq.id}>
            <div className="flex items-center justify-between">
              <span className="font-medium text-slate-800">{eq.name}</span>
              <div className="flex items-center gap-2">
                <Badge variant={eq.fitForUse ? 'success' : 'danger'}>{eq.fitForUse ? 'Çalışmaya Uygun' : 'Uygun Değil'}</Badge>
                <button onClick={() => handleDelete(eq.id)} className="text-xs text-red-600 hover:underline">
                  Sil
                </button>
              </div>
            </div>
            <div className="mt-1 text-xs text-slate-500">
              {eq.serialNumber && <>Seri No: {eq.serialNumber} · </>}
              Periyodik Kontrol: {formatDate(eq.periodicInspectionDate)} → {formatDate(eq.periodicInspectionValidUntil)}
            </div>
            <div className="mt-1 text-xs text-slate-500">
              Zimmet: {eq.assignedTo === 'KISI' ? eq.assignedEmployeeName || '—' : 'Firma'} · Operatör:{' '}
              {eq.operatorSource === 'CALISAN' ? eq.operatorEmployeeId && employees.find((emp) => emp.id === eq.operatorEmployeeId)?.fullName : eq.operatorSource === 'DISARIDAN' ? `${eq.operatorOutsideFullName} (${eq.operatorOutsideCompanyName || 'Dışarıdan'})` : 'Yok'}
            </div>
            {eq.hasDamage && <p className="mt-1 text-xs text-red-600">Hasar/Eksiklik: {eq.damageDescription}</p>}
          </Card>
        ))}
      </div>

      {!showForm ? (
        <Button variant="secondary" onClick={() => setShowForm(true)}>
          + Ekipman Ekle
        </Button>
      ) : (
        <Card>
          <form onSubmit={handleSubmit} className="space-y-3">
            <Input label="Ekipman Adı/Tipi" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
            <div className="grid grid-cols-2 gap-3">
              <Input label="Seri No" value={form.serialNumber} onChange={(e) => setForm((f) => ({ ...f, serialNumber: e.target.value }))} />
              <Input label="Ruhsat No" value={form.licenseNumber} onChange={(e) => setForm((f) => ({ ...f, licenseNumber: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input label="Periyodik Kontrol Tarihi" type="date" value={form.periodicInspectionDate} onChange={(e) => setForm((f) => ({ ...f, periodicInspectionDate: e.target.value }))} />
              <Input label="Geçerlilik Tarihi" type="date" value={form.periodicInspectionValidUntil} onChange={(e) => setForm((f) => ({ ...f, periodicInspectionValidUntil: e.target.value }))} />
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={form.hasDamage} onChange={(e) => setForm((f) => ({ ...f, hasDamage: e.target.checked }))} />
              Hasar/eksiklik var
            </label>
            {form.hasDamage && (
              <Textarea label="Hasar/Eksiklik Açıklaması" value={form.damageDescription} onChange={(e) => setForm((f) => ({ ...f, damageDescription: e.target.value }))} />
            )}
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={form.fitForUse} onChange={(e) => setForm((f) => ({ ...f, fitForUse: e.target.checked }))} />
              Çalışmaya uygun
            </label>
            <Select label="Zimmet" value={form.assignedTo} onChange={(e) => setForm((f) => ({ ...f, assignedTo: e.target.value }))}>
              <option value="FIRMA">Firmaya zimmetli</option>
              <option value="KISI">Kişiye zimmetli</option>
            </Select>
            {form.assignedTo === 'KISI' && (
              <div className="space-y-1.5">
                <span className="mb-1.5 block text-sm font-medium text-slate-700">Zimmetli Kişi</span>
                <EmployeeCombobox
                  employees={employees}
                  value={form.assignedEmployeeId}
                  onChange={(id) => setForm((f) => ({ ...f, assignedEmployeeId: id }))}
                />
              </div>
            )}
            <Select label="Operatör" value={form.operatorSource} onChange={(e) => setForm((f) => ({ ...f, operatorSource: e.target.value }))}>
              <option value="YOK">Yok</option>
              <option value="CALISAN">Firma çalışanlarından</option>
              <option value="DISARIDAN">Dışarıdan</option>
            </Select>
            {form.operatorSource === 'CALISAN' && (
              <div className="space-y-1.5">
                <span className="mb-1.5 block text-sm font-medium text-slate-700">Operatör Çalışan</span>
                <EmployeeCombobox
                  employees={employees}
                  value={form.operatorEmployeeId}
                  onChange={(id) => setForm((f) => ({ ...f, operatorEmployeeId: id }))}
                />
              </div>
            )}
            {form.operatorSource === 'DISARIDAN' && (
              <>
                <Input label="Operatör Ad Soyad" value={form.operatorOutsideFullName} onChange={(e) => setForm((f) => ({ ...f, operatorOutsideFullName: e.target.value }))} />
                <Input label="Operatör Firması" value={form.operatorOutsideCompanyName} onChange={(e) => setForm((f) => ({ ...f, operatorOutsideCompanyName: e.target.value }))} />
                <div className="grid grid-cols-2 gap-3">
                  <Input label="T.C. Kimlik No" value={form.operatorOutsideNationalId} onChange={(e) => setForm((f) => ({ ...f, operatorOutsideNationalId: e.target.value }))} />
                  <Input label="SGK No" value={form.operatorOutsideSgkNo} onChange={(e) => setForm((f) => ({ ...f, operatorOutsideSgkNo: e.target.value }))} />
                </div>
              </>
            )}
            {form.operatorSource !== 'YOK' && (
              <Input label="Operatörlük Belge No" value={form.operatorCertificateNo} onChange={(e) => setForm((f) => ({ ...f, operatorCertificateNo: e.target.value }))} />
            )}
            <div className="flex gap-2">
              <Button type="submit" disabled={submitting}>
                {submitting ? 'Ekleniyor...' : 'Kaydet'}
              </Button>
              <Button type="button" variant="secondary" onClick={() => setShowForm(false)}>
                Vazgeç
              </Button>
            </div>
          </form>
        </Card>
      )}
    </div>
  );
}
