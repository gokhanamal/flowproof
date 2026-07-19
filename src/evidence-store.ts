import { chmod, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AccessibleNode } from './observation.js';

export interface StepRecord {
  index: number;
  action: string;
  detail: string;
  timestamp: string;
}

export class EvidenceStore {
  private stepIndex = 0;
  readonly steps: StepRecord[] = [];

  constructor(private readonly root: string) {}

  async initialize(): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    await chmod(this.root, 0o700);
  }

  async observation(xml: string, screenshotBase64: string, nodes: AccessibleNode[]): Promise<number> {
    const index = this.stepIndex++;
    const prefix = String(index).padStart(3, '0');
    const files: Array<[string, string | Buffer]> = [
      [path.join(this.root, `${prefix}-observe.xml`), xml],
      [path.join(this.root, `${prefix}-observe.png`), Buffer.from(screenshotBase64, 'base64')],
      [path.join(this.root, `${prefix}-observe.json`), JSON.stringify(nodes, null, 2)],
    ];
    await Promise.all(files.map(async ([filePath, contents]) => {
      await writeFile(filePath, contents, { mode: 0o600 });
      await chmod(filePath, 0o600);
    }));
    this.steps.push({ index, action: 'observe', detail: `${nodes.length} accessible nodes`, timestamp: new Date().toISOString() });
    return index;
  }

  recordAction(action: string, detail: string): void {
    this.steps.push({ index: this.stepIndex++, action, detail, timestamp: new Date().toISOString() });
  }

  async writeJson(name: string, value: unknown): Promise<void> {
    const filePath = path.join(this.root, name);
    await writeFile(filePath, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600 });
    await chmod(filePath, 0o600);
  }
}
