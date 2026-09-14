import { sanitizeCapture } from '../index.js';
import {
  failCli,
  optionalNonNegativeInteger,
  parseFlags,
  requiredFlag,
  stripPnpmSeparator,
} from './args.js';

try {
  const flags = parseFlags(stripPnpmSeparator(process.argv.slice(2)));
  const firstSequence = optionalNonNegativeInteger(flags, 'sequence-start');
  const lastSequence = optionalNonNegativeInteger(flags, 'sequence-end');
  if ((firstSequence === undefined) !== (lastSequence === undefined)) {
    throw new Error('--sequence-start and --sequence-end must be provided together');
  }
  if (firstSequence !== undefined && lastSequence !== undefined && firstSequence > lastSequence) {
    throw new Error('--sequence-start must not exceed --sequence-end');
  }
  const lifecycleCoverage = requiredFlag(flags, 'lifecycle-coverage');
  if (lifecycleCoverage !== 'partial' && lifecycleCoverage !== 'full-match') {
    throw new Error('--lifecycle-coverage must be partial or full-match');
  }
  const allowed = new Set([
    'input',
    'output',
    'scenario',
    'lifecycle-coverage',
    'sequence-start',
    'sequence-end',
  ]);
  for (const key of flags.keys()) if (!allowed.has(key)) throw new Error(`unknown flag --${key}`);

  const selection =
    firstSequence === undefined || lastSequence === undefined
      ? undefined
      : { kind: 'sequence-range' as const, firstSequence, lastSequence };
  const capture = await sanitizeCapture({
    inputDir: requiredFlag(flags, 'input'),
    outputDir: requiredFlag(flags, 'output'),
    scenario: requiredFlag(flags, 'scenario'),
    lifecycleCoverage,
    ...(selection === undefined ? {} : { selection }),
  });
  console.log(
    JSON.stringify({
      captureId: capture.manifest.captureId,
      frameCount: capture.manifest.frameCount,
      framesSha256: capture.computedFramesSha256,
      provenance: capture.manifest.provenance,
    }),
  );
} catch (error) {
  failCli(error);
}
