type StructuredCapability = 'json_schema' | 'json_object' | 'tool_use' | 'none';

const CAPABILITY_MAP: Record<string, StructuredCapability> = {
  openai: 'json_schema',
  'chatgpt-web': 'json_schema',
  anthropic: 'tool_use',
  'claude-web': 'tool_use',
  google: 'json_schema',
  deepseek: 'json_object',
  qwen: 'json_object',
  zhipu: 'json_object',
  moonshot: 'json_object',
  yi: 'json_object',
  baidu: 'json_object',
  minimax: 'json_object',
  baichuan: 'json_object',
  groq: 'json_object',
  ollama: 'none',
};

export function getProviderCapability(name: string): StructuredCapability {
  return CAPABILITY_MAP[name] ?? 'none';
}

export function resolveStructuredMode(
  providerName: string,
  requestedMode: 'provider_native' | 'prompt_based' | 'auto',
): 'provider_native' | 'prompt_based' {
  if (requestedMode !== 'auto') return requestedMode;

  const capability = getProviderCapability(providerName);
  return capability === 'none' ? 'prompt_based' : 'provider_native';
}
