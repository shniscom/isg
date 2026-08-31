import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import apiClient, { getErrorMessage } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { Card, Button, Select, Alert, Badge } from '../../components/ui';
import { PERMISSION_DESCRIPTIONS, PERMISSION_CATEGORIES } from '../../lib/permissions';

// GET /admin/users/:id recordCounts alanındaki anahtarların Türkçe etiketleri - kayıt özeti ve
// kalıcı silme uygunluğu bu kayımlara göre belirlenir (bkz. backend getUserRecordCounts).
const RECORD_COUNT_LABELS = [
  ['opened', 'Açtığı uygunsuzluk'],
  ['assigned', 'Atandığı uygunsuzluk'],
  ['corrections', 'Gönderdiği/incelediği düzeltme'],
  ['photos', 'Yüklediği fotoğraf'],
  ['statusHistory', 'Durum değişikliği kaydı'],
  ['penalties', 'Ceza talebi/kararı'],
  ['dueDateExtensions', 'Termin uzatma talebi/kararı'],
  ['incidents', 'Kaza/ramak kala kaydı'],
  ['companyDocuments', 'Yüklediği firma belgesi'],
  ['boardMeetings', 'Oluşturduğu İSG kurul tutanağı'],
  ['equipment', 'Kaydettiği ekipman'],
  ['companyRoleAssignments', 'Yaptığı firma rolü ataması'],
  ['archives', 'Arşiv işlemi'],
  ['pendingApprovals', 'Onay talebi/kararı'],
];

export function UserDetailPage() {
  const { id } = useParams();
  const { user: authUser } = useAuth();
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [stats, setStats] = useState(null);
  const [recordCounts, setRecordCounts] = useState(null);
  const [canDelete, setCanDelete] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);
  const [deleteError, setDeleteError] = useState(null);
  const [assignments, setAssignments] = useState([]);
  const [permissions, setPermissions] = useState([]);
  const [projects, setProjects] = useState([]);
  const [roles, setRoles] = useState([]);
  const [allPermissions, setAllPermissions] = useState([]);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [invite, setInvite] = useState(null); // { url, whatsappUrl, expiresAt }
  const [inviteSubmitting, setInviteSubmitting] = useState(false);
  const [inviteCopied, setInviteCopied] = useState(false);

  const [assignProjectId, setAssignProjectId] = useState('');
  const [assignRoleId, setAssignRoleId] = useState('');
  const [assignCompanyIds, setAssignCompanyIds] = useState([]); // boş -> Tüm Proje (Ana Firma/Genel)
  const [projectCompanies, setProjectCompanies] = useState([]);
  const [assignBlockId, setAssignBlockId] = useState(''); // boş -> Tüm Bölgeler
  const [projectBlocks, setProjectBlocks] = useState([]);
  const [assignSubmitting, setAssignSubmitting] = useState(false);
  const [grantPermissionIds, setGrantPermissionIds] = useState([]);
  const [grantProjectId, setGrantProjectId] = useState('');
  const [grantSubmitting, setGrantSubmitting] = useState(false);

  // Kullanıcı silme yerine arşivleme (bkz. backend admin/users.routes.js archive-check/archive).
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveCheck, setArchiveCheck] = useState(null); // { linkedEmployee, openNonconformities }
  const [archiveCheckLoading, setArchiveCheckLoading] = useState(false);
  const [assignableUsersByProject, setAssignableUsersByProject] = useState({});
  const [reassignments, setReassignments] = useState({}); // { [nonconformityId]: newUserId }
  const [archiveEndDate, setArchiveEndDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [archiveSubmitting, setArchiveSubmitting] = useState(null); // null | 'EXIT' | 'ROLE_CHANGE'
  const [archiveError, setArchiveError] = useState(null);

  async function load() {
    try {
      const [userRes, projectsRes, rolesRes, permsRes] = await Promise.all([
        apiClient.get(`/admin/users/${id}`),
        apiClient.get('/admin/projects'),
        apiClient.get('/admin/roles'),
        apiClient.get('/admin/permissions'),
      ]);
      setUser(userRes.data.user);
      setStats(userRes.data.stats);
      setRecordCounts(userRes.data.recordCounts);
      setCanDelete(userRes.data.canDelete);
      setAssignments(userRes.data.assignments);
      setPermissions(userRes.data.permissions);
      setProjects(projectsRes.data.projects);
      setRoles(rolesRes.data.roles);
      setAllPermissions(permsRes.data.permissions);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    setAssignCompanyIds([]);
    setAssignBlockId('');
    if (!assignProjectId) {
      setProjectCompanies([]);
      setProjectBlocks([]);
      return;
    }
    apiClient
      .get('/admin/companies', { params: { projectId: assignProjectId } })
      // Pasif firmalar yeni atama yapılırken seçilebilir olmamalı (zaten yapılmış eski atamalar
      // ayrıca bkz. assignments listesi - onlar burada değil, "Mevcut Atamalar" bölümünde gösterilir).
      .then(({ data }) => setProjectCompanies((data.companies || []).filter((c) => c.isActive)))
      .catch(() => setProjectCompanies([]));
    apiClient
      .get(`/admin/projects/${assignProjectId}/blocks`)
      .then(({ data }) => setProjectBlocks(data.blocks))
      .catch(() => setProjectBlocks([]));
  }, [assignProjectId]);

  function toggleAssignCompany(companyId) {
    setAssignCompanyIds((prev) =>
      prev.includes(companyId) ? prev.filter((c) => c !== companyId) : [...prev, companyId]
    );
  }

  async function handleAssign(e) {
    e.preventDefault();
    if (!assignProjectId || !assignRoleId) return;
    setAssignSubmitting(true);
    setError(null);
    try {
      // Firma seçilmediyse tüm proje kapsamında (Ana Firma/Genel) tek atama yapılır;
      // birden fazla firma seçildiyse her firma için ayrı bir atama oluşturulur. Seçilen bölge
      // (varsa) bu toplu işlemdeki her atamaya aynı şekilde uygulanır.
      const companyIdsToAssign = assignCompanyIds.length > 0 ? assignCompanyIds : [null];
      const blockId = assignBlockId || null;
      const results = await Promise.allSettled(
        companyIdsToAssign.map((companyId) =>
          apiClient.post(`/admin/users/${id}/projects`, {
            projectId: assignProjectId,
            roleId: assignRoleId,
            companyId,
            blockId,
          })
        )
      );
      const realFailures = results.filter(
        (r) => r.status === 'rejected' && r.reason?.response?.status !== 409
      );
      if (realFailures.length > 0) {
        setError(getErrorMessage(realFailures[0].reason));
      }
      setAssignProjectId('');
      setAssignRoleId('');
      setAssignCompanyIds([]);
      setAssignBlockId('');
      await load();
    } finally {
      setAssignSubmitting(false);
    }
  }

  async function handleRemoveAssignment(assignmentId) {
    await apiClient.delete(`/admin/users/${id}/projects/${assignmentId}`);
    await load();
  }

  // Seçili kapsam (proje ya da genel) için kullanıcıya zaten verilmiş olan yetkiler,
  // "verilecek yetkiler" listesinden çıkarılır - aynı yetki iki kez verilemez/anlamsızdır.
  const currentScopeProjectId = grantProjectId || null;
  const alreadyGrantedPermissionIds = new Set(
    permissions.filter((p) => (p.projectId || null) === currentScopeProjectId).map((p) => p.permissionId)
  );
  const grantablePermissions = allPermissions.filter((p) => !alreadyGrantedPermissionIds.has(p.id));
  // Yetki listesi kategoriye göre gruplanır (Uygunsuzluk, İtiraz, İnsan Kaynakları vb.) - 19+
  // kalemlik düz bir liste içinde belirli bir yetkiyi (örn. "İnsan Kaynakları Yönetimi") bulmak
  // zorlaşıyordu.
  const categorizedKeys = new Set(PERMISSION_CATEGORIES.flatMap((cat) => cat.keys));
  const groupedGrantablePermissions = PERMISSION_CATEGORIES.map((cat) => ({
    ...cat,
    items: grantablePermissions.filter((p) => cat.keys.includes(p.key)),
  })).filter((g) => g.items.length > 0);
  const uncategorizedGrantablePermissions = grantablePermissions.filter((p) => !categorizedKeys.has(p.key));

  function toggleGrantPermission(permId) {
    setGrantPermissionIds((prev) =>
      prev.includes(permId) ? prev.filter((p) => p !== permId) : [...prev, permId]
    );
  }

  function toggleSelectAllPermissions() {
    setGrantPermissionIds((prev) =>
      prev.length === grantablePermissions.length ? [] : grantablePermissions.map((p) => p.id)
    );
  }

  async function handleGrantPermission(e) {
    e.preventDefault();
    if (grantPermissionIds.length === 0) return;
    setGrantSubmitting(true);
    setError(null);
    try {
      const results = await Promise.allSettled(
        grantPermissionIds.map((permissionId) =>
          apiClient.post(`/admin/users/${id}/permissions`, {
            permissionId,
            projectId: grantProjectId || null,
          })
        )
      );
      const realFailures = results.filter(
        (r) => r.status === 'rejected' && r.reason?.response?.status !== 409
      );
      if (realFailures.length > 0) {
        setError(getErrorMessage(realFailures[0].reason));
      }
      setGrantPermissionIds([]);
      await load();
    } finally {
      setGrantSubmitting(false);
    }
  }

  async function handleRevokePermission(permissionRowId) {
    await apiClient.delete(`/admin/users/${id}/permissions/${permissionRowId}`);
    await load();
  }

  async function handleResetPassword() {
    const { data } = await apiClient.post(`/admin/users/${id}/reset-password`);
    setNotice(`Yeni geçici şifre: ${data.tempPassword}`);
    await load();
  }

  async function handleCreateInvite() {
    setInviteSubmitting(true);
    setInviteCopied(false);
    try {
      const { data } = await apiClient.post(`/admin/users/${id}/invite-link`);
      const url = `${window.location.origin}/davet/${data.token}`;
      const message =
        `Merhaba ${data.fullName}, İSG Takip Sistemi hesabınız hazır.\n` +
        `Kullanıcı adınız: ${data.username}\n` +
        `Şifrenizi belirlemek için bu bağlantıya tıklayın: ${url}`;
      const whatsappUrl = data.whatsappPhone
        ? `https://wa.me/${data.whatsappPhone}?text=${encodeURIComponent(message)}`
        : `https://wa.me/?text=${encodeURIComponent(message)}`;
      setInvite({ url, whatsappUrl, expiresAt: data.expiresAt });
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setInviteSubmitting(false);
    }
  }

  async function handleCopyInviteLink() {
    if (!invite) return;
    try {
      await navigator.clipboard.writeText(invite.url);
      setInviteCopied(true);
      setTimeout(() => setInviteCopied(false), 2000);
    } catch {
      // Panoya erişim izni yoksa sessizce yok say; kullanıcı linki elle seçip kopyalayabilir.
    }
  }

  async function handleOpenArchive() {
    setArchiveOpen(true);
    setArchiveError(null);
    setArchiveCheckLoading(true);
    setReassignments({});
    try {
      const { data } = await apiClient.get(`/admin/users/${id}/archive-check`);
      setArchiveCheck(data);
      const projectIds = [...new Set(data.openNonconformities.map((n) => n.projectId))];
      const entries = await Promise.all(
        projectIds.map((pid) =>
          apiClient
            .get('/nonconformities/assignable-users', { params: { projectId: pid } })
            .then(({ data: d }) => [pid, d.users.filter((u) => u.userId !== id)])
            .catch(() => [pid, []])
        )
      );
      setAssignableUsersByProject(Object.fromEntries(entries));
    } catch (err) {
      setArchiveError(getErrorMessage(err));
    } finally {
      setArchiveCheckLoading(false);
    }
  }

  async function handleArchive(mode) {
    setArchiveSubmitting(mode);
    setArchiveError(null);
    try {
      const reassignmentList = Object.entries(reassignments)
        .filter(([, newAssigneeUserId]) => newAssigneeUserId)
        .map(([nonconformityId, newAssigneeUserId]) => ({ nonconformityId, newAssigneeUserId }));
      const payload = { mode, reassignments: reassignmentList };
      if (mode === 'EXIT') payload.endDate = archiveEndDate;
      const { data } = await apiClient.post(`/admin/users/${id}/archive`, payload);
      setArchiveOpen(false);
      const baseMessage = mode === 'EXIT' ? 'Kullanıcı ve bağlı çalışan kaydı çıkış olarak arşivlendi.' : 'Kullanıcı hesabı görev değişikliği nedeniyle arşivlendi.';
      const transferNote = data.autoTransferredCount > 0
        ? ` Elle devretmediğiniz ${data.autoTransferredCount} açık uygunsuzluk ataması otomatik olarak size devredildi; Uygunsuzluklar sekmesinden uygun gördüğünüz kişiye yeniden atayabilirsiniz.`
        : '';
      setNotice(baseMessage + transferNote);
      await load();
    } catch (err) {
      setArchiveError(getErrorMessage(err));
    } finally {
      setArchiveSubmitting(null);
    }
  }

  async function handleDelete() {
    setDeleteSubmitting(true);
    setDeleteError(null);
    try {
      await apiClient.delete(`/admin/users/${id}`);
      navigate('/admin/kullanicilar');
    } catch (err) {
      setDeleteError(getErrorMessage(err));
      setDeleteSubmitting(false);
    }
  }

  if (error) return <Alert>{error}</Alert>;
  if (!user) return <p className="text-sm text-slate-500">Yükleniyor...</p>;

  const projectName = (pid) => projects.find((p) => p.id === pid)?.name || 'Tüm Projeler (Genel)';

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link to="/admin/kullanicilar" className="text-sm text-brand-700 hover:underline">
        ‹ Kullanıcılar
      </Link>

      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-bold text-slate-800">{user.fullName}</h1>
        {user.isSystemAdmin && <Badge variant="info">Admin</Badge>}
        {!user.isActive && <Badge variant="danger">Arşivde / Pasif</Badge>}
      </div>
      <p className="text-sm text-slate-500">@{user.username}</p>

      {notice && <Alert variant="success">{notice}</Alert>}
      {!user.isActive && (
        <Alert variant="warning">
          Bu kullanıcı arşivlenmiş (pasif). Giriş yapamaz, proje atamaları ve yetkileri kaldırılmıştır. Geçmiş
          açtığı/kapattığı uygunsuzluk kayıtları korunmaktadır.
        </Alert>
      )}

      {!user.isSystemAdmin && stats && (
        <Card>
          <h2 className="mb-3 font-semibold text-slate-800">Uygunsuzluk İstatistikleri</h2>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="rounded-xl border border-slate-200 p-3">
              <div className="text-2xl font-bold text-slate-800">{stats.opened}</div>
              <div className="text-xs text-slate-500">Açtığı</div>
            </div>
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
              <div className="text-2xl font-bold text-emerald-700">{stats.closed}</div>
              <div className="text-xs text-emerald-700">Kapattığı</div>
            </div>
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
              <div className="text-2xl font-bold text-amber-700">{stats.assignedOpen}</div>
              <div className="text-xs text-amber-700">Üzerinde Açık</div>
            </div>
          </div>
        </Card>
      )}

      {!user.isSystemAdmin && authUser?.id !== user.id && recordCounts && (
        <Card className={canDelete ? 'space-y-3 border-red-200' : 'space-y-3'}>
          <h2 className="font-semibold text-slate-800">Sistem Kayıtları</h2>
          {recordCounts.total === 0 ? (
            <p className="text-sm text-slate-500">
              Bu kullanıcının sistemde hiç kaydı yok (hiç uygunsuzluk açmamış/atanmamış, ceza, düzeltme, kaza kaydı
              vb. yok).
            </p>
          ) : (
            <div className="flex flex-wrap gap-2 text-xs text-slate-600">
              {RECORD_COUNT_LABELS.filter(([key]) => recordCounts[key] > 0).map(([key, label]) => (
                <span key={key} className="rounded-full bg-slate-100 px-3 py-1">
                  {label}: <strong>{recordCounts[key]}</strong>
                </span>
              ))}
            </div>
          )}

          {canDelete ? (
            <div className="border-t border-slate-100 pt-3">
              {deleteError && <Alert>{deleteError}</Alert>}
              {!deleteConfirmOpen ? (
                <Button variant="danger" onClick={() => setDeleteConfirmOpen(true)}>
                  Kullanıcıyı Sil
                </Button>
              ) : (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-red-700">
                    Bu işlem geri alınamaz. "{user.fullName}" kullanıcısı kalıcı olarak silinecek. Emin misiniz?
                  </p>
                  <div className="flex gap-2">
                    <Button variant="danger" onClick={handleDelete} disabled={deleteSubmitting}>
                      {deleteSubmitting ? 'Siliniyor...' : 'Evet, Kalıcı Olarak Sil'}
                    </Button>
                    <Button variant="secondary" onClick={() => setDeleteConfirmOpen(false)} disabled={deleteSubmitting}>
                      Vazgeç
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <p className="border-t border-slate-100 pt-3 text-xs text-slate-400">
              Bu kullanıcının sistem kayıtları olduğu için kalıcı olarak silinemez; bunun yerine aşağıdan
              arşivleyebilirsiniz.
            </p>
          )}
        </Card>
      )}

      <Card className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-slate-800">Şifre</h2>
          <Button variant="secondary" onClick={handleResetPassword}>
            Geçici Şifre Oluştur
          </Button>
        </div>

        <div className="border-t border-slate-100 pt-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-800">Davet Bağlantısı</h3>
              <p className="text-xs text-slate-500">
                Kullanıcı bu bağlantıya tıklayıp kendi şifresini belirleyebilir; şifreyi telefonla iletmenize
                gerek kalmaz. Bağlantı 7 gün geçerlidir ve tek kullanımlıktır.
              </p>
            </div>
            <Button variant="secondary" onClick={handleCreateInvite} disabled={inviteSubmitting}>
              {inviteSubmitting ? 'Oluşturuluyor...' : 'Bağlantı Oluştur'}
            </Button>
          </div>

          {invite && (
            <div className="mt-3 space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={invite.url}
                  onFocus={(e) => e.target.select()}
                  className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-surface px-3 py-2 text-xs text-slate-700"
                />
                <Button variant="ghost" onClick={handleCopyInviteLink}>
                  {inviteCopied ? 'Kopyalandı ✓' : 'Kopyala'}
                </Button>
              </div>
              <a
                href={invite.whatsappUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-700"
              >
                📱 WhatsApp'ta Gönder
              </a>
            </div>
          )}
        </div>
      </Card>

      <Card>
        <h2 className="mb-3 font-semibold text-slate-800">Proje / Görev Atamaları</h2>
        <div className="mb-4 space-y-2">
          {assignments.length === 0 && <p className="text-sm text-slate-400">Henüz atama yok.</p>}
          {assignments.map((a) => (
            <div key={a.id} className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3">
              <div>
                <div className="font-medium text-slate-800">{a.projectName}</div>
                <div className="text-sm text-slate-500">
                  {a.roleName}
                  {a.companyName ? ` · ${a.companyName}` : ' · Tüm Proje (Ana Firma/Genel)'}
                  {a.blockName ? ` · ${a.blockName}` : ' · Tüm Bölgeler'}
                </div>
              </div>
              <Button variant="ghost" onClick={() => handleRemoveAssignment(a.id)}>
                Kaldır
              </Button>
            </div>
          ))}
        </div>
        <form onSubmit={handleAssign} className="space-y-3">
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="flex-1">
              <Select label="Proje" value={assignProjectId} onChange={(e) => setAssignProjectId(e.target.value)}>
                <option value="">Seçiniz</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex-1">
              <Select label="Görev" value={assignRoleId} onChange={(e) => setAssignRoleId(e.target.value)}>
                <option value="">Seçiniz</option>
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          {assignProjectId && (
            <div>
              <span className="mb-1.5 block text-sm font-medium text-slate-700">
                Firma (boş bırakılırsa Tüm Proje / Ana Firma kapsamında atanır)
              </span>
              {projectCompanies.length === 0 ? (
                <p className="text-sm text-slate-400">Bu projede tanımlı firma yok.</p>
              ) : (
                <div className="max-h-48 space-y-1 overflow-y-auto rounded-xl border border-slate-200 p-2">
                  {projectCompanies.map((c) => (
                    <label key={c.id} className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 hover:bg-slate-50">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-slate-300 text-brand-700 focus:ring-brand-500"
                        checked={assignCompanyIds.includes(c.id)}
                        onChange={() => toggleAssignCompany(c.id)}
                      />
                      <span className="text-sm text-slate-800">{c.name}</span>
                    </label>
                  ))}
                </div>
              )}
              <p className="mt-1 text-xs text-slate-500">
                Birden fazla firma seçilirse, her firma için ayrı bir atama oluşturulur.
              </p>
            </div>
          )}

          {assignProjectId && projectBlocks.length > 0 && (
            <Select
              label="Bölge (boş bırakılırsa tüm bölgeler kapsamında atanır)"
              value={assignBlockId}
              onChange={(e) => setAssignBlockId(e.target.value)}
            >
              <option value="">Tüm Bölgeler</option>
              {projectBlocks.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          )}

          <Button type="submit" disabled={!assignProjectId || !assignRoleId || assignSubmitting}>
            {assignSubmitting ? 'Atanıyor...' : 'Ata'}
          </Button>
        </form>
      </Card>

      <Card>
        <h2 className="mb-3 font-semibold text-slate-800">Yetkiler</h2>
        <div className="mb-4 space-y-2">
          {permissions.length === 0 && <p className="text-sm text-slate-400">Henüz özel yetki tanımlanmamış.</p>}
          {permissions.map((p) => (
            <div key={p.id} className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3">
              <div>
                <div className="font-medium text-slate-800">{p.name}</div>
                <div className="text-sm text-slate-500">{projectName(p.projectId)}</div>
              </div>
              <Button variant="ghost" onClick={() => handleRevokePermission(p.id)}>
                Kaldır
              </Button>
            </div>
          ))}
        </div>
        <form onSubmit={handleGrantPermission} className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-slate-700">Verilecek Yetkiler</span>
            {grantablePermissions.length > 0 && (
              <button
                type="button"
                onClick={toggleSelectAllPermissions}
                className="text-sm font-medium text-brand-700 hover:underline"
              >
                {grantPermissionIds.length === grantablePermissions.length ? 'Tümünü Kaldır' : 'Tümünü Seç'}
              </button>
            )}
          </div>
          {grantablePermissions.length === 0 ? (
            <p className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
              Bu kapsam için tanımlı tüm yetkiler zaten verilmiş.
            </p>
          ) : (
          <div className="max-h-80 space-y-3 overflow-y-auto rounded-xl border border-slate-200 p-2">
            {groupedGrantablePermissions.map((group) => (
              <div key={group.title}>
                <div className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  {group.icon} {group.title}
                </div>
                {group.items.map((p) => (
                  <label
                    key={p.id}
                    className="flex cursor-pointer items-start gap-3 rounded-lg px-3 py-2 hover:bg-slate-50"
                  >
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4 rounded border-slate-300 text-brand-700 focus:ring-brand-500"
                      checked={grantPermissionIds.includes(p.id)}
                      onChange={() => toggleGrantPermission(p.id)}
                    />
                    <span>
                      <span className="block text-sm font-medium text-slate-800">{p.name}</span>
                      {PERMISSION_DESCRIPTIONS[p.key] && (
                        <span className="block text-xs text-slate-500">{PERMISSION_DESCRIPTIONS[p.key]}</span>
                      )}
                    </span>
                  </label>
                ))}
              </div>
            ))}
            {uncategorizedGrantablePermissions.length > 0 && (
              <div>
                <div className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Diğer</div>
                {uncategorizedGrantablePermissions.map((p) => (
                  <label
                    key={p.id}
                    className="flex cursor-pointer items-start gap-3 rounded-lg px-3 py-2 hover:bg-slate-50"
                  >
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4 rounded border-slate-300 text-brand-700 focus:ring-brand-500"
                      checked={grantPermissionIds.includes(p.id)}
                      onChange={() => toggleGrantPermission(p.id)}
                    />
                    <span>
                      <span className="block text-sm font-medium text-slate-800">{p.name}</span>
                      {PERMISSION_DESCRIPTIONS[p.key] && (
                        <span className="block text-xs text-slate-500">{PERMISSION_DESCRIPTIONS[p.key]}</span>
                      )}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>
          )}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <Select
                label="Kapsam"
                value={grantProjectId}
                onChange={(e) => {
                  setGrantProjectId(e.target.value);
                  setGrantPermissionIds([]);
                }}
              >
                <option value="">Tüm Projeler (Genel)</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </div>
            <Button type="submit" disabled={grantPermissionIds.length === 0 || grantSubmitting}>
              {grantSubmitting
                ? 'Veriliyor...'
                : `Yetki Ver${grantPermissionIds.length > 0 ? ` (${grantPermissionIds.length})` : ''}`}
            </Button>
          </div>
        </form>
      </Card>

      {user.isActive && authUser?.id !== user.id && (
        <Card className="space-y-4 border-red-200">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-slate-800">Kullanıcıyı Arşivle</h2>
              <p className="text-xs text-slate-500">
                Kullanıcılar kalıcı olarak silinemez (geçmiş uygunsuzluk kayıtları bozulmasın diye); bunun yerine
                arşivlenir.
              </p>
            </div>
            {!archiveOpen && (
              <Button variant="secondary" onClick={handleOpenArchive}>
                Arşivle
              </Button>
            )}
          </div>

          {archiveOpen && (
            <div className="space-y-4 border-t border-slate-100 pt-4">
              {archiveError && <Alert>{archiveError}</Alert>}
              {archiveCheckLoading && <p className="text-sm text-slate-500">Kontrol ediliyor...</p>}

              {archiveCheck && (
                <>
                  {archiveCheck.openNonconformities.length > 0 && (
                    <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3">
                      <p className="text-sm font-medium text-amber-800">
                        ⚠️ Bu kullanıcının üzerinde {archiveCheck.openNonconformities.length} açık uygunsuzluk var.
                        İsterseniz aşağıdan doğrudan başka birine devredin; devretmediklerinizi sistem arşivleme
                        sırasında otomatik olarak size (işlemi yapan admine) devreder - hiçbir kayıt sahipsiz kalmaz.
                      </p>
                      <div className="space-y-2">
                        {archiveCheck.openNonconformities.map((nc) => (
                          <div key={nc.id} className="flex flex-col gap-1.5 rounded-lg bg-surface p-2.5 sm:flex-row sm:items-center sm:justify-between">
                            <div className="min-w-0">
                              <div className="truncate text-sm font-medium text-slate-800">{nc.number}</div>
                              <div className="truncate text-xs text-slate-500">{nc.description}</div>
                            </div>
                            <Select
                              value={reassignments[nc.id] || ''}
                              onChange={(e) => setReassignments((prev) => ({ ...prev, [nc.id]: e.target.value }))}
                              className="sm:w-56"
                            >
                              <option value="">Devretmeden bırak</option>
                              {(assignableUsersByProject[nc.projectId] || []).map((u) => (
                                <option key={u.userId} value={u.userId}>
                                  {u.fullName} ({u.roleName})
                                </option>
                              ))}
                            </Select>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="rounded-xl border border-slate-200 p-3">
                    <p className="mb-2 text-sm font-medium text-slate-700">Arşivleme sebebi</p>
                    {archiveCheck.linkedEmployee ? (
                      <div className="space-y-3">
                        <p className="text-xs text-slate-500">
                          Bu kullanıcı <strong>{archiveCheck.linkedEmployee.fullName}</strong> çalışan kaydına bağlı
                          ({archiveCheck.linkedEmployee.companyName || 'firma yok'}).
                        </p>
                        <div className="rounded-lg bg-slate-50 p-3">
                          <p className="text-sm font-medium text-slate-800">Çıkış (işten/projeden ayrıldı)</p>
                          <p className="mb-2 text-xs text-slate-500">
                            Hem kullanıcı hesabı hem bağlı çalışan kaydı, girilen tarihle birlikte arşivlenir.
                          </p>
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                            <input
                              type="date"
                              value={archiveEndDate}
                              onChange={(e) => setArchiveEndDate(e.target.value)}
                              className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
                            />
                            <Button
                              variant="danger"
                              disabled={archiveSubmitting !== null}
                              onClick={() => handleArchive('EXIT')}
                            >
                              {archiveSubmitting === 'EXIT' ? 'Arşivleniyor...' : 'Çıkış Olarak Arşivle'}
                            </Button>
                          </div>
                        </div>
                        <div className="rounded-lg bg-slate-50 p-3">
                          <p className="text-sm font-medium text-slate-800">Görev değişikliği</p>
                          <p className="mb-2 text-xs text-slate-500">
                            Yalnızca sistem kullanıcısı hesabı arşivlenir; çalışan kaydı sahada çalışmaya devam
                            ettiği için dokunulmaz.
                          </p>
                          <Button
                            variant="secondary"
                            disabled={archiveSubmitting !== null}
                            onClick={() => handleArchive('ROLE_CHANGE')}
                          >
                            {archiveSubmitting === 'ROLE_CHANGE' ? 'Arşivleniyor...' : 'Görev Değişikliği (Yalnızca Hesabı Arşivle)'}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-lg bg-slate-50 p-3">
                        <p className="mb-2 text-xs text-slate-500">
                          Bu kullanıcı bir çalışan kaydına bağlı değil, bu yüzden yalnızca hesap arşivlenebilir.
                          (Kişi bir firmadan işten ayrıldıysa, o firmanın çalışan kaydını Çalışanlar sekmesinden
                          arşivlemeniz de gerekir.)
                        </p>
                        <Button
                          variant="secondary"
                          disabled={archiveSubmitting !== null}
                          onClick={() => handleArchive('ROLE_CHANGE')}
                        >
                          {archiveSubmitting === 'ROLE_CHANGE' ? 'Arşivleniyor...' : 'Hesabı Arşivle'}
                        </Button>
                      </div>
                    )}
                  </div>
                </>
              )}

              <button type="button" onClick={() => setArchiveOpen(false)} className="text-xs text-slate-500 hover:underline">
                Vazgeç
              </button>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
