import { vi } from 'vitest';
import type { DashboardContextValue } from '../../../src/dashboard/hooks/useDashboardContext.js';

export function createMockContext(overrides?: Partial<DashboardContextValue>): DashboardContextValue {
  return {
    connected: false,
    events: [],
    agents: [],
    tasks: [],
    tokenTotal: 0,
    chatMessages: [],
    chatTokenTotal: 0,
    eventFilter: 'all',
    tokenHistory: [],
    progressEvents: {},
    connect: vi.fn(),
    disconnect: vi.fn(),
    send: vi.fn(),
    setEventFilter: vi.fn(),
    theme: 'dark' as const,
    toggleTheme: vi.fn(),
    wsUrl: 'ws://localhost:3001',
    setWsUrl: vi.fn(),
    activeSessionId: '',
    setActiveSessionId: vi.fn(),
    ...overrides,
  };
}
