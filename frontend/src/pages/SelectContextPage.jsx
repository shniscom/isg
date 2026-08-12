import { useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Button, Alert, Card } from '../components/ui';

export function SelectContextPage() {
  const { assignments, selectContext, backToLogin, error, clearError, user } = useAuth();
  const [projectId, setProjectId] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const projects = useMemo(() => {
    const map = new Map();
    for (const a of assignments) {
      if (!map.has(a.projectId)) map.set(a.projectId, { id: a.projectId, name: a.projectName, code: a.projectCode });
    }
    return Array.from(map.values());
  }, [assignments]);

  const rolesForProject = useMemo(
    () => assignments.filter((a) => a.projectId === projectId),
    [assignments, projectId]
  );

  async function handleSelectRole(roleId) {
    clearError();
    setSubmitting(true);
    await selectContext(projectId, roleId);
    setSubmitting(false);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-bold text-slate-800">Hoş geldiniz, {user?.fullName}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {projectId ? 'Bu projedeki görevinizi seçin' : 'Çalışacağınız projeyi seçin'}
          </p>
        </div>

        <Card className="space-y-3">
          {error && <Alert>{error}</Alert>}

          {!projectId &&
            projects.map((p) => (
              <button
                key={p.id}
                onClick={() => setProjectId(p.id)}
                className="flex w-full items-center justify-between rounded-xl border border-slate-200 px-4 py-3.5 text-left transition hover:border-brand-400 hover:bg-brand-50"
              >
                <div>
                  <div className="font-semibold text-slate-800">{p.name}</div>
                  <div className="text-xs text-slate-500">{p.code}</div>
                </div>
                <span className="text-slate-400">›</span>
              </button>
            ))}

          {projectId && (
            <>
              <button onClick={() => setProjectId(null)} className="text-sm text-brand-700 hover:underline">
                ‹ Proje seçimine dön
              </button>
              {rolesForProject.map((a) => (
                <button
                  key={a.roleId}
                  disabled={submitting}
                  onClick={() => handleSelectRole(a.roleId)}
                  className="flex w-full items-center justify-between rounded-xl border border-slate-200 px-4 py-3.5 text-left transition hover:border-brand-400 hover:bg-brand-50 disabled:opacity-50"
                >
                  <div className="font-semibold text-slate-800">{a.roleName}</div>
                  <span className="text-slate-400">›</span>
                </button>
              ))}
            </>
          )}
        </Card>

        <div className="mt-4 text-center">
          <Button variant="ghost" onClick={backToLogin}>
            Farklı bir hesapla giriş yap
          </Button>
        </div>
      </div>
    </div>
  );
}
