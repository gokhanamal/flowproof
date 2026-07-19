import { Agent, MaxTurnsExceededError, OpenAIProvider, Runner, getGlobalTraceProvider, tool } from '@openai/agents';
import { z } from 'zod';
import type { MobileDriver } from './appium.js';
import { StructuredActions } from './actions.js';
import type { Config } from './config.js';
import { EvidenceGate } from './evidence.js';
import { EvidenceStore } from './evidence-store.js';
import type { FlowDefinition } from './flow.js';
import { compactAccessibilityTree, type AccessibleNode } from './observation.js';
import { RecordingModel, sanitizeTranscriptValue } from './transcript.js';

export const AGENT_INSTRUCTIONS = [
  'Complete the supplied mobile test journey using only the tools.',
  'Call observe first and after every action. Take one action at a time.',
  'Only tap an exact accessibility name or label returned by the latest observation.',
  'Only enter or clear text in an exact text-input name, label, or value returned by the latest observation.',
  'Use enter_secret for configured runtime input aliases; never request, repeat, or type a secret value with enter_text.',
  'Use bounded waits only when the interface is visibly loading or changing asynchronously.',
  'Stop as soon as every deterministic check returned by observe is true.',
  'Stop immediately if observe reports deterministicFailed; forbidden evidence is a terminal flow failure.',
  'If blocked, stop and concisely describe the visible blocker.',
  'Do not grade the test yourself; deterministic runner checks decide pass or fail.',
].join(' ');

export interface AgentRunReport {
  status: 'passed' | 'failed' | 'error';
  model: string;
  agentSummary: unknown;
  evidence: ReturnType<EvidenceGate['status']>;
  usage?: {
    requests: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  transcriptTurns: number;
  error?: string;
}

function redactNodes(nodes: AccessibleNode[], config: Config): AccessibleNode[] {
  return nodes.map((node) => ({
    ...node,
    ...(node.name ? { name: config.runtimeInputs.redact(node.name) } : {}),
    ...(node.label ? { label: config.runtimeInputs.redact(node.label) } : {}),
    ...(node.value ? { value: config.runtimeInputs.redact(node.value) } : {}),
  }));
}

function boundedModelNodes(nodes: AccessibleNode[], maxCharacters = 12_000): {
  nodes: AccessibleNode[];
  truncated: boolean;
} {
  const output: AccessibleNode[] = [];
  let size = 2;
  for (const node of nodes) {
    const nodeSize = JSON.stringify(node).length + (output.length > 0 ? 1 : 0);
    if (size + nodeSize > maxCharacters) return { nodes: output, truncated: true };
    output.push(node);
    size += nodeSize;
  }
  return { nodes: output, truncated: false };
}

export async function runAgent(
  config: Config,
  flow: FlowDefinition,
  driver: MobileDriver,
  store: EvidenceStore,
): Promise<AgentRunReport> {
  const gate = new EvidenceGate(flow.evidence);
  const actions = new StructuredActions(driver, store, config.runtimeInputs);
  const observeNext = 'Action completed. Observe the screen before taking another action.';
  const meaningfulActionCompleted = (action: string) => {
    gate.recordAction(action);
    return observeNext;
  };

  const observe = tool({
    name: 'observe',
    description: 'Inspect the current screen as compact visible accessibility nodes. Screenshots are saved locally but never sent to the model.',
    parameters: z.object({}),
    timeoutMs: 30_000,
    execute: async () => {
      const xml = await driver.getPageSource();
      const screenshot = await driver.takeScreenshot();
      const observation = compactAccessibilityTree(xml);
      actions.updateObservation(observation.nodes);
      const safeNodes = redactNodes(observation.nodes, config);
      const modelObservation = boundedModelNodes(safeNodes);
      const status = gate.record(safeNodes);
      await store.observation(config.runtimeInputs.redact(xml), screenshot, safeNodes);
      return JSON.stringify({
        elements: modelObservation.nodes,
        truncated: modelObservation.truncated,
        deterministicChecks: status.checks,
        deterministicFailed: status.failed,
      });
    },
  });

  const tapText = tool({
    name: 'tap_text',
    description: 'Tap one exact accessibility name or label from the most recent observation.',
    parameters: z.object({ text: z.string().min(1).max(120) }),
    timeoutMs: 20_000,
    execute: async ({ text }) => {
      await actions.tapText(text);
      return meaningfulActionCompleted('tap_text');
    },
  });

  const enterText = tool({
    name: 'enter_text',
    description: 'Replace the value of an observed text field, secure text field, search field, or text view.',
    parameters: z.object({
      target: z.string().min(1).max(120),
      text: z.string().min(1).max(1_000),
    }),
    timeoutMs: 20_000,
    execute: async ({ target, text }) => {
      await actions.enterText(target, text);
      return meaningfulActionCompleted('enter_text');
    },
  });

  const enterSecret = config.runtimeInputs.names.length > 0 ? tool({
    name: 'enter_secret',
    description: `Enter a configured runtime input without exposing its value. Allowed inputName aliases: ${config.runtimeInputs.names.join(', ')}.`,
    parameters: z.object({
      target: z.string().min(1).max(120),
      inputName: z.string().refine((name) => config.runtimeInputs.names.includes(name), 'Runtime input is not allow-listed'),
    }),
    timeoutMs: 20_000,
    execute: async ({ target, inputName }) => {
      await actions.enterSecret(target, inputName);
      return meaningfulActionCompleted('enter_secret');
    },
  }) : undefined;

  const clearText = tool({
    name: 'clear_text',
    description: 'Clear an observed text field, secure text field, search field, or text view.',
    parameters: z.object({ target: z.string().min(1).max(120) }),
    timeoutMs: 20_000,
    execute: async ({ target }) => {
      await actions.clearText(target);
      return meaningfulActionCompleted('clear_text');
    },
  });

  const swipe = tool({
    name: 'swipe',
    description: 'Perform one full-screen directional swipe without using coordinates.',
    parameters: z.object({ direction: z.enum(['up', 'down', 'left', 'right']) }),
    timeoutMs: 20_000,
    execute: async ({ direction }) => {
      await actions.swipe(direction);
      return meaningfulActionCompleted('swipe');
    },
  });

  const scroll = tool({
    name: 'scroll',
    description: 'Scroll the current page by one screen in a direction.',
    parameters: z.object({ direction: z.enum(['up', 'down', 'left', 'right']) }),
    timeoutMs: 20_000,
    execute: async ({ direction }) => {
      await actions.scroll(direction);
      return meaningfulActionCompleted('scroll');
    },
  });

  const wait = tool({
    name: 'wait',
    description: 'Wait briefly for an asynchronous interface update before observing again.',
    parameters: z.object({ durationMs: z.number().int().min(250).max(10_000) }),
    timeoutMs: 12_000,
    execute: async ({ durationMs }) => {
      await actions.wait(durationMs);
      return observeNext;
    },
  });

  const dismissKeyboard = tool({
    name: 'dismiss_keyboard',
    description: 'Hide the software keyboard if it is currently visible.',
    parameters: z.object({}),
    timeoutMs: 20_000,
    execute: async () => {
      await actions.dismissKeyboard();
      return meaningfulActionCompleted('dismiss_keyboard');
    },
  });

  const handleAlert = tool({
    name: 'handle_alert',
    description: 'Accept or dismiss the currently visible iOS alert.',
    parameters: z.object({ action: z.enum(['accept', 'dismiss']) }),
    timeoutMs: 20_000,
    execute: async ({ action }) => {
      await actions.handleAlert(action);
      return meaningfulActionCompleted('handle_alert');
    },
  });

  const relaunchApp = tool({
    name: 'relaunch_app',
    description: 'Terminate and relaunch the active application without clearing its saved data.',
    parameters: z.object({}),
    timeoutMs: 60_000,
    execute: async () => {
      await actions.relaunchApp();
      return meaningfulActionCompleted('relaunch_app');
    },
  });

  const tools = [observe, tapText, enterText, enterSecret, clearText, swipe, scroll, wait, dismissKeyboard, handleAlert, relaunchApp]
    .filter((agentTool) => agentTool !== undefined);
  const toolNames = tools.map((agentTool) => agentTool.name);

  const modelSettings = {
    reasoning: { effort: 'none' as const },
    text: { verbosity: 'low' as const },
    parallelToolCalls: false,
    maxTokens: 384,
  };
  const prompt = `Flow: ${flow.name}\n\nDescription:\n${flow.description}\n\nJourney:\n${flow.instructions}`;
  const maxTurns = flow.maxTurns;
  const provider = new OpenAIProvider();
  const recordingModel = new RecordingModel(await provider.getModel(config.model), store);

  await store.writeJson('agent-input.json', {
    model: config.model,
    instructions: AGENT_INSTRUCTIONS,
    prompt,
    modelSettings,
    tools: toolNames,
    maxTurns,
  });

  const agent = new Agent({
    name: 'iOS Appium flow agent',
    model: recordingModel,
    modelSettings,
    outputType: z.object({ summary: z.string().max(300) }),
    instructions: AGENT_INSTRUCTIONS,
    tools,
  });

  const runner = new Runner({
    workflowName: 'FlowProof',
    traceIncludeSensitiveData: false,
    tracingDisabled: process.env.OPENAI_AGENTS_DISABLE_TRACING === '1',
  });

  try {
    const result = await runner.run(agent, prompt, { maxTurns });
    const usage = recordingModel.usage;
    await store.writeJson('conversation-history.json', sanitizeTranscriptValue(result.history));
    await store.writeJson('transcript-manifest.json', {
      complete: true,
      model: config.model,
      turns: recordingModel.turns,
      turnFiles: 'model-turn-NNN-input.json / model-turn-NNN-output.json',
      exclusions: [
        'API keys and authorization values',
        'provider-specific metadata',
        'hidden or encrypted reasoning',
        'screenshots and raw Appium XML',
        'simulator screen recording',
      ],
    });
    return {
      status: gate.status().passed ? 'passed' : 'failed',
      model: config.model,
      agentSummary: result.finalOutput,
      evidence: gate.status(),
      transcriptTurns: recordingModel.turns,
      usage,
    };
  } catch (error) {
    await store.writeJson('transcript-manifest.json', {
      complete: false,
      model: config.model,
      turns: recordingModel.turns,
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    });
    return {
      status: 'error',
      model: config.model,
      agentSummary: null,
      evidence: gate.status(),
      transcriptTurns: recordingModel.turns,
      usage: recordingModel.usage,
      error: error instanceof MaxTurnsExceededError ? `Agent exceeded the ${maxTurns}-turn limit` : String(error),
    };
  } finally {
    await provider.close();
    await getGlobalTraceProvider().forceFlush();
  }
}
