import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { Tool, ToolResult } from './registry.js';
import { extractText } from '../types/content-types.js';

export const imageTool: Tool = {
  definition: {
    name: 'image',
    description: 'Generate images from text descriptions or describe existing images.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['generate', 'describe'],
          description: 'Generate an image from a prompt or describe an existing image file',
        },
        prompt: { type: 'string', description: 'Text prompt for generation or description guidance' },
        image_path: { type: 'string', description: 'Path to image file for description' },
        size: { type: 'string', enum: ['256x256', '512x512', '1024x1024'], default: '512x512', description: 'Image size' },
        output_dir: { type: 'string', description: 'Directory to save generated image' },
      },
      required: ['action'],
    },
  },
  async execute(args): Promise<ToolResult> {
    const action = args.action as string;

    if (action === 'generate') {
      return handleGenerate(args);
    }
    if (action === 'describe') {
      return handleDescribe(args);
    }
    return { output: `Unknown action: ${action}`, success: false };
  },
};

async function handleGenerate(args: Record<string, unknown>): Promise<ToolResult> {
  const prompt = args.prompt as string;
  if (!prompt) {
    return { output: 'prompt is required for image generation', success: false };
  }

  const size = (args.size as string) ?? '512x512';
  const outputDir = (args.output_dir as string) ?? process.cwd();

  const apiKey = process.env['OPENAI_API_KEY'];
  if (!apiKey) {
    return { output: 'OPENAI_API_KEY not set — image generation requires an API key', success: false };
  }

  const baseUrl = (process.env['OPENAI_BASE_URL'] as string) ?? 'https://api.openai.com/v1';

  try {
    const response = await fetch(`${baseUrl}/images/generations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'dall-e-3',
        prompt,
        n: 1,
        size,
        response_format: 'b64_json',
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      return { output: `Image generation failed (${response.status}): ${errorBody}`, success: false };
    }

    const data = await response.json() as { data: Array<{ b64_json?: string; url?: string }> };
    const image = data.data?.[0];
    if (!image) {
      return { output: 'No image returned from API', success: false };
    }

    if (image.b64_json) {
      const buffer = Buffer.from(image.b64_json, 'base64');
      const filename = `image_${Date.now()}_${randomBytes(4).toString('hex')}.png`;
      const filePath = join(outputDir, filename);
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, buffer);
      return {
        output: `Image saved to ${filePath}`,
        success: true,
        metadata: { path: filePath, size },
      };
    }

    if (image.url) {
      return {
        output: `Image URL: ${image.url}`,
        success: true,
        metadata: { url: image.url, size },
      };
    }

    return { output: 'Unexpected response format from image API', success: false };
  } catch (err) {
    return { output: `Image generation error: ${(err as Error).message}`, success: false };
  }
}

async function handleDescribe(args: Record<string, unknown>): Promise<ToolResult> {
  const imagePath = args.image_path as string;
  if (!imagePath) {
    return { output: 'image_path is required for image description', success: false };
  }

  try {
    const buffer = await readFile(imagePath);
    const base64 = buffer.toString('base64');

    const ext = imagePath.split('.').pop()?.toLowerCase() ?? 'png';
    const mimeType = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
      : ext === 'gif' ? 'image/gif'
      : ext === 'webp' ? 'image/webp'
      : 'image/png';

    const apiKey = process.env['OPENAI_API_KEY'];
    if (!apiKey) {
      return {
        output: `[Image: ${imagePath}] Base64 size: ${base64.length} bytes, MIME: ${mimeType}. Set OPENAI_API_KEY to enable AI-powered description.`,
        success: true,
        metadata: { path: imagePath, mimeType, sizeBytes: buffer.length },
      };
    }

    const baseUrl = (process.env['OPENAI_BASE_URL'] as string) ?? 'https://api.openai.com/v1';

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: (args.prompt as string) ?? 'Describe this image in detail.' },
              { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
            ],
          },
        ],
        max_tokens: 1000,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      return { output: `Description failed (${response.status}): ${errorBody}`, success: false };
    }

    const data = await response.json() as { choices: Array<{ message: { content: string } }> };
    const description = data.choices?.[0]?.message?.content ?? 'No description returned';

    return {
      output: `[Image: ${imagePath}]\n${description}`,
      success: true,
      metadata: { path: imagePath, mimeType, sizeBytes: buffer.length },
    };
  } catch (err) {
    return { output: `Image description error: ${(err as Error).message}`, success: false };
  }
}
