import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { parse, stringify } from 'yaml';
import { WorkflowDefinitionSchema, type WorkflowDefinition } from './types.js';

export class WorkflowRegistry {
  private workflows = new Map<string, WorkflowDefinition>();
  private workflowsDir: string;

  constructor(configDir: string) {
    this.workflowsDir = join(configDir, 'workflows');
  }

  async loadAll(): Promise<void> {
    if (!existsSync(this.workflowsDir)) return;

    const dirs = readdirSync(this.workflowsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory());

    for (const dir of dirs) {
      const filePath = join(this.workflowsDir, dir.name, 'workflow.yaml');
      if (existsSync(filePath)) {
        try {
          const content = readFileSync(filePath, 'utf-8');
          const parsed = parse(content);
          const validated = WorkflowDefinitionSchema.parse(parsed);
          this.workflows.set(validated.name, validated);
        } catch {
          // Skip invalid workflow files
        }
      }
    }
  }

  get(name: string): WorkflowDefinition | undefined {
    return this.workflows.get(name);
  }

  list(): WorkflowDefinition[] {
    return [...this.workflows.values()];
  }

  search(query: string): WorkflowDefinition[] {
    const lower = query.toLowerCase();
    return this.list().filter((w) =>
      w.name.toLowerCase().includes(lower) ||
      w.description?.toLowerCase().includes(lower) ||
      w.tags.some((t) => t.toLowerCase().includes(lower)),
    );
  }

  listByTag(tag: string): WorkflowDefinition[] {
    return this.list().filter((w) => w.tags.includes(tag));
  }

  async create(definition: WorkflowDefinition): Promise<WorkflowDefinition> {
    const validated = WorkflowDefinitionSchema.parse(definition);
    if (this.workflows.has(validated.name)) {
      throw new Error(`Workflow "${validated.name}" already exists`);
    }
    this.workflows.set(validated.name, validated);
    this.saveToDisk(validated);
    return validated;
  }

  async update(name: string, definition: Partial<WorkflowDefinition>): Promise<WorkflowDefinition> {
    const existing = this.workflows.get(name);
    if (!existing) throw new Error(`Workflow "${name}" not found`);

    const merged = { ...existing, ...definition, name: existing.name };
    const validated = WorkflowDefinitionSchema.parse(merged);
    this.workflows.set(name, validated);
    this.saveToDisk(validated);
    return validated;
  }

  async delete(name: string): Promise<boolean> {
    if (!this.workflows.has(name)) return false;
    this.workflows.delete(name);
    const dir = join(this.workflowsDir, name);
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    return true;
  }

  private saveToDisk(workflow: WorkflowDefinition): void {
    const dir = join(this.workflowsDir, workflow.name);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const filePath = join(dir, 'workflow.yaml');
    writeFileSync(filePath, stringify(workflow), 'utf-8');
  }
}
