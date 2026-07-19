import type { EvidenceDefinition, EvidenceMatcher } from './flow.js';
import type { AccessibleNode } from './observation.js';

export interface EvidenceStatus {
  passed: boolean;
  checks: Record<string, boolean>;
  observations: number;
  nextStage?: string;
}

const patternFields = {
  typePattern: 'type',
  namePattern: 'name',
  labelPattern: 'label',
  valuePattern: 'value',
} as const;

function matches(node: AccessibleNode, matcher: EvidenceMatcher): boolean {
  for (const field of ['type', 'name', 'label', 'value', 'enabled'] as const) {
    const expected = matcher[field];
    if (expected !== undefined && node[field] !== expected) return false;
  }
  for (const [patternField, nodeField] of Object.entries(patternFields) as Array<
    [keyof typeof patternFields, (typeof patternFields)[keyof typeof patternFields]]
  >) {
    const pattern = matcher[patternField];
    if (pattern !== undefined && !new RegExp(pattern).test(node[nodeField] ?? '')) return false;
  }
  return true;
}

function stageMatches(nodes: AccessibleNode[], matchers: EvidenceMatcher[]): boolean {
  return matchers.every((matcher) => nodes.some((node) => matches(node, matcher)));
}

export class EvidenceGate {
  private readonly checks: Record<string, boolean>;
  private stageIndex = 0;
  private count = 0;

  constructor(private readonly definition: EvidenceDefinition) {
    this.checks = Object.fromEntries(definition.stages.map((stage) => [stage.name, false]));
  }

  record(nodes: AccessibleNode[]): EvidenceStatus {
    this.count += 1;
    const stage = this.definition.stages[this.stageIndex];
    if (stage && stageMatches(nodes, stage.all)) {
      this.checks[stage.name] = true;
      this.stageIndex += 1;
    }
    return this.status();
  }

  status(): EvidenceStatus {
    const nextStage = this.definition.stages[this.stageIndex]?.name;
    return {
      passed: this.stageIndex === this.definition.stages.length,
      checks: { ...this.checks },
      observations: this.count,
      ...(nextStage ? { nextStage } : {}),
    };
  }
}
