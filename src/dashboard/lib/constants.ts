export const ROLE_COLORS: Record<string, string> = {
  researcher: '#5b8def',
  coder: '#4caf7d',
  reviewer: '#9c6bca',
  planner: '#d4a843',
  tester: '#d95555',
  coordinator: '#3bb5a0',
};

export const STATUS_COLORS: Record<string, string> = {
  pending: '#888',
  running: '#5b8def',
  completed: '#4caf7d',
  failed: '#d95555',
};

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
