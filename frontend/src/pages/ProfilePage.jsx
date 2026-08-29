import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Card, Input, Button, Alert, Badge } from '../components/ui';
import apiClient, { getErrorMessage } from '../api/client';

export function ProfilePage() {
  const { user, context } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleChangePassword(e) {
    e.preventDefault();
    setMessage(null);
    setError(null);
    setSubmitting(true);
    try {
      await apiClient.post('/auth/change-password', { currentPassword, newPassword });
      setMessage('Şifreniz başarıyla güncellendi.');
      setCurrentPassword('');
      setNewPassword('');
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold text-slate-800">Profilim</h1>

      <Card>
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-100 text-xl font-bold text-brand-800">
            {user?.fullName?.charAt(0)}
          </div>
          <div>
            <div className="text-lg font-semibold text-slate-800">{user?.fullName}</div>
            <div className="text-sm text-slate-500">@{user?.username}</div>
          </div>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-slate-400">Telefon</dt>
            <dd className="text-slate-700">{user?.phone || '-'}</dd>
          </div>
          <div>
            <dt className="text-slate-400">E-posta</dt>
            <dd className="text-slate-700">{user?.email || '-'}</dd>
          </div>
        </dl>
        {user?.isSystemAdmin && (
          <div className="mt-3">
            <Badge variant="info">Sistem Admini</Badge>
          </div>
        )}
      </Card>

      <Link to="/gorunum">
        <Card className="flex items-center justify-between transition hover:border-brand-300 hover:shadow-md">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🎨</span>
            <div>
              <div className="font-semibold text-slate-800">Görünüm</div>
              <div className="text-xs text-slate-500">Tema, karanlık/aydınlık mod ve buton boyutunu seçin</div>
            </div>
          </div>
          <span className="text-slate-400">›</span>
        </Card>
      </Link>

      <Link to="/yetkilerim">
        <Card className="flex items-center justify-between transition hover:border-brand-300 hover:shadow-md">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🔑</span>
            <div>
              <div className="font-semibold text-slate-800">Yetkilerim</div>
              <div className="text-xs text-slate-500">
                {context?.permissions?.length > 0 || user?.isSystemAdmin
                  ? 'Sahip olduğunuz yetkileri görüntüleyin'
                  : 'Henüz size özel bir yetki tanımlanmamış'}
              </div>
            </div>
          </div>
          <span className="text-slate-400">›</span>
        </Card>
      </Link>

      <Card>
        <h2 className="mb-3 font-semibold text-slate-800">Şifre Değiştir</h2>
        <form onSubmit={handleChangePassword} className="space-y-4">
          {message && <Alert variant="success">{message}</Alert>}
          {error && <Alert>{error}</Alert>}
          <Input
            label="Mevcut Şifre"
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
          />
          <Input
            label="Yeni Şifre"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            minLength={8}
            required
          />
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Kaydediliyor...' : 'Şifreyi Güncelle'}
          </Button>
        </form>
      </Card>
    </div>
  );
}
