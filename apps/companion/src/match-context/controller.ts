import {
  toMatchContext,
  validateBroadcastManifest,
  type BroadcastManifestV1,
  type ContractDiagnostic,
} from '@rivalhub-broadcast/rivalhub';

import {
  type ContextFreshness,
  type ContextOrigin,
  type MatchContextBinding,
  type MatchContextStoreIssue,
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
  | 'lkg_fallback'
  | 'lkg_unavailable'
  | 'active_binding_cleared';

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
  private activeBinding: MatchContextBinding | undefined;

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
    this.clearActive();
    const diagnostics: MatchContextControllerIssue[] = [];
    let sourceFailure: MatchContextControllerIssue | undefined;

    try {
      const candidate = await source.load();
      const validated = validateBroadcastManifest(candidate);
      if (!validated.ok) {
        sourceFailure = controllerIssue('source_invalid', 'Manifest source 未通过 validation。', {
          diagnostics: validated.diagnostics,
        });
      } else if (validated.value.match.matchId !== requestedMatchId) {
        sourceFailure = controllerIssue(
          'source_match_mismatch',
          'Manifest source matchId 与请求不一致。',
        );
      } else {
        const context = toMatchContext(validated.value);
        const saved = await this.lkgStore.save(validated.value, source.kind);
        if (!saved.ok) {
          diagnostics.push(
            controllerIssue('lkg_unavailable', '当前 candidate 有效，但未能更新 Manifest LKG。', {
              storeIssue: saved.issue,
            }),
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
      }
    } catch {
      sourceFailure = controllerIssue('source_load_failed', 'Manifest source 加载失败。');
    }

    if (sourceFailure !== undefined) diagnostics.push(sourceFailure);
    const fallback = await this.lkgStore.read(requestedMatchId);
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
  }

  async select(
    requestedMatchId: string,
    source: MatchContextSource,
  ): Promise<MatchContextSelectionResult> {
    return this.selectMatch(requestedMatchId, source);
  }

  async load(
    requestedMatchId: string,
    source: MatchContextSource,
  ): Promise<MatchContextSelectionResult> {
    return this.selectMatch(requestedMatchId, source);
  }
}

export function createMatchContextController(
  options: MatchContextControllerOptions,
): MatchContextController {
  return new MatchContextController(options);
}

export type { ContextFreshness, ContextOrigin };
export type { BroadcastManifestV1 };
