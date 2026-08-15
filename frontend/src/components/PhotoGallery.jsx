export function PhotoGallery({ photos }) {
  if (!photos || photos.length === 0) {
    return <p className="text-sm text-slate-400">Fotoğraf eklenmemiş.</p>;
  }
  return (
    <div className="flex flex-wrap gap-2">
      {photos.map((p) =>
        p.viewUrl ? (
          <a key={p.id} href={p.viewUrl} target="_blank" rel="noreferrer" className="block h-24 w-24 overflow-hidden rounded-lg border border-slate-200">
            <img src={p.viewUrl} alt={p.originalFileName || 'fotoğraf'} className="h-full w-full object-cover" />
          </a>
        ) : (
          <div key={p.id} className="flex h-24 w-24 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-xs text-slate-400">
            Yüklenemedi
          </div>
        )
      )}
    </div>
  );
}
