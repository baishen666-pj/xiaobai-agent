import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, basename, extname, sep } from 'node:path';

export interface CompletionCandidate {
  text: string;
  description?: string;
  type?: 'command' | 'file' | 'provider' | 'model' | 'flag';
}

export type CompletionContext = {
  buffer: string;
  cursorPosition: number;
  cwd: string;
};

const SLASH_COMMANDS: CompletionCandidate[] = [
  { text: '/exit', description: 'Exit the session', type: 'command' },
  { text: '/quit', description: 'Exit the session', type: 'command' },
  { text: '/clear', description: 'Clear conversation history', type: 'command' },
  { text: '/compact', description: 'Force context compaction', type: 'command' },
  { text: '/memory', description: 'Show memory usage', type: 'command' },
  { text: '/tools', description: 'List available tools', type: 'command' },
  { text: '/sessions', description: 'List saved sessions', type: 'command' },
  { text: '/model', description: 'Show or switch provider/model', type: 'command' },
  { text: '/export', description: 'Export session (json or markdown)', type: 'command' },
  { text: '/metrics', description: 'Show runtime metrics', type: 'command' },
  { text: '/health', description: 'Show provider health status', type: 'command' },
  { text: '/help', description: 'Show help', type: 'command' },
];

const PROVIDERS: CompletionCandidate[] = [
  { text: 'anthropic', description: 'Anthropic (Claude)', type: 'provider' },
  { text: 'openai', description: 'OpenAI (GPT)', type: 'provider' },
  { text: 'deepseek', description: 'DeepSeek', type: 'provider' },
  { text: 'google', description: 'Google (Gemini)', type: 'provider' },
  { text: 'qwen', description: 'Qwen (Alibaba)', type: 'provider' },
  { text: 'mistral', description: 'Mistral AI', type: 'provider' },
  { text: 'ollama', description: 'Ollama (local)', type: 'provider' },
];

const EXPORT_FORMATS: CompletionCandidate[] = [
  { text: 'json', description: 'JSON format', type: 'flag' },
  { text: 'markdown', description: 'Markdown format', type: 'flag' },
];

export class AutoCompleter {
  private commands: CompletionCandidate[];
  private providers: CompletionCandidate[];

  constructor(commands?: CompletionCandidate[], providers?: CompletionCandidate[]) {
    this.commands = commands ?? SLASH_COMMANDS;
    this.providers = providers ?? PROVIDERS;
  }

  complete(ctx: CompletionContext): CompletionCandidate[] {
    const { buffer, cursorPosition } = ctx;
    const text = buffer.slice(0, cursorPosition);

    if (!text.startsWith('/')) return [];

    const parts = text.split(/\s+/);
    const command = parts[0];

    if (parts.length <= 1 && !text.endsWith(' ')) {
      return this.completeCommand(command);
    }

    switch (command) {
      case '/model':
        return this.completeModel(parts, text);
      case '/export':
        return this.completeExport(parts, text);
      default:
        return [];
    }
  }

  private completeCommand(partial: string): CompletionCandidate[] {
    if (!partial) return this.commands;
    return this.commands.filter((c) => c.text.startsWith(partial));
  }

  private completeModel(parts: string[], text: string): CompletionCandidate[] {
    if (parts.length === 2 && parts[1] === '' && text.endsWith(' ')) {
      return this.providers;
    }
    if (parts.length === 2 && parts[1] !== '' && !text.endsWith(' ')) {
      const partial = parts[1].toLowerCase();
      return this.providers.filter((p) => p.text.startsWith(partial));
    }
    return [];
  }

  private completeExport(parts: string[], text: string): CompletionCandidate[] {
    if (parts.length === 2 && parts[1] === '' && text.endsWith(' ')) {
      return EXPORT_FORMATS;
    }
    if (parts.length === 2 && parts[1] !== '' && !text.endsWith(' ')) {
      const partial = parts[1].toLowerCase();
      return EXPORT_FORMATS.filter((f) => f.text.startsWith(partial));
    }
    return [];
  }
}

export function completeFilePath(partial: string, cwd: string): CompletionCandidate[] {
  const dir = partial.includes(sep) ? join(cwd, dirname(partial)) : cwd;
  const prefix = partial.includes(sep) ? basename(partial) : partial;

  try {
    const entries = readdirSync(dir);
    const results: CompletionCandidate[] = [];

    for (const entry of entries) {
      if (entry.startsWith('.') && !prefix.startsWith('.')) continue;
      if (prefix && !entry.toLowerCase().startsWith(prefix.toLowerCase())) continue;

      const fullPath = join(dir, entry);
      try {
        const stat = statSync(fullPath);
        const display = partial.includes(sep)
          ? join(dirname(partial), entry)
          : entry;
        results.push({
          text: stat.isDirectory() ? display + sep : display,
          description: stat.isDirectory() ? 'directory' : extname(entry) || 'file',
          type: 'file',
        });
      } catch {
        // skip inaccessible entries
      }
    }

    return results.slice(0, 20);
  } catch {
    return [];
  }
}

export function generateCompletionScript(shell: 'bash' | 'zsh' | 'fish' = 'bash'): string {
  const commands = SLASH_COMMANDS.map((c) => c.text.slice(1)).join(' ');

  switch (shell) {
    case 'bash':
      return `_xiaobai_completions() {
  local cur="\${COMP_WORDS[COMP_CWORD]}"
  if [[ "\${COMP_WORDS[1]}" == "" || "\${COMP_WORDS[COMP_CWORD]}" == /* ]]; then
    COMPREPLY=($(compgen -W '${commands}' -- "$cur"))
  fi
}
complete -F _xiaobai_completions xiaobai`;

    case 'zsh':
      return `#compdef xiaobai
_xiaobai() {
  local -a commands
  commands=(${SLASH_COMMANDS.map((c) => `'${c.text.slice(1)}:${c.description ?? ''}'`).join('\n    ')})
  _describe 'command' commands
}
_xiaobai`;

    case 'fish':
      return `complete -c xiaobai -f
${SLASH_COMMANDS.map((c) => `complete -c xiaobai -n '__fish_use_subcommand' -a '${c.text.slice(1)}' -d '${c.description ?? ''}'`).join('\n')}`;

    default:
      return '';
  }
}