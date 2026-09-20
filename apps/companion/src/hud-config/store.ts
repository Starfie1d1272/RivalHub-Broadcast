import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import {
  BUILTIN_LAYOUT_ID,
  BUILTIN_PRESET_ID,
  BUILTIN_THEME_ID,
  canonicalJson,
  createDefaultHudConfigDocument,
  getBuiltinLayout,
  getBuiltinResolvedPreset,
  getBuiltinTheme,
  hudThemeSchema,
  parseHudConfigDocument,
  parseHudLayout,
  parseHudPreset,
  resolveActiveHudPreset,
  resolveHudPreset,
  type HudConfigDocument,
  type HudLayout,
  type HudPreset,
  type HudResolvedPreset,
  type HudTheme,
} from '@rivalhub-broadcast/hud-config';
import { replaceDurableJson } from '../match-context/durable-json.js';
import { SerialCommitQueue } from '../match-context/serial-commit.js';

export type HudResourceKind = 'preset' | 'layout' | 'theme';
export type HudResource = HudPreset | HudLayout | HudTheme;

export interface HudConfigStoreOptions {
  readonly filePath?: string;
  readonly onDiagnostic?: (code: string) => void;
}

export interface HudConfigState {
  readonly document: HudConfigDocument;
  readonly resolved: HudResolvedPreset;
  readonly etag: string;
  readonly activationStale: boolean;
  readonly persistenceError: string | null;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function hashResolvedPreset(value: HudResolvedPreset): string {
  return `"${createHash('sha256').update(canonicalJson(value)).digest('hex')}"`;
}

function resourceList(document: HudConfigDocument, kind: HudResourceKind): HudResource[] {
  if (kind === 'preset') return document.customPresets;
  if (kind === 'layout') return document.customLayouts;
  return document.customThemes;
}

function withResourceList(
  document: HudConfigDocument,
  kind: HudResourceKind,
  resources: HudResource[],
): HudConfigDocument {
  if (kind === 'preset') return { ...document, customPresets: resources as HudPreset[] };
  if (kind === 'layout') return { ...document, customLayouts: resources as HudLayout[] };
  return { ...document, customThemes: resources as HudTheme[] };
}

function parseResource(kind: HudResourceKind, value: unknown): HudResource {
  const parsed =
    kind === 'preset'
      ? parseHudPreset(value)
      : kind === 'layout'
        ? parseHudLayout(value)
        : hudThemeSchema.parse(value);
  return { ...parsed, name: parsed.name.trim() };
}

function savedResolvedPreset(document: HudConfigDocument): HudResolvedPreset {
  if (document.activePreset.kind === 'builtin') return getBuiltinResolvedPreset();
  const preset = document.customPresets.find((item) => item.id === document.activePreset.sourceId);
  if (preset === undefined) throw new Error('activePreset 引用的自定义预设不存在');
  const layout =
    preset.layoutId === BUILTIN_LAYOUT_ID
      ? getBuiltinLayout()
      : document.customLayouts.find((item) => item.id === preset.layoutId);
  const theme =
    preset.themeId === BUILTIN_THEME_ID
      ? getBuiltinTheme()
      : document.customThemes.find((item) => item.id === preset.themeId);
  if (layout === undefined || theme === undefined) throw new Error('预设引用的资源不存在');
  return resolveHudPreset(preset, layout, theme);
}

function createState(document: HudConfigDocument, persistenceError: string | null): HudConfigState {
  const resolved = resolveActiveHudPreset(document);
  const saved = savedResolvedPreset(document);
  return {
    document: clone(document),
    resolved: clone(resolved),
    etag: hashResolvedPreset(resolved),
    activationStale: canonicalJson(saved) !== canonicalJson(resolved),
    persistenceError,
  };
}

export class HudConfigStore {
  private readonly filePath: string | undefined;
  private readonly onDiagnostic: (code: string) => void;
  private readonly commits = new SerialCommitQueue();
  private document = createDefaultHudConfigDocument();
  private loaded = false;
  private persistenceError: string | null = null;

  constructor(options: HudConfigStoreOptions = {}) {
    this.filePath = options.filePath;
    this.onDiagnostic = options.onDiagnostic ?? (() => undefined);
  }

  async load(): Promise<void> {
    if (this.filePath === undefined) {
      this.loaded = true;
      return;
    }
    try {
      const raw = await readFile(this.filePath, 'utf8');
      this.document = parseHudConfigDocument(JSON.parse(raw) as unknown);
      this.persistenceError = null;
      this.loaded = true;
    } catch (error: unknown) {
      this.onDiagnostic(isMissingFile(error) ? 'hud_config_missing' : 'hud_config_invalid');
      this.loaded = true;
      // A running Companion keeps its last-known-valid document. On first boot
      // that document is the current built-in default; the malformed file is
      // deliberately left untouched for operator recovery.
    }
  }

  getState(): HudConfigState {
    return createState(this.document, this.persistenceError);
  }

  async saveResource(kind: HudResourceKind, value: unknown): Promise<HudConfigState> {
    const parsed = parseResource(kind, value);
    if (parsed.id.startsWith('builtin:')) throw new Error('内置 HUD 资源只读，请使用另存为');
    const resources = resourceList(this.document, kind);
    if (!resources.some((item) => item.id === parsed.id)) {
      throw new Error('只能保存已经存在的自定义 HUD 资源');
    }
    const next = withResourceList(
      this.document,
      kind,
      resources.map((item) => (item.id === parsed.id ? parsed : item)),
    );
    return this.commit(next);
  }

  async saveAs(kind: HudResourceKind, value: unknown): Promise<HudConfigState> {
    const parsed = parseResource(kind, value);
    const resource = { ...parsed, id: randomUUID(), name: parsed.name.trim() } as HudResource;
    const next = withResourceList(this.document, kind, [
      ...resourceList(this.document, kind),
      resource,
    ]);
    return this.commit(next);
  }

  async activatePreset(sourceId: string): Promise<HudConfigState> {
    if (sourceId === BUILTIN_PRESET_ID) {
      return this.commit({
        ...this.document,
        activePreset: { kind: 'builtin', sourceId: BUILTIN_PRESET_ID },
      });
    }
    const preset = this.document.customPresets.find((item) => item.id === sourceId);
    if (preset === undefined) throw new Error(`找不到要启用的 HUD 预设：${sourceId}`);
    const layout =
      preset.layoutId === BUILTIN_LAYOUT_ID
        ? getBuiltinLayout()
        : this.document.customLayouts.find((item) => item.id === preset.layoutId);
    const theme =
      preset.themeId === BUILTIN_THEME_ID
        ? getBuiltinTheme()
        : this.document.customThemes.find((item) => item.id === preset.themeId);
    if (layout === undefined || theme === undefined) throw new Error('预设引用的资源不存在');
    const snapshot = resolveHudPreset(preset, layout, theme);
    return this.commit({
      ...this.document,
      activePreset: { kind: 'custom', sourceId: preset.id, snapshot },
    });
  }

  private async commit(next: HudConfigDocument): Promise<HudConfigState> {
    const candidate = parseHudConfigDocument(next);
    await this.commits.run(async () => {
      try {
        if (this.filePath !== undefined) {
          const committed = await replaceDurableJson(this.filePath, candidate);
          if (!committed) throw new Error('HUD 配置提交已取消');
        }
        this.document = candidate;
        this.persistenceError = null;
      } catch (error: unknown) {
        this.persistenceError = error instanceof Error ? error.message : String(error);
        this.onDiagnostic('hud_config_persist_failed');
        throw error;
      }
    });
    return this.getState();
  }

  async flush(): Promise<void> {
    await this.commits.flush();
  }

  get isLoaded(): boolean {
    return this.loaded;
  }
}
