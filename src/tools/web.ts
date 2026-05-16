import type { Tool, ToolContext, ToolResult } from './registry.js';
import {
  truncate,
  stripHtml,
  extractMetadata,
  isUrlSafe,
  fetchUrl,
  extractLinks,
  extractBySelector,
  htmlToMarkdown,
  MAX_RESPONSE_SIZE,
  DEFAULT_TIMEOUT,
} from './web-utils.js';

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
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

  const response = await fetchUrl(url, 'GET', {
    'User-Agent': 'xiaobai-agent/0.4.0',
    'Accept': 'text/html',
  }, undefined, DEFAULT_TIMEOUT);

  const html = response.body;

  const results: SearchResult[] = [];
  const resultRegex = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippetRegex = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;

  let match: RegExpExecArray | null;
  const titles: Array<{ url: string; title: string }> = [];

  while ((match = resultRegex.exec(html)) !== null && titles.length < maxResults * 2) {
    const rawUrl = match[1];
    const rawTitle = stripHtml(match[2]).trim();
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

// Re-export utilities for backward compatibility
export { truncate, stripHtml, extractMetadata, isUrlSafe, extractLinks, extractBySelector, htmlToMarkdown, fetchUrl } from './web-utils.js';
