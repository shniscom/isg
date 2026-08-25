import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Button, Input, PasswordInput, Alert, Card } from '../components/ui';

export function LoginPage() {
  const { login, error, clearError } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    clearError();
    setSubmitting(true);
    await login(username, password, rememberMe);
    setSubmitting(false);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-brand-900 to-brand-700 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center text-white">
          <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-white/10 text-3xl">🦺</div>
          <h1 className="text-2xl font-bold">İSG Takip Sistemi</h1>
          <p className="mt-1 text-sm text-white/70">Yerel Uygunsuzluk Açma-Kapama Programı</p>
        </div>

        <Card className="space-y-4">
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && <Alert>{error}</Alert>}
            <Input
              label="Kullanıcı Adı"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoFocus
            />
            <PasswordInput
              label="Şifre"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300 text-brand-700 focus:ring-brand-500"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
              />
              Beni hatırla
            </label>
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? 'Giriş yapılıyor...' : 'Giriş Yap'}
            </Button>
          </form>
        </Card>
        <p className="mt-4 text-center text-xs text-white/50">
          Kullanıcı bilgileriniz sistem yöneticiniz tarafından tanımlanır.
        </p>
      </div>
    </div>
  );
}
