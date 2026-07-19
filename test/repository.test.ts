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

test('suite helper actions use explicit shells and pinned external actions', async () => {
  for (const actionPath of [
    '.github/actions/prepare-suite/action.yml',
    '.github/actions/aggregate-suite/action.yml',
  ]) {
    const metadata = parse(await readFile(path.join(root, actionPath), 'utf8')) as {
      runs: { using: string; steps: Array<{ run?: string; shell?: string; uses?: string }> };
    };
    assert.equal(metadata.runs.using, 'composite');
    for (const step of metadata.runs.steps) {
      if (step.run) assert.equal(step.shell, 'bash');
      if (step.uses) assert.match(step.uses, /@[0-9a-f]{40}$/);
    }
  }
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

test('suite workflow runs every flow and enforces one aggregate release gate', async () => {
  const workflow = await readFile(path.join(root, '.github/workflows/ios-e2e-suite.yml'), 'utf8');
  assert.match(workflow, /fail-fast: false/);
  assert.match(workflow, /max-parallel: 1/);
  assert.match(workflow, /if: always\(\) && needs\.prepare\.result == 'success'/);
  assert.match(workflow, /<!-- flowproof-suite-report -->/);
  assert.match(workflow, /steps\.aggregate\.outputs\.gate_passed/);
  assert.match(workflow, /actions\/download-artifact@[0-9a-f]{40}/);
  assert.match(workflow, /actions\/upload-artifact@[0-9a-f]{40}/);
  assert.match(workflow, /TEST_EMAIL:\n\s+description: Synthetic learner account email/);
  assert.match(workflow, /TEST_PASSWORD:\n\s+description: Synthetic learner account password/);
  assert.match(workflow, /FIXTURE_API_TOKEN:\n\s+description: Optional credential used only by the fixture command/);
  assert.doesNotMatch(workflow, /^ {6}runtime_input_[1-4]_name:/m);
  assert.doesNotMatch(workflow, /^ {6}RUNTIME_INPUT_[1-4]:/m);
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
