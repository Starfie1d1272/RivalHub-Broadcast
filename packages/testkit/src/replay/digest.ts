import { createHash } from 'node:crypto';

import { canonicalJson } from '../capture/canonical-json.js';
import type { ReplayEvent, ReplayResultDigest } from './types.js';

export async function digestReplayEvents(
  events: AsyncIterable<ReplayEvent>,
): Promise<ReplayResultDigest> {
  const hash = createHash('sha256');
  let frameCount = 0;
  let boundaryCount = 0;
  for await (const event of events) {
    if (event.kind === 'frame') {
      frameCount += 1;
      hash.update(
        canonicalJson({
          kind: event.kind,
          captureIndex: event.captureIndex,
          occurrence: event.occurrence,
          scheduledElapsedUs: event.scheduledElapsedUs,
          receiveContext: event.receiveContext,
          result: event.result,
        }),
      );
      hash.update('\n');
    } else {
      boundaryCount += 1;
      hash.update(canonicalJson(event));
      hash.update('\n');
    }
  }
  return { frameCount, boundaryCount, digest: hash.digest('hex') };
}
