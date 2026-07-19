import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';
import { loadFlow, type FlowDefinition } from './flow.js';

export const SUITE_RESULT_SCHEMA_VERSION = 1 as const;

const safeIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const aliasPattern = /^[a-z][a-z0-9_]*$/;
const localePattern = /^[a-z]{2,3}_[A-Z]{2}$/;
const languagePattern = /^[a-z]{2,3}(?:-[A-Z]{2})?$/;
const singleLine = z.string().trim().min(1).max(200).regex(/^[^\r\n]+$/, 'Value must be a single line');

const suiteFlowSchema = z.object({
  path: z.string().trim().min(1).max(500),
  required: z.boolean(),
  fixture: z.string().regex(aliasPattern, 'Fixture must be a lowercase alias').optional(),
  inputs: z.array(z.string().regex(aliasPattern, 'Input must be a lowercase alias')).default([]),
}).strict().superRefine((entry, context) => {
  if (new Set(entry.inputs).size !== entry.inputs.length) {
    context.addIssue({ code: 'custom', path: ['inputs'], message: 'Input aliases must be unique' });
  }
});

const suiteSchema = z.object({
  key: z.string().max(80).regex(safeIdPattern, 'Suite key must be artifact-safe lowercase kebab-case'),
  name: singleLine,
  device: singleLine,
  locale: z.string().regex(localePattern, 'Locale must use language_REGION format, for example en_US'),
  language: z.string().regex(languagePattern, 'Language must use a BCP 47 language code, for example en or en-US'),
  flows: z.array(suiteFlowSchema).min(1),
}).strict();

export type SuiteFlowEntry = z.infer<typeof suiteFlowSchema>;
export type SuiteManifest = z.infer<typeof suiteSchema>;

export interface SuiteAliases {
  fixtures?: readonly string[];
  inputs?: readonly string[];
}

export interface ResolvedSuiteFlow extends SuiteFlowEntry {
  absolutePath: string;
  artifactId: string;
  flow: FlowDefinition;
}

export interface LoadedSuite extends Omit<SuiteManifest, 'flows'> {
  manifestPath: string;
  flows: ResolvedSuiteFlow[];
}

function validateDeclaredAlias(
  kind: 'fixture' | 'input',
  alias: string,
  declared: readonly string[] | undefined,
  flowPath: string,
): void {
  if (declared && !declared.includes(alias)) {
    throw new Error(`Unknown ${kind} alias "${alias}" in suite flow ${flowPath}`);
  }
}

export async function loadSuite(filePath: string, aliases: SuiteAliases = {}): Promise<LoadedSuite> {
  const manifestPath = path.resolve(filePath);
  let parsed: unknown;
  try {
    parsed = parse(await readFile(manifestPath, 'utf8'));
  } catch (error) {
    throw new Error(`Unable to read suite ${manifestPath}: ${error instanceof Error ? error.message : String(error)}`);
  }

  const result = suiteSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Invalid suite ${manifestPath}: ${z.prettifyError(result.error)}`);
  }

  const manifest = result.data;
  const baseDirectory = path.dirname(manifestPath);
  const loadedFlows: ResolvedSuiteFlow[] = [];
  const flowKeys = new Set<string>();

  for (const entry of manifest.flows) {
    if (entry.fixture) validateDeclaredAlias('fixture', entry.fixture, aliases.fixtures, entry.path);
    for (const input of entry.inputs) validateDeclaredAlias('input', input, aliases.inputs, entry.path);

    const absolutePath = path.resolve(baseDirectory, entry.path);
    const relativePath = path.relative(baseDirectory, absolutePath);
    if (path.isAbsolute(entry.path) || relativePath === '..' || relativePath.startsWith(`..${path.sep}`)) {
      throw new Error(`Suite flow path must stay inside the suite directory: ${entry.path}`);
    }
    let flow: FlowDefinition;
    try {
      flow = await loadFlow(absolutePath);
    } catch (error) {
      throw new Error(`Invalid suite flow ${entry.path}: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (!safeIdPattern.test(flow.key)) {
      throw new Error(`Flow key "${flow.key}" in ${entry.path} must be artifact-safe lowercase kebab-case`);
    }
    if (flowKeys.has(flow.key)) {
      throw new Error(`Duplicate flow key "${flow.key}" in suite ${manifest.key}`);
    }
    flowKeys.add(flow.key);

    const artifactId = `${manifest.key}-${flow.key}`;
    loadedFlows.push({ ...entry, absolutePath, artifactId, flow });
  }

  return {
    key: manifest.key,
    name: manifest.name,
    device: manifest.device,
    locale: manifest.locale,
    language: manifest.language,
    manifestPath,
    flows: loadedFlows,
  };
}

export const flowRunStatusSchema = z.enum(['passed', 'failed', 'error', 'skipped']);
export type FlowRunStatus = z.infer<typeof flowRunStatusSchema>;

export const flowRunResultSchema = z.object({
  schemaVersion: z.literal(SUITE_RESULT_SCHEMA_VERSION),
  suiteKey: z.string().min(1),
  flowKey: z.string().min(1),
  flowName: z.string().min(1),
  artifactId: z.string().regex(safeIdPattern),
  required: z.boolean(),
  status: flowRunStatusSchema,
  durationMs: z.number().int().nonnegative(),
  turns: z.number().int().nonnegative(),
  attemptId: z.string().min(1),
  buildSha: z.string().min(1),
  firstFailedStage: z.string().min(1).optional(),
  reason: z.string().min(1).optional(),
  errorClass: z.string().min(1).optional(),
  artifacts: z.record(z.string(), z.string().min(1)).default({}),
}).strict().superRefine((result, context) => {
  if ((result.status === 'failed' || result.status === 'error' || result.status === 'skipped') && !result.reason) {
    context.addIssue({ code: 'custom', path: ['reason'], message: `${result.status} results require a reason` });
  }
  if (result.status === 'error' && !result.errorClass) {
    context.addIssue({ code: 'custom', path: ['errorClass'], message: 'Error results require an errorClass' });
  }
});

export type FlowRunResult = z.infer<typeof flowRunResultSchema>;

export interface AggregateOptions {
  attemptId: string;
  buildSha: string;
}

export interface SuiteTotals {
  total: number;
  passed: number;
  failed: number;
  error: number;
  skipped: number;
}

export interface SuiteAggregateResult {
  schemaVersion: typeof SUITE_RESULT_SCHEMA_VERSION;
  suiteKey: string;
  suiteName: string;
  attemptId: string;
  buildSha: string;
  gatePassed: boolean;
  totals: SuiteTotals;
  flows: FlowRunResult[];
}

type RawResults = ReadonlyMap<string, unknown> | Readonly<Record<string, unknown>>;

function rawResultFor(results: RawResults, flowKey: string): unknown {
  if (results instanceof Map) return results.get(flowKey);
  return (results as Readonly<Record<string, unknown>>)[flowKey];
}

function errorResult(flow: ResolvedSuiteFlow, suite: LoadedSuite, options: AggregateOptions, reason: string): FlowRunResult {
  return {
    schemaVersion: SUITE_RESULT_SCHEMA_VERSION,
    suiteKey: suite.key,
    flowKey: flow.flow.key,
    flowName: flow.flow.name,
    artifactId: flow.artifactId,
    required: flow.required,
    status: 'error',
    durationMs: 0,
    turns: 0,
    attemptId: options.attemptId,
    buildSha: options.buildSha,
    reason,
    errorClass: 'ResultValidationError',
    artifacts: {},
  };
}

function validateExpectedResult(
  raw: unknown,
  flow: ResolvedSuiteFlow,
  suite: LoadedSuite,
  options: AggregateOptions,
): FlowRunResult {
  if (raw === undefined) return errorResult(flow, suite, options, 'Missing terminal result');
  const parsed = flowRunResultSchema.safeParse(raw);
  if (!parsed.success) {
    return errorResult(flow, suite, options, `Corrupt terminal result: ${z.prettifyError(parsed.error)}`);
  }

  const result = parsed.data;
  const identityMatches = result.suiteKey === suite.key
    && result.flowKey === flow.flow.key
    && result.flowName === flow.flow.name
    && result.artifactId === flow.artifactId
    && result.required === flow.required
    && result.attemptId === options.attemptId
    && result.buildSha === options.buildSha;
  if (!identityMatches) {
    return errorResult(flow, suite, options, 'Terminal result identity does not match the expected suite flow');
  }
  return result;
}

export function aggregateSuiteResults(
  suite: LoadedSuite,
  rawResults: RawResults,
  options: AggregateOptions,
): SuiteAggregateResult {
  const flows = suite.flows.map((flow) => validateExpectedResult(rawResultFor(rawResults, flow.flow.key), flow, suite, options));
  const totals: SuiteTotals = { total: flows.length, passed: 0, failed: 0, error: 0, skipped: 0 };
  for (const result of flows) totals[result.status] += 1;

  return {
    schemaVersion: SUITE_RESULT_SCHEMA_VERSION,
    suiteKey: suite.key,
    suiteName: suite.name,
    attemptId: options.attemptId,
    buildSha: options.buildSha,
    gatePassed: flows.every((result) => !result.required || result.status === 'passed'),
    totals,
    flows,
  };
}

function escapeTableCell(value: string): string {
  return value.replaceAll('|', '\\|').replaceAll('\n', ' ');
}

export function renderSuiteMarkdown(result: SuiteAggregateResult): string {
  const conclusion = result.gatePassed ? 'PASSED' : 'FAILED';
  const lines = [
    `## FlowProof: ${escapeTableCell(result.suiteName)}`,
    '',
    `**Release gate: ${conclusion}**`,
    '',
    `Passed: ${result.totals.passed} · Failed: ${result.totals.failed} · Error: ${result.totals.error} · Skipped: ${result.totals.skipped}`,
    '',
    '| Flow | Required | Status | Duration | Details |',
    '| --- | --- | --- | ---: | --- |',
  ];
  for (const flow of result.flows) {
    const detail = flow.reason ?? flow.firstFailedStage ?? '';
    lines.push(`| ${escapeTableCell(flow.flowName)} | ${flow.required ? 'yes' : 'no'} | ${flow.status} | ${flow.durationMs} ms | ${escapeTableCell(detail)} |`);
  }
  return `${lines.join('\n')}\n`;
}

export function renderSuiteJson(result: SuiteAggregateResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}
