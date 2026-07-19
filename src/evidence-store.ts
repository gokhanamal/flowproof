import { mkdir, writeFile } from 'node:fs/promises';
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
    await mkdir(this.root, { recursive: true });
  }

  async observation(xml: string, screenshotBase64: string, nodes: AccessibleNode[]): Promise<number> {
    const index = this.stepIndex++;
    const prefix = String(index).padStart(3, '0');
    await Promise.all([
      writeFile(path.join(this.root, `${prefix}-observe.xml`), xml, 'utf8'),
      writeFile(path.join(this.root, `${prefix}-observe.png`), Buffer.from(screenshotBase64, 'base64')),
      writeFile(path.join(this.root, `${prefix}-observe.json`), JSON.stringify(nodes, null, 2), 'utf8'),
    ]);
    this.steps.push({ index, action: 'observe', detail: `${nodes.length} accessible nodes`, timestamp: new Date().toISOString() });
    return index;
  }

  recordAction(action: string, detail: string): void {
    this.steps.push({ index: this.stepIndex++, action, detail, timestamp: new Date().toISOString() });
  }

  async writeJson(name: string, value: unknown): Promise<void> {
    await writeFile(path.join(this.root, name), JSON.stringify(value, null, 2), 'utf8');
  }
}
