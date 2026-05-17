import { existsSync } from 'node:fs';
import { readFile, writeFile, stat, readdir } from 'node:fs/promises';
import { join, extname, relative, resolve as pathResolve } from 'node:path';
import type { Tool, ToolContext, ToolResult } from './registry.js';
import { extractSymbolsAST } from './ast-symbols.js';

export interface SymbolDef {
  name: string;
  kind: 'function' | 'class' | 'interface' | 'type' | 'variable' | 'enum' | 'method' | 'property' | 'import' | 'export';
  filePath: string;
  line: number;
  column: number;
  exported: boolean;
  parent?: string;
}

export interface SymbolRef {
  name: string;
  filePath: string;
  line: number;
  column: number;
  kind: 'usage' | 'call' | 'import';
}

export interface CodeIndex {
  symbols: Map<string, SymbolDef[]>;
  references: Map<string, SymbolRef[]>;
  files: Map<string, { lastModified: number; symbolCount: number }>;
  createdAt: number;
  updatedAt: number;
}

export interface SerializedIndex {
  symbols: Array<[string, SymbolDef[]]>;
  references: Array<[string, SymbolRef[]]>;
  files: Array<[string, { lastModified: number; symbolCount: number }]>;
  createdAt: number;
  updatedAt: number;
  rootDir: string;
}

export interface IndexQuery {
  type: 'symbol' | 'references' | 'callers' | 'callees' | 'search' | 'outline';
  name?: string;
  filePath?: string;
  pattern?: string;
  kind?: SymbolDef['kind'];
  limit?: number;
}

export interface IndexResult {
  matches: Array<SymbolDef | SymbolRef>;
  total: number;
  query: IndexQuery;
}

const SUPPORTED_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.go', '.rs', '.java', '.c', '.cpp', '.h', '.hpp',
]);

const SYMBOL_PATTERNS: Array<{ kind: SymbolDef['kind']; pattern: RegExp; group: number }> = [
  { kind: 'function', pattern: /(?:export\s+)?(?:async\s+)?function\s+(\w+)/g, group: 1 },
  { kind: 'class', pattern: /(?:export\s+)?(?:default\s+)?class\s+(\w+)/g, group: 1 },
  { kind: 'interface', pattern: /(?:export\s+)?interface\s+(\w+)/g, group: 1 },
  { kind: 'type', pattern: /(?:export\s+)?type\s+(\w+)\s*[=<{]/g, group: 1 },
  { kind: 'enum', pattern: /(?:export\s+)?enum\s+(\w+)/g, group: 1 },
  { kind: 'variable', pattern: /(?:export\s+)?(?:const|let|var)\s+(\w+)/g, group: 1 },
  { kind: 'method', pattern: /(?:public|private|protected)?\s*(?:async\s+)?(\w+)\s*\(/g, group: 1 },
];

const CACHE_FILE = '.xiaobai-index.json';
const MAX_CACHE_AGE_MS = 30 * 60 * 1000; // 30 minutes

export class CodeIndexer {
  private index: CodeIndex;
  private rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = rootDir;
    this.index = {
      symbols: new Map(),
      references: new Map(),
      files: new Map(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  async buildIndex(dirs?: string[]): Promise<{ files: number; symbols: number; references: number }> {
    const loaded = await this.loadCachedIndex();
    const targetDirs = dirs ?? [this.rootDir];
    let totalFiles = 0;
    let totalSymbols = 0;
    let totalRefs = 0;

    for (const dir of targetDirs) {
      const files = await this.walkDir(dir);
      for (const filePath of files) {
        const relPath = relative(this.rootDir, filePath);
        let fileStat;
        try {
          fileStat = await stat(filePath);
        } catch {
          continue;
        }

        const cached = this.index.files.get(relPath);
        if (cached && cached.lastModified === fileStat.mtimeMs && loaded) {
          totalFiles++;
          continue; // skip unchanged files
        }

        // Remove stale data for this file before re-indexing
        this.removeFileFromIndex(relPath);

        const result = await this.indexFile(filePath);
        totalSymbols += result.symbols;
        totalRefs += result.references;
        totalFiles++;
      }
    }

    this.index.updatedAt = Date.now();
    await this.saveCachedIndex();

    return {
      files: totalFiles,
      symbols: totalSymbols,
      references: totalRefs,
    };
  }

  query(q: IndexQuery): IndexResult {
    const limit = q.limit ?? 50;
    const matches: Array<SymbolDef | SymbolRef> = [];

    switch (q.type) {
      case 'symbol':
        matches.push(...this.querySymbol(q.name!, q.kind, limit));
        break;
      case 'references':
        matches.push(...this.queryReferences(q.name!, limit));
        break;
      case 'callers':
        matches.push(...this.queryCallers(q.name!, limit));
        break;
      case 'callees':
        matches.push(...this.queryCallees(q.filePath!, limit));
        break;
      case 'search':
        matches.push(...this.searchSymbols(q.pattern!, q.kind, limit));
        break;
      case 'outline':
        matches.push(...this.fileOutline(q.filePath!, limit));
        break;
    }

    return {
      matches: matches.slice(0, limit),
      total: matches.length,
      query: q,
    };
  }

  getStats(): { files: number; symbols: number; references: number; updatedAt: number } {
    let symbolCount = 0;
    let refCount = 0;
    for (const defs of this.index.symbols.values()) symbolCount += defs.length;
    for (const refs of this.index.references.values()) refCount += refs.length;

    return {
      files: this.index.files.size,
      symbols: symbolCount,
      references: refCount,
      updatedAt: this.index.updatedAt,
    };
  }

  private removeFileFromIndex(relPath: string): void {
    for (const [name, defs] of this.index.symbols) {
      const filtered = defs.filter((d) => d.filePath !== relPath);
      if (filtered.length === 0) this.index.symbols.delete(name);
      else if (filtered.length < defs.length) this.index.symbols.set(name, filtered);
    }
    for (const [name, refs] of this.index.references) {
      const filtered = refs.filter((r) => r.filePath !== relPath);
      if (filtered.length === 0) this.index.references.delete(name);
      else if (filtered.length < refs.length) this.index.references.set(name, filtered);
    }
    this.index.files.delete(relPath);
  }

  private async loadCachedIndex(): Promise<boolean> {
    const cachePath = join(this.rootDir, CACHE_FILE);
    if (!existsSync(cachePath)) return false;
    try {
      const raw = await readFile(cachePath, 'utf-8');
      const data: SerializedIndex = JSON.parse(raw);
      if (data.rootDir !== this.rootDir) return false;
      if (Date.now() - data.updatedAt > MAX_CACHE_AGE_MS) return false;
      this.index = {
        symbols: new Map(data.symbols),
        references: new Map(data.references),
        files: new Map(data.files),
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
      };
      return true;
    } catch {
      return false;
    }
  }

  private async saveCachedIndex(): Promise<void> {
    const cachePath = join(this.rootDir, CACHE_FILE);
    const data: SerializedIndex = {
      symbols: [...this.index.symbols.entries()],
      references: [...this.index.references.entries()],
      files: [...this.index.files.entries()],
      createdAt: this.index.createdAt,
      updatedAt: this.index.updatedAt,
      rootDir: this.rootDir,
    };
    try {
      await writeFile(cachePath, JSON.stringify(data), 'utf-8');
    } catch {
      // cache write failure is non-critical
    }
  }

  private async indexFile(filePath: string): Promise<{ symbols: number; references: number }> {
    const relPath = relative(this.rootDir, filePath);
    let fileStat;
    let source: string;
    try {
      fileStat = await stat(filePath);
      source = await readFile(filePath, 'utf-8');
    } catch {
      return { symbols: 0, references: 0 };
    }

    // Try AST-based extraction first
    try {
      const astResult = await extractSymbolsAST(source, filePath, relPath);
      if (astResult) {
        for (const def of astResult.symbols) {
          const existing = this.index.symbols.get(def.name);
          if (!existing) {
            this.index.symbols.set(def.name, [def]);
          } else if (!existing.some((d) => d.filePath === relPath && d.line === def.line)) {
            existing.push(def);
          }
        }
        for (const ref of astResult.references) {
          const existing = this.index.references.get(ref.name);
          if (existing) {
            existing.push(ref);
          } else {
            this.index.references.set(ref.name, [ref]);
          }
        }
        this.index.files.set(relPath, {
          lastModified: fileStat.mtimeMs,
          symbolCount: astResult.symbols.length,
        });
        return { symbols: astResult.symbols.length, references: astResult.references.length };
      }
    } catch {
      // AST extraction failed, fall through to regex
    }

    // Regex fallback
    const lines = source.split('\n');

    let symbolCount = 0;
    let refCount = 0;

    // Extract symbol definitions
    for (const { kind, pattern } of SYMBOL_PATTERNS) {
      const regex = new RegExp(pattern.source, pattern.flags);
      let match: RegExpExecArray | null;

      while ((match = regex.exec(source)) !== null) {
        const name = match[1];
        if (!name || /^[0-9]/.test(name) || name === 'constructor') continue;

        const pos = this.getLineCol(source, match.index);
        const isExported = this.isExported(source, match.index);

        const def: SymbolDef = {
          name,
          kind,
          filePath: relPath,
          line: pos.line,
          column: pos.column,
          exported: isExported,
        };

        const existing = this.index.symbols.get(name);
        if (!existing) {
          this.index.symbols.set(name, [def]);
          symbolCount++;
        } else if (!existing.some((d) => d.filePath === relPath && d.line === pos.line)) {
          existing.push(def);
          symbolCount++;
        }
      }
    }

    // Extract import references
    const importPattern = /import\s+(?:\{([^}]+)\}|(\w+))\s+from\s+['"]([^'"]+)['"]/g;
    let importMatch: RegExpExecArray | null;
    while ((importMatch = importPattern.exec(source)) !== null) {
      const namedImports = importMatch[1];
      const defaultImport = importMatch[2];
      const pos = this.getLineCol(source, importMatch.index);

      const names: string[] = [];
      if (namedImports) {
        names.push(...namedImports.split(',').map((s) => s.trim().split(/\s+as\s+/).pop()!.trim()));
      }
      if (defaultImport) {
        names.push(defaultImport);
      }

      for (const name of names) {
        if (!name) continue;
        const ref: SymbolRef = {
          name,
          filePath: relPath,
          line: pos.line,
          column: pos.column,
          kind: 'import',
        };

        const existing = this.index.references.get(name);
        if (existing) {
          existing.push(ref);
        } else {
          this.index.references.set(name, [ref]);
        }
        refCount++;
      }
    }

    // Extract usage references (identifiers that aren't definitions)
    const usagePattern = /\b([A-Z]\w+)\b/g;
    let usageMatch: RegExpExecArray | null;
    const seenUsages = new Set<string>();
    while ((usageMatch = usagePattern.exec(source)) !== null) {
      const name = usageMatch[1];
      const pos = this.getLineCol(source, usageMatch.index);
      const key = `${name}:${relPath}:${pos.line}`;

      if (seenUsages.has(key)) continue;
      seenUsages.add(key);

      // Skip if this is a definition line
      const lineText = lines[pos.line - 1] ?? '';
      if (/\b(function|class|interface|type|enum|const|let|var)\s+/.test(lineText) && lineText.includes(name)) {
        continue;
      }

      const ref: SymbolRef = {
        name,
        filePath: relPath,
        line: pos.line,
        column: pos.column,
        kind: 'usage',
      };

      const existing = this.index.references.get(name);
      if (existing) {
        existing.push(ref);
      } else {
        this.index.references.set(name, [ref]);
      }
      refCount++;
    }

    this.index.files.set(relPath, {
      lastModified: fileStat.mtimeMs,
      symbolCount,
    });

    return { symbols: symbolCount, references: refCount };
  }

  private querySymbol(name: string, kind?: SymbolDef['kind'], limit: number = 50): SymbolDef[] {
    const defs = this.index.symbols.get(name) ?? [];
    const filtered = kind ? defs.filter((d) => d.kind === kind) : defs;
    return filtered.slice(0, limit);
  }

  private queryReferences(name: string, limit: number = 50): SymbolRef[] {
    const refs = this.index.references.get(name) ?? [];
    return refs.slice(0, limit);
  }

  private queryCallers(name: string, limit: number = 50): SymbolRef[] {
    const refs = this.index.references.get(name) ?? [];
    return refs.filter((r) => r.kind === 'call' || r.kind === 'usage').slice(0, limit);
  }

  private queryCallees(filePath: string, limit: number = 50): SymbolRef[] {
    const refs: SymbolRef[] = [];
    for (const [, nameRefs] of this.index.references) {
      for (const ref of nameRefs) {
        if (ref.filePath === filePath) {
          refs.push(ref);
          if (refs.length >= limit) return refs;
        }
      }
    }
    return refs;
  }

  private searchSymbols(pattern: string, kind?: SymbolDef['kind'], limit: number = 50): SymbolDef[] {
    const regex = new RegExp(pattern, 'i');
    const results: SymbolDef[] = [];

    for (const [name, defs] of this.index.symbols) {
      if (regex.test(name)) {
        const filtered = kind ? defs.filter((d) => d.kind === kind) : defs;
        results.push(...filtered);
        if (results.length >= limit) break;
      }
    }

    return results.slice(0, limit);
  }

  private fileOutline(filePath: string, limit: number = 100): SymbolDef[] {
    const results: SymbolDef[] = [];

    for (const [, defs] of this.index.symbols) {
      for (const def of defs) {
        if (def.filePath === filePath) {
          results.push(def);
        }
      }
    }

    return results.sort((a, b) => a.line - b.line).slice(0, limit);
  }

  private async walkDir(dir: string): Promise<string[]> {
    const files: string[] = [];
    const skipDirs = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next', '.nuxt', 'target', '__pycache__', '.venv', 'venv']);

    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!skipDirs.has(entry.name) && !entry.name.startsWith('.')) {
            files.push(...await this.walkDir(fullPath));
          }
        } else if (entry.isFile()) {
          const ext = extname(entry.name);
          if (SUPPORTED_EXTENSIONS.has(ext)) {
            files.push(fullPath);
          }
        }
      }
    } catch {
      // Skip directories we can't read
    }

    return files;
  }

  private getLineCol(source: string, offset: number): { line: number; column: number } {
    const before = source.slice(0, offset);
    const line = (before.match(/\n/g) ?? []).length + 1;
    const lastNewline = before.lastIndexOf('\n');
    const column = offset - lastNewline;
    return { line, column };
  }

  private isExported(source: string, offset: number): boolean {
    const lineStart = source.lastIndexOf('\n', offset - 1) + 1;
    const lineEnd = source.indexOf('\n', offset);
    const line = source.slice(lineStart, lineEnd === -1 ? source.length : lineEnd);
    return /\bexport\b/.test(line);
  }
}

// ── Code Index Tool ──

export const codeIndexTool: Tool = {
  definition: {
    name: 'code_index',
    description: 'Build and query a code symbol index. Supports finding definitions, references, callers, callees, and searching symbols by pattern.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['build', 'query', 'stats', 'outline'],
          description: 'Action to perform: build index, query symbols, get stats, or file outline',
        },
        root_dir: { type: 'string', description: 'Root directory for building index' },
        query_type: {
          type: 'string',
          enum: ['symbol', 'references', 'callers', 'callees', 'search'],
          description: 'Type of query',
        },
        name: { type: 'string', description: 'Symbol name to query' },
        file_path: { type: 'string', description: 'File path for outline/callees queries' },
        pattern: { type: 'string', description: 'Regex pattern for search queries' },
        kind: {
          type: 'string',
          enum: ['function', 'class', 'interface', 'type', 'variable', 'enum', 'method', 'property'],
          description: 'Filter by symbol kind',
        },
        limit: { type: 'number', description: 'Maximum results', default: 50 },
      },
      required: ['action'],
    },
  },
  async execute(args): Promise<ToolResult> {
    const { action, root_dir, query_type, name, file_path, pattern, kind, limit = 50 } = args as {
      action: string;
      root_dir?: string;
      query_type?: string;
      name?: string;
      file_path?: string;
      pattern?: string;
      kind?: string;
      limit?: number;
    };

    try {
      switch (action) {
        case 'build': {
          if (!root_dir) {
            return { output: 'build requires root_dir', success: false, error: 'missing_params' };
          }
          const absRoot = pathResolve(root_dir);
          if (!existsSync(absRoot)) {
            return { output: `Directory not found: ${absRoot}`, success: false, error: 'dir_not_found' };
          }
          const indexer = new CodeIndexer(absRoot);
          const result = await indexer.buildIndex();
          return {
            output: `Index built: ${result.files} files, ${result.symbols} symbols, ${result.references} references`,
            success: true,
            metadata: result,
          };
        }

        case 'query': {
          if (!query_type || !name) {
            return { output: 'query requires query_type and name', success: false, error: 'missing_params' };
          }
          const absRoot = root_dir ? pathResolve(root_dir) : process.cwd();
          const indexer = new CodeIndexer(absRoot);
          await indexer.buildIndex();
          const result = indexer.query({
            type: query_type as IndexQuery['type'],
            name,
            kind: kind as SymbolDef['kind'],
            limit,
          });
          const lines = result.matches.map((m) => {
            if ('kind' in m && 'exported' in m) {
              const def = m as SymbolDef;
              return `${def.kind} ${def.name} at ${def.filePath}:${def.line}:${def.column}${def.exported ? ' (exported)' : ''}`;
            }
            const ref = m as SymbolRef;
            return `${ref.kind} ${ref.name} at ${ref.filePath}:${ref.line}:${ref.column}`;
          });
          return {
            output: lines.length > 0 ? lines.join('\n') : `No results for ${query_type}: ${name}`,
            success: true,
            metadata: { total: result.total },
          };
        }

        case 'stats': {
          const absRoot = root_dir ? pathResolve(root_dir) : process.cwd();
          const indexer = new CodeIndexer(absRoot);
          await indexer.buildIndex();
          const stats = indexer.getStats();
          return {
            output: `Index stats: ${stats.files} files, ${stats.symbols} symbols, ${stats.references} references`,
            success: true,
            metadata: stats,
          };
        }

        case 'outline': {
          if (!file_path) {
            return { output: 'outline requires file_path', success: false, error: 'missing_params' };
          }
          const absRoot = root_dir ? pathResolve(root_dir) : process.cwd();
          const indexer = new CodeIndexer(absRoot);
          await indexer.buildIndex();
          const result = indexer.query({ type: 'outline', filePath: file_path, limit });
          const lines = result.matches.map((m) => {
            const def = m as SymbolDef;
            return `  ${def.line}:${def.column} ${def.kind} ${def.name}${def.exported ? ' (exported)' : ''}`;
          });
          return {
            output: lines.length > 0 ? `Outline for ${file_path}:\n${lines.join('\n')}` : `No symbols found in ${file_path}`,
            success: true,
            metadata: { total: result.total },
          };
        }

        default:
          return { output: `Unknown action: ${action}`, success: false, error: 'unknown_action' };
      }
    } catch (error) {
      return {
        output: `Code index failed: ${(error as Error).message}`,
        success: false,
        error: 'index_error',
      };
    }
  },
};
