import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { createServer } from 'node:http';
import type { XiaobaiAgent } from '../core/agent.js';

export interface McpServerConfig {
  name?: string;
  version?: string;
}

export class XiaobaiMcpServer {
  private mcp: McpServer;
  private agent: XiaobaiAgent;

  constructor(agent: XiaobaiAgent, config?: McpServerConfig) {
    this.agent = agent;
    this.mcp = new McpServer(
      { name: config?.name ?? 'xiaobai-agent', version: config?.version ?? '0.9.0' },
      { capabilities: { tools: {}, resources: {}, prompts: {} } },
    );
    this.registerTools();
    this.registerResources();
    this.registerPrompts();
  }

  private registerTools(): void {
    this.mcp.registerTool(
      'chat',
      {
        description: 'Send a message to the Xiaobai agent and get a response',
        inputSchema: { message: z.string().describe('The message to send to the agent') },
      },
      async (args) => {
        const response = await this.agent.chatSync(args.message);
        return { content: [{ type: 'text' as const, text: response }] };
      },
    );

    this.mcp.registerTool(
      'knowledge_search',
      {
        description: 'Search the knowledge base for relevant information',
        inputSchema: {
          query: z.string().describe('The search query'),
          topK: z.number().optional().describe('Number of results to return (default 5)'),
        },
      },
      async (args) => {
        const kb = this.agent.getKnowledge();
        if (!kb) {
          return { content: [{ type: 'text' as const, text: 'Knowledge base not available' }], isError: true };
        }
        const result = await kb.query(args.query);
        return { content: [{ type: 'text' as const, text: result.assembledContext || 'No results found' }] };
      },
    );
  }

  private registerResources(): void {
    this.mcp.registerResource(
      'knowledge-status',
      'knowledge://status',
      { description: 'Knowledge base status information' },
      async () => {
        const kb = this.agent.getKnowledge();
        const status = kb
          ? { documentCount: kb.getDocumentCount(), chunkCount: kb.getChunkCount(), loaded: kb.isLoaded() }
          : { documentCount: 0, chunkCount: 0, loaded: false };
        return {
          contents: [{ uri: 'knowledge://status', mimeType: 'application/json', text: JSON.stringify(status, null, 2) }],
        };
      },
    );
  }

  private registerPrompts(): void {
    this.mcp.registerPrompt(
      'code-review',
      { description: 'Code review prompt template' },
      async () => ({
        messages: [{
          role: 'user' as const,
          content: { type: 'text' as const, text: 'Please review the following code for bugs, security issues, and improvement suggestions:\n\n```\n{{code}}\n```\n\nFocus on: correctness, security, performance, and maintainability.' },
        }],
      }),
    );

    this.mcp.registerPrompt(
      'explain',
      {
        description: 'Code explanation prompt template',
        argsSchema: { language: z.string().optional().describe('Programming language') },
      },
      async (args) => {
        const lang = args.language ? ` (${args.language})` : '';
        return {
          messages: [{
            role: 'user' as const,
            content: { type: 'text' as const, text: `Please explain the following code${lang} in detail:\n\n\`\`\`\n{{code}}\n\`\`\`\n\nExplain the purpose, logic flow, and any notable patterns or techniques used.` },
          }],
        };
      },
    );
  }

  async startStdio(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.mcp.connect(transport);
  }

  async startHttp(port = 3002): Promise<void> {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    await this.mcp.connect(transport);

    const httpServer = createServer(async (req, res) => {
      await transport.handleRequest(req, res);
    });

    return new Promise((resolve) => {
      httpServer.listen(port, () => {
        resolve();
      });
    });
  }

  async close(): Promise<void> {
    await this.mcp.close();
  }

  getServer(): McpServer {
    return this.mcp;
  }
}
