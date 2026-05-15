import { existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

export function ensureDir(path: string): void {
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
}

export function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + '...';
}

export function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}
