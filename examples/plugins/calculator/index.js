export default {
  manifest: {
    name: 'calculator',
    version: '1.0.0',
    description: 'Simple math expression calculator',
    permissions: ['tools:register'],
  },

  async init(api) {
    api.tools.register({
      definition: {
        name: 'calculate',
        description: 'Evaluate a mathematical expression safely',
        parameters: {
          type: 'object',
          properties: {
            expression: { type: 'string', description: 'Math expression (e.g. "2 + 3 * 4")' },
          },
          required: ['expression'],
        },
      },
      execute: async (args) => {
        const expr = String(args.expression);
        if (!/^[\d\s+\-*/().%^]+$/.test(expr)) {
          return { success: false, output: 'Invalid expression: only numbers and basic operators allowed' };
        }
        try {
          const result = Function('"use strict"; return (' + expr + ')')();
          return { success: true, output: `${expr} = ${result}` };
        } catch (e) {
          return { success: false, output: `Error: ${e.message}` };
        }
      },
    });
    api.logger.info('Calculator plugin initialized');
  },

  async deactivate() {},
};
