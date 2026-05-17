import { describe, it, expect } from 'vitest';
import { generateOpenApiSpec } from '../../src/server/openapi.js';
import { Router } from '../../src/server/router.js';

describe('generateOpenApiSpec', () => {
  it('should generate spec from routes', () => {
    const router = new Router();
    router.get('/api/models', async (ctx) => {}, {
      summary: 'List models',
      tags: ['resources'],
      responses: { 200: { description: 'Success' } },
    });
    router.post('/api/chat', async (ctx) => {}, {
      summary: 'Send message',
      tags: ['chat'],
    });
    router.get('/api/sessions/:id', async (ctx) => {}, {
      summary: 'Get session',
      tags: ['sessions'],
    });

    const spec = generateOpenApiSpec(router);

    expect(spec.openapi).toBe('3.1.0');
    expect(spec.info.title).toBe('Xiaobai Agent API');
    expect(spec.paths['/api/models']).toBeDefined();
    expect(spec.paths['/api/models'].get.summary).toBe('List models');
    expect(spec.paths['/api/chat'].post.summary).toBe('Send message');
    expect(spec.paths['/api/sessions/{id}'].get.parameters).toHaveLength(1);
    expect(spec.paths['/api/sessions/{id}'].get.parameters[0].name).toBe('id');
  });

  it('should include tags in operations', () => {
    const router = new Router();
    router.get('/api/test', async () => {}, { tags: ['test', 'debug'] });

    const spec = generateOpenApiSpec(router);
    expect(spec.paths['/api/test'].get.tags).toEqual(['test', 'debug']);
  });
});
