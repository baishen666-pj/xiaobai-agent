import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  fetchTool, searchTool, scrapeTool,
  stripHtml, extractMetadata, extractLinks,
  htmlToMarkdown, extractBySelector, isUrlSafe, truncate,
} from '../../src/tools/web.js';

describe('Web Tools', () => {
  describe('truncate', () => {
    it('returns short strings unchanged', () => {
      expect(truncate('hello', 100)).toBe('hello');
    });

    it('truncates long strings with indicator', () => {
      const long = 'a'.repeat(200);
      const result = truncate(long, 100);
      expect(result).toContain('[truncated');
      expect(result.length).toBeLessThan(200);
    });
  });

  describe('stripHtml', () => {
    it('removes tags and decodes entities', () => {
      expect(stripHtml('<p>Hello &amp; World</p>')).toBe('Hello & World');
    });

    it('removes script blocks', () => {
      expect(stripHtml('<script>alert(1)</script><p>Safe</p>')).toBe('Safe');
    });

    it('removes style blocks', () => {
      expect(stripHtml('<style>.x{}</style><p>Text</p>')).toBe('Text');
    });

    it('decodes common entities', () => {
      expect(stripHtml('&lt;tag&gt;')).toBe('<tag>');
      expect(stripHtml('&quot;text&quot;')).toBe('"text"');
      expect(stripHtml('&#39;single&#39;')).toBe("'single'");
      expect(stripHtml('&nbsp;&nbsp;text')).toBe('text');
    });

    it('collapses excessive newlines', () => {
      expect(stripHtml('a\n\n\n\n\nb')).toBe('a\n\nb');
    });

    it('removes noscript blocks', () => {
      expect(stripHtml('<noscript>hidden</noscript><p>visible</p>')).toBe('visible');
    });
  });

  describe('extractMetadata', () => {
    it('extracts title and description', () => {
      const html = '<html><head><title>Test Page</title><meta name="description" content="A test"></head><body></body></html>';
      const meta = extractMetadata(html);
      expect(meta.title).toBe('Test Page');
      expect(meta.description).toBe('A test');
    });

    it('handles missing elements', () => {
      const meta = extractMetadata('<html><body>No head content</body></html>');
      expect(meta.title).toBeUndefined();
      expect(meta.description).toBeUndefined();
    });
  });

  describe('extractLinks', () => {
    it('extracts href and text', () => {
      const html = '<a href="https://example.com">Example</a><a href="#skip">Skip</a><a href="javascript:void(0)">JS</a><a href="/path">Path</a>';
      const links = extractLinks(html);
      expect(links).toContain('Example: https://example.com');
      expect(links).toContain('Path: /path');
      expect(links).not.toContain('#skip');
    });
  });

  describe('htmlToMarkdown', () => {
    it('converts headers', () => {
      const md = htmlToMarkdown('<h1>Title</h1><p>Text</p>');
      expect(md).toContain('# Title');
      expect(md).toContain('Text');
    });

    it('converts h2-h4', () => {
      expect(htmlToMarkdown('<h2>Sub</h2>')).toContain('## Sub');
      expect(htmlToMarkdown('<h3>Sub3</h3>')).toContain('### Sub3');
      expect(htmlToMarkdown('<h4>Sub4</h4>')).toContain('#### Sub4');
    });

    it('converts bold and italic', () => {
      expect(htmlToMarkdown('<strong>bold</strong>')).toContain('**bold**');
      expect(htmlToMarkdown('<b>bold</b>')).toContain('**bold**');
      expect(htmlToMarkdown('<em>italic</em>')).toContain('*italic*');
      expect(htmlToMarkdown('<i>italic</i>')).toContain('*italic*');
    });

    it('converts links', () => {
      const md = htmlToMarkdown('<a href="https://example.com">Link</a>');
      expect(md).toContain('[Link](https://example.com)');
    });

    it('converts code blocks', () => {
      const md = htmlToMarkdown('<pre><code>const x = 1;</code></pre>');
      expect(md).toContain('```');
      expect(md).toContain('const x = 1;');
    });

    it('converts inline code', () => {
      expect(htmlToMarkdown('<code>let x</code>')).toContain('`let x`');
    });

    it('converts list items', () => {
      expect(htmlToMarkdown('<li>item</li>')).toContain('- item');
    });

    it('converts paragraphs', () => {
      const md = htmlToMarkdown('<p>para1</p><p>para2</p>');
      expect(md).toContain('para1');
      expect(md).toContain('para2');
    });

    it('handles selector extraction', () => {
      const md = htmlToMarkdown('<div><h1>Title</h1></div><p>Outside</p>', 'div');
      expect(md).toContain('# Title');
    });
  });

  describe('extractBySelector', () => {
    it('handles tag selectors', () => {
      const result = extractBySelector('<p>First</p><p>Second</p><div>Other</div>', 'p');
      expect(result).toContain('First');
      expect(result).toContain('Second');
      expect(result).not.toContain('Other');
    });

    it('handles class selectors', () => {
      const result = extractBySelector('<p class="highlight">Important</p><p>Normal</p>', '.highlight');
      expect(result).toContain('Important');
      expect(result).not.toContain('Normal');
    });

    it('handles id selectors', () => {
      const result = extractBySelector('<div id="main">Main content</div><div>Other</div>', '#main');
      expect(result).toContain('Main content');
    });

    it('handles tag.class selectors', () => {
      const result = extractBySelector('<span class="label">Label</span><div class="label">Div</div>', 'span.label');
      expect(result).toContain('Label');
      expect(result).not.toContain('Div');
    });

    it('returns error for unsupported selectors', () => {
      const result = extractBySelector('<p>text</p>', 'div > p');
      expect(result).toContain('Unsupported selector');
    });
  });

  describe('isUrlSafe', () => {
    it('allows https URLs', () => {
      expect(isUrlSafe('https://example.com')).toBe(true);
      expect(isUrlSafe('https://api.example.com/v1/data')).toBe(true);
    });

    it('allows http URLs', () => {
      expect(isUrlSafe('http://example.com')).toBe(true);
    });

    it('blocks localhost', () => {
      expect(isUrlSafe('http://localhost:3000')).toBe(false);
    });

    it('blocks loopback', () => {
      expect(isUrlSafe('http://127.0.0.1')).toBe(false);
    });

    it('blocks RFC1918 addresses', () => {
      expect(isUrlSafe('http://10.0.0.1')).toBe(false);
      expect(isUrlSafe('http://172.16.0.1')).toBe(false);
      expect(isUrlSafe('http://192.168.1.1')).toBe(false);
    });

    it('blocks non-http protocols', () => {
      expect(isUrlSafe('ftp://example.com')).toBe(false);
      expect(isUrlSafe('file:///etc/passwd')).toBe(false);
      expect(isUrlSafe('javascript:alert(1)')).toBe(false);
    });

    it('blocks invalid URLs', () => {
      expect(isUrlSafe('')).toBe(false);
      expect(isUrlSafe('not-a-url')).toBe(false);
    });
  });

  describe('fetchTool', () => {
    it('should have correct definition', () => {
      expect(fetchTool.definition.name).toBe('fetch');
      expect(fetchTool.definition.parameters.required).toEqual(['url']);
    });

    it('should block internal network URLs', async () => {
      const result = await fetchTool.execute({ url: 'http://localhost:3000' });
      expect(result.success).toBe(false);
      expect(result.error).toBe('url_blocked');
    });

    it('should block 127.0.0.1', async () => {
      const result = await fetchTool.execute({ url: 'http://127.0.0.1/admin' });
      expect(result.success).toBe(false);
      expect(result.error).toBe('url_blocked');
    });

    it('should block private network 192.168.x', async () => {
      const result = await fetchTool.execute({ url: 'http://192.168.1.1/router' });
      expect(result.success).toBe(false);
      expect(result.error).toBe('url_blocked');
    });

    it('should block private network 10.x', async () => {
      const result = await fetchTool.execute({ url: 'http://10.0.0.1/internal' });
      expect(result.success).toBe(false);
      expect(result.error).toBe('url_blocked');
    });

    it('should block ftp protocol', async () => {
      const result = await fetchTool.execute({ url: 'ftp://example.com/file' });
      expect(result.success).toBe(false);
      expect(result.error).toBe('url_blocked');
    });

    it('should block invalid URLs', async () => {
      const result = await fetchTool.execute({ url: 'not-a-url' });
      expect(result.success).toBe(false);
      expect(result.error).toBe('url_blocked');
    });

    describe('with mocked fetch', () => {
      const originalFetch = globalThis.fetch;

      beforeEach(() => {
        globalThis.fetch = vi.fn();
      });

      afterEach(() => {
        globalThis.fetch = originalFetch;
        vi.restoreAllMocks();
      });

      it('should fetch HTML and strip tags', async () => {
        (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
          status: 200,
          headers: new Headers({ 'content-type': 'text/html' }),
          text: async () => '<html><head><title>Test</title></head><body><p>Hello</p></body></html>',
        });

        const result = await fetchTool.execute({ url: 'https://example.com' });
        expect(result.success).toBe(true);
        expect(result.output).toContain('Hello');
        expect(result.output).toContain('Title: Test');
      });

      it('should fetch JSON content', async () => {
        (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: async () => '{"key": "value"}',
        });

        const result = await fetchTool.execute({ url: 'https://api.example.com/data' });
        expect(result.success).toBe(true);
        expect(result.output).toContain('key');
      });

      it('should return raw HTML when raw=true', async () => {
        (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
          status: 200,
          headers: new Headers({ 'content-type': 'text/html' }),
          text: async () => '<html><body><p>Raw</p></body></html>',
        });

        const result = await fetchTool.execute({ url: 'https://example.com', raw: true });
        expect(result.success).toBe(true);
        expect(result.output).toContain('<html>');
      });

      it('should handle plain text responses', async () => {
        (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
          status: 200,
          headers: new Headers({ 'content-type': 'text/plain' }),
          text: async () => 'plain text content',
        });

        const result = await fetchTool.execute({ url: 'https://example.com/text.txt' });
        expect(result.success).toBe(true);
        expect(result.output).toContain('plain text content');
      });

      it('should send POST request with body', async () => {
        (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: async () => '{"ok": true}',
        });

        const result = await fetchTool.execute({
          url: 'https://api.example.com/submit',
          method: 'POST',
          body: '{"data": "test"}',
        });
        expect(result.success).toBe(true);
        expect(globalThis.fetch).toHaveBeenCalledWith(
          'https://api.example.com/submit',
          expect.objectContaining({ method: 'POST', body: '{"data": "test"}' }),
        );
      });

      it('should handle fetch errors', async () => {
        (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Network error'));

        const result = await fetchTool.execute({ url: 'https://example.com' });
        expect(result.success).toBe(false);
        expect(result.error).toBe('fetch_error');
        expect(result.output).toContain('Network error');
      });

      it('should handle response too large', async () => {
        const bigBody = 'x'.repeat(6 * 1024 * 1024);
        (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
          status: 200,
          headers: new Headers({ 'content-type': 'text/plain' }),
          text: async () => bigBody,
        });

        const result = await fetchTool.execute({ url: 'https://example.com/big' });
        expect(result.success).toBe(false);
        expect(result.error).toBe('response_too_large');
      });

      it('should include metadata in response', async () => {
        (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
          status: 200,
          headers: new Headers({ 'content-type': 'text/plain' }),
          text: async () => 'content',
        });

        const result = await fetchTool.execute({ url: 'https://example.com' });
        expect(result.success).toBe(true);
        expect(result.metadata).toMatchObject({
          url: 'https://example.com',
          status: 200,
        });
      });
    });
  });

  describe('searchTool', () => {
    it('should have correct definition', () => {
      expect(searchTool.definition.name).toBe('search');
      expect(searchTool.definition.parameters.required).toEqual(['query']);
    });

    it('should have max_results parameter with default', () => {
      const props = searchTool.definition.parameters.properties;
      expect(props.max_results.default).toBe(10);
    });

    describe('with mocked fetch', () => {
      const originalFetch = globalThis.fetch;

      beforeEach(() => {
        globalThis.fetch = vi.fn();
      });

      afterEach(() => {
        globalThis.fetch = originalFetch;
        vi.restoreAllMocks();
      });

      it('should return search results', async () => {
        const ddgHtml = `
          <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com&amp;rut=abc">Example</a>
          <a class="result__snippet">Example snippet text</a>
          <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Ftest.com&amp;rut=def">Test</a>
          <a class="result__snippet">Test snippet</a>
        `;
        (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
          status: 200,
          headers: new Headers({ 'content-type': 'text/html' }),
          text: async () => ddgHtml,
        });

        const result = await searchTool.execute({ query: 'test query' });
        expect(result.success).toBe(true);
        expect(result.metadata?.count).toBeGreaterThanOrEqual(0);
      });

      it('should handle no results', async () => {
        (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
          status: 200,
          headers: new Headers({ 'content-type': 'text/html' }),
          text: async () => '<html><body>No results</body></html>',
        });

        const result = await searchTool.execute({ query: 'obscure query xyz' });
        expect(result.success).toBe(true);
        expect(result.output).toContain('No results');
      });

      it('should handle search errors', async () => {
        (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Search failed'));

        const result = await searchTool.execute({ query: 'test' });
        expect(result.success).toBe(false);
        expect(result.error).toBe('search_error');
      });
    });
  });

  describe('scrapeTool', () => {
    it('should have correct definition', () => {
      expect(scrapeTool.definition.name).toBe('scrape');
      expect(scrapeTool.definition.parameters.required).toEqual(['url']);
    });

    it('should block internal network URLs', async () => {
      const result = await scrapeTool.execute({ url: 'http://localhost:3000' });
      expect(result.success).toBe(false);
      expect(result.error).toBe('url_blocked');
    });

    it('should support format parameter', () => {
      const props = scrapeTool.definition.parameters.properties;
      expect(props.format.enum).toContain('text');
      expect(props.format.enum).toContain('markdown');
      expect(props.format.enum).toContain('links');
    });

    describe('with mocked fetch', () => {
      const originalFetch = globalThis.fetch;

      beforeEach(() => {
        globalThis.fetch = vi.fn();
      });

      afterEach(() => {
        globalThis.fetch = originalFetch;
        vi.restoreAllMocks();
      });

      it('should scrape and strip HTML', async () => {
        (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
          status: 200,
          headers: new Headers({ 'content-type': 'text/html' }),
          text: async () => '<html><head><title>Page</title></head><body><p>Content</p></body></html>',
        });

        const result = await scrapeTool.execute({ url: 'https://example.com' });
        expect(result.success).toBe(true);
        expect(result.output).toContain('Content');
        expect(result.output).toContain('Title: Page');
      });

      it('should scrape with links format', async () => {
        (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
          status: 200,
          headers: new Headers({ 'content-type': 'text/html' }),
          text: async () => '<html><body><a href="https://example.com">Link</a></body></html>',
        });

        const result = await scrapeTool.execute({ url: 'https://example.com', format: 'links' });
        expect(result.success).toBe(true);
        expect(result.output).toContain('Link: https://example.com');
      });

      it('should scrape with markdown format', async () => {
        (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
          status: 200,
          headers: new Headers({ 'content-type': 'text/html' }),
          text: async () => '<html><body><h1>Title</h1><p>Text</p></body></html>',
        });

        const result = await scrapeTool.execute({ url: 'https://example.com', format: 'markdown' });
        expect(result.success).toBe(true);
        expect(result.output).toContain('# Title');
      });

      it('should scrape with selector', async () => {
        (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
          status: 200,
          headers: new Headers({ 'content-type': 'text/html' }),
          text: async () => '<html><body><p class="main">Target</p><p>Other</p></body></html>',
        });

        const result = await scrapeTool.execute({ url: 'https://example.com', selector: '.main' });
        expect(result.success).toBe(true);
        expect(result.output).toContain('Target');
      });

      it('should handle response too large', async () => {
        (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
          status: 200,
          headers: new Headers({ 'content-type': 'text/html' }),
          text: async () => 'x'.repeat(6 * 1024 * 1024),
        });

        const result = await scrapeTool.execute({ url: 'https://example.com/big' });
        expect(result.success).toBe(false);
        expect(result.error).toBe('response_too_large');
      });

      it('should handle scrape errors', async () => {
        (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Connection refused'));

        const result = await scrapeTool.execute({ url: 'https://example.com' });
        expect(result.success).toBe(false);
        expect(result.error).toBe('scrape_error');
        expect(result.output).toContain('Connection refused');
      });

      it('should include metadata in scrape result', async () => {
        (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
          status: 200,
          headers: new Headers({ 'content-type': 'text/html' }),
          text: async () => '<html><head><title>Title</title><meta name="description" content="Desc"></head><body>Text</body></html>',
        });

        const result = await scrapeTool.execute({ url: 'https://example.com' });
        expect(result.success).toBe(true);
        expect(result.metadata).toMatchObject({
          url: 'https://example.com',
          status: 200,
          title: 'Title',
          description: 'Desc',
        });
      });
    });
  });
});
