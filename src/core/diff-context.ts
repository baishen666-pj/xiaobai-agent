export interface ContextSnapshot {
  systemPrompt: string;
  toolDefinitionsHash: string;
  memoryHash: string;
  skillHash: string;
  timestamp: number;
}

export interface ContextDiff {
  systemPromptChanged: boolean;
  toolsChanged: boolean;
  memoryChanged: boolean;
  skillsChanged: boolean;
  fullSystemPrompt?: string;
  systemPromptDelta?: string;
}

function simpleHash(str: string): string {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return h.toString(36);
}

export class DiffContextManager {
  private reference: ContextSnapshot | null = null;

  buildSnapshot(
    systemPrompt: string,
    toolDefs: string,
    memoryBlock: string,
    skillBlock: string,
  ): ContextSnapshot {
    return {
      systemPrompt,
      toolDefinitionsHash: simpleHash(toolDefs),
      memoryHash: simpleHash(memoryBlock),
      skillHash: simpleHash(skillBlock),
      timestamp: Date.now(),
    };
  }

  computeDiff(current: ContextSnapshot): ContextDiff {
    if (!this.reference) {
      this.reference = current;
      return {
        systemPromptChanged: true,
        toolsChanged: true,
        memoryChanged: true,
        skillsChanged: true,
        fullSystemPrompt: current.systemPrompt,
      };
    }

    const toolsChanged = current.toolDefinitionsHash !== this.reference.toolDefinitionsHash;
    const memoryChanged = current.memoryHash !== this.reference.memoryHash;
    const skillsChanged = current.skillHash !== this.reference.skillHash;
    const systemChanged = current.systemPrompt !== this.reference.systemPrompt;

    this.reference = current;

    return {
      systemPromptChanged: systemChanged,
      toolsChanged,
      memoryChanged,
      skillsChanged,
      fullSystemPrompt: systemChanged ? current.systemPrompt : undefined,
    };
  }

  reset(): void {
    this.reference = null;
  }

  hasReference(): boolean {
    return this.reference !== null;
  }
}
