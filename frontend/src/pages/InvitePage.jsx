import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import apiClient, { getErrorMessage } from '../api/client';
import { Button, PasswordInput, Alert, Card, FullScreenLoader } from '../components/ui';

/**
 * Herkese açık davet sayfası (/davet/:token). Admin tarafından üretilen tek kullanımlık
 * bağlantıyla açılır; kullanıcı kendi şifresini belirler ve giriş ekranına yönlendirilir.
 * Şifre unutma senaryosunda kullanıcı adı/şifreyi telefonla iletmek yerine bu bağlantı
 * (ör. WhatsApp üzerinden) paylaşılabilir.
 */
export function InvitePage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState('loading'); // loading | invalid | ready | done
  const [invite, setInvite] = useState(null);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    apiClient
      .get(`/auth/invite/${token}`)
      .then(({ data }) => {
        setInvite(data);
        setStatus('ready');
      })
      .catch(() => setStatus('invalid'));
  }, [token]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError('Şifreler birbiriyle eşleşmiyor.');
      return;
    }

    setSubmitting(true);
    try {
      await apiClient.post(`/auth/invite/${token}`, { password });
      setStatus('done');
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (status === 'loading') return <FullScreenLoader label="Davet bağlantısı kontrol ediliyor..." />;

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-brand-900 to-brand-700 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center text-white">
          <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-white/10 text-3xl">🦺</div>
          <h1 className="text-2xl font-bold">İSG Takip Sistemi</h1>
          <p className="mt-1 text-sm text-white/70">Hesabınıza hoş geldiniz</p>
        </div>

        <Card className="space-y-4">
          {status === 'invalid' && (
            <div className="space-y-3 text-center">
              <Alert>Bu davet bağlantısının süresi dolmuş veya daha önce kullanılmış.</Alert>
              <p className="text-sm text-slate-500">
                Yeni bir bağlantı için sistem yöneticinizle iletişime geçin.
              </p>
              <Button variant="ghost" className="w-full" onClick={() => navigate('/giris')}>
                Giriş sayfasına dön
              </Button>
            </div>
          )}

          {status === 'ready' && (
            <>
              <div className="text-center">
                <p className="text-sm text-slate-500">Merhaba</p>
                <p className="text-lg font-bold text-slate-800">{invite.fullName}</p>
                <p className="text-sm text-slate-500">
                  Kullanıcı adınız: <span className="font-mono font-semibold text-slate-700">{invite.username}</span>
                </p>
              </div>
              <form onSubmit={handleSubmit} className="space-y-4">
                {error && <Alert>{error}</Alert>}
                <PasswordInput
                  label="Yeni Şifre"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  minLength={8}
                  required
                  autoFocus
                />
                <PasswordInput
                  label="Yeni Şifre (Tekrar)"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  minLength={8}
                  required
                />
                <p className="text-xs text-slate-500">En az 8 karakter, en az bir harf ve bir rakam içermelidir.</p>
                <Button type="submit" className="w-full" disabled={submitting}>
                  {submitting ? 'Kaydediliyor...' : 'Şifremi Belirle ve Devam Et'}
                </Button>
              </form>
            </>
          )}

          {status === 'done' && (
            <div className="space-y-3 text-center">
              <Alert variant="success">Şifreniz belirlendi. Artık kullanıcı adınız ve yeni şifrenizle giriş yapabilirsiniz.</Alert>
              <Button className="w-full" onClick={() => navigate('/giris')}>
                Giriş Yap
              </Button>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
