import { isPathSafe, truncate } from './builtin-shell.js';
import { existsSync } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, resolve, extname, relative } from 'node:path';
import type { Tool, ToolContext, ToolResult } from './registry.js';

const MAX_GRAPH_NODES = 500;
const DEFAULT_DEPTH = 3;

const IMPORT_RE =
  /(?:import\s+(?:type\s+)?[\s\S]*?from|require\s*\(|export\s+(?:type\s+)?[\s\S]*?from)\s*['"]([^'"]+)['"]/g;

const PARSEABLE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
]);

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.nuxt', 'coverage',
]);

export const depsTool: Tool = {
  definition: {
    name: 'deps',
    description:
      'Analyze dependency graphs: list imports, find dependents, detect orphans and circular dependencies.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['graph', 'imports', 'dependents', 'orphans', 'circular'],
          description: 'Analysis action to perform',
        },
        file_path: {
          type: 'string',
          description: 'File path for imports/dependents',
        },
        root_dir: {
          type: 'string',
          description: 'Root directory for graph/orphans/circular',
        },
        depth: {
          type: 'number',
          description: 'Traversal depth (default 3)',
        },
      },
      required: ['action'],
    },
  },

  async execute(
    args: Record<string, unknown>,
    context?: ToolContext,
  ): Promise<ToolResult> {
    const action = args.action as string;
    const depth = (args.depth as number) ?? DEFAULT_DEPTH;

    if (action === 'imports' || action === 'dependents') {
      return handleFileAction(action, args, context);
    }

    if (action === 'graph' || action === 'orphans' || action === 'circular') {
      return handleDirAction(action, args, depth, context);
    }

    return {
      output: `Unknown action: ${action}`,
      success: false,
      error: 'invalid_action',
    };
  },
};

async function handleFileAction(
  action: string,
  args: Record<string, unknown>,
  context?: ToolContext,
): Promise<ToolResult> {
  const filePath = args.file_path as string;
  if (!filePath) {
    return {
      output: 'file_path is required for imports/dependents action.',
      success: false,
      error: 'missing_param',
    };
  }

  const absPath = resolve(filePath);
  if (!isPathSafe(absPath)) {
    return {
      output: `Access denied: ${filePath}`,
      success: false,
      error: 'access_denied',
    };
  }

  try {
    const s = await stat(absPath);
    if (!s.isFile()) {
      return {
        output: `Not a file: ${filePath}`,
        success: false,
        error: 'not_a_file',
      };
    }
  } catch {
    return {
      output: `File not found: ${filePath}`,
      success: false,
      error: 'file_not_found',
    };
  }

  const content = await readFile(absPath, 'utf-8');
  const imports = extractImports(content, absPath);

  if (action === 'imports') {
    if (imports.length === 0) {
      return {
        output: `No imports found in ${filePath}`,
        success: true,
      };
    }
    return {
      output: `Imports of ${filePath}:\n${imports.join('\n')}`,
      success: true,
    };
  }

  // dependents: need a root_dir to scan
  const rootDir = args.root_dir as string;
  if (!rootDir) {
    return {
      output: 'root_dir is required for dependents action to scan.',
      success: false,
      error: 'missing_param',
    };
  }

  const absRoot = resolve(rootDir);
  if (!isPathSafe(absRoot)) {
    return {
      output: `Access denied: ${rootDir}`,
      success: false,
      error: 'access_denied',
    };
  }

  const graph = await buildGraph(absRoot);
  const normalizedTarget = absPath.replace(/\\/g, '/');
  const dependents: string[] = [];

  for (const [file, deps] of graph) {
    if (deps.has(normalizedTarget)) {
      dependents.push(file);
    }
  }

  if (dependents.length === 0) {
    return {
      output: `No dependents found for ${filePath}`,
      success: true,
    };
  }

  return {
    output: `Dependents of ${filePath}:\n${dependents.join('\n')}`,
    success: true,
  };
}

async function handleDirAction(
  action: string,
  args: Record<string, unknown>,
  depth: number,
  context?: ToolContext,
): Promise<ToolResult> {
  const rootDir = args.root_dir as string;
  if (!rootDir) {
    return {
      output: 'root_dir is required for graph/orphans/circular action.',
      success: false,
      error: 'missing_param',
    };
  }

  const absRoot = resolve(rootDir);
  if (!isPathSafe(absRoot)) {
    return {
      output: `Access denied: ${rootDir}`,
      success: false,
      error: 'access_denied',
    };
  }

  try {
    const s = await stat(absRoot);
    if (!s.isDirectory()) {
      return {
        output: `Not a directory: ${rootDir}`,
        success: false,
        error: 'not_a_directory',
      };
    }
  } catch {
    return {
      output: `Directory not found: ${rootDir}`,
      success: false,
      error: 'dir_not_found',
    };
  }

  const graph = await buildGraph(absRoot);

  if (graph.size === 0) {
    return {
      output: `No parseable files found in ${rootDir}`,
      success: true,
    };
  }

  if (action === 'graph') {
    return formatGraph(graph, absRoot, depth);
  }

  if (action === 'orphans') {
    return findOrphans(graph, absRoot);
  }

  if (action === 'circular') {
    return findCircular(graph);
  }

  return {
    output: `Unknown action: ${action}`,
    success: false,
    error: 'invalid_action',
  };
}

function extractImports(content: string, fromFile: string): string[] {
  const imports: string[] = [];
  const dir = resolve(fromFile, '..');
  let match: RegExpExecArray | null;

  IMPORT_RE.lastIndex = 0;
  while ((match = IMPORT_RE.exec(content)) !== null) {
    const spec = match[1];
    if (!spec) continue;

    // Only resolve relative imports
    if (spec.startsWith('.')) {
      const resolved = resolveImportPath(dir, spec);
      if (resolved) {
        imports.push(resolved.replace(/\\/g, '/'));
      }
    }
  }

  return imports;
}

function resolveImportPath(dir: string, specifier: string): string | null {
  const fullPath = resolve(dir, specifier);

  // Try exact path
  if (hasParseableExt(fullPath)) {
    return existsSync(fullPath) ? fullPath : null;
  }

  // Try extensions
  for (const ext of PARSEABLE_EXTENSIONS) {
    const candidate = fullPath + ext;
    if (existsSync(candidate)) return candidate;
  }

  // Try index files
  for (const ext of PARSEABLE_EXTENSIONS) {
    const candidate = join(fullPath, `index${ext}`);
    if (existsSync(candidate)) return candidate;
  }

  return null;
}

function hasParseableExt(path: string): boolean {
  return PARSEABLE_EXTENSIONS.has(extname(path));
}

async function collectFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  let nodeCount = 0;

  async function walk(current: string): Promise<void> {
    if (nodeCount >= MAX_GRAPH_NODES) return;

    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (nodeCount >= MAX_GRAPH_NODES) return;
      if (SKIP_DIRS.has(entry.name)) continue;

      const fullPath = join(current, entry.name);

      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && hasParseableExt(fullPath)) {
        files.push(fullPath);
        nodeCount++;
      }
    }
  }

  await walk(dir);
  return files;
}

async function buildGraph(rootDir: string): Promise<Map<string, Set<string>>> {
  const graph = new Map<string, Set<string>>();
  const files = await collectFiles(rootDir);

  for (const file of files) {
    const normalizedFile = file.replace(/\\/g, '/');
    let content: string;
    try {
      content = await readFile(file, 'utf-8');
    } catch {
      continue;
    }

    const imports = extractImports(content, file);
    graph.set(normalizedFile, new Set(imports));
  }

  return graph;
}

function formatGraph(
  graph: Map<string, Set<string>>,
  rootDir: string,
  depth: number,
): ToolResult {
  const lines: string[] = [`Import graph (${graph.size} files):`];

  let count = 0;
  for (const [file, deps] of graph) {
    if (count >= depth * 50) break;
    const rel = relative(rootDir, file).replace(/\\/g, '/');
    const depList = Array.from(deps)
      .slice(0, depth)
      .map((d) => '  -> ' + relative(rootDir, d).replace(/\\/g, '/'));
    lines.push(rel);
    lines.push(...depList);
    count++;
  }

  return {
    output: truncate(lines.join('\n')),
    success: true,
    metadata: { nodeCount: graph.size },
  };
}

function findOrphans(
  graph: Map<string, Set<string>>,
  rootDir: string,
): ToolResult {
  const imported = new Set<string>();
  for (const deps of graph.values()) {
    for (const dep of deps) {
      imported.add(dep);
    }
  }

  const orphans: string[] = [];
  for (const file of graph.keys()) {
    if (!imported.has(file)) {
      orphans.push(relative(rootDir, file).replace(/\\/g, '/'));
    }
  }

  if (orphans.length === 0) {
    return {
      output: 'No orphan files found.',
      success: true,
    };
  }

  return {
    output: `Orphan files (${orphans.length}):\n${orphans.join('\n')}`,
    success: true,
    metadata: { orphanCount: orphans.length },
  };
}

function findCircular(graph: Map<string, Set<string>>): ToolResult {
  const visited = new Set<string>();
  const inStack = new Set<string>();
  const cycles: string[][] = [];

  function dfs(node: string, path: string[]): void {
    if (inStack.has(node)) {
      const cycleStart = path.indexOf(node);
      if (cycleStart !== -1) {
        cycles.push(path.slice(cycleStart).concat(node));
      }
      return;
    }
    if (visited.has(node)) return;

    visited.add(node);
    inStack.add(node);
    path.push(node);

    const deps = graph.get(node);
    if (deps) {
      for (const dep of deps) {
        if (graph.has(dep)) {
          dfs(dep, [...path]);
        }
      }
    }

    inStack.delete(node);
  }

  for (const node of graph.keys()) {
    if (!visited.has(node)) {
      dfs(node, []);
    }
  }

  if (cycles.length === 0) {
    return {
      output: 'No circular dependencies detected.',
      success: true,
    };
  }

  const lines = cycles.slice(0, 20).map((cycle, i) => {
    return `[${i + 1}] ${cycle.join(' -> ')}`;
  });

  return {
    output: `Circular dependencies (${cycles.length}):\n${lines.join('\n')}`,
    success: true,
    metadata: { cycleCount: cycles.length },
  };
}
