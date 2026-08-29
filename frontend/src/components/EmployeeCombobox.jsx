import { useEffect, useRef, useState } from 'react';

/**
 * Uzun çalışan listelerinde isim yazdıkça filtreleyen aranabilir seçici. Native <select> çok
 * firma/çalışan olan projelerde kullanışsız hale geldiği için bunun yerine kullanılır - gerçek
 * bir metin girişi olduğundan mobilde dokununca klavye otomatik açılır ve yazdıkça liste anında
 * filtrelenir (Uygunsuzluk açma ve Kaza/Ramak Kala bildirme formlarının ikisinde de kullanılır).
 */
export function EmployeeCombobox({ employees, value, onChange, placeholder = 'İsim veya TC no yazarak arayın...' }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
        setQuery('');
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selected = employees.find((e) => e.id === value);
  const normalizedQuery = query.trim().toLowerCase();
  const filtered = normalizedQuery
    ? employees.filter(
        (e) => e.fullName.toLowerCase().includes(normalizedQuery) || (e.nationalId || '').includes(query.trim())
      )
    : employees;

  function select(id) {
    onChange(id);
    setOpen(false);
    setQuery('');
  }

  return (
    <div className="relative" ref={containerRef}>
      <input
        type="text"
        className="w-full rounded-[var(--btn-radius)] border border-slate-300 bg-surface px-4 py-3 pr-9 text-base outline-none transition focus:ring-2 focus:ring-brand-500"
        placeholder={placeholder}
        value={open ? query : selected ? selected.fullName : ''}
        onFocus={() => {
          setOpen(true);
          setQuery('');
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
      />
      {selected && !open && (
        <button
          type="button"
          onClick={() => onChange('')}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
          aria-label="Seçimi temizle"
        >
          ✕
        </button>
      )}
      {open && (
        <div className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-slate-200 bg-surface shadow-lg">
          <button type="button" onClick={() => select('')} className="block w-full px-4 py-2.5 text-left text-sm text-slate-500 hover:bg-slate-50">
            Seçiniz (yok)
          </button>
          {filtered.length === 0 && <p className="px-4 py-2.5 text-sm text-slate-400">Sonuç bulunamadı.</p>}
          {filtered.map((emp) => (
            <button
              key={emp.id}
              type="button"
              onClick={() => select(emp.id)}
              className={`block w-full px-4 py-2.5 text-left text-sm hover:bg-brand-50 ${
                emp.id === value ? 'bg-brand-50 font-medium text-brand-700' : 'text-slate-700'
              }`}
            >
              {emp.fullName}
              {emp.warningCount > 0 ? ` (${emp.warningCount} önceki kayıt)` : ''}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
