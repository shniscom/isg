import { Link } from 'react-router-dom';
import { Card, Button, Badge } from '../components/ui';
import { useTheme, THEMES, COLOR_MODES, BUTTON_DENSITIES } from '../context/ThemeContext';

const MODE_ICONS = { light: '☀️', dark: '🌙', system: '📱' };

export function AppearancePage() {
  const { themeKey, colorMode, buttonDensity, setThemeKey, setColorMode, setButtonDensity } = useTheme();

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link to="/profil" className="text-sm text-brand-700 hover:underline">
        ‹ Profilim
      </Link>
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Görünüm</h1>
        <p className="mt-1 text-sm text-slate-500">
          Tema, mod ve buton boyutu yalnızca sizin hesabınız için geçerlidir; başka bir cihazda giriş
          yaptığınızda da sizi karşılar.
        </p>
      </div>

      <Card>
        <h2 className="mb-3 font-semibold text-slate-800">Tema</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {THEMES.map((t) => {
            const selected = themeKey === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setThemeKey(t.key)}
                className={`flex items-center gap-3 rounded-2xl border-2 p-3 text-left transition ${
                  selected ? 'border-brand-600 bg-brand-50' : 'border-slate-200 hover:border-brand-200'
                }`}
              >
                <span
                  className="h-11 w-11 shrink-0 rounded-xl shadow-inner"
                  style={{ background: `linear-gradient(135deg, ${t.swatch[0]}, ${t.swatch[1]})` }}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 font-semibold text-slate-800">
                    {t.label}
                    {selected && <span className="text-brand-600">✓</span>}
                  </div>
                  <div className="text-xs text-slate-500">{t.description}</div>
                </div>
              </button>
            );
          })}
        </div>
      </Card>

      <Card>
        <h2 className="mb-3 font-semibold text-slate-800">Mod</h2>
        <div className="flex gap-2">
          {COLOR_MODES.map((m) => (
            <button
              key={m.key}
              type="button"
              onClick={() => setColorMode(m.key)}
              className={`flex-1 rounded-xl border-2 px-3 py-3 text-center text-sm font-medium transition ${
                colorMode === m.key ? 'border-brand-600 bg-brand-50 text-brand-800' : 'border-slate-200 text-slate-600 hover:border-brand-200'
              }`}
            >
              <div className="text-xl">{MODE_ICONS[m.key]}</div>
              <div className="mt-1">{m.label}</div>
            </button>
          ))}
        </div>
      </Card>

      <Card>
        <h2 className="mb-3 font-semibold text-slate-800">Buton / Alan Boyutu</h2>
        <div className="space-y-2">
          {BUTTON_DENSITIES.map((d) => (
            <button
              key={d.key}
              type="button"
              onClick={() => setButtonDensity(d.key)}
              className={`flex w-full items-start gap-3 rounded-xl border-2 p-3 text-left transition ${
                buttonDensity === d.key ? 'border-brand-600 bg-brand-50' : 'border-slate-200 hover:border-brand-200'
              }`}
            >
              <span className="mt-0.5">{buttonDensity === d.key ? '🔘' : '⚪'}</span>
              <div>
                <div className="font-medium text-slate-800">{d.label}</div>
                <div className="text-xs text-slate-500">{d.description}</div>
              </div>
            </button>
          ))}
        </div>
      </Card>

      <Card>
        <h2 className="mb-3 font-semibold text-slate-800">Önizleme</h2>
        <div className="flex flex-wrap items-center gap-2">
          <Button>Ana Buton</Button>
          <Button variant="secondary">İkincil</Button>
          <Button variant="ghost">Metin</Button>
          <Badge variant="info">Rozet</Badge>
          <Badge variant="success">Onaylandı</Badge>
        </div>
      </Card>
    </div>
  );
}
