import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import apiClient from '../api/client';
import { useAuth } from './AuthContext';

const ThemeContext = createContext(null);

const STORAGE_KEY = 'isg_takip_appearance_v1';
const DEFAULTS = { themeKey: 'klasik', colorMode: 'system', buttonDensity: 'compact' };

// index.html'deki önyükleme betiğiyle (flash-of-wrong-theme önlemek için) ve backend'deki
// seed/şema varsayılanlarıyla (users.theme_key/color_mode/button_density) senkron tutulmalıdır.
export const THEMES = [
  { key: 'klasik', label: 'Klasik Mavi', description: 'Sistemin bugüne kadarki mevcut rengi.', swatch: ['#3b82f6', '#1d4ed8'] },
  { key: 'kirmizi', label: 'Kırmızı Enerji', description: 'Canlı, dikkat çekici kırmızı-mercan tonları.', swatch: ['#f87171', '#b91c1c'] },
  { key: 'lacivert-turuncu', label: 'Lacivert - Turuncu', description: 'Koyu modda en özgün haline kavuşan, şık fintech tarzı.', swatch: ['#fb923c', '#c2410c'] },
  { key: 'turkuaz', label: 'Turkuaz Sağlık', description: 'Sakin, İSG/sağlık temasına yakın turkuaz tonlar.', swatch: ['#2dd4bf', '#0f766e'] },
  { key: 'mor', label: 'Mor Sağlık', description: 'Yumuşak, modern mor-indigo tonları.', swatch: ['#a78bfa', '#6d28d9'] },
];

export const COLOR_MODES = [
  { key: 'light', label: 'Aydınlık' },
  { key: 'dark', label: 'Karanlık' },
  { key: 'system', label: 'Cihaza Göre' },
];

export const BUTTON_DENSITIES = [
  { key: 'compact', label: 'İnce (önerilen)', description: 'Daha az yer kaplayan, ince butonlar ve alanlar.' },
  { key: 'comfortable', label: 'Rahat', description: 'Daha önceki, kalın buton/alan boyutları.' },
];

function loadCached() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw);
    return { ...DEFAULTS, ...parsed };
  } catch {
    return DEFAULTS;
  }
}

function applyToDom({ themeKey, colorMode, buttonDensity }) {
  const root = document.documentElement;
  root.setAttribute('data-theme', themeKey);
  root.setAttribute('data-density', buttonDensity);
  const resolvedDark = colorMode === 'dark' || (colorMode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  root.classList.toggle('dark', resolvedDark);
}

export function ThemeProvider({ children }) {
  const { user, status } = useAuth();
  const [prefs, setPrefs] = useState(loadCached);

  // Her tercih değişiminde <html> özniteliklerini güncelle ve cihazda önbelleğe al (bir
  // sonraki açılışta sayfa çizilmeden önce doğru tema uygulanabilsin diye; bkz. index.html).
  useEffect(() => {
    applyToDom(prefs);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    } catch {
      // localStorage'a erişilemiyorsa (gizli sekme vb.) sessizce yok say.
    }
  }, [prefs]);

  // "Cihaza göre" seçiliyken işletim sistemi/tarayıcı teması değişirse anında yansısın.
  useEffect(() => {
    if (prefs.colorMode !== 'system') return undefined;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => applyToDom(prefs);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [prefs]);

  // Kullanıcı giriş yaptığında (veya /auth/me tazelendiğinde) hesabına kayıtlı tercihi benimser;
  // böylece farklı bir cihazda açıldığında da kendi teması karşılar.
  useEffect(() => {
    if (status !== 'authenticated' || !user) return;
    const fromAccount = {
      themeKey: user.themeKey || DEFAULTS.themeKey,
      colorMode: user.colorMode || DEFAULTS.colorMode,
      buttonDensity: user.buttonDensity || DEFAULTS.buttonDensity,
    };
    setPrefs((prev) =>
      prev.themeKey === fromAccount.themeKey && prev.colorMode === fromAccount.colorMode && prev.buttonDensity === fromAccount.buttonDensity
        ? prev
        : fromAccount
    );
  }, [user, status]);

  const update = useCallback(
    async (patch) => {
      setPrefs((prev) => ({ ...prev, ...patch }));
      if (status === 'authenticated') {
        try {
          await apiClient.patch('/auth/me/appearance', patch);
        } catch {
          // Ağ hatası olsa bile tercih yerelde zaten uygulandı; kullanıcıyı bloklamaya gerek yok.
        }
      }
    },
    [status]
  );

  const value = useMemo(
    () => ({
      themeKey: prefs.themeKey,
      colorMode: prefs.colorMode,
      buttonDensity: prefs.buttonDensity,
      setThemeKey: (themeKey) => update({ themeKey }),
      setColorMode: (colorMode) => update({ colorMode }),
      setButtonDensity: (buttonDensity) => update({ buttonDensity }),
    }),
    [prefs, update]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme, ThemeProvider içinde kullanılmalıdır.');
  return ctx;
}
