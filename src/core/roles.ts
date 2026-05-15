import type { ToolDefinition } from '../tools/registry.js';

export type RoleId =
  | 'coordinator'
  | 'researcher'
  | 'coder'
  | 'reviewer'
  | 'planner'
  | 'tester'
  | string;

export interface RoleDefinition {
  id: RoleId;
  name: string;
  description: string;
  systemPrompt: string;
  allowedTools: string[] | '*';
  preferredModel?: string;
  maxTurns?: number;
  temperature?: number;
}

const BUILT_IN_ROLES: Record<string, RoleDefinition> = {
  coordinator: {
    id: 'coordinator',
    name: 'Coordinator',
    description: 'Orchestrates sub-agents, breaks down tasks, and synthesizes results.',
    systemPrompt: `You are the Coordinator agent. Your job is to:
1. Analyze the user's request and break it into subtasks
2. Assign each subtask to the most appropriate specialist agent
3. Synthesize results from all agents into a coherent response
4. Identify and resolve conflicts between agent outputs

Always think step by step. Prefer parallel execution when subtasks are independent.`,
    allowedTools: '*',
    maxTurns: 30,
  },

  researcher: {
    id: 'researcher',
    name: 'Researcher',
    description: 'Investigates codebases, searches for information, and gathers context.',
    systemPrompt: `You are the Researcher agent. Your job is to:
1. Search and read code to understand the codebase
2. Find relevant files, functions, and patterns
3. Analyze dependencies and relationships
4. Report findings clearly and concisely

Focus on thoroughness. Report file paths and line numbers when referencing code.`,
    allowedTools: ['read', 'grep', 'glob', 'bash', 'web_search', 'memory'],
    maxTurns: 20,
  },

  coder: {
    id: 'coder',
    name: 'Coder',
    description: 'Writes and modifies code based on specifications.',
    systemPrompt: `You are the Coder agent. Your job is to:
1. Implement features based on clear specifications
2. Write clean, well-structured code
3. Follow existing code patterns and conventions
4. Handle edge cases and errors properly

Always read existing code before making changes. Prefer small, focused changes.`,
    allowedTools: ['read', 'write', 'edit', 'bash', 'grep', 'glob'],
    maxTurns: 25,
  },

  reviewer: {
    id: 'reviewer',
    name: 'Reviewer',
    description: 'Reviews code for quality, security, and correctness.',
    systemPrompt: `You are the Reviewer agent. Your job is to:
1. Review code changes for bugs, security issues, and style problems
2. Verify correctness against specifications
3. Check for performance issues
4. Provide actionable feedback with severity levels

Be thorough but constructive. Always explain why something is an issue.`,
    allowedTools: ['read', 'grep', 'glob', 'bash'],
    maxTurns: 15,
  },

  planner: {
    id: 'planner',
    name: 'Planner',
    description: 'Creates implementation plans and architectural designs.',
    systemPrompt: `You are the Planner agent. Your job is to:
1. Analyze requirements and identify implementation steps
2. Consider edge cases and potential risks
3. Design clear, actionable plans
4. Identify dependencies between tasks

Break complex tasks into small, independent steps. Specify expected outcomes for each step.`,
    allowedTools: ['read', 'grep', 'glob', 'memory'],
    maxTurns: 15,
  },

  tester: {
    id: 'tester',
    name: 'Tester',
    description: 'Writes and runs tests, verifies implementations.',
    systemPrompt: `You are the Tester agent. Your job is to:
1. Write comprehensive tests for new functionality
2. Run existing tests to detect regressions
3. Verify edge cases and error handling
4. Report test results clearly

Follow TDD: write tests first, then verify implementation. Aim for 80%+ coverage.`,
    allowedTools: ['read', 'write', 'edit', 'bash', 'grep', 'glob'],
    maxTurns: 20,
  },
};

export function getRole(id: RoleId): RoleDefinition {
  if (BUILT_IN_ROLES[id]) return BUILT_IN_ROLES[id];

  return {
    id,
    name: id.charAt(0).toUpperCase() + id.slice(1),
    description: `Custom agent role: ${id}`,
    systemPrompt: `You are the ${id} agent. Follow instructions carefully and report your findings.`,
    allowedTools: '*',
  };
}

export function listRoles(): RoleDefinition[] {
  return Object.values(BUILT_IN_ROLES);
}

export function getRoleToolFilter(
  role: RoleDefinition,
  availableTools: ToolDefinition[],
): ToolDefinition[] {
  if (role.allowedTools === '*') return availableTools;
  const allowed = new Set(role.allowedTools);
  return availableTools.filter((t) => allowed.has(t.name));
}
