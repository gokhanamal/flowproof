import assert from 'node:assert/strict';
import { mkdtemp, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { EvidenceStore } from '../src/evidence-store.js';

test('EvidenceStore restricts evidence directory and file permissions', async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'flowproof-evidence-'));
  const directory = path.join(parent, 'run');
  const store = new EvidenceStore(directory);
  await store.initialize();
  await store.writeJson('report.json', { status: 'passed' });

  assert.equal((await stat(directory)).mode & 0o777, 0o700);
  assert.equal((await stat(path.join(directory, 'report.json'))).mode & 0o777, 0o600);
});
