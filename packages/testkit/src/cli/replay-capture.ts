import { verifyCapture } from '../capture/reader.js';
import { digestReplayEvents } from '../replay/digest.js';
import { replayCapture } from '../replay/runner.js';
import { failCli, parseFlags, stripPnpmSeparator } from './args.js';

try {
  const argumentsWithoutSeparator = stripPnpmSeparator(process.argv.slice(2));
  const captureDir = argumentsWithoutSeparator[0];
  if (captureDir === undefined || captureDir.startsWith('--')) {
    throw new Error('usage: pnpm testkit:capture:replay -- <capture-dir> [--speed N]');
  }
  const flags = parseFlags(argumentsWithoutSeparator.slice(1));
  for (const key of flags.keys()) if (key !== 'speed') throw new Error(`unknown flag --${key}`);
  const speedText = flags.get('speed');
  const speed = speedText === undefined ? undefined : Number(speedText);
  if (speed !== undefined && (!Number.isFinite(speed) || speed <= 0)) {
    throw new Error('--speed must be a finite number greater than zero');
  }
  const capture = await verifyCapture(captureDir);
  const result = await digestReplayEvents(
    replayCapture(capture, {
      mode: speed === undefined ? { kind: 'step' } : { kind: 'paced', speed },
    }),
  );
  console.log(JSON.stringify({ captureId: capture.manifest.captureId, ...result }));
} catch (error) {
  failCli(error);
}
