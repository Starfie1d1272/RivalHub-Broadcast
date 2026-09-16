import { randomUUID } from 'node:crypto';
import { access, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

import {
  toScheduleWindow,
  validateBroadcastScheduleWindow,
  type BroadcastScheduleWindowV1,
  type ContractDiagnostic,
} from '@rivalhub-broadcast/rivalhub';
import type { ScheduleWindow } from '@rivalhub-broadcast/core/match-context';

import type { ContextFreshness, ContextOrigin } from './lkg-store.js';

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
  | 'schedule_lkg_invalid_candidate'
  | 'schedule_lkg_write_failed'
  | 'schedule_lkg_metadata_invalid'
  | 'schedule_source_failed'
  | 'schedule_source_invalid';

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
  readonly metadataPath?: string;
  readonly clock?: () => string;
}

interface ScheduleWindowLkgMetadata {
  readonly origin: Exclude<ContextOrigin, 'cache'>;
  readonly storedAt: string;
}

function defaultMetadataPath(filePath: string): string {
  return `${filePath}.meta.json`;
}

function isSourceOrigin(value: unknown): value is Exclude<ContextOrigin, 'cache'> {
  return value === 'online' || value === 'fixture';
}

function isMetadata(value: unknown): value is ScheduleWindowLkgMetadata {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.storedAt === 'string' && isSourceOrigin(record.origin);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function writeAtomically(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = join(
    dirname(path),
    `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`,
  );
  try {
    await writeFile(temporaryPath, contents, { encoding: 'utf8', mode: 0o600 });
    await rename(temporaryPath, path);
  } catch (error: unknown) {
    try {
      await unlink(temporaryPath);
    } catch {
      // Keep the original write/rename error as the only failure signal.
    }
    throw error;
  }
}

export class ScheduleWindowLkgStore {
  private readonly filePath: string;
  private readonly metadataPath: string;
  private readonly clock: () => string;
  private currentBinding: ScheduleWindowBinding | undefined;

  constructor(options: ScheduleWindowStoreOptions) {
    this.filePath = options.filePath;
    this.metadataPath = options.metadataPath ?? defaultMetadataPath(options.filePath);
    this.clock = options.clock ?? (() => new Date().toISOString());
  }

  getCurrent(): ScheduleWindowBinding | undefined {
    return this.currentBinding;
  }

  async save(
    candidate: unknown,
    origin: Exclude<ContextOrigin, 'cache'>,
  ): Promise<ScheduleWindowStoreResult<BroadcastScheduleWindowV1>> {
    const validated = validateBroadcastScheduleWindow(candidate);
    if (!validated.ok) {
      return {
        ok: false,
        issue: {
          code: 'schedule_lkg_invalid_candidate',
          message: 'ScheduleWindow candidate 未通过 structural/semantic validation。',
          diagnostics: validated.diagnostics,
        },
      };
    }
    const metadata: ScheduleWindowLkgMetadata = { origin, storedAt: this.clock() };
    try {
      await writeAtomically(this.filePath, `${JSON.stringify(validated.value, null, 2)}\n`);
      await writeAtomically(this.metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
    } catch {
      return {
        ok: false,
        issue: {
          code: 'schedule_lkg_write_failed',
          message: 'ScheduleWindow LKG 写入失败，candidate 未被视为可恢复缓存。',
        },
      };
    }
    return { ok: true, value: validated.value, diagnostics: [] };
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
          issue: {
            code: 'schedule_lkg_not_found',
            message: '没有可用的 ScheduleWindow LKG。',
          },
        };
      }
      return {
        ok: false,
        issue: { code: 'schedule_lkg_read_failed', message: 'ScheduleWindow LKG 读取失败。' },
      };
    }
    let candidate: unknown;
    try {
      candidate = JSON.parse(contents) as unknown;
    } catch {
      return {
        ok: false,
        issue: { code: 'schedule_lkg_invalid_json', message: 'ScheduleWindow LKG 不是有效 JSON。' },
      };
    }
    const validated = validateBroadcastScheduleWindow(candidate);
    if (!validated.ok) {
      return {
        ok: false,
        issue: {
          code: 'schedule_lkg_invalid_candidate',
          message: 'ScheduleWindow LKG 未通过 validation。',
          diagnostics: validated.diagnostics,
        },
      };
    }

    const diagnostics: ScheduleWindowStoreIssue[] = [];
    let metadata: ScheduleWindowLkgMetadata | undefined;
    if (await fileExists(this.metadataPath)) {
      try {
        const parsedMetadata = JSON.parse(await readFile(this.metadataPath, 'utf8')) as unknown;
        if (isMetadata(parsedMetadata)) metadata = parsedMetadata;
        else
          diagnostics.push({
            code: 'schedule_lkg_metadata_invalid',
            message: 'ScheduleWindow LKG provenance metadata 无效。',
          });
      } catch {
        diagnostics.push({
          code: 'schedule_lkg_metadata_invalid',
          message: 'ScheduleWindow LKG provenance metadata 不是有效 JSON。',
        });
      }
    }

    try {
      const binding: ScheduleWindowBinding = {
        schedule: validated.value,
        window: toScheduleWindow(validated.value),
        origin: 'cache',
        freshness: 'stale',
        ...(metadata === undefined
          ? {}
          : { storedAt: metadata.storedAt, cachedFrom: metadata.origin }),
      };
      this.currentBinding = binding;
      return { ok: true, value: binding, diagnostics };
    } catch {
      return {
        ok: false,
        issue: {
          code: 'schedule_lkg_invalid_candidate',
          message: 'ScheduleWindow LKG 无法转换为领域模型。',
        },
      };
    }
  }

  async load(): Promise<ScheduleWindowStoreResult<ScheduleWindowBinding>> {
    return this.read();
  }

  async refresh(
    source: ScheduleWindowSource,
  ): Promise<ScheduleWindowStoreResult<ScheduleWindowBinding>> {
    try {
      const candidate = await source.load();
      const validated = validateBroadcastScheduleWindow(candidate);
      if (!validated.ok) {
        const fallback = await this.read();
        if (fallback.ok) {
          return {
            ok: true,
            value: fallback.value,
            diagnostics: [
              {
                code: 'schedule_source_invalid',
                message: 'ScheduleWindow source 未通过 validation，继续使用 stale LKG。',
                diagnostics: validated.diagnostics,
              },
            ],
          };
        }
        return {
          ok: false,
          issue: {
            code: 'schedule_source_invalid',
            message: 'ScheduleWindow source 未通过 validation，且没有可用 LKG。',
            diagnostics: validated.diagnostics,
          },
        };
      }
      const saved = await this.save(validated.value, source.kind);
      if (!saved.ok) {
        const fallback = await this.read();
        if (fallback.ok) return fallback;
        return { ok: false, issue: saved.issue };
      }
      const binding: ScheduleWindowBinding = {
        schedule: saved.value,
        window: toScheduleWindow(saved.value),
        origin: source.kind,
        freshness: 'fresh',
      };
      this.currentBinding = binding;
      return { ok: true, value: binding, diagnostics: [] };
    } catch {
      const fallback = await this.read();
      if (fallback.ok) {
        return {
          ok: true,
          value: fallback.value,
          diagnostics: [
            {
              code: 'schedule_source_failed',
              message: 'ScheduleWindow source 加载失败，继续使用 stale LKG。',
            },
          ],
        };
      }
      return {
        ok: false,
        issue: {
          code: 'schedule_source_failed',
          message: 'ScheduleWindow source 加载失败，且没有可用 LKG。',
        },
      };
    }
  }

  async saveLastKnownGood(
    candidate: unknown,
    origin: Exclude<ContextOrigin, 'cache'>,
  ): Promise<ScheduleWindowStoreResult<BroadcastScheduleWindowV1>> {
    return this.save(candidate, origin);
  }
}

export const ScheduleWindowStore = ScheduleWindowLkgStore;

export function createScheduleWindowStore(
  options: ScheduleWindowStoreOptions,
): ScheduleWindowLkgStore {
  return new ScheduleWindowLkgStore(options);
}
