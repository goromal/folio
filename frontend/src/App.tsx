import { HashRouter, Routes, Route, Navigate, Link } from 'react-router-dom';
import { ThemeProvider } from './theme/ThemeProvider';
import { ThemeControls } from './theme/ThemeControls';
import { LibraryScreen } from './library/LibraryScreen';
import { ReaderShell } from './reader/ReaderShell';
import './theme/tokens.css';

export function App() {
  return (
    <ThemeProvider>
      <HashRouter>
        <header
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '0.5rem 1rem',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <Link to="/" style={{ fontWeight: 700, color: 'var(--fg)', textDecoration: 'none' }}>
            folio
          </Link>
          <ThemeControls />
        </header>
        <Routes>
          <Route path="/" element={<LibraryScreen />} />
          <Route path="/book/:bookId" element={<ReaderShell />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </HashRouter>
    </ThemeProvider>
  );
}
