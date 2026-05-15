import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, sep } from 'node:path';
import { homedir } from 'node:os';

const CONTEXT_FILES = ['XIAOBAI.md', 'CLAUDE.md', '.claudemd', 'AGENTS.md'];
const MAX_CONTEXT_SIZE = 32 * 1024;

export interface ContextLayer {
  path: string;
  relativeTo: string;
  content: string;
}

export interface ContextLoadResult {
  layers: ContextLayer[];
  merged: string;
  totalChars: number;
}

export function loadHierarchicalContext(
  startDir: string,
  options?: { maxDepth?: number; maxChars?: number },
): ContextLoadResult {
  const maxDepth = options?.maxDepth ?? 20;
  const maxChars = options?.maxChars ?? MAX_CONTEXT_SIZE;
  const layers: ContextLayer[] = [];
  let totalChars = 0;

  let dir = startDir;
  let depth = 0;

  while (dir && depth < maxDepth && totalChars < maxChars) {
    const file = findContextFile(dir);
    if (file) {
      const content = readFileSync(file, 'utf-8').trim();
      if (content) {
        const layer: ContextLayer = {
          path: file,
          relativeTo: startDir,
          content,
        };
        layers.unshift(layer);
        totalChars += content.length;
        if (totalChars >= maxChars) break;
      }
    }

    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
    depth++;
  }

  const globalCtx = loadGlobalContext();
  if (globalCtx && totalChars + globalCtx.length < maxChars) {
    layers.unshift({
      path: join(homedir(), '.xiaobai', 'XIAOBAI.md'),
      relativeTo: startDir,
      content: globalCtx,
    });
    totalChars += globalCtx.length;
  }

  return {
    layers,
    merged: layers.map((l) => l.content).join('\n\n'),
    totalChars,
  };
}

function findContextFile(dir: string): string | null {
  for (const name of CONTEXT_FILES) {
    const path = join(dir, name);
    if (existsSync(path)) return path;
  }
  return null;
}

function loadGlobalContext(): string | null {
  const globalPath = join(homedir(), '.xiaobai', 'XIAOBAI.md');
  if (!existsSync(globalPath)) return null;
  return readFileSync(globalPath, 'utf-8').trim() || null;
}

export function buildContextSystemPrompt(context: ContextLoadResult): string | null {
  if (context.layers.length === 0) return null;

  const parts: string[] = ['## Project Context'];
  for (const layer of context.layers) {
    const rel = layer.path.replace(homedir(), '~');
    parts.push(`<!-- from ${rel} -->`);
    parts.push(layer.content);
  }
  return parts.join('\n');
}
