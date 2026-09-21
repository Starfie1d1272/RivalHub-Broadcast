// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createDefaultHudConfigDocument,
  getBuiltinResolvedPreset,
} from '@rivalhub-broadcast/hud-config';

import {
  HUD_CONFIG_POLL_INTERVAL_MS,
  HudConfigClient,
  HudConfigEditorClient,
} from '../src/realtime/hud-config-client';

describe('HudConfigClient', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('polls at the bounded interval and sends the resolved ETag conditionally', async () => {
    vi.useFakeTimers();
    const resolved = getBuiltinResolvedPreset();
    const responseBody = {
      resolved,
      etag: '"hud-etag"',
      activeRevision: 'hud-revision',
    };
    const fetchMock = vi.fn((_: string, init?: RequestInit) => {
      if (fetchMock.mock.calls.length === 1) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(responseBody),
        });
      }
      expect(init?.headers).toMatchObject({ 'If-None-Match': '"hud-etag"' });
      return Promise.resolve({ ok: true, status: 304, json: () => Promise.resolve(null) });
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new HudConfigClient();
    client.start();
    await vi.waitFor(() => expect(client.getSnapshot().status).toBe('ready'));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(HUD_CONFIG_POLL_INTERVAL_MS);
    await Promise.resolve();
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(client.getSnapshot().etag).toBe('"hud-etag"');
    expect(client.getSnapshot().activeRevision).toBe('hud-revision');
    client.stop();
  });

  it('polls the saved editor model with its own conditional revision', async () => {
    vi.useFakeTimers();
    const responseBody = {
      document: createDefaultHudConfigDocument(),
      etag: '"editor-etag"',
      revision: '"editor-etag"',
      activationStale: false,
    };
    const fetchMock = vi.fn((_: string, init?: RequestInit) => {
      if (fetchMock.mock.calls.length === 1) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(responseBody),
        });
      }
      expect(init?.headers).toMatchObject({ 'If-None-Match': '"editor-etag"' });
      return Promise.resolve({ ok: true, status: 304, json: () => Promise.resolve(null) });
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new HudConfigEditorClient();
    client.start();
    await vi.waitFor(() => expect(client.getSnapshot().status).toBe('ready'));
    await vi.advanceTimersByTimeAsync(HUD_CONFIG_POLL_INTERVAL_MS);
    await Promise.resolve();
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(client.getSnapshot().revision).toBe('"editor-etag"');
    client.stop();
  });
});
