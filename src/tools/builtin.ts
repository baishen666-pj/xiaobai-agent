import { fetchTool, searchTool, scrapeTool } from './web.js';
import { astEditTool } from './ast-edit.js';
import { codeIndexTool } from './code-index.js';
import { bashTool, truncate, isPathSafe, isBinaryContent, execStreaming, MAX_OUTPUT, IS_WIN, SENSITIVE_PATHS_WIN, SENSITIVE_PATHS_UNIX, type ExecError } from './builtin-shell.js';
import { readTool, writeTool, editTool } from './builtin-file.js';
import { grepTool, globTool, rgAvailable, _resetRgCache } from './builtin-search.js';
import { memoryTool, createAgentTool, type ToolContextExtended } from './builtin-misc.js';
import { gitTool } from './builtin-git.js';
import { diagnosticsTool } from './builtin-diagnostics.js';
import { depsTool } from './builtin-deps.js';
import { imageTool } from './builtin-image.js';
import { definitionTool } from './builtin-definition.js';
import { referencesTool } from './builtin-references.js';
import { typeInfoTool } from './builtin-typeinfo.js';
import { knowledgeSearchTool, knowledgeIndexTool, knowledgeStatusTool } from './builtin-knowledge.js';
import type { Tool } from './registry.js';

// NOTE: Tools are now split across domain-specific files:
//   builtin-shell.ts  — bash tool + shared helpers (truncate, isPathSafe, etc.)
//   builtin-file.ts    — read, write, edit tools
//   builtin-search.ts  — grep, glob tools + ripgrep helpers
//   builtin-misc.ts    — memory, agent tools + ToolContextExtended type
// The getBuiltinTools() function remains the canonical entry point.

export { truncate, isPathSafe, isBinaryContent, execStreaming, MAX_OUTPUT, IS_WIN, SENSITIVE_PATHS_WIN, SENSITIVE_PATHS_UNIX, type ExecError } from './builtin-shell.js';
export { bashTool } from './builtin-shell.js';
export { readTool, writeTool, editTool } from './builtin-file.js';
export { grepTool, globTool, rgAvailable, _resetRgCache } from './builtin-search.js';
export { memoryTool, createAgentTool, type ToolContextExtended } from './builtin-misc.js';
export { knowledgeSearchTool, knowledgeIndexTool, knowledgeStatusTool } from './builtin-knowledge.js';

export function getBuiltinTools(context?: ToolContextExtended): Tool[] {
  return [
    bashTool(context),
    readTool(context),
    writeTool(context),
    editTool(context),
    grepTool,
    globTool,
    memoryTool(context),
    createAgentTool(context),
    // Phase 3: Web tools
    fetchTool,
    searchTool,
    scrapeTool,
    // Phase 3: Code intelligence
    astEditTool,
    codeIndexTool,
    // Phase 11: Code understanding
    gitTool,
    diagnosticsTool,
    depsTool,
    // Phase 10: Image tool
    imageTool,
    // Phase 12: AST code intelligence
    definitionTool,
    referencesTool,
    typeInfoTool,
    // Phase 19: Knowledge tools
    knowledgeSearchTool(context?.knowledge),
    knowledgeIndexTool(context?.knowledge),
    knowledgeStatusTool(context?.knowledge),
  ];
}