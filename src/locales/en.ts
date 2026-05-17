export const en: Record<string, string> = {
  // CLI plugins
  'cli.plugins.not_enabled': 'Plugins system not enabled.',
  'cli.plugins.none_installed': 'No plugins installed. Create one with: xiaobai plugins create <name>',
  'cli.plugins.installed': 'Installed Plugins (${count})',
  'cli.plugins.created': 'Created plugin: ${name}',
  'cli.plugins.installed_from': 'Installed plugin from: ${source}',
  'cli.plugins.uninstalled': 'Uninstalled plugin: ${name}',
  'cli.plugins.activated': 'Activated plugin: ${name}',
  'cli.plugins.deactivated': 'Deactivated plugin: ${name}',
  'cli.plugins.search_none': 'No plugins matching "${query}".',
  'cli.plugins.search_results': 'Marketplace Results (${count})',
  'cli.plugins.browse_none': 'No plugins available.',
  'cli.plugins.browse_none_category': 'No plugins in category "${category}".',
  'cli.plugins.marketplace': 'Marketplace (${total} plugins, ${installed} installed)',

  // CLI skills
  'cli.skills.not_enabled': 'Skills system not enabled.',
  'cli.skills.none_installed': 'No skills installed. Create one with: xiaobai skills create <name>',
  'cli.skills.installed': 'Installed Skills (${count})',
  'cli.skills.created': 'Created skill: ${name}',
  'cli.skills.not_found': 'Skill not found: ${name}',
  'cli.skills.installed_skill': 'Installed: ${name}',
  'cli.skills.install_failed': 'Failed to install skill.',
  'cli.skills.search_none': 'No matching skills found.',
  'cli.skills.search_results': 'Search Results (${count})',
  'cli.skills.builtins_all': 'All built-in skills already installed or none found.',
  'cli.skills.builtins_install': 'Install with: xiaobai skills install-builtin [name]',

  // CLI agents
  'cli.agents.title': 'Available Agent Roles',
  'cli.agents.all_tools': 'all',

  // CLI config
  'cli.config.title': 'Current Configuration',

  // CLI dashboard
  'cli.dashboard.title': 'Xiaobai Dashboard',
  'cli.dashboard.starting': 'Starting dashboard...',
  'cli.dashboard.shutdown': 'Shutting down...',

  // CLI run
  'cli.run.running': 'Running: "${prompt}"',
  'cli.run.results': '--- Results ---',
  'cli.run.total_tokens': 'Total tokens: ${tokens}',

  // CLI exec
  'cli.exec.thinking': 'Thinking...',
  'cli.exec.error': 'Error:',

  // CLI repl
  'cli.repl.welcome': 'Xiaobai Agent v${version}',
  'cli.repl.exit': 'Type /exit to quit, /help for commands.',

  // CLI workflow
  'cli.workflow.none_found': 'No workflows found. Create one with: xiaobai workflow create <name>',
  'cli.workflow.list_title': 'Workflows (${count})',
  'cli.workflow.not_found': 'Workflow not found: ${name}',
  'cli.workflow.steps': 'Steps:',
  'cli.workflow.running': 'Running workflow: ${name}',
  'cli.workflow.valid': 'Workflow definition is valid.',
  'cli.workflow.invalid': 'Invalid: ${error}',

  // CLI memory
  'cli.memory.title': 'Memory:',
  'cli.memory.profile': 'User Profile:',

  // Dashboard
  'dashboard.health.title': 'System Health',
  'dashboard.health.liveness': 'Liveness',
  'dashboard.health.readiness': 'Readiness',
  'dashboard.health.refresh': 'Refresh',
  'dashboard.health.auto_refresh': 'Auto-refresh (10s)',

  'dashboard.agents.title': 'Agent Status',
  'dashboard.agents.control': 'Agent Control',

  'dashboard.sessions.title': 'Sessions',
  'dashboard.sessions.create': 'Create Session',
  'dashboard.sessions.delete': 'Delete',

  'dashboard.workflows.title': 'Workflows',
  'dashboard.workflows.run': 'Run',

  'dashboard.playground.title': 'Playground',
  'dashboard.playground.placeholder': 'Type a message...',
  'dashboard.playground.send': 'Send',

  'dashboard.overview.title': 'Overview',

  'dashboard.sidebar.overview': 'Overview',
  'dashboard.sidebar.agents': 'Agents',
  'dashboard.sidebar.sessions': 'Sessions',
  'dashboard.sidebar.workflows': 'Workflows',
  'dashboard.sidebar.playground': 'Playground',
  'dashboard.sidebar.health': 'Health',

  // General
  'general.error': 'Error: ${message}',
  'general.success': 'Success',
  'general.cancelled': 'Cancelled',
  'general.loading': 'Loading...',
  'general.no_data': 'No data available.',
};
