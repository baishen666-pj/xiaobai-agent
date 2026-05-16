import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { astEditTool } from '../../src/tools/ast-edit.js';

const TEST_DIR = join(tmpdir(), `xiaobai-ast-test-${Date.now()}`);

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('astEditTool', () => {
  it('should have correct definition', () => {
    expect(astEditTool.definition.name).toBe('ast_edit');
    expect(astEditTool.definition.parameters.required).toEqual(['file_path', 'operation']);
  });

  it('should reject unsupported file types', async () => {
    const result = await astEditTool.execute({
      file_path: join(TEST_DIR, 'test.py'),
      operation: 'rename',
      target: 'foo',
      new_name: 'bar',
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe('unsupported_file_type');
  });

  it('should reject missing file', async () => {
    const result = await astEditTool.execute({
      file_path: join(TEST_DIR, 'nonexistent.ts'),
      operation: 'rename',
      target: 'foo',
      new_name: 'bar',
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe('file_not_found');
  });

  describe('rename', () => {
    it('should rename a function', async () => {
      const filePath = join(TEST_DIR, 'rename.ts');
      writeFileSync(filePath, 'function oldName() {}\nconst x = oldName();\n', 'utf-8');

      const result = await astEditTool.execute({
        file_path: filePath,
        operation: 'rename',
        target: 'oldName',
        new_name: 'newName',
      });

      expect(result.success).toBe(true);

      const { readFileSync } = await import('node:fs');
      const content = readFileSync(filePath, 'utf-8');
      expect(content).toContain('function newName()');
      expect(content).toContain('const x = newName()');
      expect(content).not.toContain('oldName');
    });

    it('should rename a class', async () => {
      const filePath = join(TEST_DIR, 'class-rename.ts');
      writeFileSync(filePath, 'class OldClass {}\nconst inst = new OldClass();\n', 'utf-8');

      const result = await astEditTool.execute({
        file_path: filePath,
        operation: 'rename',
        target: 'OldClass',
        new_name: 'NewClass',
      });

      expect(result.success).toBe(true);
      const { readFileSync } = await import('node:fs');
      const content = readFileSync(filePath, 'utf-8');
      expect(content).toContain('class NewClass');
      expect(content).toContain('new NewClass()');
    });

    it('should not rename inside string literals', async () => {
      const filePath = join(TEST_DIR, 'string-safe.ts');
      writeFileSync(filePath, 'const target = "oldName";\nfunction oldName() {}\n', 'utf-8');

      const result = await astEditTool.execute({
        file_path: filePath,
        operation: 'rename',
        target: 'oldName',
        new_name: 'newName',
      });

      expect(result.success).toBe(true);
      const { readFileSync } = await import('node:fs');
      const content = readFileSync(filePath, 'utf-8');
      expect(content).toContain('"oldName"');
      expect(content).toContain('function newName()');
    });

    it('should require target and new_name', async () => {
      const filePath = join(TEST_DIR, 'missing-params.ts');
      writeFileSync(filePath, 'const x = 1;\n', 'utf-8');

      const result = await astEditTool.execute({
        file_path: filePath,
        operation: 'rename',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('missing_params');
    });
  });

  describe('insert', () => {
    it('should insert code at specified position', async () => {
      const filePath = join(TEST_DIR, 'insert.ts');
      writeFileSync(filePath, 'const a = 1;\nconst b = 2;\n', 'utf-8');

      const result = await astEditTool.execute({
        file_path: filePath,
        operation: 'insert',
        code: 'const c = 3;',
        position: { line: 2, column: 1 },
      });

      expect(result.success).toBe(true);
      const { readFileSync } = await import('node:fs');
      const content = readFileSync(filePath, 'utf-8');
      expect(content).toContain('const c = 3;');
    });

    it('should require code and position', async () => {
      const filePath = join(TEST_DIR, 'insert-missing.ts');
      writeFileSync(filePath, 'const x = 1;\n', 'utf-8');

      const result = await astEditTool.execute({
        file_path: filePath,
        operation: 'insert',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('missing_params');
    });

    it('should reject invalid line numbers', async () => {
      const filePath = join(TEST_DIR, 'insert-invalid.ts');
      writeFileSync(filePath, 'const x = 1;\n', 'utf-8');

      const result = await astEditTool.execute({
        file_path: filePath,
        operation: 'insert',
        code: 'test',
        position: { line: 100, column: 1 },
      });

      expect(result.success).toBe(false);
    });
  });

  describe('delete', () => {
    it('should delete a range of code', async () => {
      const filePath = join(TEST_DIR, 'delete.ts');
      writeFileSync(filePath, 'const a = 1;\nconst b = 2;\nconst c = 3;\n', 'utf-8');

      const result = await astEditTool.execute({
        file_path: filePath,
        operation: 'delete',
        range: { startLine: 2, startCol: 1, endLine: 2, endCol: 15 },
      });

      expect(result.success).toBe(true);
      const { readFileSync } = await import('node:fs');
      const content = readFileSync(filePath, 'utf-8');
      expect(content).not.toContain('const b = 2;');
      expect(content).toContain('const a = 1;');
    });

    it('should require range', async () => {
      const filePath = join(TEST_DIR, 'delete-missing.ts');
      writeFileSync(filePath, 'const x = 1;\n', 'utf-8');

      const result = await astEditTool.execute({
        file_path: filePath,
        operation: 'delete',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('missing_params');
    });
  });

  describe('replace', () => {
    it('should replace a range with new code', async () => {
      const filePath = join(TEST_DIR, 'replace.ts');
      writeFileSync(filePath, 'const a = 1;\nconst b = 2;\nconst c = 3;\n', 'utf-8');

      const result = await astEditTool.execute({
        file_path: filePath,
        operation: 'replace',
        code: 'const b = 20;',
        range: { startLine: 2, startCol: 1, endLine: 2, endCol: 15 },
      });

      expect(result.success).toBe(true);
      const { readFileSync } = await import('node:fs');
      const content = readFileSync(filePath, 'utf-8');
      expect(content).toContain('const b = 20;');
      expect(content).not.toContain('const b = 2;');
    });

    it('should require range and code', async () => {
      const filePath = join(TEST_DIR, 'replace-missing.ts');
      writeFileSync(filePath, 'const x = 1;\n', 'utf-8');

      const result = await astEditTool.execute({
        file_path: filePath,
        operation: 'replace',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('missing_params');
    });
  });

  it('should reject unknown operations', async () => {
    const filePath = join(TEST_DIR, 'unknown.ts');
    writeFileSync(filePath, 'const x = 1;\n', 'utf-8');

    const result = await astEditTool.execute({
      file_path: filePath,
      operation: 'refactor',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('unknown_operation');
  });
});