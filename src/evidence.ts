import type { EvidenceDefinition, EvidenceMatcher } from './flow.js';
import type { AccessibleNode } from './observation.js';

export interface EvidenceStatus {
  passed: boolean;
  failed: boolean;
  checks: Record<string, boolean>;
  observations: number;
  stages: EvidenceStageDiagnostic[];
  nextStage?: string;
}

export interface EvidenceMatcherDiagnostic {
  matcher: EvidenceMatcher;
  matched: boolean;
  matchedNode?: AccessibleNode;
}

export type EvidenceStageBlocker =
  | 'required-evidence'
  | 'forbidden-evidence'
  | 'meaningful-action'
  | 'required-action'
  | 'accessibility-state-change';

export interface EvidenceStageDiagnostic {
  name: string;
  state: 'passed' | 'failed' | 'active' | 'pending';
  evidenceSatisfied: boolean;
  all: EvidenceMatcherDiagnostic[];
  none: EvidenceMatcherDiagnostic[];
  blocker?: EvidenceStageBlocker;
  actionsSincePrevious: string[];
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

function diagnoseMatchers(nodes: AccessibleNode[], matchers: EvidenceMatcher[]): EvidenceMatcherDiagnostic[] {
  return matchers.map((matcher) => {
    const matchedNode = nodes.find((node) => matches(node, matcher));
    return {
      matcher,
      matched: matchedNode !== undefined,
      ...(matchedNode ? { matchedNode } : {}),
    };
  });
}

function fingerprint(nodes: AccessibleNode[]): string {
  return JSON.stringify(nodes.map(({ bounds: _bounds, ...node }) => node));
}

export class EvidenceGate {
  private readonly checks: Record<string, boolean>;
  private diagnostics: EvidenceStageDiagnostic[];
  private stageIndex = 0;
  private count = 0;
  private actionCount = 0;
  private actionCountAtLastCompletion = 0;
  private readonly actions: string[] = [];
  private fingerprintAtLastCompletion?: string;
  private terminalFailure = false;

  constructor(private readonly definition: EvidenceDefinition) {
    this.checks = Object.fromEntries(definition.stages.map((stage) => [stage.name, false]));
    this.diagnostics = definition.stages.map((stage, index) => ({
      name: stage.name,
      state: index === 0 ? 'active' : 'pending',
      evidenceSatisfied: false,
      all: stage.all.map((matcher) => ({ matcher, matched: false })),
      none: (stage.none ?? []).map((matcher) => ({ matcher, matched: false })),
      actionsSincePrevious: [],
    }));
  }

  recordAction(action = 'action'): void {
    this.actionCount += 1;
    this.actions.push(action);
  }

  record(nodes: AccessibleNode[]): EvidenceStatus {
    this.count += 1;
    const stage = this.definition.stages[this.stageIndex];
    if (!stage || this.terminalFailure) return this.status();

    const all = diagnoseMatchers(nodes, stage.all);
    const none = diagnoseMatchers(nodes, stage.none ?? []);
    const allMatched = all.every((diagnostic) => diagnostic.matched);
    const forbiddenMatched = none.some((diagnostic) => diagnostic.matched);
    const currentFingerprint = fingerprint(nodes);
    const actionsSincePrevious = this.actions.slice(this.actionCountAtLastCompletion);
    const actionOccurred = this.stageIndex === 0 || this.actionCount > this.actionCountAtLastCompletion;
    const requiredActionOccurred = !stage.afterAction || actionsSincePrevious.includes(stage.afterAction);
    const stateChanged = this.stageIndex === 0
      || stage.allowSameState === true
      || currentFingerprint !== this.fingerprintAtLastCompletion;
    const evidenceSatisfied = allMatched && !forbiddenMatched;
    const blocker: EvidenceStageBlocker | undefined = !allMatched
      ? 'required-evidence'
      : forbiddenMatched
        ? 'forbidden-evidence'
        : !actionOccurred
          ? 'meaningful-action'
          : !requiredActionOccurred
            ? 'required-action'
          : !stateChanged
            ? 'accessibility-state-change'
            : undefined;

    this.diagnostics[this.stageIndex] = {
      name: stage.name,
      state: 'active',
      evidenceSatisfied,
      all,
      none,
      actionsSincePrevious,
      ...(blocker ? { blocker } : {}),
    };

    if (forbiddenMatched) {
      this.terminalFailure = true;
      this.diagnostics[this.stageIndex] = {
        ...this.diagnostics[this.stageIndex]!,
        state: 'failed',
      };
      return this.status();
    }

    if (!blocker) {
      this.checks[stage.name] = true;
      this.diagnostics[this.stageIndex] = {
        ...this.diagnostics[this.stageIndex]!,
        state: 'passed',
      };
      this.actionCountAtLastCompletion = this.actionCount;
      this.fingerprintAtLastCompletion = currentFingerprint;
      this.stageIndex += 1;
      const next = this.diagnostics[this.stageIndex];
      if (next) this.diagnostics[this.stageIndex] = { ...next, state: 'active' };
    }
    return this.status();
  }

  status(): EvidenceStatus {
    const nextStage = this.definition.stages[this.stageIndex]?.name;
    return {
      passed: this.stageIndex === this.definition.stages.length,
      failed: this.terminalFailure,
      checks: { ...this.checks },
      observations: this.count,
      stages: this.diagnostics.map((stage) => ({
        ...stage,
        all: stage.all.map((diagnostic) => ({ ...diagnostic, matcher: { ...diagnostic.matcher } })),
        none: stage.none.map((diagnostic) => ({ ...diagnostic, matcher: { ...diagnostic.matcher } })),
        actionsSincePrevious: [...stage.actionsSincePrevious],
      })),
      ...(nextStage ? { nextStage } : {}),
    };
  }
}
