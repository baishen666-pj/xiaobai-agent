import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve, normalize } from 'node:path';

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

const IS_WIN = process.platform === 'win32';

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

  private validatePath(relativePath: string): string {
    const fullPath = normalize(resolve(this.baseDir, relativePath));
    const normalizedBase = normalize(resolve(this.baseDir));
    if (!fullPath.startsWith(normalizedBase + (IS_WIN ? '\\' : '/')) && fullPath !== normalizedBase) {
      throw new Error(`Path traversal detected: ${relativePath}`);
    }
    return fullPath;
  }

  async writeFile(
    relativePath: string,
    content: string,
    agentId: string,
  ): Promise<string> {
    const fullPath = this.validatePath(relativePath);
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
      const fullPath = this.validatePath(relativePath);
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

  async save(): Promise<void> {
    const state = {
      store: Array.from(this.store.entries()).map(([key, entry]) => [key, entry]),
      files: Array.from(this.files.entries()).map(([path, file]) => [path, file]),
      savedAt: new Date().toISOString(),
    };

    const statePath = join(this.baseDir, 'workspace-state.json');
    await mkdir(this.baseDir, { recursive: true });
    await writeFile(statePath, JSON.stringify(state, null, 2), 'utf-8');
  }

  async load(): Promise<boolean> {
    const statePath = join(this.baseDir, 'workspace-state.json');
    try {
      const raw = await readFile(statePath, 'utf-8');
      const state = JSON.parse(raw) as {
        store?: Array<[string, WorkspaceEntry]>;
        files?: Array<[string, WorkspaceFile]>;
      };

      this.store.clear();
      this.files.clear();

      if (state.store) {
        for (const [key, entry] of state.store) {
          this.store.set(key, entry);
        }
      }

      if (state.files) {
        for (const [path, file] of state.files) {
          this.files.set(path, file);
        }
      }

      return true;
    } catch {
      return false;
    }
  }
}
