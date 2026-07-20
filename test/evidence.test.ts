import assert from 'node:assert/strict';
import test from 'node:test';
import { EvidenceGate } from '../src/evidence.js';
import type { EvidenceDefinition } from '../src/flow.js';

function node(name: string) {
  return { type: 'StaticText', name };
}

const orderedEvidence: EvidenceDefinition = {
  stages: [
    { name: 'home screen', all: [{ name: 'Welcome' }, { name: 'Settings' }] },
    { name: 'disabled', all: [{ type: 'Switch', name: 'Notifications enabled', value: '0' }] },
    { name: 'ready', all: [{ name: 'Profile' }, { namePattern: '^Version [0-9]+\\.[0-9]+\\.[0-9]+$' }] },
  ],
};

test('EvidenceGate advances one ordered stage per observation', () => {
  const gate = new EvidenceGate(orderedEvidence);
  assert.equal(gate.record([node('Welcome'), node('Settings'), node('Profile'), node('Version 1.2.3')]).passed, false);
  assert.equal(gate.status().nextStage, 'disabled');
  gate.recordAction('tap_text');
  assert.equal(gate.record([{ type: 'Switch', name: 'Notifications enabled', value: '0' }]).passed, false);
  gate.recordAction('tap_text');
  const status = gate.record([node('Profile'), node('Version 1.2.3')]);
  assert.equal(status.passed, true);
  assert.equal(status.observations, 3);
});

test('EvidenceGate requires an action and a changed accessibility state after the initial stage', () => {
  const gate = new EvidenceGate({
    stages: [
      { name: 'initial', all: [{ name: 'Continue' }] },
      { name: 'complete', all: [{ name: 'Continue' }] },
    ],
  });
  const screen = [node('Continue')];

  gate.record(screen);
  assert.equal(gate.record(screen).stages[1]?.blocker, 'meaningful-action');
  gate.recordAction('tap_text');
  const unchanged = gate.record(screen);
  assert.equal(unchanged.passed, false);
  assert.equal(unchanged.stages[1]?.blocker, 'accessibility-state-change');

  const changed = gate.record([node('Continue'), node('Completed')]);
  assert.equal(changed.passed, true);
});

test('EvidenceGate rejects forbidden evidence and reports matcher diagnostics', () => {
  const gate = new EvidenceGate({
    stages: [{
      name: 'lesson complete',
      all: [{ type: 'StaticText', name: 'Lesson complete' }],
      none: [{ namePattern: 'Error|Failed' }],
    }],
  });

  const failed = gate.record([node('Lesson complete'), node('Network Error')]);
  const diagnostic = failed.stages[0];
  assert.equal(failed.passed, false);
  assert.equal(diagnostic?.evidenceSatisfied, false);
  assert.equal(diagnostic?.blocker, 'forbidden-evidence');
  assert.deepEqual(diagnostic?.all[0]?.matchedNode, node('Lesson complete'));
  assert.deepEqual(diagnostic?.none[0]?.matchedNode, node('Network Error'));

  const stillFailed = gate.record([node('Lesson complete')]);
  assert.equal(stillFailed.passed, false);
  assert.equal(stillFailed.failed, true);
  assert.equal(stillFailed.stages[0]?.state, 'failed');
  assert.deepEqual(stillFailed.stages[0]?.none[0]?.matchedNode, node('Network Error'));
});

test('EvidenceGate can require a named action before accepting an intentionally unchanged state', () => {
  const gate = new EvidenceGate({
    stages: [
      { name: 'before relaunch', all: [{ name: '20% complete' }] },
      {
        name: 'after relaunch',
        all: [{ name: '20% complete' }],
        afterAction: 'relaunch_app',
        allowSameState: true,
      },
    ],
  });
  const screen = [node('20% complete')];
  gate.record(screen);
  gate.recordAction('tap_text');
  assert.equal(gate.record(screen).stages[1]?.blocker, 'required-action');
  gate.recordAction('relaunch_app');
  const passed = gate.record(screen);
  assert.equal(passed.passed, true);
  assert.deepEqual(passed.stages[1]?.actionsSincePrevious, ['tap_text', 'relaunch_app']);
});

test('EvidenceGate reports missing required matcher details', () => {
  const gate = new EvidenceGate({
    stages: [{ name: 'ready', all: [{ name: 'Welcome' }, { name: 'Settings' }] }],
  });

  const status = gate.record([node('Welcome')]);
  assert.equal(status.stages[0]?.blocker, 'required-evidence');
  assert.equal(status.stages[0]?.all[0]?.matched, true);
  assert.equal(status.stages[0]?.all[1]?.matched, false);
});

test('EvidenceGate refuses out-of-order evidence', () => {
  const gate = new EvidenceGate(orderedEvidence);
  gate.record([{ type: 'Switch', name: 'Notifications enabled', value: '0' }]);
  assert.equal(gate.status().checks.disabled, false);
  assert.equal(gate.status().nextStage, 'home screen');
});

test('EvidenceGate supports exact node fields and anchored patterns', () => {
  const gate = new EvidenceGate({
    stages: [{
      name: 'ready',
      all: [
        { type: 'Button', name: 'Continue', enabled: true },
        { namePattern: '^Version [0-9]+\\.[0-9]+\\.[0-9]+$' },
      ],
    }],
  });
  assert.equal(gate.record([{ type: 'Button', name: 'Continue', enabled: true }, node('Version 1.2.3')]).passed, true);
});
