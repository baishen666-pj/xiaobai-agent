import { watch, type FSWatcher } from 'node:fs';
import { extname } from 'node:path';

export interface FileWatcherOptions {
  rootDir: string;
  debounceMs?: number;
  onIndexUpdated?: (stats: { filesChecked: number; duration: number }) => void;
  excludeDirs?: string[];
  includeExtensions?: string[];
}

const DEFAULT_EXCLUDE_DIRS = ['node_modules', '.git', 'dist', 'build', 'coverage', '.xiaobai'];

const DEFAULT_INCLUDE_EXTENSIONS = [
  '.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java', '.c', '.cpp', '.h',
];

export class FileWatcher {
  private watcher?: FSWatcher;
  private debounceTimer?: ReturnType<typeof setTimeout>;
  private changedFiles = new Set<string>();
  private options: {
    rootDir: string;
    debounceMs: number;
    onIndexUpdated?: (stats: { filesChecked: number; duration: number }) => void;
    excludeDirs: string[];
    includeExtensions: string[];
  };

  constructor(options: FileWatcherOptions) {
    this.options = {
      rootDir: options.rootDir,
      debounceMs: options.debounceMs ?? 500,
      onIndexUpdated: options.onIndexUpdated,
      excludeDirs: options.excludeDirs ?? DEFAULT_EXCLUDE_DIRS,
      includeExtensions: options.includeExtensions ?? DEFAULT_INCLUDE_EXTENSIONS,
    };
  }

  start(): void {
    if (this.watcher) {
      return;
    }

    const includeSet = new Set(this.options.includeExtensions);
    const excludeSet = new Set(this.options.excludeDirs);

    this.watcher = watch(this.options.rootDir, { recursive: true }, (eventType, filename) => {
      if (!filename) return;

      // Skip excluded directories
      const segments = filename.split(/[/\\]/);
      if (segments.some((seg) => excludeSet.has(seg))) return;

      // Only watch files with included extensions
      const ext = extname(filename);
      if (!includeSet.has(ext)) return;

      const fullPath = `${this.options.rootDir}/${filename}`;

      this.changedFiles.add(fullPath);

      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
      }

      this.debounceTimer = setTimeout(() => {
        this.flush();
      }, this.options.debounceMs);
    });
  }

  private flush(): void {
    const files = new Set(this.changedFiles);
    this.changedFiles.clear();
    this.debounceTimer = undefined;

    const start = Date.now();

    if (this.options.onIndexUpdated) {
      this.options.onIndexUpdated({
        filesChecked: files.size,
        duration: Date.now() - start,
      });
    }
  }

  stop(): void {
    this.watcher?.close();
    this.watcher = undefined;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = undefined;
    }
    this.changedFiles.clear();
  }

  getWatchedFiles(): number {
    return this.changedFiles.size;
  }
}
