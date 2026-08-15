import { useState } from 'react';
import apiClient from '../api/client';
import { Alert, Spinner } from './ui';

/**
 * Seçilen fotoğrafları önce backend'den alınan presigned URL ile doğrudan Cloudflare R2'ye
 * yükler (sunucu diskinden hiç geçmez), sonra elde edilen object key'leri parent'a bildirir.
 */
export function PhotoUploader({ photos, onChange, disabled, label = 'Fotoğraf Ekle' }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);

  async function handleFiles(fileList) {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;
    setError(null);
    setUploading(true);
    try {
      const uploaded = [];
      for (const file of files) {
        const { data } = await apiClient.post('/uploads/presign-upload', {
          fileName: file.name,
          contentType: file.type,
        });
        // Bilerek apiClient değil düz fetch kullanılıyor: presigned URL'e kendi JWT
        // token'ımızı eklememek gerekiyor, sadece imzalanan Content-Type başlığı gitmeli.
        const putRes = await fetch(data.uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': file.type },
          body: file,
        });
        if (!putRes.ok) throw new Error(`"${file.name}" yüklenemedi.`);
        uploaded.push({ key: data.key, originalFileName: file.name, previewUrl: URL.createObjectURL(file) });
      }
      onChange([...(photos || []), ...uploaded]);
    } catch (err) {
      setError(err.message || 'Fotoğraf yüklenirken bir hata oluştu.');
    } finally {
      setUploading(false);
    }
  }

  function removePhoto(key) {
    onChange((photos || []).filter((p) => p.key !== key));
  }

  return (
    <div>
      {error && (
        <div className="mb-2">
          <Alert>{error}</Alert>
        </div>
      )}
      <label
        className={`flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 px-4 py-3 text-sm font-medium text-slate-600 transition hover:border-brand-400 hover:bg-brand-50 ${
          disabled || uploading ? 'pointer-events-none opacity-50' : 'cursor-pointer'
        }`}
      >
        {uploading ? (
          <>
            <Spinner className="h-4 w-4" /> Yükleniyor...
          </>
        ) : (
          <>📷 {label}</>
        )}
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
          multiple
          capture="environment"
          className="hidden"
          disabled={disabled || uploading}
          onChange={(e) => {
            handleFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </label>

      {(photos || []).length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {photos.map((p) => (
            <div key={p.key} className="group relative h-20 w-20 overflow-hidden rounded-lg border border-slate-200">
              <img src={p.previewUrl || p.viewUrl} alt={p.originalFileName || 'fotoğraf'} className="h-full w-full object-cover" />
              <button
                type="button"
                onClick={() => removePhoto(p.key)}
                className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-xs text-white hover:bg-red-600"
                aria-label="Fotoğrafı kaldır"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
