export interface TextPart {
  type: 'text';
  text: string;
}

export interface ImagePart {
  type: 'image';
  data: string;
  mimeType: string;
  source: 'base64' | 'url';
}

export interface ToolResultPart {
  type: 'tool_result';
  toolUseId: string;
  content: string;
}

export type ContentPart = TextPart | ImagePart | ToolResultPart;

export type MessageContent = string | ContentPart[];

export function normalizeContent(content: MessageContent): ContentPart[] {
  if (typeof content === 'string') {
    return [{ type: 'text', text: content }];
  }
  return content;
}

export function extractText(content: MessageContent): string {
  if (typeof content === 'string') return content;
  return content
    .filter((p): p is TextPart => p.type === 'text')
    .map((p) => p.text)
    .join('');
}
