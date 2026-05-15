import { describe, it, expect } from 'vitest';
import {
  getRole,
  listRoles,
  getRoleToolFilter,
  type RoleDefinition,
} from '../src/core/roles.js';
import type { ToolDefinition } from '../src/tools/registry.js';

describe('roles', () => {
  describe('getRole', () => {
    it('returns built-in coordinator role', () => {
      const role = getRole('coordinator');
      expect(role.id).toBe('coordinator');
      expect(role.name).toBe('Coordinator');
      expect(role.allowedTools).toBe('*');
      expect(role.systemPrompt).toContain('Coordinator');
    });

    it('returns built-in researcher role with restricted tools', () => {
      const role = getRole('researcher');
      expect(role.id).toBe('researcher');
      expect(role.allowedTools).toEqual(
        expect.arrayContaining(['read', 'grep', 'glob']),
      );
    });

    it('returns coder role with write tools', () => {
      const role = getRole('coder');
      expect(role.allowedTools).toEqual(
        expect.arrayContaining(['read', 'write', 'edit']),
      );
    });

    it('returns reviewer role with read-only tools', () => {
      const role = getRole('reviewer');
      expect(role.allowedTools).not.toContain('write');
      expect(role.allowedTools).not.toContain('edit');
    });

    it('returns planner role', () => {
      const role = getRole('planner');
      expect(role.id).toBe('planner');
      expect(role.maxTurns).toBeLessThanOrEqual(20);
    });

    it('returns tester role with write tools', () => {
      const role = getRole('tester');
      expect(role.allowedTools).toContain('bash');
    });

    it('creates default role for unknown id', () => {
      const role = getRole('custom_agent');
      expect(role.id).toBe('custom_agent');
      expect(role.allowedTools).toBe('*');
    });
  });

  describe('listRoles', () => {
    it('returns all 6 built-in roles', () => {
      const roles = listRoles();
      expect(roles).toHaveLength(6);
      const ids = roles.map((r) => r.id);
      expect(ids).toContain('coordinator');
      expect(ids).toContain('researcher');
      expect(ids).toContain('coder');
      expect(ids).toContain('reviewer');
      expect(ids).toContain('planner');
      expect(ids).toContain('tester');
    });
  });

  describe('getRoleToolFilter', () => {
    const mockTools: ToolDefinition[] = [
      { name: 'read', description: '', parameters: { type: 'object', properties: {} } },
      { name: 'write', description: '', parameters: { type: 'object', properties: {} } },
      { name: 'edit', description: '', parameters: { type: 'object', properties: {} } },
      { name: 'grep', description: '', parameters: { type: 'object', properties: {} } },
      { name: 'bash', description: '', parameters: { type: 'object', properties: {} } },
    ];

    it('returns all tools for wildcard role', () => {
      const role = getRole('coordinator');
      const filtered = getRoleToolFilter(role, mockTools);
      expect(filtered).toHaveLength(5);
    });

    it('filters tools for restricted role', () => {
      const role = getRole('reviewer');
      const filtered = getRoleToolFilter(role, mockTools);
      const names = filtered.map((t) => t.name);
      expect(names).toContain('read');
      expect(names).toContain('grep');
      expect(names).not.toContain('write');
      expect(names).not.toContain('edit');
    });
  });
});
