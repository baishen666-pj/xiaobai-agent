import { createContext, useContext, useState, type ReactNode } from 'react';
import { useLocalStorage } from './useLocalStorage.js';
import { useWebSocket } from './useWebSocket.js';
import type { ClientMessage, DashboardState } from '../types.js';

export interface DashboardContextValue extends DashboardState {
  connect: () => void;
  disconnect: () => void;
  send: (msg: ClientMessage) => void;
  setEventFilter: (filter: string) => void;
  theme: 'dark' | 'light';
  toggleTheme: () => void;
  wsUrl: string;
  setWsUrl: (url: string) => void;
  activeSessionId: string;
  setActiveSessionId: (id: string) => void;
}

export const DashboardContext = createContext<DashboardContextValue | null>(null);

export function useDashboardContext(): DashboardContextValue {
  const ctx = useContext(DashboardContext);
  if (!ctx) throw new Error('useDashboardContext must be used within DashboardProvider');
  return ctx;
}

export function DashboardProvider({ children }: { children: ReactNode }) {
  const [wsUrl, setWsUrl] = useLocalStorage('xiaobai-ws-url', 'ws://localhost:3001');
  const [theme, setTheme] = useLocalStorage<'dark' | 'light'>('xiaobai-theme', 'dark');
  const [activeSessionId, setActiveSessionId] = useState('');

  const ws = useWebSocket(wsUrl);

  const value: DashboardContextValue = {
    ...ws,
    theme,
    toggleTheme: () => setTheme((t) => t === 'dark' ? 'light' : 'dark'),
    wsUrl,
    setWsUrl,
    activeSessionId,
    setActiveSessionId,
  };

  return (
    <DashboardContext.Provider value={value}>
      {children}
    </DashboardContext.Provider>
  );
}
