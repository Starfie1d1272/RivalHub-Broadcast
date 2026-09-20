import { useEffect, useMemo, useSyncExternalStore } from 'react';

import {
  createDefaultHudConfigDocument,
  getBuiltinResolvedPreset,
  parseHudConfigDocument,
  parseHudResolvedPreset,
  type HudConfigDocument,
  type HudResolvedPreset,
} from '@rivalhub-broadcast/hud-config';

export const HUD_CONFIG_POLL_INTERVAL_MS = 500;

export interface HudConfigResponse {
  readonly document: HudConfigDocument;
  readonly resolved: HudResolvedPreset;
  readonly etag: string;
  readonly activationStale: boolean;
}

export interface HudConfigClientSnapshot {
  readonly status: 'loading' | 'ready' | 'error';
  readonly current: HudResolvedPreset;
  readonly document: HudConfigDocument | null;
  readonly etag: string | null;
  readonly activationStale: boolean;
  readonly error: string | null;
}

export type HudConfigClientListener = () => void;

function parseResponse(value: unknown): HudConfigResponse {
  if (typeof value !== 'object' || value === null) throw new Error('HUD 配置响应结构无法识别');
  const record = value as Record<string, unknown>;
  if (typeof record.etag !== 'string' || typeof record.activationStale !== 'boolean') {
    throw new Error('HUD 配置响应缺少版本信息');
  }
  const document = parseHudConfigDocument(record.document);
  let resolved: HudResolvedPreset;
  try {
    resolved = parseHudResolvedPreset(record.resolved);
  } catch {
    throw new Error('HUD 配置响应的启用预设无效');
  }
  return {
    document,
    resolved,
    etag: record.etag,
    activationStale: record.activationStale,
  };
}

export class HudConfigClient {
  private snapshot: HudConfigClientSnapshot = {
    status: 'loading',
    current: getBuiltinResolvedPreset(),
    document: createDefaultHudConfigDocument(),
    etag: null,
    activationStale: false,
    error: null,
  };
  private readonly listeners = new Set<HudConfigClientListener>();
  private timer: number | undefined;
  private running = false;
  private requestInFlight = false;

  getSnapshot = (): HudConfigClientSnapshot => this.snapshot;

  subscribe = (listener: HudConfigClientListener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.poll();
  }

  stop(): void {
    this.running = false;
    if (this.timer !== undefined) {
      window.clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  private update(patch: Partial<HudConfigClientSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }

  private schedule(): void {
    if (!this.running || this.timer !== undefined) return;
    this.timer = window.setTimeout(() => {
      this.timer = undefined;
      void this.poll();
    }, HUD_CONFIG_POLL_INTERVAL_MS);
  }

  private async poll(): Promise<void> {
    if (!this.running || this.requestInFlight) return;
    this.requestInFlight = true;
    try {
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (this.snapshot.etag !== null) headers['If-None-Match'] = this.snapshot.etag;
      const response = await fetch('/local/v1/hud-config', { headers, cache: 'no-store' });
      if (response.status === 304) {
        this.update({ status: 'ready', error: null });
      } else {
        if (!response.ok) throw new Error(`本地制播服务返回 HTTP ${response.status}`);
        const parsed = parseResponse(await response.json());
        this.update({
          status: 'ready',
          current: parsed.resolved,
          document: parsed.document,
          etag: parsed.etag,
          activationStale: parsed.activationStale,
          error: null,
        });
      }
    } catch (error: unknown) {
      this.update({
        status: 'error',
        error: error instanceof Error ? error.message : 'HUD 配置暂不可用，继续使用最近有效版本',
      });
    } finally {
      this.requestInFlight = false;
      this.schedule();
    }
  }
}

export function useHudConfigClient(enabled = true): HudConfigClientSnapshot {
  const client = useMemo(() => new HudConfigClient(), []);
  useEffect(() => {
    if (!enabled) return;
    client.start();
    return () => client.stop();
  }, [client, enabled]);
  return useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
}

export interface HudConfigMutation {
  readonly kind: 'save-resource' | 'save-as' | 'activate-preset';
  readonly resource?: 'preset' | 'layout' | 'theme';
  readonly value?: unknown;
  readonly sourceId?: string;
}

export async function mutateHudConfig(
  token: string,
  command: HudConfigMutation,
): Promise<HudConfigResponse> {
  const response = await fetch('/operator/hud-config', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'x-operator-token': token,
    },
    body: JSON.stringify(command),
  });
  const body: unknown = await response.json();
  if (!response.ok) {
    const message =
      typeof body === 'object' &&
      body !== null &&
      'message' in body &&
      typeof body.message === 'string'
        ? body.message
        : 'HUD 配置命令未执行';
    throw new Error(message);
  }
  return parseResponse(body);
}
