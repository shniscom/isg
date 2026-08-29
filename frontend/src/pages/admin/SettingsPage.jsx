import { useEffect, useState } from 'react';
import apiClient, { getErrorMessage } from '../../api/client';
import { Card, Alert, Button } from '../../components/ui';

function Toggle({ checked, onChange, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-7 w-12 shrink-0 rounded-full transition ${checked ? 'bg-brand-700' : 'bg-slate-300'} ${
        disabled ? 'opacity-50' : ''
      }`}
    >
      <span
        className={`absolute top-0.5 h-6 w-6 rounded-full bg-surface shadow transition ${checked ? 'left-5' : 'left-0.5'}`}
      />
    </button>
  );
}

export function SettingsPage() {
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiClient
      .get('/settings')
      .then(({ data }) => setSettings(data.settings))
      .catch((err) => setError(getErrorMessage(err)));
  }, []);

  async function updateSetting(key, value) {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const { data } = await apiClient.patch('/settings', { [key]: value });
      setSettings(data.settings);
      setNotice('Ayar güncellendi.');
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  if (error && !settings) return <Alert>{error}</Alert>;
  if (!settings) return <p className="text-sm text-slate-500">Yükleniyor...</p>;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold text-slate-800">Sistem Ayarları</h1>

      {error && <Alert>{error}</Alert>}
      {notice && <Alert variant="success">{notice}</Alert>}

      <Card>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="font-medium text-slate-800">Galeriden Fotoğraf Seçme</div>
            <p className="mt-1 text-sm text-slate-500">
              Açıksa, kullanıcılar uygunsuzluk açarken/düzeltirken kamera ile çekmek yerine telefon
              galerisinden hazır fotoğraf da seçebilir. Kapalıyken yalnızca kamera ile anlık çekim
              yapılabilir (varsayılan: kapalı).
            </p>
          </div>
          <Toggle
            checked={settings.allowGallerySelect}
            disabled={saving}
            onChange={(value) => updateSetting('allowGallerySelect', value)}
          />
        </div>
      </Card>

      <Card>
        <div className="font-medium text-slate-800">Uygunsuzluk Başına Maksimum Fotoğraf</div>
        <p className="mt-1 mb-3 text-sm text-slate-500">
          Bir uygunsuzluk açılırken veya düzeltme gönderilirken en fazla kaç fotoğraf yüklenebileceği.
        </p>
        <div className="flex items-center gap-3">
          {[3, 5, 8, 10].map((n) => (
            <Button
              key={n}
              variant={settings.maxPhotosPerUpload === n ? 'primary' : 'secondary'}
              disabled={saving}
              onClick={() => updateSetting('maxPhotosPerUpload', n)}
            >
              {n}
            </Button>
          ))}
        </div>
      </Card>
    </div>
  );
}
