import { timingSafeEqual } from 'node:crypto';
import { performance } from 'node:perf_hooks';

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  adaptGsiPayload,
  type GsiAdaptResult,
  type TelemetryReceiveContext,
} from '@rivalhub-broadcast/telemetry-gsi';

import type { CaptureRecorder } from './capture-recorder.js';

export const GSI_BODY_LIMIT_BYTES = 64 * 1024;
export const GSI_REQUEST_TIMEOUT_MS = 5_000;

export const PRODUCTION_GSI_CONFIG: Record<string, unknown> = {
  uri: 'http://127.0.0.1:3000/gsi',
  timeout: 1.1,
  buffer: 0,
  throttle: 0,
  heartbeat: 10,
  precision_time: 3,
  precision_position: 1,
  precision_vector: 3,
  components: [
    'provider',
    'map',
    'map_round_wins',
    'round',
    'player_id',
    'player_state',
    'player_weapons',
    'player_match_stats',
    'player_position',
    'phase_countdowns',
    'allplayers_id',
    'allplayers_state',
    'allplayers_match_stats',
    'allplayers_weapons',
    'allplayers_position',
    'allgrenades',
    'bomb',
  ],
};

export interface GsiClockSample {
  readonly receivedAt: string;
  readonly receivedMonotonicMs: number;
}

export interface GsiClock {
  now(): GsiClockSample;
}

export type TelemetrySink = (result: GsiAdaptResult) => void;

export interface GsiIngressOptions {
  readonly gsiToken: string;
  readonly recorder: CaptureRecorder;
  readonly sink?: TelemetrySink;
  readonly clock?: GsiClock;
  readonly onRuntimeDiagnostic?: (
    code: 'adapter_unexpected_failure' | 'telemetry_sink_failed' | 'recorder_unexpected_failure',
  ) => void;
}

const defaultClock: GsiClock = {
  now: () => ({
    receivedAt: new Date().toISOString(),
    receivedMonotonicMs: performance.now(),
  }),
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasMatchingToken(value: unknown, expected: string): boolean {
  if (!isRecord(value) || typeof value.token !== 'string') return false;
  const actualBytes = Buffer.from(value.token, 'utf8');
  const expectedBytes = Buffer.from(expected, 'utf8');
  if (actualBytes.length !== expectedBytes.length) return false;
  return timingSafeEqual(actualBytes, expectedBytes);
}

function withoutAuth(payload: Record<string, unknown>): Record<string, unknown> {
  const sanitized = { ...payload };
  delete sanitized.auth;
  return sanitized;
}

function isSupportedContentType(value: string | string[] | undefined): boolean {
  if (value === undefined) return true;
  const contentType = Array.isArray(value) ? value[0] : value;
  return contentType !== undefined && /^application\/json(?:\s*;|$)/i.test(contentType);
}

function sendNoContent(reply: FastifyReply): void {
  void reply.code(204).send();
}

function reportRuntimeDiagnostic(
  options: GsiIngressOptions,
  code: 'adapter_unexpected_failure' | 'telemetry_sink_failed' | 'recorder_unexpected_failure',
): void {
  try {
    options.onRuntimeDiagnostic?.(code);
  } catch {
    // Diagnostics must never affect the accepted frame response.
  }
}

export function registerGsiIngress(app: FastifyInstance, options: GsiIngressOptions): void {
  const clock = options.clock ?? defaultClock;
  let sequence = 0;

  app.post(
    '/gsi',
    { bodyLimit: GSI_BODY_LIMIT_BYTES },
    (request: FastifyRequest<{ Body: unknown }>, reply: FastifyReply) => {
      if (!isSupportedContentType(request.headers['content-type'])) {
        void reply.code(415).send();
        return;
      }

      const root = request.body;
      if (!isRecord(root)) {
        void reply.code(400).send();
        return;
      }

      if (!hasMatchingToken(root.auth, options.gsiToken)) {
        void reply.code(401).send();
        return;
      }

      const receive = clock.now();
      const acceptedSequence = sequence;
      sequence += 1;
      const payload = withoutAuth(root);
      const receiveContext: TelemetryReceiveContext = {
        sequence: acceptedSequence,
        receivedAt: receive.receivedAt,
        receivedMonotonicMs: receive.receivedMonotonicMs,
      };

      try {
        const frame = options.recorder.serializeFrame({
          sequence: acceptedSequence,
          receivedAt: receive.receivedAt,
          receivedMonotonicMs: receive.receivedMonotonicMs,
          payload,
        });
        options.recorder.offer(frame);
      } catch {
        reportRuntimeDiagnostic(options, 'recorder_unexpected_failure');
      }

      let adapted: GsiAdaptResult;
      try {
        adapted = adaptGsiPayload(payload, receiveContext);
      } catch {
        reportRuntimeDiagnostic(options, 'adapter_unexpected_failure');
        sendNoContent(reply);
        return;
      }

      try {
        options.sink?.(adapted);
      } catch {
        reportRuntimeDiagnostic(options, 'telemetry_sink_failed');
      }

      sendNoContent(reply);
    },
  );
}
