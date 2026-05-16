import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateDiff, generateDiffPreview } from '../../src/cli/permissions.js';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ---------------------------------------------------------------------------
// generateDiff
// ---------------------------------------------------------------------------
describe('generateDiff', () => {
  it('returns empty summary for identical content', () => {
    const result = generateDiff('hello\nworld', 'hello\nworld');
    // Should show 0 added, 0 removed
    expect(result).toContain('0 lines added');
    expect(result).toContain('0 lines removed');
  });

  it('shows added lines with green prefix', () => {
    const result = generateDiff('', 'new line');
    expect(result).toContain('+ new line');
    expect(result).toContain('1 line added');
    expect(result).toContain('0 lines removed');
  });

  it('shows removed lines with red prefix', () => {
    const result = generateDiff('old line', '');
    expect(result).toContain('- old line');
    expect(result).toContain('0 lines added');
    expect(result).toContain('1 line removed');
  });

  it('handles single line change', () => {
    const result = generateDiff('old', 'new');
    expect(result).toContain('- old');
    expect(result).toContain('+ new');
  });

  it('handles multi-line change', () => {
    const oldContent = 'line1\nline2\nline3';
    const newContent = 'line1\nchanged\nline3';
    const result = generateDiff(oldContent, newContent);
    expect(result).toContain('- line2');
    expect(result).toContain('+ changed');
  });

  it('handles multi-line addition', () => {
    const result = generateDiff('line1', 'line1\nline2\nline3');
    expect(result).toContain('+ line2');
    expect(result).toContain('+ line3');
    expect(result).toContain('2 lines added');
    expect(result).toContain('0 lines removed');
  });

  it('handles multi-line removal', () => {
    const result = generateDiff('line1\nline2\nline3', 'line1');
    expect(result).toContain('- line2');
    expect(result).toContain('- line3');
    expect(result).toContain('0 lines added');
    expect(result).toContain('2 lines removed');
  });

  it('truncates when changes exceed maxLines', () => {
    const oldLines = Array.from({ length: 30 }, (_, i) => `old${i}`).join('\n');
    const newLines = Array.from({ length: 30 }, (_, i) => `new${i}`).join('\n');
    const result = generateDiff(oldLines, newLines, 10);
    expect(result).toContain('more changes not shown');
  });

  it('respects custom maxLines parameter', () => {
    const oldContent = Array.from({ length: 10 }, (_, i) => `old${i}`).join('\n');
    const newContent = '';
    const result = generateDiff(oldContent, newContent, 5);
    expect(result).toContain('more changes not shown');
  });

  it('does not show truncation message when within maxLines', () => {
    const result = generateDiff('a\nb\nc', 'x\ny\nz', 20);
    expect(result).not.toContain('more changes not shown');
  });

  it('handles empty old and new content', () => {
    const result = generateDiff('', '');
    expect(result).toContain('0 lines added');
    expect(result).toContain('0 lines removed');
  });

  it('handles single line identical content', () => {
    const result = generateDiff('same', 'same');
    expect(result).toContain('0 lines added');
    expect(result).toContain('0 lines removed');
  });

  it('preserves common prefix lines', () => {
    const oldContent = 'keep1\nkeep2\nold';
    const newContent = 'keep1\nkeep2\nnew';
    const result = generateDiff(oldContent, newContent);
    expect(result).toContain('- old');
    expect(result).toContain('+ new');
    // Common prefix lines should NOT appear as changes
    expect(result).not.toContain('- keep1');
    expect(result).not.toContain('- keep2');
  });

  it('preserves common suffix lines', () => {
    const oldContent = 'old\nkeep1\nkeep2';
    const newContent = 'new\nkeep1\nkeep2';
    const result = generateDiff(oldContent, newContent);
    expect(result).toContain('- old');
    expect(result).toContain('+ new');
    expect(result).not.toContain('- keep1');
    expect(result).not.toContain('- keep2');
  });

  it('handles addition at end of file', () => {
    const result = generateDiff('line1\nline2', 'line1\nline2\nline3');
    expect(result).toContain('+ line3');
    expect(result).toContain('1 line added');
  });

  it('handles removal at end of file', () => {
    const result = generateDiff('line1\nline2\nline3', 'line1\nline2');
    expect(result).toContain('- line3');
    expect(result).toContain('1 line removed');
  });

  it('uses singular for single line changes', () => {
    const result = generateDiff('a', 'b');
    expect(result).toContain('1 line added');
    expect(result).toContain('1 line removed');
  });
});

// ---------------------------------------------------------------------------
// generateDiffPreview
// ---------------------------------------------------------------------------
describe('generateDiffPreview', () => {
  const testDir = join(tmpdir(), 'xiaobai-diff-preview-test');

  beforeEach(() => {
    if (!existsSync(testDir)) {
      mkdirSync(testDir, { recursive: true });
    }
  });

  afterEach(() => {
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it('shows new file preview for write when file does not exist', () => {
    const result = generateDiffPreview('write', {
      file_path: join(testDir, 'nonexistent.txt'),
      content: 'hello\nworld',
    });
    expect(result).toContain('new file');
    expect(result).toContain('+ hello');
    expect(result).toContain('+ world');
  });

  it('shows diff for write when file exists', () => {
    const filePath = join(testDir, 'existing.txt');
    writeFileSync(filePath, 'old line 1\nold line 2', 'utf-8');

    const result = generateDiffPreview('write', {
      file_path: filePath,
      content: 'new line 1\nnew line 2',
    });
    expect(result).toContain('existing file');
    expect(result).toContain('- old line 1');
    expect(result).toContain('+ new line 1');
  });

  it('shows edit diff with old_string and new_string', () => {
    const result = generateDiffPreview('edit', {
      file_path: '/some/file.ts',
      old_string: 'const x = 1;',
      new_string: 'const x = 2;',
    });
    expect(result).toContain('edit');
    expect(result).toContain('- const x = 1;');
    expect(result).toContain('+ const x = 2;');
  });

  it('returns empty string for non-write/edit tools', () => {
    const result = generateDiffPreview('bash', { command: 'ls' });
    expect(result).toBe('');
  });

  it('returns empty string for read tool', () => {
    const result = generateDiffPreview('read', { file_path: '/tmp/test.txt' });
    expect(result).toBe('');
  });

  it('truncates large new file content', () => {
    const lines = Array.from({ length: 50 }, (_, i) => `line ${i}`);
    const result = generateDiffPreview('write', {
      file_path: join(testDir, 'nonexistent-big.txt'),
      content: lines.join('\n'),
    }, 10);
    expect(result).toContain('more lines not shown');
    expect(result).toContain('50 lines total');
  });

  it('shows line count for single-line new file', () => {
    const result = generateDiffPreview('write', {
      file_path: join(testDir, 'single.txt'),
      content: 'just one line',
    });
    expect(result).toContain('1 line');
  });

  it('shows multi-line count for new file', () => {
    const result = generateDiffPreview('write', {
      file_path: join(testDir, 'multi.txt'),
      content: 'line1\nline2\nline3',
    });
    expect(result).toContain('3 lines');
  });

  it('handles missing file_path gracefully', () => {
    const result = generateDiffPreview('write', { content: 'hello' });
    expect(result).toContain('new file');
  });

  it('handles missing content gracefully', () => {
    const result = generateDiffPreview('write', { file_path: join(testDir, 'test.txt') });
    expect(result).toContain('1 line');
  });

  it('handles missing old_string and new_string for edit', () => {
    const result = generateDiffPreview('edit', { file_path: '/some/file.ts' });
    expect(result).toContain('edit');
  });

  it('respects custom maxLines for write new file', () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line ${i}`);
    const result = generateDiffPreview('write', {
      file_path: join(testDir, 'big.txt'),
      content: lines.join('\n'),
    }, 5);
    expect(result).toContain('more lines not shown');
  });

  it('respects custom maxLines for edit preview', () => {
    const oldLines = Array.from({ length: 20 }, (_, i) => `old ${i}`).join('\n');
    const newLines = Array.from({ length: 20 }, (_, i) => `new ${i}`).join('\n');
    const result = generateDiffPreview('edit', {
      file_path: '/some/file.ts',
      old_string: oldLines,
      new_string: newLines,
    }, 5);
    expect(result).toContain('more changes not shown');
  });
});
