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

test('composite action exposes the uploaded evidence URL', async () => {
  const metadata = parse(await readFile(path.join(root, 'action.yml'), 'utf8')) as {
    outputs: Record<string, { value: string }>;
    runs: { steps: Array<{ id?: string; uses?: string }> };
  };
  assert.equal(
    metadata.outputs.artifact_url?.value,
    '${{ steps.evidence-upload.outputs.artifact-url }}',
  );
  const upload = metadata.runs.steps.find((step) => step.id === 'evidence-upload');
  assert.match(upload?.uses ?? '', /^actions\/upload-artifact@[0-9a-f]{40}$/);
});

test('reusable workflow maintains one pull request evidence comment', async () => {
  const workflow = await readFile(path.join(root, '.github/workflows/ios-e2e.yml'), 'utf8');
  assert.match(workflow, /pull-requests: write/);
  assert.match(workflow, /github\.event_name == 'pull_request'/);
  assert.match(workflow, /steps\.flowproof\.outputs\.artifact_url/);
  assert.match(workflow, /<!-- flowproof-report -->/);
  assert.match(workflow, /issues\/comments\/\$comment_id/);
  assert.match(workflow, /screen-recording\.mp4/);
});

test('every example flow validates', async () => {
  const examples = [
    'app-launch.flow.yaml',
    'feature-toggle-round-trip.flow.yaml',
    'flow-template.yaml',
    'settings-overview.flow.yaml',
  ];
  for (const example of examples) {
    await loadFlow(path.join(root, 'examples', example));
  }
});
