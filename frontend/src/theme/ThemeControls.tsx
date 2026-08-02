import { useTheme } from './ThemeProvider';

export function ThemeControls() {
  const { theme, setTheme, fontSize, setFontSize } = useTheme();
  return (
    <div className="theme-controls">
      <button
        aria-label="Toggle dark mode"
        onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      >
        {theme === 'dark' ? '☀' : '☾'}
      </button>
      <button aria-label="Decrease text size" onClick={() => setFontSize(Math.max(12, fontSize - 2))}>
        A−
      </button>
      <button aria-label="Increase text size" onClick={() => setFontSize(Math.min(32, fontSize + 2))}>
        A+
      </button>
    </div>
  );
}
