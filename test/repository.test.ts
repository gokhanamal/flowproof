import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';
import { loadFlow } from '../src/flow.js';

const root = path.resolve(import.meta.dirname, '..');

test('composite action uses explicit shells and pinned external actions', async () => {
  const metadata = parse(await readFile(path.join(root, 'action.yml'), 'utf8')) as {
    runs: { using: string; steps: Array<{ run?: string; shell?: string; uses?: string }> };
  };
  assert.equal(metadata.runs.using, 'composite');
  for (const step of metadata.runs.steps) {
    if (step.run) assert.equal(step.shell, 'bash');
    if (step.uses) assert.match(step.uses, /@[0-9a-f]{40}$/);
  }
});

test('every example flow validates', async () => {
  const examples = [
    'elo-app-launch.flow.yaml',
    'flow-template.yaml',
    'session-overview.flow.yaml',
    'session-toggle-round-trip.flow.yaml',
  ];
  for (const example of examples) {
    await loadFlow(path.join(root, 'examples', example));
  }
});
