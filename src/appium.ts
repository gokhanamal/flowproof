import { remote } from 'webdriverio';
import type { Config } from './config.js';

export interface ElementHandle {
  clearValue(): Promise<void>;
  click(): Promise<void>;
  isExisting(): Promise<boolean>;
  isDisplayed(): Promise<boolean>;
  setValue(value: string): Promise<void>;
}

export interface MobileDriver {
  $(selector: string): Promise<ElementHandle>;
  deleteSession(): Promise<void>;
  execute(script: string, arguments_: Record<string, unknown>): Promise<unknown>;
  getPageSource(): Promise<string>;
  hideKeyboard(): Promise<void>;
  isKeyboardShown(): Promise<boolean>;
  takeScreenshot(): Promise<string>;
}

export async function connectAppium(config: Config): Promise<MobileDriver> {
  const url = config.appiumServerUrl;
  const port = url.port ? Number.parseInt(url.port, 10) : url.protocol === 'https:' ? 443 : 80;
  return remote({
    protocol: url.protocol.slice(0, -1) as 'http' | 'https',
    hostname: url.hostname,
    port,
    path: url.pathname === '/' ? '/' : url.pathname,
    logLevel: 'warn',
    connectionRetryCount: 2,
    // A clean GitHub runner must build WebDriverAgent before Appium can create
    // the first session. That one-time Xcode build commonly exceeds two minutes.
    connectionRetryTimeout: 300_000,
    capabilities: {
      platformName: 'iOS',
      'appium:automationName': 'XCUITest',
      'appium:udid': config.simulatorUdid,
      'appium:app': config.appPath,
      ...(config.language ? { 'appium:language': config.language } : {}),
      ...(config.locale ? { 'appium:locale': config.locale } : {}),
      'appium:noReset': false,
      'appium:fullReset': false,
      'appium:forceAppLaunch': true,
      'appium:shouldTerminateApp': true,
      'appium:wdaLaunchTimeout': 300_000,
      'appium:wdaConnectionTimeout': 300_000,
      'appium:showXcodeLog': process.env.APPIUM_SHOW_XCODE_LOG === '1',
      'appium:newCommandTimeout': 180,
    },
  }) as unknown as Promise<MobileDriver>;
}
