import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
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
  assert.match(workflow, /if: always\(\) && github\.event_name == 'pull_request'/);
  assert.match(workflow, /steps\.flowproof\.outputs\.artifact_url/);
  assert.match(workflow, /needs: ios-agent-e2e/);
  assert.match(workflow, /E2E_RESULT: \$\{\{ needs\.ios-agent-e2e\.result \}\}/);
  assert.match(workflow, /needs\.ios-agent-e2e\.outputs\.artifact_url/);
  assert.match(workflow, /<!-- flowproof-report -->/);
  assert.match(workflow, /issues\/comments\/\$comment_id/);
  assert.match(workflow, /gh api --paginate --slurp/);
  assert.match(workflow, /\.user\.login == "github-actions\[bot\]"/);
  assert.match(workflow, /\.body \| contains\("<!-- flowproof-report -->"\)/);
  assert.match(workflow, /screen-recording\.mp4/);
  assert.match(workflow, /retention_days:/);
  assert.match(workflow, /retention_days: \$\{\{ inputs\.retention_days \}\}/);
  assert.match(workflow, /TESTED_COMMIT: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/);
  assert.match(workflow, /RUN_ATTEMPT: \$\{\{ github\.run_attempt \}\}/);
  assert.match(workflow, /needs\.ios-agent-e2e\.outputs\.device_name/);
  assert.match(workflow, /needs\.ios-agent-e2e\.outputs\.runtime_version/);
  assert.match(workflow, /Artifact expiry:/);
  assert.match(workflow, /E2E_RESULT.*cancelled/s);
  assert.doesNotMatch(workflow, /!cancelled\(\)/);
});

test('reusable workflow isolates its secret-bearing E2E job from pull request writes', async () => {
  const workflow = parse(
    await readFile(path.join(root, '.github/workflows/ios-e2e.yml'), 'utf8'),
  ) as {
    permissions: Record<string, string>;
    jobs: Record<string, {
      needs?: string;
      outputs?: Record<string, string>;
      permissions?: Record<string, string>;
      steps: Array<{ env?: Record<string, string> }>;
    }>;
  };

  assert.deepEqual(workflow.permissions, { contents: 'read' });
  assert.equal(workflow.jobs['ios-agent-e2e']?.permissions, undefined);
  assert.ok(
    workflow.jobs['ios-agent-e2e']?.steps.some((step) => step.env?.OPENAI_API_KEY),
    'E2E job should consume the API key',
  );
  assert.deepEqual(Object.keys(workflow.jobs['ios-agent-e2e']?.outputs ?? {}).sort(), [
    'artifact_url',
    'device_name',
    'runtime_name',
    'runtime_version',
  ]);
  assert.equal(workflow.jobs.report?.needs, 'ios-agent-e2e');
  assert.deepEqual(workflow.jobs.report?.permissions, {
    contents: 'read',
    'pull-requests': 'write',
  });
  assert.ok(
    workflow.jobs.report?.steps.every((step) => !step.env?.OPENAI_API_KEY),
    'report job must not receive the API key',
  );
  assert.doesNotMatch(JSON.stringify(workflow.jobs.report), /secrets\./);
  for (const [jobName, job] of Object.entries(workflow.jobs)) {
    if (jobName !== 'report') assert.notEqual(job.permissions?.['pull-requests'], 'write');
  }
});

test('workflows pin external actions and the reusable workflow pins licensed FlowProof code', async () => {
  const workflowDirectory = path.join(root, '.github/workflows');
  const workflowNames = (await readdir(workflowDirectory)).filter((name) => /\.ya?ml$/.test(name));
  for (const workflowName of workflowNames) {
    const workflow = await readFile(path.join(workflowDirectory, workflowName), 'utf8');
    for (const match of workflow.matchAll(/^\s*uses:\s*([^\s#]+)/gm)) {
      const reference = match[1]!;
      assert.match(reference, /^[^@\s]+@[0-9a-f]{40}$/, `${workflowName}: ${reference}`);
    }
    assert.doesNotMatch(workflow, /gokhanamal\/flowproof@main/);
  }

  const reusableWorkflow = await readFile(path.join(workflowDirectory, 'ios-e2e.yml'), 'utf8');
  assert.match(
    reusableWorkflow,
    /uses: gokhanamal\/flowproof@99db59105f873e02f6cd48083e93c97027738ab6/,
  );
});

test('open-source workflow checks are fork-safe and least privilege', async () => {
  const actionlint = await readFile(path.join(root, '.github/workflows/actionlint.yml'), 'utf8');
  const dependencyReview = await readFile(
    path.join(root, '.github/workflows/dependency-review.yml'),
    'utf8',
  );
  for (const workflow of [actionlint, dependencyReview]) {
    assert.match(workflow, /permissions:\n\s+contents: read/);
    assert.doesNotMatch(workflow, /pull_request_target:/);
    assert.doesNotMatch(workflow, /secrets\./);
  }
  assert.match(actionlint, /raven-actions\/actionlint@[0-9a-f]{40}/);
  assert.match(dependencyReview, /actions\/dependency-review-action@[0-9a-f]{40}/);
  assert.match(dependencyReview, /if: github\.event\.repository\.visibility == 'public'/);
});

test('repository remains open-source under Apache-2.0 without npm publication', async () => {
  const packageMetadata = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')) as {
    license?: string;
    private?: boolean;
  };
  const license = await readFile(path.join(root, 'LICENSE'), 'utf8');
  const readme = await readFile(path.join(root, 'README.md'), 'utf8');

  assert.equal(packageMetadata.private, true);
  assert.equal(packageMetadata.license, 'Apache-2.0');
  assert.match(license, /Apache License\s+Version 2\.0/);
  assert.doesNotMatch(readme, /(?:repository|codebase|project) is (?:private|proprietary)/i);
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
