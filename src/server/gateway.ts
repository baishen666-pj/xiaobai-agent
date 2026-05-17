import { Router } from './router.js';
import { corsMiddleware, rateLimitMiddleware, requestLogMiddleware, errorMiddleware, apiKeyAuthMiddleware } from './middleware.js';
import { ApiKeyManager } from './api-keys.js';
import type { AgentDeps } from '../core/agent.js';
import { registerChatRoutes } from './api/chat.js';
import { registerSessionRoutes } from './api/sessions.js';
import { registerResourceRoutes } from './api/resources.js';
import { registerWorkflowRoutes } from './api/workflows.js';
import { generateOpenApiSpec, type OpenAPIDocument } from './openapi.js';
import type { WorkflowRegistry } from '../workflow/registry.js';
import type { WorkflowEngine } from '../workflow/engine.js';
import { sendJson } from './validation.js';
import type { RouteContext } from './router.js';

export interface ApiGatewayOptions {
  enabled: boolean;
  cors?: { origins?: string[] };
  rateLimit?: { windowMs?: number; maxRequests?: number };
}

export class ApiGateway {
  private router: Router;
  private apiKeyManager: ApiKeyManager;
  private options: ApiGatewayOptions;
  private deps?: AgentDeps;
  private authKeys = new Map<string, { name: string; scopes: string[] }>();

  constructor(options: ApiGatewayOptions, configDir?: string) {
    this.options = options;
    this.router = new Router();
    this.apiKeyManager = new ApiKeyManager(configDir ?? '');

    this.router.use(errorMiddleware());
    this.router.use(corsMiddleware({
      origins: options.cors?.origins,
    }));
    this.router.use(rateLimitMiddleware({
      windowMs: options.rateLimit?.windowMs,
      maxRequests: options.rateLimit?.maxRequests,
    }));
    this.router.use(apiKeyAuthMiddleware({ keys: this.authKeys }));
    this.router.use(requestLogMiddleware());
  }

  getRouter(): Router {
    return this.router;
  }

  getApiKeyManager(): ApiKeyManager {
    return this.apiKeyManager;
  }

  registerRoutes(deps: AgentDeps, workflowRegistry?: WorkflowRegistry, workflowEngine?: WorkflowEngine): void {
    this.deps = deps;
    this.refreshAuthKeys();
    this.apiKeyManager.load().catch(() => {}).then(() => this.refreshAuthKeys());

    registerChatRoutes(this.router, deps);
    registerSessionRoutes(this.router, deps);
    registerResourceRoutes(this.router, deps);

    if (workflowRegistry && workflowEngine) {
      registerWorkflowRoutes(this.router, workflowRegistry, workflowEngine);
    }

    this.router.get('/api/docs', async (ctx: RouteContext) => {
      const spec = this.getOpenApiSpec();
      sendJson(ctx, 200, spec);
    }, { summary: 'OpenAPI specification', tags: ['meta'] });
  }

  getOpenApiSpec(): OpenAPIDocument {
    return generateOpenApiSpec(this.router);
  }

  refreshAuthKeys(): void {
    // Rebuild the auth keys map for the middleware from ApiKeyManager entries
    // Since we only have hashes, the middleware validates by passing raw keys to validate()
    this.authKeys.clear();
    for (const entry of this.apiKeyManager.list()) {
      this.authKeys.set(entry.name, { name: entry.name, scopes: entry.scopes });
    }
  }
}
