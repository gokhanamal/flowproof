import assert from 'node:assert/strict';
import test from 'node:test';
import { EvidenceGate } from '../src/evidence.js';
import type { EvidenceDefinition } from '../src/flow.js';

function node(name: string) {
  return { type: 'StaticText', name };
}

const orderedEvidence: EvidenceDefinition = {
  stages: [
    { name: 'chat list', all: [{ name: 'Daimon' }, { name: 'Maya' }] },
    { name: 'disabled', all: [{ type: 'Switch', name: 'Session enabled', value: '0' }] },
    { name: 'healthy', all: [{ name: 'ok' }, { namePattern: '^(?:•\\s*)?Adapters:\\s*1$' }] },
  ],
};

test('EvidenceGate advances one ordered stage per observation', () => {
  const gate = new EvidenceGate(orderedEvidence);
  assert.equal(gate.record([node('Daimon'), node('Maya'), node('ok'), node('Adapters: 1')]).passed, false);
  assert.equal(gate.status().nextStage, 'disabled');
  assert.equal(gate.record([{ type: 'Switch', name: 'Session enabled', value: '0' }]).passed, false);
  const status = gate.record([node('ok'), node('• Adapters: 1')]);
  assert.equal(status.passed, true);
  assert.equal(status.observations, 3);
});

test('EvidenceGate refuses out-of-order evidence', () => {
  const gate = new EvidenceGate(orderedEvidence);
  gate.record([{ type: 'Switch', name: 'Session enabled', value: '0' }]);
  assert.equal(gate.status().checks.disabled, false);
  assert.equal(gate.status().nextStage, 'chat list');
});

test('EvidenceGate supports exact node fields and anchored patterns', () => {
  const gate = new EvidenceGate({
    stages: [{
      name: 'ready',
      all: [
        { type: 'Button', name: 'Continue', enabled: true },
        { namePattern: '^SDK v[0-9]+\\.[0-9]+\\.[0-9]+$' },
      ],
    }],
  });
  assert.equal(gate.record([{ type: 'Button', name: 'Continue', enabled: true }, node('SDK v1.2.3')]).passed, true);
});
