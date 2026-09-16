import { randomUUID } from 'node:crypto';
import { access, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, basename } from 'node:path';

import {
  toMatchContext,
  validateBroadcastManifest,
  type BroadcastManifestV1,
  type ContractDiagnostic,
} from '@rivalhub-broadcast/rivalhub';
import type { MatchContext } from '@rivalhub-broadcast/core/match-context';

export type ContextOrigin = 'online' | 'fixture' | 'cache';
export type ContextFreshness = 'fresh' | 'stale';

export interface MatchContextBinding {
  readonly manifest: BroadcastManifestV1;
  readonly context: MatchContext;
  readonly origin: ContextOrigin;
  readonly freshness: ContextFreshness;
  readonly storedAt?: string;
  readonly cachedFrom?: Exclude<ContextOrigin, 'cache'>;
}

export type MatchContextStoreIssueCode =
  | 'lkg_not_found'
  | 'lkg_read_failed'
  | 'lkg_invalid_json'
  | 'lkg_invalid_candidate'
  | 'lkg_match_mismatch'
  | 'lkg_metadata_invalid'
  | 'lkg_write_failed';

export interface MatchContextStoreIssue {
  readonly code: MatchContextStoreIssueCode;
  readonly message: string;
  readonly diagnostics?: readonly ContractDiagnostic[];
}

export interface MatchContextStoreFailure {
  readonly ok: false;
  readonly issue: MatchContextStoreIssue;
}

export interface MatchContextStoreSuccess<T> {
  readonly ok: true;
  readonly value: T;
  readonly diagnostics: readonly MatchContextStoreIssue[];
}

export type MatchContextStoreResult<T> = MatchContextStoreSuccess<T> | MatchContextStoreFailure;

export interface MatchManifestLkgStoreOptions {
  readonly filePath: string;
  readonly metadataPath?: string;
  readonly clock?: () => string;
}

interface MatchManifestLkgMetadata {
  readonly matchId: string;
  readonly origin: Exclude<ContextOrigin, 'cache'>;
  readonly storedAt: string;
}

function defaultMetadataPath(filePath: string): string {
  return `${filePath}.meta.json`;
}

function isSourceOrigin(value: unknown): value is Exclude<ContextOrigin, 'cache'> {
  return value === 'online' || value === 'fixture';
}

function isMetadata(value: unknown): value is MatchManifestLkgMetadata {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.matchId === 'string' &&
    isSourceOrigin(record.origin) &&
    typeof record.storedAt === 'string'
  );
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
      // The original write/rename error is the useful diagnostic.
    }
    throw error;
  }
}

function invalidCandidate(diagnostics: readonly ContractDiagnostic[]): MatchContextStoreFailure {
  return {
    ok: false,
    issue: {
      code: 'lkg_invalid_candidate',
      message: 'Manifest candidate 未通过 structural/semantic validation。',
      diagnostics,
    },
  };
}

export class MatchManifestLkgStore {
  private readonly filePath: string;
  private readonly metadataPath: string;
  private readonly clock: () => string;

  constructor(options: MatchManifestLkgStoreOptions) {
    this.filePath = options.filePath;
    this.metadataPath = options.metadataPath ?? defaultMetadataPath(options.filePath);
    this.clock = options.clock ?? (() => new Date().toISOString());
  }

  async save(
    candidate: unknown,
    origin: Exclude<ContextOrigin, 'cache'>,
  ): Promise<MatchContextStoreResult<BroadcastManifestV1>> {
    const validated = validateBroadcastManifest(candidate);
    if (!validated.ok) return invalidCandidate(validated.diagnostics);

    const storedAt = this.clock();
    const metadata: MatchManifestLkgMetadata = {
      matchId: validated.value.match.matchId,
      origin,
      storedAt,
    };
    try {
      await writeAtomically(this.filePath, `${JSON.stringify(validated.value, null, 2)}\n`);
      await writeAtomically(this.metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
    } catch {
      return {
        ok: false,
        issue: {
          code: 'lkg_write_failed',
          message: 'Manifest LKG 写入失败，candidate 未被视为可恢复缓存。',
        },
      };
    }
    return { ok: true, value: validated.value, diagnostics: [] };
  }

  async read(requestedMatchId: string): Promise<MatchContextStoreResult<MatchContextBinding>> {
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
          issue: { code: 'lkg_not_found', message: '没有可用的 Manifest LKG。' },
        };
      }
      return {
        ok: false,
        issue: { code: 'lkg_read_failed', message: 'Manifest LKG 读取失败。' },
      };
    }
    let candidate: unknown;
    try {
      candidate = JSON.parse(contents) as unknown;
    } catch {
      return {
        ok: false,
        issue: { code: 'lkg_invalid_json', message: 'Manifest LKG 不是有效 JSON。' },
      };
    }

    const validated = validateBroadcastManifest(candidate);
    if (!validated.ok) return invalidCandidate(validated.diagnostics);
    if (validated.value.match.matchId !== requestedMatchId) {
      return {
        ok: false,
        issue: { code: 'lkg_match_mismatch', message: 'Manifest LKG matchId 与请求不一致。' },
      };
    }

    const diagnostics: MatchContextStoreIssue[] = [];
    let metadata: MatchManifestLkgMetadata | undefined;
    if (await fileExists(this.metadataPath)) {
      try {
        const parsedMetadata = JSON.parse(await readFile(this.metadataPath, 'utf8')) as unknown;
        if (
          isMetadata(parsedMetadata) &&
          parsedMetadata.matchId === validated.value.match.matchId
        ) {
          metadata = parsedMetadata;
        } else
          diagnostics.push({
            code: 'lkg_metadata_invalid',
            message: 'Manifest LKG provenance metadata 无效。',
          });
      } catch {
        diagnostics.push({
          code: 'lkg_metadata_invalid',
          message: 'Manifest LKG provenance metadata 不是有效 JSON。',
        });
      }
    }

    try {
      const context = toMatchContext(validated.value);
      return {
        ok: true,
        value: {
          manifest: validated.value,
          context,
          origin: 'cache',
          freshness: 'stale',
          ...(metadata === undefined
            ? {}
            : { storedAt: metadata.storedAt, cachedFrom: metadata.origin }),
        },
        diagnostics,
      };
    } catch {
      return {
        ok: false,
        issue: {
          code: 'lkg_invalid_candidate',
          message: 'Manifest LKG 无法重新转换为 MatchContext。',
        },
      };
    }
  }

  async load(requestedMatchId: string): Promise<MatchContextStoreResult<MatchContextBinding>> {
    return this.read(requestedMatchId);
  }

  async readForMatch(
    requestedMatchId: string,
  ): Promise<MatchContextStoreResult<MatchContextBinding>> {
    return this.read(requestedMatchId);
  }

  async saveLastKnownGood(
    candidate: unknown,
    origin: Exclude<ContextOrigin, 'cache'>,
  ): Promise<MatchContextStoreResult<BroadcastManifestV1>> {
    return this.save(candidate, origin);
  }
}

export const LastKnownGoodManifestStore = MatchManifestLkgStore;
