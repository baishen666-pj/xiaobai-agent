export const zhCN: Record<string, string> = {
  // CLI 插件
  'cli.plugins.not_enabled': '插件系统未启用。',
  'cli.plugins.none_installed': '没有已安装的插件。使用 xiaobai plugins create <name> 创建',
  'cli.plugins.installed': '已安装插件 (${count})',
  'cli.plugins.created': '已创建插件: ${name}',
  'cli.plugins.installed_from': '已从 ${source} 安装插件',
  'cli.plugins.uninstalled': '已卸载插件: ${name}',
  'cli.plugins.activated': '已激活插件: ${name}',
  'cli.plugins.deactivated': '已停用插件: ${name}',
  'cli.plugins.search_none': '没有匹配 "${query}" 的插件。',
  'cli.plugins.search_results': '市场搜索结果 (${count})',
  'cli.plugins.browse_none': '暂无可用插件。',
  'cli.plugins.browse_none_category': '分类 "${category}" 下暂无插件。',
  'cli.plugins.marketplace': '插件市场 (${total} 个插件, ${installed} 个已安装)',

  // CLI 技能
  'cli.skills.not_enabled': '技能系统未启用。',
  'cli.skills.none_installed': '没有已安装的技能。使用 xiaobai skills create <name> 创建',
  'cli.skills.installed': '已安装技能 (${count})',
  'cli.skills.created': '已创建技能: ${name}',
  'cli.skills.not_found': '未找到技能: ${name}',
  'cli.skills.installed_skill': '已安装: ${name}',
  'cli.skills.install_failed': '技能安装失败。',
  'cli.skills.search_none': '未找到匹配的技能。',
  'cli.skills.search_results': '搜索结果 (${count})',
  'cli.skills.builtins_all': '所有内置技能已安装或未找到。',
  'cli.skills.builtins_install': '使用 xiaobai skills install-builtin [name] 安装',

  // CLI 角色
  'cli.agents.title': '可用 Agent 角色',
  'cli.agents.all_tools': '全部',

  // CLI 配置
  'cli.config.title': '当前配置',

  // CLI 仪表盘
  'cli.dashboard.title': 'Xiaobai 仪表盘',
  'cli.dashboard.starting': '正在启动仪表盘...',
  'cli.dashboard.shutdown': '正在关闭...',

  // CLI 运行
  'cli.run.running': '正在运行: "${prompt}"',
  'cli.run.results': '--- 结果 ---',
  'cli.run.total_tokens': '总 Token: ${tokens}',

  // CLI 执行
  'cli.exec.thinking': '思考中...',
  'cli.exec.error': '错误:',

  // CLI 交互
  'cli.repl.welcome': 'Xiaobai Agent v${version}',
  'cli.repl.exit': '输入 /exit 退出, /help 查看命令。',

  // CLI 工作流
  'cli.workflow.none_found': '未找到工作流。使用 xiaobai workflow create <name> 创建',
  'cli.workflow.list_title': '工作流 (${count})',
  'cli.workflow.not_found': '未找到工作流: ${name}',
  'cli.workflow.steps': '步骤:',
  'cli.workflow.running': '正在运行工作流: ${name}',
  'cli.workflow.valid': '工作流定义有效。',
  'cli.workflow.invalid': '无效: ${error}',

  // CLI 记忆
  'cli.memory.title': '记忆:',
  'cli.memory.profile': '用户档案:',

  // 仪表盘页面
  'dashboard.health.title': '系统健康',
  'dashboard.health.liveness': '存活检查',
  'dashboard.health.readiness': '就绪检查',
  'dashboard.health.refresh': '刷新',
  'dashboard.health.auto_refresh': '自动刷新 (10秒)',

  'dashboard.agents.title': 'Agent 状态',
  'dashboard.agents.control': 'Agent 控制',

  'dashboard.sessions.title': '会话',
  'dashboard.sessions.create': '创建会话',
  'dashboard.sessions.delete': '删除',

  'dashboard.workflows.title': '工作流',
  'dashboard.workflows.run': '运行',

  'dashboard.playground.title': '测试场',
  'dashboard.playground.placeholder': '输入消息...',
  'dashboard.playground.send': '发送',

  'dashboard.overview.title': '概览',

  'dashboard.sidebar.overview': '概览',
  'dashboard.sidebar.agents': 'Agent',
  'dashboard.sidebar.sessions': '会话',
  'dashboard.sidebar.workflows': '工作流',
  'dashboard.sidebar.playground': '测试场',
  'dashboard.sidebar.health': '健康',

  // 通用
  'general.error': '错误: ${message}',
  'general.success': '成功',
  'general.cancelled': '已取消',
  'general.loading': '加载中...',
  'general.no_data': '暂无数据。',
};
