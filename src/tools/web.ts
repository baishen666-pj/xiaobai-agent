import { spawn, type ChildProcess } from 'node:child_process';
import type { Tool, ToolContext, ToolResult } from './registry.js';

const MAX_WEB_OUTPUT = 50_000;
const MAX_RESPONSE_SIZE = 5 * 1024 * 1024;
const DEFAULT_TIMEOUT = 30_000;
const IS_WIN = process.platform === 'win32';

export function truncate(output: string, max = MAX_WEB_OUTPUT): string {
  if (output.length <= max) return output;
  const half = Math.floor(max / 2) - 20;
  return output.slice(0, half) + `\n\n... [truncated ${output.length - max} chars] ...\n\n` + output.slice(-half);
}

export function stripHtml(html: string): string {
  let text = html;

  // Remove script and style blocks
  text = text.replace(/<script[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[\s\S]*?<\/style>/gi, '');
  text = text.replace(/<noscript[\s\S]*?<\/noscript>/gi, '');

  // Remove HTML tags
  text = text.replace(/<[^>]+>/g, '');

  // Decode common HTML entities
  text = text.replace(/&amp;/g, '&');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  text = text.replace(/&nbsp;/g, ' ');

  // Collapse whitespace
  text = text.replace(/\n{3,}/g, '\n\n');
  text = text.trim();

  return text;
}

export function extractMetadata(html: string): { title?: string; description?: string } {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const descMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([\s\S]*?)["']/i);

  return {
    title: titleMatch?.[1]?.trim() ?? undefined,
    description: descMatch?.[1]?.trim() ?? undefined,
  };
}

const BLOCKED_HOSTS = new Set([
  'localhost', '127.0.0.1', '0.0.0.0', '::1',
  '192.168.', '10.', '172.16.', '172.17.', '172.18.', '172.19.',
  '172.20.', '172.21.', '172.22.', '172.23.', '172.24.', '172.25.',
  '172.26.', '172.27.', '172.28.', '172.29.', '172.30.', '172.31.',
]);

export function isUrlSafe(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    const host = parsed.hostname.toLowerCase();
    if (BLOCKED_HOSTS.has(host)) return false;
    for (const prefix of BLOCKED_HOSTS) {
      if (prefix.endsWith('.') && host.startsWith(prefix)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

// ── fetch tool ──

export const fetchTool: Tool = {
  definition: {
    name: 'fetch',
    description: 'Fetch content from a URL. Returns text content with metadata. Supports HTTP GET and POST.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to fetch' },
        method: { type: 'string', enum: ['GET', 'POST'], description: 'HTTP method', default: 'GET' },
        headers: { type: 'object', description: 'Custom headers (key-value pairs)' },
        body: { type: 'string', description: 'Request body for POST requests' },
        raw: { type: 'boolean', description: 'Return raw HTML instead of stripped text', default: false },
        timeout: { type: 'number', description: 'Timeout in milliseconds', default: 30000 },
      },
      required: ['url'],
    },
  },
  async execute(args): Promise<ToolResult> {
    const { url, method = 'GET', headers = {}, body, raw = false, timeout = DEFAULT_TIMEOUT } = args as {
      url: string;
      method?: string;
      headers?: Record<string, string>;
      body?: string;
      raw?: boolean;
      timeout?: number;
    };

    if (!isUrlSafe(url)) {
      return { output: `URL blocked: internal/private network addresses not allowed`, success: false, error: 'url_blocked' };
    }

    try {
      const fetchHeaders: Record<string, string> = {
        'User-Agent': 'xiaobai-agent/0.4.0',
        'Accept': 'text/html,application/json,text/plain,*/*',
        ...headers,
      };

      const response = await fetchUrl(url, method, fetchHeaders, body, timeout);

      if (response.size > MAX_RESPONSE_SIZE) {
        return {
          output: `Response too large: ${response.size} bytes (max ${MAX_RESPONSE_SIZE})`,
          success: false,
          error: 'response_too_large',
        };
      }

      const contentType = response.headers['content-type'] ?? '';
      const isJson = contentType.includes('application/json');
      const isHtml = contentType.includes('text/html');

      let output: string;

      if (isJson) {
        output = response.body;
      } else if (isHtml && !raw) {
        const meta = extractMetadata(response.body);
        const text = stripHtml(response.body);
        const metaLine = meta.title ? `Title: ${meta.title}\n` : '';
        const descLine = meta.description ? `Description: ${meta.description}\n` : '';
        output = metaLine + descLine + '\n' + truncate(text);
      } else {
        output = truncate(response.body);
      }

      return {
        output,
        success: true,
        metadata: {
          url,
          status: response.status,
          contentType,
          size: response.size,
        },
      };
    } catch (error) {
      return {
        output: `Fetch failed: ${(error as Error).message}`,
        success: false,
        error: 'fetch_error',
      };
    }
  },
};

interface FetchResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  size: number;
}

async function fetchUrl(
  url: string,
  method: string,
  headers: Record<string, string>,
  body?: string,
  timeout?: number,
): Promise<FetchResponse> {
  const abortController = new AbortController();
  const timer = setTimeout(() => abortController.abort(), timeout ?? DEFAULT_TIMEOUT);

  try {
    const init: RequestInit = {
      method,
      headers,
      signal: abortController.signal,
    };

    if (method === 'POST' && body) {
      init.body = body;
    }

    const response = await fetch(url, init);

    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    const responseBody = await response.text();

    return {
      status: response.status,
      headers: responseHeaders,
      body: responseBody,
      size: responseBody.length,
    };
  } finally {
    clearTimeout(timer);
  }
}

// ── search tool ──

export const searchTool: Tool = {
  definition: {
    name: 'search',
    description: 'Search the web using a query. Returns ranked results with titles, URLs, and snippets.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        max_results: { type: 'number', description: 'Maximum results to return', default: 10 },
      },
      required: ['query'],
    },
  },
  async execute(args): Promise<ToolResult> {
    const { query, max_results = 10 } = args as {
      query: string;
      max_results?: number;
    };

    try {
      const results = await webSearch(query, max_results);

      if (results.length === 0) {
        return { output: `No results found for: ${query}`, success: true };
      }

      const lines = results.map((r, i) =>
        `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`,
      );

      return {
        output: truncate(lines.join('\n\n')),
        success: true,
        metadata: { query, count: results.length },
      };
    } catch (error) {
      return {
        output: `Search failed: ${(error as Error).message}`,
        success: false,
        error: 'search_error',
      };
    }
  },
};

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

async function webSearch(query: string, maxResults: number): Promise<SearchResult[]> {
  // Use DuckDuckGo HTML search as a free, no-API-key search engine
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

  const response = await fetchUrl(url, 'GET', {
    'User-Agent': 'xiaobai-agent/0.4.0',
    'Accept': 'text/html',
  }, undefined, DEFAULT_TIMEOUT);

  const html = response.body;

  // Parse DuckDuckGo HTML results
  const results: SearchResult[] = [];
  const resultRegex = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippetRegex = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;

  let match: RegExpExecArray | null;
  const titles: Array<{ url: string; title: string }> = [];

  while ((match = resultRegex.exec(html)) !== null && titles.length < maxResults * 2) {
    const rawUrl = match[1];
    const rawTitle = stripHtml(match[2]).trim();
    // DuckDuckGo wraps URLs in redirect: //duckduckgo.com/l/?uddg=ENCODED_URL
    let cleanUrl = rawUrl;
    const uddgMatch = rawUrl.match(/uddg=([^&]+)/);
    if (uddgMatch) {
      cleanUrl = decodeURIComponent(uddgMatch[1]);
    }
    if (cleanUrl && rawTitle) {
      titles.push({ url: cleanUrl, title: rawTitle });
    }
  }

  const snippets: string[] = [];
  while ((match = snippetRegex.exec(html)) !== null && snippets.length < maxResults * 2) {
    snippets.push(stripHtml(match[1]).trim());
  }

  for (let i = 0; i < Math.min(titles.length, maxResults); i++) {
    results.push({
      title: titles[i].title,
      url: titles[i].url,
      snippet: snippets[i] ?? '',
    });
  }

  return results;
}

// ── scrape tool ──

export const scrapeTool: Tool = {
  definition: {
    name: 'scrape',
    description: 'Scrape and extract structured content from a web page. Returns cleaned text with optional metadata.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to scrape' },
        selector: { type: 'string', description: 'CSS selector to extract specific elements' },
        format: { type: 'string', enum: ['text', 'markdown', 'links'], description: 'Output format', default: 'text' },
        timeout: { type: 'number', description: 'Timeout in milliseconds', default: 30000 },
      },
      required: ['url'],
    },
  },
  async execute(args): Promise<ToolResult> {
    const { url, selector, format = 'text', timeout = DEFAULT_TIMEOUT } = args as {
      url: string;
      selector?: string;
      format?: string;
      timeout?: number;
    };

    if (!isUrlSafe(url)) {
      return { output: `URL blocked: internal/private network addresses not allowed`, success: false, error: 'url_blocked' };
    }

    try {
      const response = await fetchUrl(url, 'GET', {
        'User-Agent': 'xiaobai-agent/0.4.0',
        'Accept': 'text/html',
      }, undefined, timeout);

      if (response.size > MAX_RESPONSE_SIZE) {
        return {
          output: `Response too large: ${response.size} bytes`,
          success: false,
          error: 'response_too_large',
        };
      }

      const html = response.body;
      const meta = extractMetadata(html);

      let output: string;

      if (format === 'links') {
        output = extractLinks(html);
      } else if (format === 'markdown') {
        output = htmlToMarkdown(html, selector);
      } else {
        const text = selector ? extractBySelector(html, selector) : stripHtml(html);
        const metaLine = meta.title ? `Title: ${meta.title}\n` : '';
        output = metaLine + truncate(text);
      }

      return {
        output: truncate(output),
        success: true,
        metadata: {
          url,
          status: response.status,
          title: meta.title,
          description: meta.description,
          size: response.size,
        },
      };
    } catch (error) {
      return {
        output: `Scrape failed: ${(error as Error).message}`,
        success: false,
        error: 'scrape_error',
      };
    }
  },
};

export function extractLinks(html: string): string {
  const linkRegex = /<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const links: Array<{ url: string; text: string }> = [];
  let match: RegExpExecArray | null;

  while ((match = linkRegex.exec(html)) !== null) {
    const href = match[1];
    const text = stripHtml(match[2]).trim();
    if (href && !href.startsWith('#') && !href.startsWith('javascript:')) {
      links.push({ url: href, text });
    }
  }

  return links.map((l) => `${l.text}: ${l.url}`).join('\n');
}

export function extractBySelector(html: string, selector: string): string {
  // Simple selector extraction: tag name, class, or id
  const tagMatch = selector.match(/^(\w+)$/);
  const classMatch = selector.match(/^\.([\w-]+)$/);
  const idMatch = selector.match(/^#([\w-]+)$/);
  const tagClassMatch = selector.match(/^(\w+)\.([\w-]+)$/);

  let regex: RegExp;
  if (tagMatch) {
    regex = new RegExp(`<${tagMatch[1]}[^>]*>([\\s\\S]*?)<\\/${tagMatch[1]}>`, 'gi');
  } else if (classMatch) {
    regex = new RegExp(`<[^>]*class="[^"]*${classMatch[1]}[^"]*"[^>]*>([\\s\\S]*?)<\\/\\w+>`, 'gi');
  } else if (idMatch) {
    regex = new RegExp(`<[^>]*id="${idMatch[1]}"[^>]*>([\\s\\S]*?)<\\/\\w+>`, 'gi');
  } else if (tagClassMatch) {
    regex = new RegExp(`<${tagClassMatch[1]}[^>]*class="[^"]*${tagClassMatch[2]}[^"]*"[^>]*>([\\s\\S]*?)<\\/${tagClassMatch[1]}>`, 'gi');
  } else {
    return `Unsupported selector: ${selector}. Use simple tag, .class, #id, or tag.class selectors.`;
  }

  const parts: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    parts.push(stripHtml(match[1]));
  }

  return parts.join('\n\n');
}

export function htmlToMarkdown(html: string, selector?: string): string {
  const source = selector ? extractBySelectorHtml(html, selector) : html;
  let md = source;

  // Headers
  md = md.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (_, c) => `# ${stripHtml(c)}`);
  md = md.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_, c) => `## ${stripHtml(c)}`);
  md = md.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (_, c) => `### ${stripHtml(c)}`);
  md = md.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, (_, c) => `#### ${stripHtml(c)}`);

  // Bold/italic
  md = md.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/(strong|b)>/gi, (_, _tag, c) => `**${stripHtml(c)}**`);
  md = md.replace(/<(em|i)[^>]*>([\s\S]*?)<\/(em|i)>/gi, (_, _tag, c) => `*${stripHtml(c)}*`);

  // Links
  md = md.replace(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, text) => `[${stripHtml(text)}](${href})`);

  // Code blocks
  md = md.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_, c) => `\`${stripHtml(c)}\``);
  md = md.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_, c) => `\n\`\`\`\n${stripHtml(c)}\n\`\`\`\n`);

  // Lists
  md = md.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, c) => `- ${stripHtml(c)}`);

  // Paragraphs
  md = md.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_, c) => `${stripHtml(c)}\n\n`);

  // Remove remaining tags
  md = stripHtml(md);

  // Clean up
  md = md.replace(/\n{3,}/g, '\n\n');

  return md.trim();
}

function extractBySelectorHtml(html: string, selector: string): string {
  const tagMatch = selector.match(/^(\w+)$/);
  const classMatch = selector.match(/^\.([\w-]+)$/);
  const idMatch = selector.match(/^#([\w-]+)$/);

  let regex: RegExp;
  if (tagMatch) {
    regex = new RegExp(`<${tagMatch[1]}[^>]*>([\\s\\S]*?)<\\/${tagMatch[1]}>`, 'gi');
  } else if (classMatch) {
    regex = new RegExp(`<[^>]*class="[^"]*${classMatch[1]}[^"]*"[^>]*>([\\s\\S]*?)<\\/\\w+>`, 'gi');
  } else if (idMatch) {
    regex = new RegExp(`<[^>]*id="${idMatch[1]}"[^>]*>([\\s\\S]*?)<\\/\\w+>`, 'gi');
  } else {
    return html;
  }

  const parts: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    parts.push(match[1]);
  }

  return parts.join('\n');
}