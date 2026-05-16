export interface PricingEntry {
  provider: string;
  model: string;
  inputPricePer1M: number;
  outputPricePer1M: number;
}

export interface TokenCost {
  inputCost: number;
  outputCost: number;
  totalCost: number;
  currency: string;
  isEstimated: boolean;
}

export interface ModelPrice {
  input: number;
  output: number;
}

const DEFAULT_INPUT_PRICE = 1;
const DEFAULT_OUTPUT_PRICE = 3;

const BUILTIN_PRICING: PricingEntry[] = [
  // Anthropic
  { provider: 'anthropic', model: 'claude-sonnet-4-6', inputPricePer1M: 3, outputPricePer1M: 15 },
  { provider: 'anthropic', model: 'claude-opus-4-7', inputPricePer1M: 15, outputPricePer1M: 75 },
  { provider: 'anthropic', model: 'claude-haiku-4-5', inputPricePer1M: 1, outputPricePer1M: 5 },
  // OpenAI
  { provider: 'openai', model: 'gpt-4o', inputPricePer1M: 2.5, outputPricePer1M: 10 },
  { provider: 'openai', model: 'gpt-4o-mini', inputPricePer1M: 0.15, outputPricePer1M: 0.6 },
  { provider: 'openai', model: 'gpt-4-turbo', inputPricePer1M: 10, outputPricePer1M: 30 },
  // Google
  { provider: 'google', model: 'gemini-2.0-flash', inputPricePer1M: 0.1, outputPricePer1M: 0.4 },
  { provider: 'google', model: 'gemini-1.5-pro', inputPricePer1M: 1.25, outputPricePer1M: 5 },
  // DeepSeek
  { provider: 'deepseek', model: 'deepseek-chat', inputPricePer1M: 0.27, outputPricePer1M: 1.1 },
  { provider: 'deepseek', model: 'deepseek-reasoner', inputPricePer1M: 0.55, outputPricePer1M: 2.19 },
  // Qwen
  { provider: 'qwen', model: 'qwen-max', inputPricePer1M: 1.6, outputPricePer1M: 6.4 },
  { provider: 'qwen', model: 'qwen-plus', inputPricePer1M: 0.4, outputPricePer1M: 1.6 },
  // Groq
  { provider: 'groq', model: 'llama-3.3-70b', inputPricePer1M: 0.59, outputPricePer1M: 0.79 },
  { provider: 'groq', model: 'mixtral-8x7b', inputPricePer1M: 0.24, outputPricePer1M: 0.24 },
  // Ollama (free)
  { provider: 'ollama', model: '*', inputPricePer1M: 0, outputPricePer1M: 0 },
];

function buildKey(provider: string, model: string): string {
  return `${provider}::${model}`;
}

export class PricingTable {
  private entries: Map<string, PricingEntry>;

  constructor() {
    this.entries = new Map();
    for (const entry of BUILTIN_PRICING) {
      this.entries.set(buildKey(entry.provider, entry.model), entry);
    }
  }

  getPrice(provider: string, model: string): ModelPrice | null {
    const exact = this.entries.get(buildKey(provider, model));
    if (exact) {
      return { input: exact.inputPricePer1M, output: exact.outputPricePer1M };
    }

    // Check for wildcard match (e.g., ollama *)
    const wildcard = this.entries.get(buildKey(provider, '*'));
    if (wildcard) {
      return { input: wildcard.inputPricePer1M, output: wildcard.outputPricePer1M };
    }

    return null;
  }

  calculateCost(provider: string, model: string, promptTokens: number, completionTokens: number): TokenCost {
    const price = this.getPrice(provider, model);
    const isEstimated = price === null;

    const inputPrice = price?.input ?? DEFAULT_INPUT_PRICE;
    const outputPrice = price?.output ?? DEFAULT_OUTPUT_PRICE;

    const inputCost = (promptTokens / 1_000_000) * inputPrice;
    const outputCost = (completionTokens / 1_000_000) * outputPrice;

    return {
      inputCost,
      outputCost,
      totalCost: inputCost + outputCost,
      currency: 'USD',
      isEstimated,
    };
  }

  listModels(): PricingEntry[] {
    return Array.from(this.entries.values());
  }

  addPricing(entry: PricingEntry): void {
    this.entries.set(buildKey(entry.provider, entry.model), entry);
  }
}
