import chalk from 'chalk';

const LANGUAGES = [
  'javascript', 'typescript', 'python', 'java', 'c', 'cpp',
  'go', 'rust', 'bash', 'json', 'yaml', 'xml', 'css', 'sql',
  'diff', 'markdown', 'plaintext',
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let hljs: any = null;

async function loadHljs(): Promise<void> {
  const coreModule = await import('highlight.js/lib/core');
  hljs = coreModule.default ?? coreModule;

  const languageImports = LANGUAGES.map(async (lang) => {
    const langModule = await import(`highlight.js/lib/languages/${lang}`);
    const mod = langModule.default ?? langModule;
    hljs.registerLanguage(lang, mod);
  });

  await Promise.all(languageImports);
}

const hljsReady = loadHljs();

const LANG_ALIASES: Record<string, string> = {
  js: 'javascript', ts: 'typescript', sh: 'bash', shell: 'bash',
  yml: 'yaml', html: 'xml', jsx: 'javascript', tsx: 'typescript',
  py: 'python', rb: 'ruby', md: 'markdown', text: 'plaintext',
};

const TOKEN_COLORS: Record<string, (s: string) => string> = {
  'hljs-keyword': chalk.magenta,
  'hljs-string': chalk.green,
  'hljs-number': chalk.yellow,
  'hljs-comment': chalk.gray,
  'hljs-function': chalk.blue,
  'hljs-title': chalk.blue,
  'hljs-params': chalk.white,
  'hljs-built_in': chalk.cyan,
  'hljs-literal': chalk.magenta,
  'hljs-type': chalk.cyan,
  'hljs-variable': chalk.white,
  'hljs-attr': chalk.yellow,
  'hljs-selector-tag': chalk.magenta,
  'hljs-tag': chalk.magenta,
  'hljs-name': chalk.blue,
  'hljs-attribute': chalk.yellow,
  'hljs-symbol': chalk.magenta,
  'hljs-meta': chalk.gray,
  'hljs-regexp': chalk.green,
  'hljs-addition': chalk.green,
  'hljs-deletion': chalk.red,
  'hljs-section': chalk.bold.cyan,
};

function htmlToAnsi(html: string): string {
  let result = html;
  result = result.replace(/<span class="([^"]+)">([^<]*)<\/span>/g, (_, cls, text) => {
    for (const tokenClass of cls.split(' ')) {
      const colorFn = TOKEN_COLORS[tokenClass];
      if (colorFn) return colorFn(text);
    }
    return text;
  });
  result = result.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  result = result.replace(/<\/?span[^>]*>/g, '');
  return result;
}

export function highlightCode(code: string, lang?: string): string {
  if (!hljs) return code;

  const resolvedLang = lang ? (LANG_ALIASES[lang] ?? lang) : undefined;

  try {
    let highlighted: string;
    if (resolvedLang && hljs.getLanguage(resolvedLang)) {
      highlighted = hljs.highlight(code, { language: resolvedLang }).value;
    } else {
      highlighted = hljs.highlightAuto(code).value;
    }
    return htmlToAnsi(highlighted);
  } catch {
    return code;
  }
}

export { hljsReady };

export function getLanguageLabel(lang?: string): string {
  if (!lang) return '';
  return chalk.gray(` ${lang} `);
}
