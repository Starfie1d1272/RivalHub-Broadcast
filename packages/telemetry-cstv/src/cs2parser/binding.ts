import { DemoReader, EntityMode, HttpBroadcastReader } from 'cs2parser';

import { normalizeCstvSync } from '../normalize/sync.js';
import { SUPPORTED_CSTV_GAME_EVENT_NAMES } from '../types.js';
import type {
  CstvGameEventName,
  CstvParserSession,
  CstvParserSessionFactoryOptions,
  CstvSessionRunResult,
  CstvSessionStartResult,
  CstvSyncMetadata,
} from '../types.js';

type Cs2ParserGameEventName = Parameters<DemoReader['gameEvents']['on']>[0];
type CstvGameEventNameCompatibility =
  Exclude<CstvGameEventName, Cs2ParserGameEventName> extends never ? true : never;

const cstvGameEventNameCompatibility: CstvGameEventNameCompatibility = true;
void cstvGameEventNameCompatibility;

function startResult(status: CstvSessionStartResult['status']): CstvSessionStartResult {
  if (status === 'ready') return { status: 'ready' };
  return { status };
}

function runResult(status: CstvSessionRunResult['status']): CstvSessionRunResult {
  return { status };
}

/** The only module in the package that imports cs2parser runtime types. */
export function createCs2ParserSession(
  options: CstvParserSessionFactoryOptions,
): CstvParserSession {
  const parser = new DemoReader();
  const reader = new HttpBroadcastReader(parser, options.url, {
    entities: EntityMode.ALL,
    onFragmentError: () => 'abort',
  });

  let normalizedSync: CstvSyncMetadata | null = null;
  let stopped = false;

  parser.on('broadcastsync', (sync) => {
    const nextSync = normalizeCstvSync(sync);
    if (nextSync === undefined) {
      options.onDiagnostic({ code: 'invalid-sync' });
      return;
    }
    normalizedSync = nextSync;
    options.onSync(nextSync);
  });

  const gameEvents = parser.gameEvents;
  for (const eventName of SUPPORTED_CSTV_GAME_EVENT_NAMES) {
    gameEvents.on(eventName, (event) => {
      options.onEvent(eventName, event, parser.currentTick);
    });
  }

  return {
    get sync() {
      return normalizedSync;
    },
    get tailTick() {
      return reader.tailTick;
    },
    async start() {
      const result = await reader.start();
      if (result.status === 'ready') {
        const sync = reader.sync;
        if (normalizedSync === null && sync !== null) {
          const nextSync = normalizeCstvSync(sync);
          if (nextSync === undefined) {
            options.onDiagnostic({ code: 'invalid-sync' });
          } else {
            normalizedSync = nextSync;
            options.onSync(nextSync);
          }
        }
      }
      return startResult(result.status);
    },
    async run() {
      const result = await reader.run();
      return runResult(result.status);
    },
    stop() {
      if (stopped) return;
      stopped = true;
      reader.stop();
    },
  };
}
