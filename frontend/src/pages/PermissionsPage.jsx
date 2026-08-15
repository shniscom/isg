import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import apiClient, { getErrorMessage } from '../api/client';
import { Card, Alert } from '../components/ui';
import { PERMISSION_DESCRIPTIONS, PERMISSION_CATEGORIES } from '../lib/permissions';

export function PermissionsPage() {
  const { user, context, refreshMe } = useAuth();
  const [catalog, setCatalog] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([refreshMe(), apiClient.get('/admin/permissions')])
      .then(([, permsRes]) => {
        setCatalog(permsRes.data.permissions);
      })
      .catch((err) => setError(getErrorMessage(err)))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const catalogByKey = new Map((catalog || []).map((p) => [p.key, p]));
  const grantedKeys = new Set(context?.permissions || []);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link to="/profil" className="text-sm text-brand-700 hover:underline">
        ‹ Profilim
      </Link>
      <h1 className="text-2xl font-bold text-slate-800">Yetkilerim</h1>

      {error && <Alert>{error}</Alert>}
      {loading && <p className="text-sm text-slate-500">Yükleniyor...</p>}

      {!loading && user?.isSystemAdmin && (
        <Card className="border-brand-100 bg-brand-50">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🛡️</span>
            <div>
              <div className="font-semibold text-brand-900">Sistem Admini</div>
              <p className="mt-0.5 text-sm text-brand-800">
                Sistem admini olduğunuz için tüm işlemlere ve tüm projelere sınırsız erişiminiz vardır.
              </p>
            </div>
          </div>
        </Card>
      )}

      {!loading && !user?.isSystemAdmin && (
        <>
          {context?.projectId && (
            <p className="text-sm text-slate-500">
              Aşağıdaki yetkiler, şu anda seçili olan proje/görev bağlamınız için geçerlidir.
            </p>
          )}

          {grantedKeys.size === 0 && (
            <Card>
              <p className="text-sm text-slate-500">
                Şu anda size özel tanımlanmış bir yetki bulunmuyor. İhtiyacınız olan bir yetki varsa
                sistem yöneticinizle iletişime geçin.
              </p>
            </Card>
          )}

          {PERMISSION_CATEGORIES.map((category) => {
            const grantedInCategory = category.keys.filter((k) => grantedKeys.has(k));
            if (grantedInCategory.length === 0) return null;
            return (
              <Card key={category.title}>
                <h2 className="mb-3 flex items-center gap-2 font-semibold text-slate-800">
                  <span>{category.icon}</span> {category.title}
                </h2>
                <div className="space-y-3">
                  {grantedInCategory.map((key) => {
                    const catalogEntry = catalogByKey.get(key);
                    return (
                      <div key={key} className="flex items-start gap-3 rounded-xl bg-slate-50 px-4 py-3">
                        <span className="mt-0.5 text-emerald-600">✓</span>
                        <div>
                          <div className="text-sm font-medium text-slate-800">
                            {catalogEntry?.name || key}
                          </div>
                          {PERMISSION_DESCRIPTIONS[key] && (
                            <div className="text-xs text-slate-500">{PERMISSION_DESCRIPTIONS[key]}</div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Card>
            );
          })}
        </>
      )}
    </div>
  );
}
