import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';

export interface ScreenRecording {
  outputPath: string;
  stop(): Promise<void>;
}

export async function startScreenRecording(simulatorUdid: string, artifactsDir: string): Promise<ScreenRecording> {
  const outputPath = path.join(artifactsDir, 'screen-recording.mp4');
  const child = spawn(
    'xcrun',
    ['simctl', 'io', simulatorUdid, 'recordVideo', '--codec=h264', '--force', outputPath],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  let stderr = '';
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr = `${stderr}${chunk.toString('utf8')}`.slice(-4_000);
  });

  await waitForRecordingStart(child, () => stderr);

  return {
    outputPath,
    async stop() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const exited = once(child, 'exit');
      child.kill('SIGINT');
      const forceStop = setTimeout(() => child.kill('SIGTERM'), 10_000);
      try {
        await exited;
      } finally {
        clearTimeout(forceStop);
      }
    },
  };
}

async function waitForRecordingStart(child: ChildProcess, stderr: () => string): Promise<void> {
  await Promise.race([
    new Promise<void>((resolve) => setTimeout(resolve, 750)),
    new Promise<void>((_, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => {
        reject(new Error(
          `Simulator screen recording exited before startup (${code ?? signal ?? 'unknown'}): ${stderr().trim()}`,
        ));
      });
    }),
  ]);
}
