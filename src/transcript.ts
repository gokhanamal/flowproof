import type { Model, ModelRequest, ModelResponse, StreamEvent } from '@openai/agents';
import type { EvidenceStore } from './evidence-store.js';

const omittedKeys = new Set(['providerData', 'signal', 'encrypted_content', 'encryptedContent']);
const sensitiveKeys = new Set([
  'apikey',
  'openaiapikey',
  'authorization',
  'secret',
  'clientsecret',
  'token',
  'accesstoken',
  'refreshtoken',
]);

function isSensitiveKey(key: string): boolean {
  return sensitiveKeys.has(key.replaceAll(/[-_]/g, '').toLowerCase());
}

export function sanitizeTranscriptValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitizeTranscriptValue);
  }
  if (!value || typeof value !== 'object') return value;

  const record = value as Record<string, unknown>;
  if (record.type === 'reasoning' || record.type === 'reasoning_text') {
    return { type: record.type, omitted: 'hidden reasoning is not recorded' };
  }

  return Object.fromEntries(
    Object.entries(record).flatMap(([key, child]) => {
      if (omittedKeys.has(key)) return [];
      if (isSensitiveKey(key)) return [[key, '[REDACTED]']];
      return [[key, sanitizeTranscriptValue(child)]];
    }),
  );
}

export class RecordingModel implements Model {
  private turn = 0;
  private totals = { requests: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 };

  constructor(
    private readonly inner: Model,
    private readonly store: EvidenceStore,
  ) {}

  get turns(): number {
    return this.turn;
  }

  get usage(): { requests: number; inputTokens: number; outputTokens: number; totalTokens: number } {
    return { ...this.totals };
  }

  async getResponse(request: ModelRequest): Promise<ModelResponse> {
    this.turn += 1;
    const prefix = `model-turn-${String(this.turn).padStart(3, '0')}`;
    await this.store.writeJson(`${prefix}-input.json`, sanitizeTranscriptValue(request));
    try {
      const response = await this.inner.getResponse(request);
      this.totals.requests += response.usage.requests;
      this.totals.inputTokens += response.usage.inputTokens;
      this.totals.outputTokens += response.usage.outputTokens;
      this.totals.totalTokens += response.usage.totalTokens;
      await this.store.writeJson(`${prefix}-output.json`, sanitizeTranscriptValue({
        output: response.output,
        usage: response.usage,
        responseId: response.responseId,
        requestId: response.requestId,
      }));
      return response;
    } catch (error) {
      await this.store.writeJson(`${prefix}-output.json`, {
        error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      });
      throw error;
    }
  }

  getStreamedResponse(request: ModelRequest): AsyncIterable<StreamEvent> {
    return this.inner.getStreamedResponse(request);
  }
}
