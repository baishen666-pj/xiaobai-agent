import { describe, it, expect, vi, beforeEach } from 'vitest';
import { imageTool } from '../../src/tools/builtin-image.js';

describe('imageTool', () => {
  it('has correct definition', () => {
    expect(imageTool.definition.name).toBe('image');
    expect(imageTool.definition.parameters.required).toContain('action');
  });

  it('rejects unknown action', async () => {
    const result = await imageTool.execute({ action: 'unknown' });
    expect(result.success).toBe(false);
    expect(result.output).toContain('Unknown action');
  });

  describe('generate', () => {
    beforeEach(() => {
      delete process.env['OPENAI_API_KEY'];
    });

    it('rejects missing prompt', async () => {
      const result = await imageTool.execute({ action: 'generate' });
      expect(result.success).toBe(false);
      expect(result.output).toContain('prompt is required');
    });

    it('reports missing API key', async () => {
      const result = await imageTool.execute({ action: 'generate', prompt: 'a cat' });
      expect(result.success).toBe(false);
      expect(result.output).toContain('OPENAI_API_KEY');
    });
  });

  describe('describe', () => {
    it('rejects missing image_path', async () => {
      const result = await imageTool.execute({ action: 'describe' });
      expect(result.success).toBe(false);
      expect(result.output).toContain('image_path');
    });

    it('handles missing file gracefully', async () => {
      const result = await imageTool.execute({ action: 'describe', image_path: '/nonexistent/image.png' });
      expect(result.success).toBe(false);
      expect(result.output).toContain('error');
    });
  });
});
