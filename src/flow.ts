import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import { z } from 'zod';

const evidenceMatcherSchema = z.object({
  type: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  label: z.string().min(1).optional(),
  value: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
  typePattern: z.string().min(1).optional(),
  namePattern: z.string().min(1).optional(),
  labelPattern: z.string().min(1).optional(),
  valuePattern: z.string().min(1).optional(),
}).strict().refine((matcher) => Object.values(matcher).some((value) => value !== undefined), {
  message: 'An evidence matcher must define at least one field',
});

const evidenceStageSchema = z.object({
  name: z.string().min(1),
  all: z.array(evidenceMatcherSchema).min(1),
  none: z.array(evidenceMatcherSchema).min(1).optional(),
  afterAction: z.enum([
    'tap_text',
    'enter_text',
    'enter_secret',
    'clear_text',
    'swipe',
    'scroll',
    'dismiss_keyboard',
    'handle_alert',
    'relaunch_app',
  ]).optional(),
  allowSameState: z.boolean().optional(),
}).strict().superRefine((stage, context) => {
  if (stage.allowSameState === true && !stage.afterAction) {
    context.addIssue({
      code: 'custom',
      path: ['allowSameState'],
      message: 'allowSameState requires afterAction',
    });
  }
});

const flowSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  instructions: z.string().min(1),
  maxTurns: z.number().int().min(1).max(30).default(10),
  evidence: z.object({
    stages: z.array(evidenceStageSchema).min(1),
  }).strict(),
}).strict().superRefine((flow, context) => {
  const names = flow.evidence.stages.map((stage) => stage.name);
  if (new Set(names).size !== names.length) {
    context.addIssue({ code: 'custom', path: ['evidence', 'stages'], message: 'Stage names must be unique' });
  }
  for (const [stageIndex, stage] of flow.evidence.stages.entries()) {
    for (const matcherGroup of ['all', 'none'] as const) {
      for (const [matcherIndex, matcher] of (stage[matcherGroup] ?? []).entries()) {
        for (const field of ['typePattern', 'namePattern', 'labelPattern', 'valuePattern'] as const) {
          const pattern = matcher[field];
          if (!pattern) continue;
          try {
            new RegExp(pattern);
          } catch {
            context.addIssue({
              code: 'custom',
              path: ['evidence', 'stages', stageIndex, matcherGroup, matcherIndex, field],
              message: `Invalid regular expression: ${pattern}`,
            });
          }
        }
      }
    }
  }
});

export type EvidenceMatcher = z.infer<typeof evidenceMatcherSchema>;
export type EvidenceDefinition = z.infer<typeof flowSchema>['evidence'];
export type FlowDefinition = z.infer<typeof flowSchema>;

export async function loadFlow(filePath: string): Promise<FlowDefinition> {
  const parsed: unknown = parse(await readFile(filePath, 'utf8'));
  const result = flowSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Invalid flow ${filePath}: ${z.prettifyError(result.error)}`);
  }
  return result.data;
}
