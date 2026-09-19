import { useState } from 'react';
import { HashRouter, Routes, Route, Navigate, Link } from 'react-router-dom';
import { ThemeProvider } from './theme/ThemeProvider';
import { ThemeControls } from './theme/ThemeControls';
import { LibraryScreen } from './library/LibraryScreen';
import { ReaderShell } from './reader/ReaderShell';
import { NotesView } from './notesview/NotesView';
import { LeaseBanner } from './lease/LeaseBanner';
import { AgentPanel } from './agent/AgentPanel';
import { useMediaQuery } from './agent/useMediaQuery';
import styles from './App.module.css';
import './theme/tokens.css';

export function App() {
  const wide = useMediaQuery('(min-width: 1000px)');
  const [agentOpen, setAgentOpen] = useState(false);
  const [everOpened, setEverOpened] = useState(false);
  const [mobileAgent, setMobileAgent] = useState(false);

  const showReader = !agentOpen || wide || !mobileAgent;
  const showAgent = agentOpen && (wide || mobileAgent);

  const onMenu = () => {
    if (!agentOpen) {
      setAgentOpen(true);
      setEverOpened(true);
      setMobileAgent(true);
    } else if (wide) {
      setAgentOpen(false);
    } else {
      setMobileAgent((v) => !v);
    }
  };

  const buttonLabel = !agentOpen ? 'Agent' : wide ? 'Close agent' : mobileAgent ? 'Reader' : 'Agent';

  return (
    <ThemeProvider>
      <HashRouter>
        <header className={styles.header}>
          <Link to="/" className={styles.brand}>folio</Link>
          <div className={styles.right}>
            <LeaseBanner />
            <button type="button" className={styles.agentBtn} onClick={onMenu}>
              {buttonLabel}
            </button>
            <ThemeControls />
          </div>
        </header>
        <div className={styles.split}>
          <div className={styles.pane} hidden={!showReader}>
            <Routes>
              <Route path="/" element={<LibraryScreen />} />
              <Route path="/book/:bookId" element={<ReaderShell />} />
              <Route path="/book/:bookId/notes" element={<NotesView />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </div>
          {everOpened && (
            <div className={styles.pane} hidden={!showAgent}>
              <AgentPanel active={showAgent} hidden={!showAgent} />
            </div>
          )}
        </div>
      </HashRouter>
    </ThemeProvider>
  );
}
