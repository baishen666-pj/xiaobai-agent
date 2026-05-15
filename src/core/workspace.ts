import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

export interface WorkspaceEntry {
  key: string;
  value: unknown;
  updatedAt: number;
  updatedBy: string;
}

export interface WorkspaceFile {
  path: string;
  content: string;
  createdBy: string;
}

export class Workspace {
  private store = new Map<string, WorkspaceEntry>();
  private files = new Map<string, WorkspaceFile>();
  private baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
  }

  async init(): Promise<void> {
    await mkdir(this.baseDir, { recursive: true });
  }

  set(key: string, value: unknown, agentId: string): void {
    this.store.set(key, {
      key,
      value,
      updatedAt: Date.now(),
      updatedBy: agentId,
    });
  }

  get<T = unknown>(key: string): T | undefined {
    return this.store.get(key)?.value as T | undefined;
  }

  has(key: string): boolean {
    return this.store.has(key);
  }

  delete(key: string): boolean {
    return this.store.delete(key);
  }

  entries(): WorkspaceEntry[] {
    return Array.from(this.store.values());
  }

  getByPrefix(prefix: string): WorkspaceEntry[] {
    return this.entries().filter((e) => e.key.startsWith(prefix));
  }

  async writeFile(
    relativePath: string,
    content: string,
    agentId: string,
  ): Promise<string> {
    const fullPath = join(this.baseDir, relativePath);
    const dir = join(fullPath, '..');
    await mkdir(dir, { recursive: true });
    await writeFile(fullPath, content, 'utf-8');

    this.files.set(relativePath, {
      path: fullPath,
      content,
      createdBy: agentId,
    });

    return fullPath;
  }

  async readFile(relativePath: string): Promise<string | null> {
    const cached = this.files.get(relativePath);
    if (cached) return cached.content;

    try {
      const fullPath = join(this.baseDir, relativePath);
      return await readFile(fullPath, 'utf-8');
    } catch {
      return null;
    }
  }

  getFileEntries(): WorkspaceFile[] {
    return Array.from(this.files.values());
  }

  snapshot(): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of this.store) {
      result[key] = entry.value;
    }
    return result;
  }

  clear(): void {
    this.store.clear();
    this.files.clear();
  }

  getBaseDir(): string {
    return this.baseDir;
  }
}
