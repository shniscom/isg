import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import apiClient, { getErrorMessage } from '../../api/client';
import { Card, Button, Select, Alert, Badge } from '../../components/ui';

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
  const [grantPermissionId, setGrantPermissionId] = useState('');
  const [grantProjectId, setGrantProjectId] = useState('');

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

  async function handleAssign(e) {
    e.preventDefault();
    if (!assignProjectId || !assignRoleId) return;
    try {
      await apiClient.post(`/admin/users/${id}/projects`, { projectId: assignProjectId, roleId: assignRoleId });
      await load();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  async function handleRemoveAssignment(assignmentId) {
    await apiClient.delete(`/admin/users/${id}/projects/${assignmentId}`);
    await load();
  }

  async function handleGrantPermission(e) {
    e.preventDefault();
    if (!grantPermissionId) return;
    try {
      await apiClient.post(`/admin/users/${id}/permissions`, {
        permissionId: grantPermissionId,
        projectId: grantProjectId || null,
      });
      await load();
    } catch (err) {
      setError(getErrorMessage(err));
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
                <div className="text-sm text-slate-500">{a.roleName}</div>
              </div>
              <Button variant="ghost" onClick={() => handleRemoveAssignment(a.id)}>
                Kaldır
              </Button>
            </div>
          ))}
        </div>
        <form onSubmit={handleAssign} className="flex flex-col gap-3 sm:flex-row sm:items-end">
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
          <Button type="submit">Ata</Button>
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
        <form onSubmit={handleGrantPermission} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Select label="Yetki" value={grantPermissionId} onChange={(e) => setGrantPermissionId(e.target.value)}>
              <option value="">Seçiniz</option>
              {allPermissions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </div>
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
          <Button type="submit">Yetki Ver</Button>
        </form>
      </Card>
    </div>
  );
}
