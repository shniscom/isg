import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Button, Input, Alert, Card } from '../components/ui';

export function ChangePasswordPage() {
  const { changePassword, error, clearError, logout } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [localError, setLocalError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    clearError();
    setLocalError(null);

    if (newPassword !== confirmPassword) {
      setLocalError('Yeni şifreler birbiriyle eşleşmiyor.');
      return;
    }

    setSubmitting(true);
    await changePassword(currentPassword, newPassword);
    setSubmitting(false);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-bold text-slate-800">Şifrenizi Değiştirin</h1>
          <p className="mt-1 text-sm text-slate-500">
            Güvenliğiniz için geçici şifrenizi değiştirmeniz gerekiyor.
          </p>
        </div>

        <Card>
          <form onSubmit={handleSubmit} className="space-y-4">
            {(error || localError) && <Alert>{localError || error}</Alert>}
            <Input
              label="Mevcut (Geçici) Şifre"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
              autoFocus
            />
            <Input
              label="Yeni Şifre"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              minLength={8}
              required
            />
            <Input
              label="Yeni Şifre (Tekrar)"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              minLength={8}
              required
            />
            <p className="text-xs text-slate-500">En az 8 karakter, en az bir harf ve bir rakam içermelidir.</p>
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? 'Kaydediliyor...' : 'Şifreyi Değiştir'}
            </Button>
          </form>
        </Card>

        <div className="mt-4 text-center">
          <Button variant="ghost" onClick={logout}>
            Çıkış Yap
          </Button>
        </div>
      </div>
    </div>
  );
}
