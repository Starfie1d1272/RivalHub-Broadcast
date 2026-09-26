import { randomUUID } from 'node:crypto';

import {
  BroadcastManifestConversionError,
  toMatchContext,
  validateBroadcastManifest,
  type BroadcastManifestV1,
  type ContractDiagnostic,
} from '@rivalhub-broadcast/rivalhub';

import { SerialCommitQueue } from './serial-commit.js';
import { SourceLoadError } from './source-error.js';
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
  /** Expected network/source failures must reject with SourceLoadError. */
  readonly load: () => Promise<unknown>;
}

export type MatchContextControllerIssueCode =
  | 'source_load_failed'
  | 'source_invalid'
  | 'source_match_mismatch'
  | 'source_conversion_failed'
  | 'lkg_fallback'
  | 'memory_fallback'
  | 'lkg_unavailable'
  | 'lkg_persistence_failed'
  | 'rivalhub_candidate_pending'
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
  readonly initialBinding?: MatchContextBinding;
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
  private pendingOnlineBinding: MatchContextBinding | undefined;
  private bindingRevision = 0;
  private readonly revisionEpoch = randomUUID();
  private selectionGeneration = 0;

  constructor(options: MatchContextControllerOptions) {
    this.lkgStore = options.lkgStore;
    this.onBindingChanged = options.onBindingChanged;
    this.activeBinding = options.initialBinding;
    this.bindingRevision = options.initialBinding === undefined ? 0 : 1;
  }

  getActiveBinding(): MatchContextBinding | undefined {
    return this.activeBinding;
  }

  getActiveRevision(): string {
    return `${this.revisionEpoch}:${this.bindingRevision}`;
  }

  getPendingOnlineBinding(): MatchContextBinding | undefined {
    return this.pendingOnlineBinding;
  }

  clearActive(): void {
    this.selectionGeneration += 1;
    this.pendingOnlineBinding = undefined;
    this.clearActiveBinding();
  }

  private clearActiveBinding(): void {
    if (this.activeBinding === undefined) return;
    this.activeBinding = undefined;
    this.bindingRevision += 1;
    this.onBindingChanged?.(undefined);
  }

  private setActive(binding: MatchContextBinding): void {
    this.activeBinding = binding;
    this.bindingRevision += 1;
    this.onBindingChanged?.(binding);
  }

  async selectMatch(
    requestedMatchId: string,
    source: MatchContextSource,
  ): Promise<MatchContextSelectionResult> {
    if (source.kind === 'online' && this.hasLocalOverride()) {
      return this.stageOnlineCandidate(requestedMatchId, source);
    }
    const generation = ++this.selectionGeneration;
    const isCurrent = () => generation === this.selectionGeneration;
    if (this.activeBinding?.context.matchId !== requestedMatchId) this.clearActiveBinding();

    let candidate: unknown;
    try {
      candidate = await source.load();
    } catch (error: unknown) {
      if (!(error instanceof SourceLoadError)) throw error;
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
    } catch (error: unknown) {
      if (!(error instanceof BroadcastManifestConversionError)) throw error;
      return {
        ok: false,
        requestedMatchId,
        diagnostics: [
          controllerIssue(
            'source_conversion_failed',
            'Manifest candidate 无法转换为 MatchContext。',
            { diagnostics: error.diagnostics },
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
        diagnostics: validated.diagnostics,
      };
      this.setActive(binding);
      return { ok: true, binding, diagnostics };
    });
  }

  async selectLocalMatch(
    candidate: unknown,
    expectedBindingRevision: string,
  ): Promise<MatchContextSelectionResult> {
    const validated = validateBroadcastManifest(candidate);
    if (!validated.ok) {
      return {
        ok: false,
        requestedMatchId: '',
        diagnostics: [
          controllerIssue('source_invalid', '本地 BP 未通过 Manifest validation。', {
            diagnostics: validated.diagnostics,
          }),
        ],
      };
    }
    let context;
    try {
      context = toMatchContext(validated.value);
    } catch (error: unknown) {
      if (!(error instanceof BroadcastManifestConversionError)) throw error;
      return {
        ok: false,
        requestedMatchId: validated.value.match.matchId,
        diagnostics: [
          controllerIssue('source_conversion_failed', '本地 BP 无法转换为比赛上下文。', {
            diagnostics: error.diagnostics,
          }),
        ],
      };
    }

    return this.commitQueue.run(async () => {
      if (expectedBindingRevision !== this.getActiveRevision())
        return this.staleSelectionResult(validated.value.match.matchId);
      const generation = ++this.selectionGeneration;
      const isCurrent = () =>
        generation === this.selectionGeneration &&
        expectedBindingRevision === this.getActiveRevision();
      const saved = await this.lkgStore.save(validated.value, 'local', { canCommit: isCurrent });
      if (!isCurrent() || (!saved.ok && saved.issue.code === 'lkg_commit_stale'))
        return this.staleSelectionResult(validated.value.match.matchId);
      if (!saved.ok) {
        return {
          ok: false,
          requestedMatchId: validated.value.match.matchId,
          diagnostics: [
            controllerIssue('lkg_persistence_failed', '本地 BP 未能安全保存，当前比赛保持不变。', {
              storeIssue: saved.issue,
            }),
          ],
        };
      }
      const binding: MatchContextBinding = {
        manifest: validated.value,
        context,
        origin: 'local',
        freshness: 'fresh',
        diagnostics: validated.diagnostics,
      };
      this.pendingOnlineBinding = undefined;
      this.setActive(binding);
      return { ok: true, binding, diagnostics: [] };
    });
  }

  async restoreLatest(): Promise<MatchContextBinding | undefined> {
    const generation = ++this.selectionGeneration;
    return this.commitQueue.run(async () => {
      if (this.activeBinding !== undefined) return this.activeBinding;
      const cached = await this.lkgStore.readLatest();
      if (generation !== this.selectionGeneration || !cached.ok) return undefined;
      this.setActive(cached.value);
      return cached.value;
    });
  }

  async activatePendingOnlineMatch(
    expectedBindingRevision: string,
  ): Promise<MatchContextSelectionResult> {
    return this.commitQueue.run(async () => {
      const pending = this.pendingOnlineBinding;
      if (
        pending === undefined ||
        expectedBindingRevision !== this.getActiveRevision() ||
        !this.hasLocalOverride()
      )
        return this.staleSelectionResult(pending?.context.matchId ?? '');
      const generation = ++this.selectionGeneration;
      const isCurrent = () =>
        generation === this.selectionGeneration &&
        expectedBindingRevision === this.getActiveRevision();
      const saved = await this.lkgStore.save(pending.manifest, 'online', { canCommit: isCurrent });
      if (!isCurrent() || (!saved.ok && saved.issue.code === 'lkg_commit_stale'))
        return this.staleSelectionResult(pending.context.matchId);
      if (!saved.ok) {
        return {
          ok: false,
          requestedMatchId: pending.context.matchId,
          diagnostics: [
            controllerIssue(
              'lkg_persistence_failed',
              '无法安全切回 RivalHub BP，本地比赛保持不变。',
              {
                storeIssue: saved.issue,
              },
            ),
          ],
        };
      }
      this.pendingOnlineBinding = undefined;
      this.setActive(pending);
      return { ok: true, binding: pending, diagnostics: [] };
    });
  }

  private hasLocalOverride(): boolean {
    return (
      this.activeBinding?.origin === 'local' ||
      (this.activeBinding?.origin === 'cache' && this.activeBinding.cachedFrom === 'local')
    );
  }

  private async stageOnlineCandidate(
    requestedMatchId: string,
    source: MatchContextSource,
  ): Promise<MatchContextSelectionResult> {
    let candidate: unknown;
    try {
      candidate = await source.load();
    } catch (error: unknown) {
      if (!(error instanceof SourceLoadError)) throw error;
      return {
        ok: false,
        requestedMatchId,
        diagnostics: [
          controllerIssue('source_load_failed', 'RivalHub BP 当前不可用，本地比赛仍保持。'),
        ],
      };
    }
    const validated = validateBroadcastManifest(candidate);
    if (!validated.ok || validated.value.match.matchId !== requestedMatchId) {
      return {
        ok: false,
        requestedMatchId,
        diagnostics: [
          controllerIssue(
            validated.ok ? 'source_match_mismatch' : 'source_invalid',
            'RivalHub BP 暂不可用，本地比赛仍保持。',
            validated.ok ? {} : { diagnostics: validated.diagnostics },
          ),
        ],
      };
    }
    let context;
    try {
      context = toMatchContext(validated.value);
    } catch (error: unknown) {
      if (!(error instanceof BroadcastManifestConversionError)) throw error;
      return {
        ok: false,
        requestedMatchId,
        diagnostics: [
          controllerIssue('source_conversion_failed', 'RivalHub BP 无法转换，本地比赛仍保持。', {
            diagnostics: error.diagnostics,
          }),
        ],
      };
    }
    return this.commitQueue.run(() => {
      if (!this.hasLocalOverride() || this.activeBinding === undefined)
        return this.staleSelectionResult(requestedMatchId);
      const binding: MatchContextBinding = {
        manifest: validated.value,
        context,
        origin: 'online',
        freshness: 'fresh',
        diagnostics: validated.diagnostics,
      };
      this.pendingOnlineBinding = binding;
      return {
        ok: true,
        binding: this.activeBinding,
        diagnostics: [
          controllerIssue(
            'rivalhub_candidate_pending',
            'RivalHub BP 已恢复，等待制作人员确认切回。',
          ),
        ],
      };
    });
  }

  private async useFallback(
    generation: number,
    requestedMatchId: string,
    diagnostics: MatchContextControllerIssue[],
  ): Promise<MatchContextSelectionResult> {
    return this.commitQueue.run(async () => {
      if (generation !== this.selectionGeneration)
        return this.staleSelectionResult(requestedMatchId);

      const current = this.activeBinding;
      if (current?.context.matchId === requestedMatchId) {
        const staleBinding: MatchContextBinding = { ...current, freshness: 'stale' };
        diagnostics.push(
          controllerIssue(
            'memory_fallback',
            'Manifest source 失败，继续使用当前同 matchId 的内存 binding，并标记为 stale。',
          ),
        );
        this.setActive(staleBinding);
        return { ok: true, binding: staleBinding, diagnostics };
      }

      const fallback = await this.lkgStore.read(requestedMatchId);
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
