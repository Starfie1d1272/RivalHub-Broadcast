import { useEffect, useState } from 'react';

export type BrowserHostKind = 'obs' | 'browser' | 'unknown';

export interface BrowserHostDiagnostics {
  readonly active: {
    readonly obs: number;
    readonly browser: number;
    readonly unknown: number;
    readonly byChannel: Readonly<Record<string, number>>;
    readonly byHostChannel: Readonly<Record<BrowserHostKind, Readonly<Record<string, number>>>>;
    readonly obsVersions: readonly string[];
  };
  readonly totals: {
    readonly connected: number;
    readonly disconnected: number;
    readonly connectionLimitRejected: number;
    readonly slowConsumerTerminated: number;
    readonly snapshotOversize: number;
    readonly heartbeatTerminated: number;
    readonly sendFailed: number;
  };
  readonly recentEvents: readonly {
    readonly sequence: number;
    readonly at: string;
    readonly action: 'connected' | 'disconnected';
    readonly host: BrowserHostKind;
    readonly channel: string;
    readonly obsVersion?: string;
  }[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function parseCounts(value: unknown): Record<string, number> | undefined {
  if (!isRecord(value)) return undefined;
  const result: Record<string, number> = {};
  for (const [key, count] of Object.entries(value)) {
    if (!isCount(count)) return undefined;
    result[key] = count;
  }
  return result;
}

export function parseBrowserHostDiagnostics(value: unknown): BrowserHostDiagnostics | undefined {
  if (!isRecord(value) || !isRecord(value.active) || !isRecord(value.totals)) return undefined;
  const { active, totals } = value;
  const byChannel = parseCounts(active.byChannel);
  const byHostChannelRaw = active.byHostChannel;
  if (!isRecord(byHostChannelRaw)) return undefined;
  const obsByChannel = parseCounts(byHostChannelRaw.obs);
  const browserByChannel = parseCounts(byHostChannelRaw.browser);
  const unknownByChannel = parseCounts(byHostChannelRaw.unknown);
  if (
    !isCount(active.obs) ||
    !isCount(active.browser) ||
    !isCount(active.unknown) ||
    byChannel === undefined ||
    obsByChannel === undefined ||
    browserByChannel === undefined ||
    unknownByChannel === undefined ||
    !Array.isArray(active.obsVersions) ||
    !active.obsVersions.every((version) => typeof version === 'string')
  ) {
    return undefined;
  }
  const totalKeys = [
    'connected',
    'disconnected',
    'connectionLimitRejected',
    'slowConsumerTerminated',
    'snapshotOversize',
    'heartbeatTerminated',
    'sendFailed',
  ] as const;
  if (!totalKeys.every((key) => isCount(totals[key]))) return undefined;
  if (!Array.isArray(value.recentEvents)) return undefined;
  const recentEvents = value.recentEvents.map((event) => {
    if (
      !isRecord(event) ||
      !isCount(event.sequence) ||
      typeof event.at !== 'string' ||
      (event.action !== 'connected' && event.action !== 'disconnected') ||
      (event.host !== 'obs' && event.host !== 'browser' && event.host !== 'unknown') ||
      typeof event.channel !== 'string' ||
      (event.obsVersion !== undefined && typeof event.obsVersion !== 'string')
    ) {
      return undefined;
    }
    return {
      sequence: event.sequence,
      at: event.at,
      action: event.action,
      host: event.host,
      channel: event.channel,
      ...(event.obsVersion === undefined ? {} : { obsVersion: event.obsVersion }),
    } as const;
  });
  if (recentEvents.some((event) => event === undefined)) return undefined;
  return {
    active: {
      obs: active.obs,
      browser: active.browser,
      unknown: active.unknown,
      byChannel,
      byHostChannel: {
        obs: obsByChannel,
        browser: browserByChannel,
        unknown: unknownByChannel,
      },
      obsVersions: [...active.obsVersions],
    },
    totals: {
      connected: totals.connected as number,
      disconnected: totals.disconnected as number,
      connectionLimitRejected: totals.connectionLimitRejected as number,
      slowConsumerTerminated: totals.slowConsumerTerminated as number,
      snapshotOversize: totals.snapshotOversize as number,
      heartbeatTerminated: totals.heartbeatTerminated as number,
      sendFailed: totals.sendFailed as number,
    },
    recentEvents: recentEvents as BrowserHostDiagnostics['recentEvents'],
  };
}

export function useBrowserHostDiagnostics(): BrowserHostDiagnostics | null {
  const [diagnostics, setDiagnostics] = useState<BrowserHostDiagnostics | null>(null);

  useEffect(() => {
    let active = true;
    let timer: number | undefined;

    const poll = async (): Promise<void> => {
      try {
        const response = await fetch('/debug/hosts', {
          headers: { Accept: 'application/json' },
        });
        if (!response.ok) throw new Error('host diagnostics unavailable');
        const parsed = parseBrowserHostDiagnostics(await response.json());
        if (parsed === undefined) throw new Error('host diagnostics shape unavailable');
        if (active) setDiagnostics(parsed);
      } catch {
        if (active) setDiagnostics(null);
      } finally {
        if (active) timer = window.setTimeout(() => void poll(), 1500);
      }
    };

    void poll();
    return () => {
      active = false;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, []);

  return diagnostics;
}
