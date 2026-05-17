export const MAX_WEB_OUTPUT = 50_000;
export const MAX_RESPONSE_SIZE = 5 * 1024 * 1024;
export const DEFAULT_TIMEOUT = 30_000;

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
  // Link-local / cloud metadata endpoints
  '169.254.',
  // 0.0.x.x addresses
  '0.',
  // IPv6 loopback / mapped variants
  '::',
  '::ffff:127.0.0.1',
  '::ffff:7f00:1',
  '0:0:0:0:0:0:0:0',
  // IPv6 link-local
  'fe80:',
  // IPv6 unique local addresses
  'fc00:',
  'fd00:',
]);

function isHostSafe(host: string): boolean {
  const lowered = host.toLowerCase();

  // Block decimal IP representations (e.g. 2130706433 = 127.0.0.1)
  const asNum = Number(lowered);
  if (!isNaN(asNum) && asNum > 0 && Number.isInteger(asNum)) {
    const octets = [
      (asNum >>> 24) & 0xff,
      (asNum >>> 16) & 0xff,
      (asNum >>> 8) & 0xff,
      asNum & 0xff,
    ];
    const dottedIp = octets.join('.');
    if (!isHostSafe(dottedIp)) return false;
  }

  // Block octal IP representations (e.g. 0177.0.0.1 = 127.0.0.1)
  if (/^0[0-7]+(\.[0-7]+){0,3}$/.test(lowered)) {
    const octets = lowered.split('.').map((octet) => parseInt(octet, 8));
    const dottedIp = octets.join('.');
    if (!isHostSafe(dottedIp)) return false;
  }

  if (BLOCKED_HOSTS.has(lowered)) return false;
  for (const prefix of BLOCKED_HOSTS) {
    if (prefix.endsWith('.') && lowered.startsWith(prefix)) return false;
    if (prefix.endsWith(':') && lowered.startsWith(prefix)) return false;
  }
  return true;
}

export function isUrlSafe(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    // URL parser wraps IPv6 addresses in brackets (e.g. "[::1]");
    // strip them so the blocklist matches bare IPv6 forms.
    let host = parsed.hostname.toLowerCase();
    if (host.startsWith('[') && host.endsWith(']')) {
      host = host.slice(1, -1);
    }
    return isHostSafe(host);
  } catch {
    return false;
  }
}

export interface FetchResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  size: number;
}

export async function fetchUrl(
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

function buildSelectorRegex(selector: string): RegExp | null {
  const tagMatch = selector.match(/^(\w+)$/);
  const classMatch = selector.match(/^\.([\w-]+)$/);
  const idMatch = selector.match(/^#([\w-]+)$/);
  const tagClassMatch = selector.match(/^(\w+)\.([\w-]+)$/);

  if (tagMatch) {
    return new RegExp(`<${tagMatch[1]}[^>]*>([\\s\\S]*?)<\\/${tagMatch[1]}>`, 'gi');
  } else if (classMatch) {
    return new RegExp(`<[^>]*class="[^"]*${classMatch[1]}[^"]*"[^>]*>([\\s\\S]*?)<\\/\\w+>`, 'gi');
  } else if (idMatch) {
    return new RegExp(`<[^>]*id="${idMatch[1]}"[^>]*>([\\s\\S]*?)<\\/\\w+>`, 'gi');
  } else if (tagClassMatch) {
    return new RegExp(`<${tagClassMatch[1]}[^>]*class="[^"]*${tagClassMatch[2]}[^"]*"[^>]*>([\\s\\S]*?)<\\/${tagClassMatch[1]}>`, 'gi');
  }
  return null;
}

export function extractBySelector(html: string, selector: string): string {
  const regex = buildSelectorRegex(selector);
  if (!regex) {
    return `Unsupported selector: ${selector}. Use simple tag, .class, #id, or tag.class selectors.`;
  }

  const parts: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    parts.push(stripHtml(match[1]));
  }

  return parts.join('\n\n');
}

export function extractBySelectorHtml(html: string, selector: string): string {
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
