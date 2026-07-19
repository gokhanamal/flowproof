import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { loadFlow } from '../src/flow.js';

test('loadFlow reads a project-defined ordered evidence journey', async () => {
  const flow = await loadFlow(path.resolve(import.meta.dirname, '../examples/feature-toggle-round-trip.flow.yaml'));
  assert.equal(flow.key, 'ios-feature-toggle-round-trip');
  assert.equal(flow.maxTurns, 18);
  assert.equal(flow.evidence.stages.at(-1)?.name, 'notifications restored');
});

test('loadFlow defaults maxTurns and permits arbitrary project flow keys', async () => {
  const flow = await loadFlow(path.resolve(import.meta.dirname, '../examples/flow-template.yaml'));
  assert.equal(flow.key, 'replace-with-stable-flow-key');
  assert.equal(flow.maxTurns, 10);
});

test('loadFlow rejects missing evidence and invalid patterns', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'appium-agent-flow-'));
  const missingEvidence = path.join(directory, 'missing-evidence.yaml');
  const invalidPattern = path.join(directory, 'invalid-pattern.yaml');
  const invalidNegativePattern = path.join(directory, 'invalid-negative-pattern.yaml');
  await writeFile(missingEvidence, 'key: other\nname: Other\ndescription: Test\ninstructions: Test\n');
  await writeFile(invalidPattern, [
    'key: other',
    'name: Other',
    'description: Test',
    'instructions: Test',
    'evidence:',
    '  stages:',
    '    - name: ready',
    '      all:',
    '        - namePattern: "["',
  ].join('\n'));
  await writeFile(invalidNegativePattern, [
    'key: other',
    'name: Other',
    'description: Test',
    'instructions: Test',
    'evidence:',
    '  stages:',
    '    - name: ready',
    '      all:',
    '        - name: Ready',
    '      none:',
    '        - namePattern: "["',
  ].join('\n'));
  await assert.rejects(loadFlow(missingEvidence), /evidence/);
  await assert.rejects(loadFlow(invalidPattern), /Invalid regular expression/);
  await assert.rejects(loadFlow(invalidNegativePattern), /Invalid regular expression/);
});

test('loadFlow accepts forbidden evidence matchers', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'appium-agent-flow-'));
  const file = path.join(directory, 'negative-evidence.yaml');
  await writeFile(file, [
    'key: lesson',
    'name: Lesson',
    'description: Complete a lesson',
    'instructions: Complete the lesson',
    'evidence:',
    '  stages:',
    '    - name: complete',
    '      all:',
    '        - name: Lesson complete',
    '      none:',
    '        - namePattern: Error|Failed',
  ].join('\n'));

  const flow = await loadFlow(file);
  assert.deepEqual(flow.evidence.stages[0]?.none, [{ namePattern: 'Error|Failed' }]);
});

test('loadFlow requires a named action when unchanged state is allowed', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'appium-agent-flow-'));
  const filePath = path.join(directory, 'unchanged-state.yaml');
  await writeFile(filePath, `
key: persistence
name: Persistence
description: Verify persisted state.
instructions: Relaunch and verify the state remains.
evidence:
  stages:
    - name: persisted
      allowSameState: true
      all:
        - name: Progress
`);

  await assert.rejects(() => loadFlow(filePath), /allowSameState requires afterAction/);
});
