import type { Router } from './router.js';

export interface OpenAPIDocument {
  openapi: string;
  info: { title: string; version: string; description?: string };
  paths: Record<string, Record<string, unknown>>;
}

export function generateOpenApiSpec(router: Router): OpenAPIDocument {
  const paths: Record<string, Record<string, unknown>> = {};

  for (const route of router.getRoutes()) {
    const path = route.pattern.replace(/:([^/]+)/g, '{$1}');
    if (!paths[path]) paths[path] = {};

    const operation: Record<string, unknown> = {
      operationId: `${route.method.toLowerCase()}_${route.pattern.replace(/[/:]/g, '_')}`,
    };

    if (route.metadata?.summary) operation.summary = route.metadata.summary;
    if (route.metadata?.description) operation.description = route.metadata.description;
    if (route.metadata?.tags) operation.tags = route.metadata.tags;

    const params = route.pattern.match(/:([^/]+)/g);
    if (params) {
      operation.parameters = params.map((p) => ({
        name: p.slice(1),
        in: 'path',
        required: true,
        schema: { type: 'string' },
      }));
    }

    if (route.metadata?.requestBody) {
      operation.requestBody = {
        content: { 'application/json': { schema: { type: 'object' } } },
        ...route.metadata.requestBody,
      };
    }

    if (route.metadata?.responses) {
      operation.responses = Object.fromEntries(
        Object.entries(route.metadata.responses).map(([code, resp]) => [
          code,
          { description: resp.description, content: { 'application/json': { schema: { type: 'object' } } } },
        ]),
      );
    } else {
      operation.responses = { 200: { description: 'Success' } };
    }

    paths[path][route.method.toLowerCase()] = operation;
  }

  return {
    openapi: '3.1.0',
    info: { title: 'Xiaobai Agent API', version: '0.6.0', description: 'REST API for Xiaobai AI Agent Framework' },
    paths,
  };
}
