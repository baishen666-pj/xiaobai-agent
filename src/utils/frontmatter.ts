export interface FrontmatterResult {
  meta: Record<string, string>;
  body: string;
}

export function parseFrontmatter(content: string): FrontmatterResult | null {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return null;

  const [, yaml, body] = match;
  const meta: Record<string, string> = {};

  const lines = yaml.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) { i++; continue; }

    const key = line.slice(0, colonIdx).trim();
    const val = line.slice(colonIdx + 1).trim();

    // Check if next lines are array items (indented with - prefix)
    const arrayItems: string[] = [];
    let j = i + 1;
    while (j < lines.length && /^\s+-\s+/.test(lines[j])) {
      arrayItems.push(lines[j].replace(/^\s+-\s+/, '').trim());
      j++;
    }

    if (arrayItems.length > 0) {
      meta[key] = arrayItems.join(',');
      i = j;
    } else {
      meta[key] = val;
      i++;
    }
  }

  return { meta, body: body.trim() };
}
