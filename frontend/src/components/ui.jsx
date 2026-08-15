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
