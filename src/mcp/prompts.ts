export interface MCPPrompt {
  name: string;
  description?: string;
  arguments?: Array<{
    name: string;
    description?: string;
    required?: boolean;
  }>;
}

export interface MCPPromptMessage {
  role: 'user' | 'assistant';
  content: { type: 'text'; text: string };
}

export interface MCPPromptProvider {
  listPrompts(): Promise<MCPPrompt[]>;
  getPrompt(name: string, args?: Record<string, string>): Promise<MCPPromptMessage[]>;
}
