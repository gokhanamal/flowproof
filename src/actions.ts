import type { MobileDriver } from './appium.js';
import {
  compactAccessibilityTree,
  observedInputForText,
  selectorForObservedInput,
  selectorForObservedText,
  type AccessibleNode,
} from './observation.js';

export type GestureDirection = 'up' | 'down' | 'left' | 'right';
export type AlertAction = 'accept' | 'dismiss';

export interface ActionRecorder {
  recordAction(action: string, detail: string): void;
}

interface ActiveAppInfo {
  bundleId: string;
}

export class StructuredActions {
  private latestNodes: AccessibleNode[] = [];

  constructor(
    private readonly driver: MobileDriver,
    private readonly recorder: ActionRecorder,
  ) {}

  updateObservation(nodes: AccessibleNode[]): void {
    this.latestNodes = nodes;
  }

  async tapText(text: string): Promise<void> {
    if (!this.wasObserved(text)) throw new Error(`Refusing to tap unobserved text: ${text}`);
    const element = await this.visibleElement(selectorForObservedText(text, this.latestNodes), text);
    await element.click();
    this.recorder.recordAction('tap_text', text);
  }

  async enterText(target: string, text: string): Promise<void> {
    const input = observedInputForText(target, this.latestNodes);
    if (!input) throw new Error(`Refusing to target an unobserved text input: ${target}`);
    const element = await this.visibleElement(selectorForObservedInput(target, this.latestNodes), target);
    await element.setValue(text);
    this.recorder.recordAction('enter_text', `${input.type} (${text.length} characters)`);
  }

  async clearText(target: string): Promise<void> {
    const before = observedInputForText(target, this.latestNodes);
    if (!before) throw new Error(`Refusing to target an unobserved text input: ${target}`);
    const element = await this.visibleElement(selectorForObservedInput(target, this.latestNodes), target);
    try {
      await element.clearValue();
    } catch (error) {
      const currentNodes = compactAccessibilityTree(await this.driver.getPageSource()).nodes;
      this.updateObservation(currentNodes);
      if (!clearCompletedDespiteStaleElement(before, target, currentNodes)) throw error;
    }
    this.recorder.recordAction('clear_text', before.type);
  }

  async swipe(direction: GestureDirection): Promise<void> {
    await this.driver.execute('mobile: swipe', { direction });
    this.recorder.recordAction('swipe', direction);
  }

  async scroll(direction: GestureDirection): Promise<void> {
    await this.driver.execute('mobile: scroll', { direction });
    this.recorder.recordAction('scroll', direction);
  }

  async wait(durationMs: number): Promise<void> {
    if (!Number.isInteger(durationMs) || durationMs < 250 || durationMs > 10_000) {
      throw new Error('Wait duration must be an integer from 250 to 10000 milliseconds');
    }
    await new Promise((resolve) => setTimeout(resolve, durationMs));
    this.recorder.recordAction('wait', `${durationMs} ms`);
  }

  async dismissKeyboard(): Promise<void> {
    if (await this.driver.isKeyboardShown()) {
      try {
        await this.driver.hideKeyboard();
        this.recorder.recordAction('dismiss_keyboard', 'keyboard hidden');
      } catch (error) {
        await this.driver.execute('mobile: swipe', { direction: 'down' });
        if (await this.driver.isKeyboardShown()) {
          throw new Error('Appium could not dismiss the keyboard with its native command or a downward swipe', {
            cause: error,
          });
        }
        this.recorder.recordAction('dismiss_keyboard', 'keyboard hidden with downward swipe');
      }
      return;
    }
    this.recorder.recordAction('dismiss_keyboard', 'keyboard already hidden');
  }

  async handleAlert(action: AlertAction): Promise<void> {
    await this.driver.execute('mobile: alert', { action });
    this.recorder.recordAction('handle_alert', action);
  }

  async relaunchApp(): Promise<void> {
    const app = asActiveAppInfo(await this.driver.execute('mobile: activeAppInfo', {}));
    await this.driver.execute('mobile: terminateApp', { bundleId: app.bundleId });
    await this.driver.execute('mobile: launchApp', { bundleId: app.bundleId });
    this.recorder.recordAction('relaunch_app', 'active application');
  }

  private wasObserved(text: string): boolean {
    return this.latestNodes.some((node) => node.name === text || node.label === text);
  }

  private async visibleElement(selector: string, text: string) {
    const element = await this.driver.$(selector);
    if (!(await element.isExisting()) || !(await element.isDisplayed())) {
      throw new Error(`Observed element is no longer visible: ${text}`);
    }
    return element;
  }
}

function clearCompletedDespiteStaleElement(
  before: AccessibleNode,
  target: string,
  currentNodes: AccessibleNode[],
): boolean {
  if (before.value === target && !currentNodes.some((node) => node.type === before.type && node.value === target)) {
    return true;
  }
  const current = currentNodes.find((node) =>
    node.type === before.type
      && ((before.name && node.name === before.name) || (before.label && node.label === before.label)),
  );
  return before.value !== undefined && current?.value !== before.value;
}

function asActiveAppInfo(value: unknown): ActiveAppInfo {
  if (!value || typeof value !== 'object') throw new Error('Appium did not return active application information');
  const bundleId = (value as Record<string, unknown>).bundleId;
  if (typeof bundleId !== 'string' || !bundleId.trim()) {
    throw new Error('Appium did not return an active application bundle identifier');
  }
  return { bundleId };
}
