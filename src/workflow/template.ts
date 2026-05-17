export function renderTemplate(template: string, context: Record<string, unknown>): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (match, expr: string) => {
    const trimmed = expr.trim();
    const value = resolvePath(context, trimmed);
    if (value === undefined) return `[${trimmed}]`;
    return String(value);
  });
}

function resolvePath(obj: unknown, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current === 'object') {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return current;
}

const DANGEROUS_IDENTS = /\b(process|require|global|globalThis|window|eval|Function|constructor|__proto__|prototype|import|exports|module|this)\b/;
const SAFE_CHARS = /^[a-zA-Z0-9_."'`>\s<!=&(||)+\-*/%,()[\]{}:]+$/;

export function evaluateCondition(condition: string, context: Record<string, unknown>): boolean {
  const trimmed = condition.trim();
  if (!trimmed || DANGEROUS_IDENTS.test(trimmed) || !SAFE_CHARS.test(trimmed)) {
    return false;
  }
  try {
    const fn = new Function(
      'ctx',
      `with(ctx){return(${condition})}`,
    );
    return fn(context) === true;
  } catch {
    return false;
  }
}
