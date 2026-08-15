import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import apiClient, { getErrorMessage } from '../../api/client';
import { Card, Button, Select, Alert, Badge } from '../../components/ui';
import { PERMISSION_DESCRIPTIONS } from '../../lib/permissions';

export function UserDetailPage() {
  const { id } = useParams();
  const [user, setUser] = useState(null);
  const [assignments, setAssignments] = useState([]);
  const [permissions, setPermissions] = useState([]);
  const [projects, setProjects] = useState([]);
  const [roles, setRoles] = useState([]);
  const [allPermissions, setAllPermissions] = useState([]);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const [assignProjectId, setAssignProjectId] = useState('');
  const [assignRoleId, setAssignRoleId] = useState('');
  const [assignCompanyIds, setAssignCompanyIds] = useState([]); // boş -> Tüm Proje (Ana Firma/Genel)
  const [projectCompanies, setProjectCompanies] = useState([]);
  const [assignSubmitting, setAssignSubmitting] = useState(false);
  const [grantPermissionIds, setGrantPermissionIds] = useState([]);
  const [grantProjectId, setGrantProjectId] = useState('');
  const [grantSubmitting, setGrantSubmitting] = useState(false);

  async function load() {
    try {
      const [userRes, projectsRes, rolesRes, permsRes] = await Promise.all([
        apiClient.get(`/admin/users/${id}`),
        apiClient.get('/admin/projects'),
        apiClient.get('/admin/roles'),
        apiClient.get('/admin/permissions'),
      ]);
      setUser(userRes.data.user);
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
    if (!assignProjectId) {
      setProjectCompanies([]);
      return;
    }
    apiClient
      .get('/admin/companies', { params: { projectId: assignProjectId } })
      .then(({ data }) => setProjectCompanies(data.companies))
      .catch(() => setProjectCompanies([]));
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
      // birden fazla firma seçildiyse her firma için ayrı bir atama oluşturulur.
      const companyIdsToAssign = assignCompanyIds.length > 0 ? assignCompanyIds : [null];
      const results = await Promise.allSettled(
        companyIdsToAssign.map((companyId) =>
          apiClient.post(`/admin/users/${id}/projects`, {
            projectId: assignProjectId,
            roleId: assignRoleId,
            companyId,
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
      await load();
    } finally {
      setAssignSubmitting(false);
    }
  }

  async function handleRemoveAssignment(assignmentId) {
    await apiClient.delete(`/admin/users/${id}/projects/${assignmentId}`);
    await load();
  }

  function toggleGrantPermission(permId) {
    setGrantPermissionIds((prev) =>
      prev.includes(permId) ? prev.filter((p) => p !== permId) : [...prev, permId]
    );
  }

  function toggleSelectAllPermissions() {
    setGrantPermissionIds((prev) =>
      prev.length === allPermissions.length ? [] : allPermissions.map((p) => p.id)
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
      </div>
      <p className="text-sm text-slate-500">@{user.username}</p>

      {notice && <Alert variant="success">{notice}</Alert>}

      <Card>
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-slate-800">Şifre</h2>
          <Button variant="secondary" onClick={handleResetPassword}>
            Geçici Şifre Oluştur
          </Button>
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
            <button
              type="button"
              onClick={toggleSelectAllPermissions}
              className="text-sm font-medium text-brand-700 hover:underline"
            >
              {grantPermissionIds.length === allPermissions.length ? 'Tümünü Kaldır' : 'Tümünü Seç'}
            </button>
          </div>
          <div className="max-h-80 space-y-1 overflow-y-auto rounded-xl border border-slate-200 p-2">
            {allPermissions.map((p) => (
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
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <Select label="Kapsam" value={grantProjectId} onChange={(e) => setGrantProjectId(e.target.value)}>
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
    </div>
  );
}
