#!/usr/bin/env node
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  aggregateSuiteResults,
  loadSuite,
  renderSuiteJson,
  renderSuiteMarkdown,
  type LoadedSuite,
  type SuiteAliases,
} from './suite.js';

export interface SuiteMatrixEntry {
  flow_key: string;
  flow_name: string;
  flow_path: string;
  required: boolean;
  fixture: string;
  inputs: string;
  artifact_id: string;
}

export interface SuiteMatrix {
  include: SuiteMatrixEntry[];
}

function aliasesFromEnvironment(env: NodeJS.ProcessEnv): SuiteAliases {
  const list = (name: string) => (env[name] ?? '').split(',').map((value) => value.trim()).filter(Boolean);
  const fixtures = list('FLOWPROOF_FIXTURE_ALIASES');
  const inputs = list('FLOWPROOF_INPUT_ALIASES');
  return {
    ...(fixtures.length > 0 ? { fixtures } : {}),
    ...(inputs.length > 0 ? { inputs } : {}),
  };
}

export function buildSuiteMatrix(suite: LoadedSuite, workspace: string): SuiteMatrix {
  return {
    include: suite.flows.map((entry) => ({
      flow_key: entry.flow.key,
      flow_name: entry.flow.name,
      flow_path: path.relative(workspace, entry.absolutePath),
      required: entry.required,
      fixture: entry.fixture ?? '',
      inputs: entry.inputs.join(','),
      artifact_id: entry.artifactId,
    })),
  };
}

async function writeGithubOutputs(values: Record<string, string>, env: NodeJS.ProcessEnv): Promise<void> {
  const outputPath = env.GITHUB_OUTPUT;
  if (!outputPath) return;
  await appendFile(outputPath, Object.entries(values).map(([key, value]) => `${key}=${value}\n`).join(''), 'utf8');
}

export async function prepareSuite(
  manifestPath: string,
  workspace: string,
  aliases: SuiteAliases,
  env: NodeJS.ProcessEnv = process.env,
): Promise<SuiteMatrix> {
  const suite = await loadSuite(manifestPath, aliases);
  const matrix = buildSuiteMatrix(suite, workspace);
  await writeGithubOutputs({
    matrix: JSON.stringify(matrix),
    suite_key: suite.key,
    suite_name: suite.name,
    device: suite.device,
    locale: suite.locale,
    language: suite.language,
  }, env);
  return matrix;
}

async function readRawResults(suite: LoadedSuite, resultsDirectory: string): Promise<Record<string, unknown>> {
  const results: Record<string, unknown> = {};
  await Promise.all(suite.flows.map(async (entry) => {
    const resultPath = path.join(resultsDirectory, entry.artifactId, 'flow-result.json');
    try {
      const contents = await readFile(resultPath, 'utf8');
      try {
        results[entry.flow.key] = JSON.parse(contents) as unknown;
      } catch (error) {
        results[entry.flow.key] = {
          invalidJson: error instanceof Error ? error.message : String(error),
        };
      }
    } catch {
      // The aggregator converts an absent terminal result into a blocking error.
    }
  }));
  return results;
}

export async function aggregateSuiteArtifacts(options: {
  manifestPath: string;
  resultsDirectory: string;
  outputDirectory: string;
  attemptId: string;
  buildSha: string;
  aliases: SuiteAliases;
  env?: NodeJS.ProcessEnv;
}): Promise<{ gatePassed: boolean; jsonPath: string; markdownPath: string }> {
  const env = options.env ?? process.env;
  const suite = await loadSuite(options.manifestPath, options.aliases);
  const rawResults = await readRawResults(suite, options.resultsDirectory);
  const aggregate = aggregateSuiteResults(suite, rawResults, {
    attemptId: options.attemptId,
    buildSha: options.buildSha,
  });
  const json = renderSuiteJson(aggregate);
  const markdown = renderSuiteMarkdown(aggregate);
  await mkdir(options.outputDirectory, { recursive: true });
  const jsonPath = path.join(options.outputDirectory, 'suite-report.json');
  const markdownPath = path.join(options.outputDirectory, 'suite-summary.md');
  await Promise.all([
    writeFile(jsonPath, json, 'utf8'),
    writeFile(markdownPath, markdown, 'utf8'),
    env.GITHUB_STEP_SUMMARY ? appendFile(env.GITHUB_STEP_SUMMARY, markdown, 'utf8') : Promise.resolve(),
  ]);
  await writeGithubOutputs({
    gate_passed: String(aggregate.gatePassed),
    json_path: jsonPath,
    markdown_path: markdownPath,
  }, env);
  return { gatePassed: aggregate.gatePassed, jsonPath, markdownPath };
}

async function main(): Promise<void> {
  const [command, ...arguments_] = process.argv.slice(2);
  const aliases = aliasesFromEnvironment(process.env);
  if (command === 'prepare') {
    const [manifestPath, workspace = process.cwd()] = arguments_;
    if (!manifestPath) throw new Error('Usage: suite-cli prepare <manifest-path> [workspace]');
    const matrix = await prepareSuite(manifestPath, workspace, aliases);
    if (!process.env.GITHUB_OUTPUT) process.stdout.write(`${JSON.stringify(matrix)}\n`);
    return;
  }
  if (command === 'aggregate') {
    const [manifestPath, resultsDirectory, outputDirectory, attemptId, buildSha] = arguments_;
    if (!manifestPath || !resultsDirectory || !outputDirectory || !attemptId || !buildSha) {
      throw new Error('Usage: suite-cli aggregate <manifest-path> <results-dir> <output-dir> <attempt-id> <build-sha>');
    }
    const result = await aggregateSuiteArtifacts({
      manifestPath,
      resultsDirectory,
      outputDirectory,
      attemptId,
      buildSha,
      aliases,
    });
    if (!process.env.GITHUB_OUTPUT) process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  throw new Error('Expected suite command: prepare or aggregate');
}

const entrypoint = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === entrypoint) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
