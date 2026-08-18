import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import apiClient, { getErrorMessage } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Card, Select, Input, Alert, Badge } from '../components/ui';

export function EmployeesPage() {
  const { user } = useAuth();
  const [employees, setEmployees] = useState(null);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');

  const [adminProjects, setAdminProjects] = useState(null);
  const [adminProjectId, setAdminProjectId] = useState('');
  const [adminCompanies, setAdminCompanies] = useState([]);
  const [adminCompanyId, setAdminCompanyId] = useState('');

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

  useEffect(() => {
    setAdminCompanyId('');
    if (user?.isSystemAdmin && adminProjectId) {
      apiClient
        .get('/admin/companies', { params: { projectId: adminProjectId } })
        .then(({ data }) => setAdminCompanies(data.companies))
        .catch(() => setAdminCompanies([]));
    }
  }, [user, adminProjectId]);

  async function load() {
    if (user?.isSystemAdmin && !adminProjectId) return;
    try {
      const params = {};
      if (user?.isSystemAdmin) {
        params.projectId = adminProjectId;
        if (adminCompanyId) params.companyId = adminCompanyId;
      }
      if (search) params.search = search;
      const { data } = await apiClient.get('/employees', { params });
      setEmployees(data.employees);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminProjectId, adminCompanyId, search]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-2xl font-bold text-slate-800">Çalışanlar</h1>
      <p className="text-sm text-slate-500">
        Uygunsuz davranış nedeniyle uygunsuzluğa konu olmuş çalışanlar ve uyarı sayıları.
      </p>

      {error && <Alert>{error}</Alert>}

      <div className="flex flex-col gap-3 sm:flex-row">
        {user?.isSystemAdmin && adminProjects && (
          <Select value={adminProjectId} onChange={(e) => setAdminProjectId(e.target.value)} className="sm:flex-1">
            {adminProjects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        )}
        {user?.isSystemAdmin && adminCompanies.length > 0 && (
          <Select value={adminCompanyId} onChange={(e) => setAdminCompanyId(e.target.value)} className="sm:flex-1">
            <option value="">Tüm Firmalar</option>
            {adminCompanies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        )}
        <Input
          placeholder="İsim ara..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="sm:flex-1"
        />
      </div>

      {employees?.length === 0 && <p className="text-sm text-slate-500">Kayıtlı çalışan bulunamadı.</p>}

      <div className="space-y-2">
        {employees?.map((emp) => (
          <Link key={emp.id} to={`/calisanlar/${emp.id}`}>
            <Card className="flex items-center justify-between transition hover:border-brand-300">
              <div>
                <div className="font-medium text-slate-800">{emp.fullName}</div>
                <div className="text-xs text-slate-500">
                  {emp.companyName || 'Firma belirtilmemiş'}
                  {emp.nationalId && ` · TC: ${emp.nationalId}`}
                </div>
              </div>
              <Badge variant={emp.warningCount > 2 ? 'danger' : emp.warningCount > 0 ? 'warning' : 'default'}>
                {emp.warningCount} uyarı
              </Badge>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
