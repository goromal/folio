import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, beforeEach } from 'vitest';
import { ThemeProvider, useTheme } from './ThemeProvider';

beforeEach(() => localStorage.clear());

function Probe() {
  const { theme, setTheme, fontSize, setFontSize } = useTheme();
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <span data-testid="fs">{fontSize}</span>
      <button onClick={() => setTheme('dark')}>dark</button>
      <button onClick={() => setFontSize(22)}>bigger</button>
    </div>
  );
}

test('toggling theme sets data-theme and persists', async () => {
  render(<ThemeProvider><Probe /></ThemeProvider>);
  await userEvent.click(screen.getByText('dark'));
  expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  expect(localStorage.getItem('folio-theme')).toBe('dark');
});

test('font size updates --reader-fs and persists', async () => {
  render(<ThemeProvider><Probe /></ThemeProvider>);
  await userEvent.click(screen.getByText('bigger'));
  expect(document.documentElement.style.getPropertyValue('--reader-fs')).toBe('22px');
  expect(localStorage.getItem('folio-fs')).toBe('22');
});

test('useTheme throws outside provider', () => {
  const orig = console.error;
  console.error = () => {};
  expect(() => render(<Probe />)).toThrow();
  console.error = orig;
});
