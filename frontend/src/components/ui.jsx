import { useState } from 'react';

export function Button({ children, variant = 'primary', className = '', ...props }) {
  const base = 'inline-flex items-center justify-center gap-2 rounded-xl px-5 py-3.5 font-semibold text-base transition active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none min-h-[48px]';
  const variants = {
    primary: 'bg-brand-700 text-white hover:bg-brand-800 shadow-sm',
    secondary: 'bg-white text-brand-800 border border-brand-200 hover:bg-brand-50',
    danger: 'bg-red-600 text-white hover:bg-red-700',
    ghost: 'text-brand-700 hover:bg-brand-50',
  };
  return (
    <button className={`${base} ${variants[variant]} ${className}`} {...props}>
      {children}
    </button>
  );
}

export function Input({ label, error, className = '', ...props }) {
  return (
    <label className="block">
      {label && <span className="mb-1.5 block text-sm font-medium text-slate-700">{label}</span>}
      <input
        className={`w-full rounded-xl border px-4 py-3 text-base outline-none transition focus:ring-2 focus:ring-brand-500 ${
          error ? 'border-red-400 bg-red-50' : 'border-slate-300 bg-white'
        } ${className}`}
        {...props}
      />
      {error && <span className="mt-1 block text-sm text-red-600">{error}</span>}
    </label>
  );
}

export function PasswordInput({ label, error, className = '', ...props }) {
  const [visible, setVisible] = useState(false);
  return (
    <label className="block">
      {label && <span className="mb-1.5 block text-sm font-medium text-slate-700">{label}</span>}
      <div className="relative">
        <input
          type={visible ? 'text' : 'password'}
          className={`w-full rounded-xl border px-4 py-3 pr-12 text-base outline-none transition focus:ring-2 focus:ring-brand-500 ${
            error ? 'border-red-400 bg-red-50' : 'border-slate-300 bg-white'
          } ${className}`}
          {...props}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-slate-400 hover:text-slate-600"
          aria-label={visible ? 'Şifreyi gizle' : 'Şifreyi göster'}
          tabIndex={-1}
        >
          {visible ? (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
            </svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          )}
        </button>
      </div>
      {error && <span className="mt-1 block text-sm text-red-600">{error}</span>}
    </label>
  );
}

export function Textarea({ label, error, className = '', ...props }) {
  return (
    <label className="block">
      {label && <span className="mb-1.5 block text-sm font-medium text-slate-700">{label}</span>}
      <textarea
        className={`w-full rounded-xl border px-4 py-3 text-base outline-none transition focus:ring-2 focus:ring-brand-500 ${
          error ? 'border-red-400 bg-red-50' : 'border-slate-300 bg-white'
        } ${className}`}
        rows={4}
        {...props}
      />
      {error && <span className="mt-1 block text-sm text-red-600">{error}</span>}
    </label>
  );
}

export function Select({ label, error, children, className = '', ...props }) {
  return (
    <label className="block">
      {label && <span className="mb-1.5 block text-sm font-medium text-slate-700">{label}</span>}
      <select
        className={`w-full rounded-xl border px-4 py-3 text-base outline-none transition focus:ring-2 focus:ring-brand-500 ${
          error ? 'border-red-400 bg-red-50' : 'border-slate-300 bg-white'
        } ${className}`}
        {...props}
      >
        {children}
      </select>
      {error && <span className="mt-1 block text-sm text-red-600">{error}</span>}
    </label>
  );
}

export function Card({ children, className = '' }) {
  return <div className={`rounded-2xl border border-slate-200 bg-white p-5 shadow-sm ${className}`}>{children}</div>;
}

export function Alert({ children, variant = 'error' }) {
  const variants = {
    error: 'bg-red-50 text-red-700 border-red-200',
    success: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    info: 'bg-blue-50 text-blue-700 border-blue-200',
    warning: 'bg-amber-50 text-amber-800 border-amber-200',
  };
  return <div className={`rounded-xl border px-4 py-3 text-sm ${variants[variant]}`}>{children}</div>;
}

export function Badge({ children, variant = 'default' }) {
  const variants = {
    default: 'bg-slate-100 text-slate-700',
    success: 'bg-emerald-100 text-emerald-700',
    danger: 'bg-red-100 text-red-700',
    warning: 'bg-amber-100 text-amber-800',
    info: 'bg-blue-100 text-blue-700',
    orange: 'bg-orange-100 text-orange-700',
    purple: 'bg-purple-100 text-purple-700',
  };
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${variants[variant] || variants.default}`}>{children}</span>;
}

export function Spinner({ className = '' }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

export function FullScreenLoader({ label = 'Yükleniyor...' }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-slate-50">
      <Spinner className="h-8 w-8 text-brand-700" />
      <p className="text-sm text-slate-500">{label}</p>
    </div>
  );
}
