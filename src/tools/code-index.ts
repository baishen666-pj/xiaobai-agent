import { existsSync, readFileSync, statSync, readdirSync } from 'node:fs';
import { join, extname, relative } from 'node:path';
import type { Tool, ToolContext, ToolResult } from './registry.js';

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

export class CodeIndexer {
  private index: CodeIndex;
  private rootDir: string;
  private watchers = new Map<string, () => void>();

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
    const targetDirs = dirs ?? [this.rootDir];
    let totalFiles = 0;
    let totalSymbols = 0;
    let totalRefs = 0;

    for (const dir of targetDirs) {
      const files = this.walkDir(dir);
      for (const filePath of files) {
        const result = this.indexFile(filePath);
        totalSymbols += result.symbols;
        totalRefs += result.references;
        totalFiles++;
      }
    }

    this.index.updatedAt = Date.now();

    return {
      files: totalFiles,
      symbols: totalSymbols,
      references: totalRefs,
    };
  }

  query(q: IndexQuery): IndexResult {
    const limit = q.limit ?? 50;
    let matches: Array<SymbolDef | SymbolRef[]> = [];

    switch (q.type) {
      case 'symbol':
        matches = this.querySymbol(q.name!, q.kind, limit);
        break;
      case 'references':
        matches = this.queryReferences(q.name!, limit);
        break;
      case 'callers':
        matches = this.queryCallers(q.name!, limit);
        break;
      case 'callees':
        matches = this.queryCallees(q.filePath!, limit);
        break;
      case 'search':
        matches = this.searchSymbols(q.pattern!, q.kind, limit);
        break;
      case 'outline':
        matches = this.fileOutline(q.filePath!, limit);
        break;
    }

    const flat = matches.flat();
    return {
      matches: flat.slice(0, limit),
      total: flat.length,
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

  private indexFile(filePath: string): { symbols: number; references: number } {
    const relPath = relative(this.rootDir, filePath);
    const stat = statSync(filePath);
    const source = readFileSync(filePath, 'utf-8');
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

        const existing = this.index.symbols.get(name) ?? [];
        // Avoid duplicates
        if (!existing.some((d) => d.filePath === relPath && d.line === pos.line)) {
          this.index.symbols.set(name, [...existing, def]);
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
      const modulePath = importMatch[3];
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

        const existing = this.index.references.get(name) ?? [];
        this.index.references.set(name, [...existing, ref]);
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

      const existing = this.index.references.get(name) ?? [];
      this.index.references.set(name, [...existing, ref]);
      refCount++;
    }

    this.index.files.set(relPath, {
      lastModified: stat.mtimeMs,
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
    for (const [name, nameRefs] of this.index.references) {
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

  private walkDir(dir: string): string[] {
    const files: string[] = [];
    const skipDirs = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next', '.nuxt', 'target', '__pycache__', '.venv', 'venv']);

    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!skipDirs.has(entry.name) && !entry.name.startsWith('.')) {
            files.push(...this.walkDir(fullPath));
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
          const { resolve } = await import('node:path');
          const absRoot = resolve(root_dir);
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
          const { resolve } = await import('node:path');
          const absRoot = root_dir ? resolve(root_dir) : process.cwd();
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
          const { resolve } = await import('node:path');
          const absRoot = root_dir ? resolve(root_dir) : process.cwd();
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
          const { resolve } = await import('node:path');
          const absRoot = root_dir ? resolve(root_dir) : process.cwd();
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