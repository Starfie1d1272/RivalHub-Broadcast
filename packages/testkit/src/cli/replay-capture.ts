import { verifyCapture } from '../capture/reader.js';
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
  let frameCount = 0;
  let boundaryCount = 0;
  for await (const event of replayCapture(capture, {
    mode: speed === undefined ? { kind: 'step' } : { kind: 'paced', speed },
  })) {
    if (event.kind === 'frame') frameCount += 1;
    else boundaryCount += 1;
  }
  console.log(JSON.stringify({ captureId: capture.manifest.captureId, frameCount, boundaryCount }));
} catch (error) {
  failCli(error);
}
