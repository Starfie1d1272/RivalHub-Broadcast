import { verifyCapture } from '../index.js';
import { failCli, stripPnpmSeparator } from './args.js';

const argumentsWithoutSeparator = stripPnpmSeparator(process.argv.slice(2));
const captureDir = argumentsWithoutSeparator[0];
if (
  captureDir === undefined ||
  captureDir.startsWith('--') ||
  argumentsWithoutSeparator.length !== 1
) {
  failCli(new Error('usage: pnpm testkit:capture:verify -- <capture-dir>'));
}

try {
  const capture = await verifyCapture(captureDir);
  console.log(
    JSON.stringify({
      captureId: capture.manifest.captureId,
      frameCount: capture.manifest.frameCount,
      computedFramesSha256: capture.computedFramesSha256,
      firstElapsedUs: capture.firstElapsedUs,
      lastElapsedUs: capture.lastElapsedUs,
    }),
  );
} catch (error) {
  failCli(error);
}
