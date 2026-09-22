import { dbSettings } from '../db/models';

export interface OllamaLlmOptions {
  temperature?: number;
  maxTokens?: number;
  jsonFormat?: boolean;
}

/**
 * Local LLM inference client via Ollama.
 * Model Selection Priority:
 *   1. Qwen — highest priority.
 *   2. Gemma — use only if a Qwen model is not available.
 * Strict constraint: Do not use any other models or providers.
 */
export class OllamaLlmClient {
  public static readonly DEFAULT_BASE_URL = 'http://127.0.0.1:11434';

  public static async getBaseUrl(): Promise<string> {
    const envUrl = process.env.OLLAMA_BASE_URL?.trim();
    if (envUrl) {
      return envUrl.replace(/\/+$/, '');
    }
    try {
      const settings = await dbSettings.get();
      if (settings?.ollamaBaseUrl?.trim()) {
        return settings.ollamaBaseUrl.trim().replace(/\/+$/, '');
      }
    } catch {
      // ignore
    }
    return this.DEFAULT_BASE_URL;
  }

  /**
   * Resolves the local model using the strict priority:
   * 1. Qwen (highest priority)
   * 2. Gemma (only if Qwen is not available)
   */
  public static async resolveModel(baseUrlOverride?: string): Promise<{ model: string; family: 'qwen' | 'gemma' }> {
    const baseUrl = baseUrlOverride || (await this.getBaseUrl());
    try {
      const res = await fetch(`${baseUrl}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(4000),
      });

      if (res.ok) {
        const data = await res.json();
        const models: string[] = Array.isArray(data.models)
          ? data.models.map((m: any) => m.name || m.model || '')
          : [];

        // 1. Qwen — highest priority (excluding chandra OCR vision model)
        const qwenModel = models.find((m) => m.toLowerCase().includes('qwen') && !m.toLowerCase().includes('chandra'));
        if (qwenModel) {
          console.log(`[Ollama LLM Client] Priority 1 Selected: Qwen model '${qwenModel}'`);
          return { model: qwenModel, family: 'qwen' };
        }

        // 2. Gemma — use only if a Qwen model is not available
        const gemmaModel = models.find((m) => m.toLowerCase().includes('gemma'));
        if (gemmaModel) {
          console.log(`[Ollama LLM Client] Priority 2 Selected: Gemma model '${gemmaModel}' (Qwen not available)`);
          return { model: gemmaModel, family: 'gemma' };
        }
      }
    } catch (e: any) {
      console.warn(`[Ollama LLM Client] Could not query Ollama models at ${baseUrl}: ${e?.message}`);
    }

    // Default to Qwen
    return { model: 'qwen2.5:7b', family: 'qwen' };
  }

  /**
   * Dispatches chat completion to Ollama /api/chat
   */
  public static async executeChat(
    messages: Array<{ role: string; content: string }>,
    options: OllamaLlmOptions = {}
  ): Promise<string> {
    const baseUrl = await this.getBaseUrl();
    const { model, family } = await this.resolveModel(baseUrl);
    const chatUrl = `${baseUrl}/api/chat`;

    console.log(`[Ollama LLM Client] Dispatching chat completion to ${chatUrl} | Model: '${model}' (${family.toUpperCase()})`);

    const payload: Record<string, any> = {
      model,
      messages,
      stream: false,
      options: {
        temperature: options.temperature ?? 0.0,
        num_predict: options.maxTokens ?? 8192,
      },
    };

    if (options.jsonFormat !== false) {
      payload.format = 'json';
    }

    const res = await fetch(chatUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Ollama chat completion failed (HTTP ${res.status}): ${errText}`);
    }

    const data = await res.json();
    return data?.message?.content || '';
  }
}
