import assert from 'node:assert/strict';
import test from 'node:test';
import { sanitizeTranscriptValue } from '../src/transcript.js';

test('sanitizeTranscriptValue removes secrets, provider internals, and hidden reasoning', () => {
  const sanitized = sanitizeTranscriptValue({
    apiKey: 'secret-value',
    authorization: 'Bearer secret-value',
    token: 'secret-value',
    inputTokens: 123,
    outputTokens: 45,
    providerData: { raw: true },
    signal: { aborted: false },
    items: [
      { type: 'function_call', name: 'observe', arguments: '{}' },
      { type: 'reasoning', encrypted_content: 'hidden' },
    ],
  });

  assert.deepEqual(sanitized, {
    apiKey: '[REDACTED]',
    authorization: '[REDACTED]',
    token: '[REDACTED]',
    inputTokens: 123,
    outputTokens: 45,
    items: [
      { type: 'function_call', name: 'observe', arguments: '{}' },
      { type: 'reasoning', omitted: 'hidden reasoning is not recorded' },
    ],
  });
});
