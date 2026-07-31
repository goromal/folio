import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

type Theme = 'light' | 'dark';

interface ThemeCtx {
  theme: Theme;
  setTheme: (t: Theme) => void;
  fontSize: number;
  setFontSize: (n: number) => void;
}

const Ctx = createContext<ThemeCtx | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem('folio-theme') as Theme) || 'light',
  );
  const [fontSize, setFontSize] = useState<number>(
    () => Number(localStorage.getItem('folio-fs')) || 18,
  );

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('folio-theme', theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.style.setProperty('--reader-fs', `${fontSize}px`);
    localStorage.setItem('folio-fs', String(fontSize));
  }, [fontSize]);

  return (
    <Ctx.Provider value={{ theme, setTheme, fontSize, setFontSize }}>
      {children}
    </Ctx.Provider>
  );
}

export function useTheme(): ThemeCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useTheme must be used within ThemeProvider');
  return c;
}
