import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

let parserInstance: any = null;
const grammarCache = new Map<string, any>();

const EXTENSION_MAP: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'tsx',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.c': 'c',
  '.h': 'c',
  '.cpp': 'cpp',
  '.hpp': 'cpp',
  '.cc': 'cpp',
};

export function getLanguageId(filePath: string): string | null {
  const ext = filePath.substring(filePath.lastIndexOf('.'));
  return EXTENSION_MAP[ext] ?? null;
}

function resolveGrammarPath(langId: string): string {
  return join(__dirname, '..', 'grammars', `tree-sitter-${langId}.wasm`);
}

export async function initParser(): Promise<any> {
  if (parserInstance) return parserInstance;
  const wt = await import('web-tree-sitter');
  const Parser = wt.Parser ?? wt.default?.Parser ?? wt;
  await Parser.init();
  parserInstance = new Parser();
  return parserInstance;
}

export async function loadGrammar(langId: string): Promise<any> {
  const cached = grammarCache.get(langId);
  if (cached) return cached;

  const parser = await initParser();
  const grammarPath = resolveGrammarPath(langId);

  try {
    const buffer = await readFile(grammarPath);
    const language = await parser.getLanguageBuffer(buffer.buffer as ArrayBuffer);
    grammarCache.set(langId, language);
    return language;
  } catch {
    return null;
  }
}

export async function parseFile(
  filePath: string,
  source: string,
): Promise<any | null> {
  const langId = getLanguageId(filePath);
  if (!langId) return null;

  const parser = await initParser();
  const language = await loadGrammar(langId);
  if (!language) return null;

  parser.setLanguage(language);
  return parser.parse(source);
}
