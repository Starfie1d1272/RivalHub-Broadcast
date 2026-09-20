import { timingSafeEqual } from 'node:crypto';

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { checkLocalWebOrigin, type LocalWebOriginPolicy } from '../local-web/origin-policy.js';
import { HudConfigStore, type HudResourceKind } from './store.js';

export interface HudConfigControllerOptions {
  readonly store: HudConfigStore;
  readonly controlToken?: string;
  readonly originPolicy: LocalWebOriginPolicy;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
  const actual = Buffer.from(provided, 'utf8');
  const expectedBytes = Buffer.from(expected, 'utf8');
  return actual.length === expectedBytes.length && timingSafeEqual(actual, expectedBytes);
}

function unauthorized(reply: FastifyReply): void {
  void reply.code(401).send({ error: 'operator_unauthorized' });
}

function originForbidden(reply: FastifyReply): void {
  void reply.code(403).send({ error: 'operator_origin_forbidden' });
}

function resourceKind(value: unknown): HudResourceKind | undefined {
  return value === 'preset' || value === 'layout' || value === 'theme' ? value : undefined;
}

function responseBody(store: HudConfigStore) {
  return store.getState();
}

export function registerHudConfigRoutes(
  app: FastifyInstance,
  options: HudConfigControllerOptions,
): void {
  app.get('/local/v1/hud-config', (request, reply) => {
    const state = options.store.getState();
    reply.header('cache-control', 'no-store');
    reply.header('etag', state.etag);
    const requested = request.headers['if-none-match'];
    if (typeof requested === 'string' && requested === state.etag) return reply.code(304).send();
    return reply.code(200).send(responseBody(options.store));
  });

  if (options.controlToken === undefined) return;
  if (options.controlToken.trim().length === 0) {
    throw new Error('设置 operatorControlToken 时必须为非空值');
  }

  app.post('/operator/hud-config', async (request, reply) => {
    if (!checkLocalWebOrigin(options.originPolicy, request.headers.origin).allowed) {
      originForbidden(reply);
      return;
    }
    if (!tokenMatches(request, options.controlToken!)) {
      unauthorized(reply);
      return;
    }

    const body: unknown = request.body;
    try {
      if (!isRecord(body) || typeof body.kind !== 'string') {
        return reply.code(400).send({ error: 'invalid_hud_config_command' });
      }
      if (body.kind === 'save-resource' || body.kind === 'save-as') {
        const resource = resourceKind(body.resource);
        if (resource === undefined || !('value' in body)) {
          return reply.code(400).send({ error: 'invalid_hud_config_command' });
        }
        const state =
          body.kind === 'save-resource'
            ? await options.store.saveResource(resource, body.value)
            : await options.store.saveAs(resource, body.value);
        return reply.code(200).send(state);
      }
      if (body.kind === 'activate-preset' && typeof body.sourceId === 'string') {
        const state = await options.store.activatePreset(body.sourceId);
        return reply.code(200).send(state);
      }
      return reply.code(400).send({ error: 'invalid_hud_config_command' });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'HUD 配置命令未执行';
      return reply.code(400).send({ error: 'hud_config_command_rejected', message });
    }
  });
}
