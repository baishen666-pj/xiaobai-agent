# Plugin Development Guide

## Quick Start

Create a new plugin:

```bash
xiaobai plugins create my-plugin
```

This generates a plugin directory at `~/.xiaobai/default/plugins/my-plugin/` with:
- `plugin.json` — Plugin manifest
- `index.js` — Plugin implementation

## Plugin Manifest (plugin.json)

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "A sample plugin",
  "author": "your-name",
  "permissions": ["tools:register"],
  "sandbox": {
    "mode": "workspace-write",
    "network": "allow-all"
  }
}
```

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Lowercase-hyphen identifier (e.g., `my-plugin`) |
| `version` | string | Semver version (e.g., `1.0.0`) |
| `description` | string | Brief description |
| `permissions` | string[] | Required permissions |

### Optional Fields

| Field | Type | Description |
|-------|------|-------------|
| `author` | string | Author name |
| `homepage` | string | URL to plugin homepage |
| `minAppVersion` | string | Minimum Xiaobai version required |
| `sandbox` | object | Sandbox configuration |
| `provides` | object | Tools and providers provided |

## Permissions

| Permission | Allows |
|-----------|--------|
| `tools:register` | Register and unregister tools |
| `tools:execute` | Execute registered tools |
| `hooks:subscribe` | Subscribe to hook events |
| `providers:register` | Register LLM provider factories |
| `config:read` | Read plugin-scoped config |
| `config:write` | Write plugin-scoped config |
| `memory:read` | Read from memory system |
| `memory:write` | Write to memory system |

## Plugin Lifecycle

```javascript
export default {
  manifest: { /* plugin.json content */ },

  async init(api) {
    // Called once during plugin loading
    // Register tools, hooks, providers here
  },

  async activate() {
    // Called when plugin is activated
  },

  async deactivate() {
    // Called when plugin is deactivated
  },

  async destroy() {
    // Called during uninstall
  },
};
```

## Plugin API

### Tools

```javascript
async init(api) {
  api.tools.register({
    definition: {
      name: 'my-tool',
      description: 'Does something useful',
      parameters: {
        type: 'object',
        properties: {
          input: { type: 'string', description: 'Input value' }
        },
        required: ['input'],
      },
    },
    execute: async (args) => {
      return { success: true, output: `Processed: ${args.input}` };
    },
  });
}
```

Tool names are automatically prefixed: `my-plugin:my-tool`

### Hooks

```javascript
api.hooks.on('tool:after', async (data) => {
  api.logger.info(`Tool ${data.toolName} completed`);
});
```

### Config

```javascript
const config = api.config.get(); // { apiKey: '...' }
api.config.set({ lastRun: Date.now() });
```

### Memory

```javascript
api.memory.add('Important fact to remember');
const memories = api.memory.list();
```

## Sandbox Modes

| Mode | Filesystem | Network | Execution |
|------|-----------|---------|-----------|
| `read-only` | No writes | Blocked | Blocked |
| `workspace-write` | Within workspace only | Configurable | Safe commands only |
| `full-access` | Unrestricted | Unrestricted | All commands |

## Installing Plugins

### From local directory

```bash
xiaobai plugins install /path/to/plugin
```

### From marketplace

```bash
xiaobai plugins search "weather"
xiaobai plugins browse
```

### From GitHub

```bash
xiaobai plugins install github:owner/repo
```

## Testing

Plugins are tested as part of the core test suite. Place tests in `tests/plugins/`.

Example test:

```typescript
import { PluginAPIImpl } from '../../src/plugins/api.js';
// ... setup mocks ...

it('registers tool with correct prefix', () => {
  api.tools.register({
    definition: { name: 'my-tool', description: 'Test', parameters: { type: 'object', properties: {} } },
    execute: async () => ({ output: 'ok', success: true }),
  });
  expect(tools.has('my-plugin:my-tool')).toBe(true);
});
```
