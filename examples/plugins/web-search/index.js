export default {
  manifest: {
    name: 'web-search',
    version: '1.0.0',
    description: 'Web search tool and provider integration',
    permissions: ['tools:register', 'providers:register'],
  },

  async init(api) {
    api.tools.register({
      definition: {
        name: 'web-search',
        description: 'Search the web for information',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query' },
            limit: { type: 'number', description: 'Max results (default 5)' },
          },
          required: ['query'],
        },
      },
      execute: async (args) => {
        const query = args.query;
        const limit = args.limit ?? 5;
        return {
          success: true,
          output: `Search results for "${query}" (showing ${limit}): [simulated] No real search backend configured.`,
        };
      },
    });
    api.logger.info('Web-search plugin initialized');
  },

  async deactivate() {},
};
