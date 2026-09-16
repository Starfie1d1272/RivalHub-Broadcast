import {
  toMatchContext,
  validateBroadcastManifest,
  type BroadcastManifestV1,
  type ContractDiagnostic,
} from '@rivalhub-broadcast/rivalhub';

import { SerialCommitQueue } from './serial-commit.js';
import {
  type ContextFreshness,
  type ContextOrigin,
  type MatchContextBinding,
  type MatchContextStoreIssue,
  type MatchManifestLkgSaveOptions,
  type MatchManifestLkgStore,
} from './lkg-store.js';

export interface MatchContextSource {
  readonly kind: Exclude<ContextOrigin, 'cache'>;
  readonly load: () => Promise<unknown>;
}

export type MatchContextControllerIssueCode =
  | 'source_load_failed'
  | 'source_invalid'
  | 'source_match_mismatch'
  | 'source_conversion_failed'
  | 'lkg_fallback'
  | 'lkg_unavailable'
  | 'lkg_persistence_failed'
  | 'selection_stale';

export interface MatchContextControllerIssue {
  readonly code: MatchContextControllerIssueCode;
  readonly message: string;
  readonly diagnostics?: readonly ContractDiagnostic[];
  readonly storeIssue?: MatchContextStoreIssue;
}

export interface MatchContextSelectionSuccess {
  readonly ok: true;
  readonly binding: MatchContextBinding;
  readonly diagnostics: readonly MatchContextControllerIssue[];
}

export interface MatchContextSelectionFailure {
  readonly ok: false;
  readonly requestedMatchId: string;
  readonly diagnostics: readonly MatchContextControllerIssue[];
}

export type MatchContextSelectionResult =
  MatchContextSelectionSuccess | MatchContextSelectionFailure;

export interface MatchContextControllerOptions {
  readonly lkgStore: MatchManifestLkgStore;
  readonly onBindingChanged?: (binding: MatchContextBinding | undefined) => void;
}

function controllerIssue(
  code: MatchContextControllerIssueCode,
  message: string,
  details: Omit<MatchContextControllerIssue, 'code' | 'message'> = {},
): MatchContextControllerIssue {
  return { code, message, ...details };
}

export class MatchContextController {
  private readonly lkgStore: MatchManifestLkgStore;
  private readonly onBindingChanged:
    ((binding: MatchContextBinding | undefined) => void) | undefined;
  private readonly commitQueue = new SerialCommitQueue();
  private activeBinding: MatchContextBinding | undefined;
  private selectionGeneration = 0;

  constructor(options: MatchContextControllerOptions) {
    this.lkgStore = options.lkgStore;
    this.onBindingChanged = options.onBindingChanged;
  }

  getActiveBinding(): MatchContextBinding | undefined {
    return this.activeBinding;
  }

  clearActive(): void {
    this.activeBinding = undefined;
    this.onBindingChanged?.(undefined);
  }

  private setActive(binding: MatchContextBinding): void {
    this.activeBinding = binding;
    this.onBindingChanged?.(binding);
  }

  async selectMatch(
    requestedMatchId: string,
    source: MatchContextSource,
  ): Promise<MatchContextSelectionResult> {
    const generation = ++this.selectionGeneration;
    const isCurrent = () => generation === this.selectionGeneration;
    this.clearActive();

    let candidate: unknown;
    try {
      candidate = await source.load();
    } catch {
      return this.useFallback(generation, requestedMatchId, [
        controllerIssue('source_load_failed', 'Manifest source 加载失败。'),
      ]);
    }

    const validated = validateBroadcastManifest(candidate);
    if (!validated.ok) {
      return this.useFallback(generation, requestedMatchId, [
        controllerIssue('source_invalid', 'Manifest source 未通过 validation。', {
          diagnostics: validated.diagnostics,
        }),
      ]);
    }
    if (validated.value.match.matchId !== requestedMatchId) {
      return this.useFallback(generation, requestedMatchId, [
        controllerIssue('source_match_mismatch', 'Manifest source matchId 与请求不一致。'),
      ]);
    }

    let context;
    try {
      context = toMatchContext(validated.value);
    } catch {
      return {
        ok: false,
        requestedMatchId,
        diagnostics: [
          controllerIssue(
            'source_conversion_failed',
            'Manifest candidate 无法转换为 MatchContext。',
          ),
        ],
      };
    }

    return this.commitQueue.run(async () => {
      if (!isCurrent()) return this.staleSelectionResult(requestedMatchId);

      const saveOptions: MatchManifestLkgSaveOptions = { canCommit: isCurrent };
      const saved = await this.lkgStore.save(validated.value, source.kind, saveOptions);
      if (!isCurrent() || (!saved.ok && saved.issue.code === 'lkg_commit_stale')) {
        return this.staleSelectionResult(requestedMatchId);
      }

      const diagnostics: MatchContextControllerIssue[] = [];
      if (!saved.ok) {
        diagnostics.push(
          controllerIssue(
            'lkg_persistence_failed',
            '当前 candidate 有效，但未能更新 Manifest LKG。',
            {
              storeIssue: saved.issue,
            },
          ),
        );
      }
      const binding: MatchContextBinding = {
        manifest: validated.value,
        context,
        origin: source.kind,
        freshness: 'fresh',
      };
      this.setActive(binding);
      return { ok: true, binding, diagnostics };
    });
  }

  private async useFallback(
    generation: number,
    requestedMatchId: string,
    diagnostics: MatchContextControllerIssue[],
  ): Promise<MatchContextSelectionResult> {
    const fallback = await this.lkgStore.read(requestedMatchId);
    return this.commitQueue.run(() => {
      if (generation !== this.selectionGeneration)
        return this.staleSelectionResult(requestedMatchId);
      if (fallback.ok) {
        diagnostics.push(
          controllerIssue('lkg_fallback', '已使用同一 matchId 的 stale Manifest LKG。'),
        );
        this.setActive(fallback.value);
        return { ok: true, binding: fallback.value, diagnostics };
      }
      diagnostics.push(
        controllerIssue('lkg_unavailable', '没有可用于该 matchId 的 Manifest LKG。', {
          storeIssue: fallback.issue,
        }),
      );
      return { ok: false, requestedMatchId, diagnostics };
    });
  }

  private staleSelectionResult(requestedMatchId: string): MatchContextSelectionFailure {
    return {
      ok: false,
      requestedMatchId,
      diagnostics: [
        controllerIssue(
          'selection_stale',
          'MatchContext selection 已被更新的 selection supersede。',
        ),
      ],
    };
  }
}

export function createMatchContextController(
  options: MatchContextControllerOptions,
): MatchContextController {
  return new MatchContextController(options);
}

export type { ContextFreshness, ContextOrigin };
export type { BroadcastManifestV1 };
