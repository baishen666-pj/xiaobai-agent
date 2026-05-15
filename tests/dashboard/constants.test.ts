import { describe, it, expect } from 'vitest';
import { ROLE_COLORS, STATUS_COLORS, formatTokens } from '../../src/dashboard/lib/constants.js';

describe('Dashboard Constants', () => {
  describe('ROLE_COLORS', () => {
    it('has colors for all expected roles', () => {
      expect(ROLE_COLORS.researcher).toBeDefined();
      expect(ROLE_COLORS.coder).toBeDefined();
      expect(ROLE_COLORS.reviewer).toBeDefined();
      expect(ROLE_COLORS.planner).toBeDefined();
      expect(ROLE_COLORS.tester).toBeDefined();
      expect(ROLE_COLORS.coordinator).toBeDefined();
    });

    it('uses hex color format', () => {
      for (const color of Object.values(ROLE_COLORS)) {
        expect(color).toMatch(/^#[0-9a-f]{6}$/);
      }
    });
  });

  describe('STATUS_COLORS', () => {
    it('has colors for all statuses', () => {
      expect(STATUS_COLORS.pending).toBeDefined();
      expect(STATUS_COLORS.running).toBeDefined();
      expect(STATUS_COLORS.completed).toBeDefined();
      expect(STATUS_COLORS.failed).toBeDefined();
    });
  });

  describe('formatTokens', () => {
    it('formats small numbers', () => {
      expect(formatTokens(42)).toBe('42');
    });

    it('formats thousands', () => {
      expect(formatTokens(1500)).toBe('1.5K');
    });

    it('formats millions', () => {
      expect(formatTokens(2500000)).toBe('2.5M');
    });

    it('formats exact thousand', () => {
      expect(formatTokens(1000)).toBe('1.0K');
    });

    it('formats exact million', () => {
      expect(formatTokens(1000000)).toBe('1.0M');
    });
  });
});
