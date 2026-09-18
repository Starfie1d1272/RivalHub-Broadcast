import { timingSafeEqual } from 'node:crypto';

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { OperatorCommand, SeriesProgress } from '@rivalhub-broadcast/core/series-progress';

import { checkLocalWebOrigin, type LocalWebOriginPolicy } from '../local-web/origin-policy.js';
import type { SeriesOperatorCommandResult } from '../runtime/program-runtime.js';

export interface OperatorCommandControllerOptions {
  readonly controlToken: string;
  readonly originPolicy?: LocalWebOriginPolicy;
  readonly execute: (command: OperatorCommand) => SeriesOperatorCommandResult;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function tokenMatches(request: FastifyRequest, expected: string): boolean {
  const header = request.headers['x-operator-token'];
  const authorization = request.headers.authorization;
  const provided =
    typeof header === 'string'
      ? header
      : typeof authorization === 'string' && authorization.startsWith('Bearer ')
        ? authorization.slice('Bearer '.length)
        : undefined;
  if (provided === undefined) return false;
  const actualBytes = Buffer.from(provided, 'utf8');
  const expectedBytes = Buffer.from(expected, 'utf8');
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

function unauthorized(reply: FastifyReply): void {
  void reply.code(401).send({ error: 'operator_unauthorized' });
}

function originForbidden(reply: FastifyReply): void {
  void reply.code(403).send({ error: 'operator_origin_forbidden' });
}

function commandResult(result: SeriesOperatorCommandResult): Record<string, unknown> {
  const progress = result.progress;
  return {
    ok: result.ok,
    code: result.code,
    series: progress === null ? null : seriesStatus(progress),
  };
}

function seriesStatus(progress: SeriesProgress): Record<string, unknown> {
  return {
    bindingState: progress.bindingState,
    currentMapOrder: progress.currentMapOrder,
    score: progress.score,
    issues: progress.issues.map((item) => ({ ...item })),
  };
}

export function registerOperatorCommandRoutes(
  app: FastifyInstance,
  options: OperatorCommandControllerOptions,
): void {
  if (options.controlToken.trim().length === 0) {
    throw new Error('operator control token 不能为空');
  }

  app.post('/operator/series/bind', (request, reply) => {
    if (
      options.originPolicy !== undefined &&
      !checkLocalWebOrigin(options.originPolicy, request.headers.origin).allowed
    ) {
      originForbidden(reply);
      return;
    }
    if (!tokenMatches(request, options.controlToken)) {
      unauthorized(reply);
      return;
    }

    const body: unknown = request.body;
    const kind = isRecord(body) ? body.kind : undefined;
    const mapOrder = isRecord(body) ? body.mapOrder : undefined;
    const reason = isRecord(body) ? body.reason : undefined;
    if (
      kind !== 'bind-current-map-execution-to-series-map' ||
      !isPositiveInteger(mapOrder) ||
      mapOrder > 5 ||
      typeof reason !== 'string' ||
      reason.trim().length === 0 ||
      reason.length > 512
    ) {
      return reply.code(400).send({ error: 'invalid_operator_series_bind_command' });
    }

    const result = options.execute({
      kind,
      mapOrder,
      reason,
    });
    return reply.code(result.ok ? 200 : 409).send(commandResult(result));
  });
}
