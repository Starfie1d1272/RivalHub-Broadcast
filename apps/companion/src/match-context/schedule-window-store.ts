import { readFile } from 'node:fs/promises';

import {
  toScheduleWindow,
  validateBroadcastScheduleWindow,
  type BroadcastScheduleWindowV1,
  type ContractDiagnostic,
} from '@rivalhub-broadcast/rivalhub';
import type { ScheduleWindow } from '@rivalhub-broadcast/core/match-context';

import { replaceDurableJson, type DurableJsonFaultInjector } from './durable-json.js';
import { SerialCommitQueue } from './serial-commit.js';
import type { ContextFreshness, ContextOrigin } from './lkg-store.js';

const SCHEDULE_WINDOW_CACHE_VERSION = 'rivalhub.broadcast-schedule-window-cache.v1' as const;

export interface ScheduleWindowBinding {
  readonly schedule: BroadcastScheduleWindowV1;
  readonly window: ScheduleWindow;
  readonly origin: ContextOrigin;
  readonly freshness: ContextFreshness;
  readonly storedAt?: string;
  readonly cachedFrom?: Exclude<ContextOrigin, 'cache'>;
}

export type ScheduleWindowStoreIssueCode =
  | 'schedule_lkg_not_found'
  | 'schedule_lkg_read_failed'
  | 'schedule_lkg_invalid_json'
  | 'schedule_lkg_invalid_envelope'
  | 'schedule_lkg_invalid_candidate'
  | 'schedule_lkg_write_failed'
  | 'schedule_lkg_commit_stale'
  | 'schedule_refresh_stale'
  | 'schedule_source_failed'
  | 'schedule_source_invalid'
  | 'schedule_conversion_failed';

export interface ScheduleWindowStoreIssue {
  readonly code: ScheduleWindowStoreIssueCode;
  readonly message: string;
  readonly diagnostics?: readonly ContractDiagnostic[];
}

export interface ScheduleWindowStoreSuccess<T> {
  readonly ok: true;
  readonly value: T;
  readonly diagnostics: readonly ScheduleWindowStoreIssue[];
}

export interface ScheduleWindowStoreFailure {
  readonly ok: false;
  readonly issue: ScheduleWindowStoreIssue;
}

export type ScheduleWindowStoreResult<T> =
  ScheduleWindowStoreSuccess<T> | ScheduleWindowStoreFailure;

export interface ScheduleWindowSource {
  readonly kind: Exclude<ContextOrigin, 'cache'>;
  readonly load: () => Promise<unknown>;
}

export interface ScheduleWindowStoreOptions {
  readonly filePath: string;
  readonly clock?: () => string;
  /** Test-only hook used to prove failed commits preserve the previous envelope. */
  readonly faultInjector?: DurableJsonFaultInjector;
}

interface ScheduleWindowCacheMetadata {
  readonly origin: Exclude<ContextOrigin, 'cache'>;
  readonly storedAt: string;
}

interface ScheduleWindowCacheEnvelope {
  readonly cacheVersion: typeof SCHEDULE_WINDOW_CACHE_VERSION;
  readonly metadata: ScheduleWindowCacheMetadata;
  readonly payload: BroadcastScheduleWindowV1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSourceOrigin(value: unknown): value is Exclude<ContextOrigin, 'cache'> {
  return value === 'online' || value === 'fixture';
}

function parseEnvelope(value: unknown): ScheduleWindowCacheEnvelope | undefined {
  if (!isRecord(value) || value.cacheVersion !== SCHEDULE_WINDOW_CACHE_VERSION) return undefined;
  const metadata = value.metadata;
  if (
    !isRecord(metadata) ||
    !isSourceOrigin(metadata.origin) ||
    typeof metadata.storedAt !== 'string' ||
    value.payload === undefined
  ) {
    return undefined;
  }
  return {
    cacheVersion: SCHEDULE_WINDOW_CACHE_VERSION,
    metadata: { origin: metadata.origin, storedAt: metadata.storedAt },
    payload: value.payload as BroadcastScheduleWindowV1,
  };
}

function invalidCandidate(diagnostics: readonly ContractDiagnostic[]): ScheduleWindowStoreFailure {
  return {
    ok: false,
    issue: {
      code: 'schedule_lkg_invalid_candidate',
      message: 'ScheduleWindow candidate 未通过 structural/semantic validation。',
      diagnostics,
    },
  };
}

function invalidEnvelope(): ScheduleWindowStoreFailure {
  return {
    ok: false,
    issue: {
      code: 'schedule_lkg_invalid_envelope',
      message: 'ScheduleWindow LKG cache envelope 缺少有效的版本、metadata 或 payload。',
    },
  };
}

export interface ScheduleWindowSaveOptions {
  readonly canCommit?: () => boolean;
}

export class ScheduleWindowLkgStore {
  private readonly filePath: string;
  private readonly clock: () => string;
  private readonly faultInjector: DurableJsonFaultInjector | undefined;
  private readonly writeQueue = new SerialCommitQueue();
  private readonly commitQueue = new SerialCommitQueue();
  private currentBinding: ScheduleWindowBinding | undefined;
  private refreshGeneration = 0;

  constructor(options: ScheduleWindowStoreOptions) {
    this.filePath = options.filePath;
    this.clock = options.clock ?? (() => new Date().toISOString());
    this.faultInjector = options.faultInjector;
  }

  getCurrent(): ScheduleWindowBinding | undefined {
    return this.currentBinding;
  }

  async save(
    candidate: unknown,
    origin: Exclude<ContextOrigin, 'cache'>,
    options: ScheduleWindowSaveOptions = {},
  ): Promise<ScheduleWindowStoreResult<BroadcastScheduleWindowV1>> {
    const validated = validateBroadcastScheduleWindow(candidate);
    if (!validated.ok) return invalidCandidate(validated.diagnostics);

    return this.writeQueue.run(async () => {
      const envelope: ScheduleWindowCacheEnvelope = {
        cacheVersion: SCHEDULE_WINDOW_CACHE_VERSION,
        metadata: { origin, storedAt: this.clock() },
        payload: validated.value,
      };
      try {
        const committed = await replaceDurableJson(this.filePath, envelope, {
          ...(options.canCommit === undefined ? {} : { canCommit: options.canCommit }),
          ...(this.faultInjector === undefined ? {} : { faultInjector: this.faultInjector }),
        });
        if (!committed) {
          return {
            ok: false,
            issue: {
              code: 'schedule_lkg_commit_stale',
              message: 'ScheduleWindow LKG candidate 已被更新的 refresh supersede。',
            },
          };
        }
      } catch {
        return {
          ok: false,
          issue: {
            code: 'schedule_lkg_write_failed',
            message: 'ScheduleWindow LKG 原子提交失败，旧 cache envelope 保持不变。',
          },
        };
      }
      return { ok: true, value: validated.value, diagnostics: [] };
    });
  }

  async read(): Promise<ScheduleWindowStoreResult<ScheduleWindowBinding>> {
    let contents: string;
    try {
      contents = await readFile(this.filePath, 'utf8');
    } catch (error: unknown) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        return {
          ok: false,
          issue: { code: 'schedule_lkg_not_found', message: '没有可用的 ScheduleWindow LKG。' },
        };
      }
      return {
        ok: false,
        issue: { code: 'schedule_lkg_read_failed', message: 'ScheduleWindow LKG 读取失败。' },
      };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(contents) as unknown;
    } catch {
      return {
        ok: false,
        issue: { code: 'schedule_lkg_invalid_json', message: 'ScheduleWindow LKG 不是有效 JSON。' },
      };
    }

    const envelope = parseEnvelope(parsed);
    if (envelope === undefined) return invalidEnvelope();
    const validated = validateBroadcastScheduleWindow(envelope.payload);
    if (!validated.ok) return invalidCandidate(validated.diagnostics);

    try {
      return {
        ok: true,
        value: {
          schedule: validated.value,
          window: toScheduleWindow(validated.value),
          origin: 'cache',
          freshness: 'stale',
          storedAt: envelope.metadata.storedAt,
          cachedFrom: envelope.metadata.origin,
        },
        diagnostics: [],
      };
    } catch {
      return {
        ok: false,
        issue: {
          code: 'schedule_lkg_invalid_candidate',
          message: 'ScheduleWindow LKG 无法重新转换为领域模型。',
        },
      };
    }
  }

  async refresh(
    source: ScheduleWindowSource,
  ): Promise<ScheduleWindowStoreResult<ScheduleWindowBinding>> {
    const generation = ++this.refreshGeneration;
    const isCurrent = () => generation === this.refreshGeneration;

    let candidate: unknown;
    try {
      candidate = await source.load();
    } catch {
      return this.useFallback(generation, {
        code: 'schedule_source_failed',
        message: 'ScheduleWindow source 加载失败，继续使用 stale LKG。',
      });
    }

    const validated = validateBroadcastScheduleWindow(candidate);
    if (!validated.ok) {
      return this.useFallback(generation, {
        code: 'schedule_source_invalid',
        message: 'ScheduleWindow source 未通过 validation，继续使用 stale LKG。',
        diagnostics: validated.diagnostics,
      });
    }

    let window: ScheduleWindow;
    try {
      window = toScheduleWindow(validated.value);
    } catch {
      return {
        ok: false,
        issue: {
          code: 'schedule_conversion_failed',
          message: 'ScheduleWindow validated candidate 无法转换为领域模型。',
        },
      };
    }

    return this.commitQueue.run(async () => {
      if (!isCurrent()) return this.staleRefreshResult();

      const saved = await this.save(validated.value, source.kind, { canCommit: isCurrent });
      if (!isCurrent() || (!saved.ok && saved.issue.code === 'schedule_lkg_commit_stale')) {
        return this.staleRefreshResult();
      }

      const diagnostics: ScheduleWindowStoreIssue[] = saved.ok ? [] : [saved.issue];
      const binding: ScheduleWindowBinding = {
        schedule: validated.value,
        window,
        origin: source.kind,
        freshness: 'fresh',
      };
      this.currentBinding = binding;
      return { ok: true, value: binding, diagnostics };
    });
  }

  private async useFallback(
    generation: number,
    diagnostic: ScheduleWindowStoreIssue,
  ): Promise<ScheduleWindowStoreResult<ScheduleWindowBinding>> {
    const fallback = await this.read();
    return this.commitQueue.run(() => {
      if (generation !== this.refreshGeneration) return this.staleRefreshResult();
      if (fallback.ok) {
        this.currentBinding = fallback.value;
        return { ok: true, value: fallback.value, diagnostics: [diagnostic] };
      }
      const message = `${diagnostic.message.replace('继续使用 stale LKG。', '')}且没有可用 LKG。`;
      return diagnostic.diagnostics === undefined
        ? { ok: false, issue: { code: diagnostic.code, message } }
        : {
            ok: false,
            issue: { code: diagnostic.code, message, diagnostics: diagnostic.diagnostics },
          };
    });
  }

  private staleRefreshResult(): ScheduleWindowStoreFailure {
    return {
      ok: false,
      issue: {
        code: 'schedule_refresh_stale',
        message: 'ScheduleWindow refresh 已被更新的 refresh supersede。',
      },
    };
  }
}

export function createScheduleWindowStore(
  options: ScheduleWindowStoreOptions,
): ScheduleWindowLkgStore {
  return new ScheduleWindowLkgStore(options);
}
