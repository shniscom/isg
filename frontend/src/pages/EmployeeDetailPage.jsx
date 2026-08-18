import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import apiClient, { getErrorMessage } from '../api/client';
import { Card, Alert, Badge } from '../components/ui';
import { STATUS_LABELS, STATUS_BADGE_VARIANT, PRIORITY_LABELS, PRIORITY_BADGE_VARIANT, formatDate } from '../lib/nonconformity';

export function EmployeeDetailPage() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    apiClient
      .get(`/employees/${id}/nonconformities`)
      .then(({ data }) => setData(data))
      .catch((err) => setError(getErrorMessage(err)));
  }, [id]);

  if (error) return <Alert>{error}</Alert>;
  if (!data) return <p className="text-sm text-slate-500">Yükleniyor...</p>;

  const { employee, nonconformities } = data;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link to="/calisanlar" className="text-sm text-brand-700 hover:underline">
        ‹ Çalışanlar
      </Link>

      <div>
        <h1 className="text-2xl font-bold text-slate-800">{employee.fullName}</h1>
        {employee.nationalId && <p className="text-sm text-slate-500">TC: {employee.nationalId}</p>}
      </div>

      <Card>
        <h2 className="mb-3 font-semibold text-slate-800">Uygunsuzluk Geçmişi ({nonconformities.length})</h2>
        {nonconformities.length === 0 ? (
          <p className="text-sm text-slate-400">Bu çalışana bağlı kayıt yok.</p>
        ) : (
          <div className="space-y-2">
            {nonconformities.map((n) => (
              <Link key={n.id} to={`/uygunsuzluklar/${n.id}`}>
                <div className="rounded-xl bg-slate-50 px-4 py-3 transition hover:bg-slate-100">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-slate-400">{n.number}</span>
                    <Badge variant={STATUS_BADGE_VARIANT[n.status]}>{STATUS_LABELS[n.status]}</Badge>
                    <Badge variant={PRIORITY_BADGE_VARIANT[n.priority]}>{PRIORITY_LABELS[n.priority]}</Badge>
                    <span className="ml-auto text-xs text-slate-400">{formatDate(n.createdAt)}</span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-sm text-slate-700">{n.description}</p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
