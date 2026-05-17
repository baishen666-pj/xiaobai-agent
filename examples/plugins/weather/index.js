export default {
  manifest: {
    name: 'weather',
    version: '1.0.0',
    description: 'Get current weather for a city',
    permissions: ['tools:register'],
  },

  async init(api) {
    api.tools.register({
      definition: {
        name: 'weather',
        description: 'Get the current weather for a given city',
        parameters: {
          type: 'object',
          properties: {
            city: { type: 'string', description: 'City name' },
          },
          required: ['city'],
        },
      },
      execute: async (args) => {
        const city = args.city;
        const temp = Math.round(15 + Math.random() * 20);
        const conditions = ['sunny', 'cloudy', 'rainy', 'windy', 'partly cloudy'];
        const condition = conditions[Math.floor(Math.random() * conditions.length)];
        return {
          success: true,
          output: `Weather in ${city}: ${temp}°C, ${condition}`,
        };
      },
    });
    api.logger.info('Weather plugin initialized');
  },

  async deactivate() {},
};
