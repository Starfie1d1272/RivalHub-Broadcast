import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import {
  getBuiltinPreset,
  getBuiltinTheme,
  type HudConfigDocument,
} from '@rivalhub-broadcast/hud-config';

import { buildApp } from '../src/app.js';
import { HudConfigStore } from '../src/hud-config/store.js';

const OPERATOR_HEADERS = {
  origin: 'http://127.0.0.1',
  'x-operator-token': 'operator-secret',
};

interface HudStateBody {
  readonly document: HudConfigDocument;
  readonly resolved: { readonly preset: { readonly id: string; readonly name: string } };
  readonly etag: string;
  readonly activationStale: boolean;
}

function parseHudStateBody(value: unknown): HudStateBody {
  if (typeof value !== 'object' || value === null) throw new Error('HUD response is not an object');
  return value as HudStateBody;
}

describe('HUD config control plane', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    if (app !== undefined) await app.close();
    app = undefined;
  });

  it('serves the resolved preset with conditional ETag polling', async () => {
    app = buildApp({
      hudConfigStore: new HudConfigStore(),
      operatorControlToken: 'operator-secret',
    });

    const first = await app.inject({ method: 'GET', url: '/local/v1/hud-config' });
    expect(first.statusCode).toBe(200);
    expect(first.headers.etag).toMatch(/^"[0-9a-f]{64}"$/);
    expect(first.json()).toMatchObject({
      resolved: { preset: { id: 'builtin:rivalhub-default-preset' } },
      activationStale: false,
    });

    const notModified = await app.inject({
      method: 'GET',
      url: '/local/v1/hud-config',
      headers: { 'if-none-match': first.headers.etag },
    });
    expect(notModified.statusCode).toBe(304);
    expect(notModified.headers.etag).toBe(first.headers.etag);
  });

  it('requires both local origin and operator token for mutations', async () => {
    app = buildApp({ operatorControlToken: 'operator-secret' });
    const value = { ...getBuiltinTheme(), id: 'draft-theme', name: '现场外观' };

    const noOrigin = await app.inject({
      method: 'POST',
      url: '/operator/hud-config',
      headers: { 'x-operator-token': 'operator-secret' },
      payload: { kind: 'save-as', resource: 'theme', value },
    });
    expect(noOrigin.statusCode).toBe(403);

    const wrongToken = await app.inject({
      method: 'POST',
      url: '/operator/hud-config',
      headers: { origin: 'http://127.0.0.1', 'x-operator-token': 'wrong' },
      payload: { kind: 'save-as', resource: 'theme', value },
    });
    expect(wrongToken.statusCode).toBe(401);
  });

  it('keeps save and activate as separate mutations', async () => {
    app = buildApp({ operatorControlToken: 'operator-secret' });
    const initial = await app.inject({ method: 'GET', url: '/local/v1/hud-config' });
    const initialEtag = initial.headers.etag;
    const preset = { ...getBuiltinPreset(), id: 'draft-preset', name: '现场预设' };

    const saved = await app.inject({
      method: 'POST',
      url: '/operator/hud-config',
      headers: OPERATOR_HEADERS,
      payload: { kind: 'save-as', resource: 'preset', value: preset },
    });
    expect(saved.statusCode).toBe(200);
    const savedBody = parseHudStateBody(saved.json());
    const customPreset = savedBody.document.customPresets[0];
    if (customPreset === undefined) throw new Error('save-as did not return a custom preset');
    expect(savedBody.etag).toBe(initialEtag);
    expect(savedBody.activationStale).toBe(false);

    const activated = await app.inject({
      method: 'POST',
      url: '/operator/hud-config',
      headers: OPERATOR_HEADERS,
      payload: { kind: 'activate-preset', sourceId: customPreset.id },
    });
    expect(activated.statusCode).toBe(200);
    const activatedBody = parseHudStateBody(activated.json());
    expect(activatedBody).toMatchObject({
      resolved: { preset: { id: customPreset.id, name: '现场预设' } },
      activationStale: false,
    });
    expect(activatedBody.etag).not.toBe(initialEtag);

    const repeated = await app.inject({
      method: 'POST',
      url: '/operator/hud-config',
      headers: OPERATOR_HEADERS,
      payload: { kind: 'activate-preset', sourceId: customPreset.id },
    });
    const repeatedBody = parseHudStateBody(repeated.json());
    expect(repeatedBody.etag).toBe(activatedBody.etag);
  });
});
