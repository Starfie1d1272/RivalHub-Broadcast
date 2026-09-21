import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { PointerEvent } from 'react';

import {
  BUILTIN_LAYOUT_ID,
  BUILTIN_PRESET_ID,
  BUILTIN_THEME_ID,
  HUD_ANCHORS,
  HUD_CANVAS_HEIGHT,
  HUD_CANVAS_WIDTH,
  HUD_GRID_SIZE,
  HUD_WIDGET_IDS,
  HUD_WIDGET_REGISTRY,
  canonicalJson,
  createDefaultHudConfigDocument,
  getBuiltinLayout,
  getBuiltinPreset,
  getBuiltinResolvedPreset,
  getBuiltinTheme,
  moveWidgetPlacement,
  normalizeHudPlacement,
  placementToBox,
  resetLayoutDraft,
  resetPresetDraft,
  resetThemeDraft,
  resolveHudPreset,
  resizeRadarPlacement,
  type HudConfigDocument,
  type HudLayout,
  type HudPreset,
  type HudResolvedPreset,
  type HudTheme,
  type HudWidgetId,
} from '@rivalhub-broadcast/hud-config';
import type { ProgramSnapshot } from '@rivalhub-broadcast/protocol/program';

import {
  getProgramFixture,
  PROGRAM_FIXTURE_IDS,
  PROGRAM_FIXTURE_LABELS,
  type ProgramFixtureId,
} from '../program/fixtures';
import { hasAcceptedProgramSnapshot } from '../program/presentation-boundary';
import { HudCanvasPreview } from './HudCanvasPreview';
import {
  hudResourceNavigationBlockReason,
  type HudDraftDirtyState,
  type HudResource,
  type HudWorkspace,
} from './hud-console-state';
import { type LocalChannelConnectionState, useLocalChannelClient } from '../realtime';
import {
  mutateHudConfig,
  useHudConfigEditorClient,
  useHudConfigClient,
  type HudConfigMutation,
  type HudConfigMutationResponse,
} from '../realtime/hud-config-client';

import './hud-console.css';

const WORKSPACES: readonly { readonly id: HudWorkspace; readonly label: string }[] = [
  { id: 'preset', label: 'HUD 预设' },
  { id: 'layout', label: 'HUD 布局' },
  { id: 'theme', label: 'HUD 外观' },
];

const ANCHOR_LABELS: Record<(typeof HUD_ANCHORS)[number], string> = {
  'top-left': '左上',
  'top-center': '上中',
  'top-right': '右上',
  'center-left': '左中',
  center: '中心',
  'center-right': '右中',
  'bottom-left': '左下',
  'bottom-center': '下中',
  'bottom-right': '右下',
};

const PANEL_LABELS = { solid: '实心', standard: '标准', light: '轻量' } as const;
const CORNER_LABELS = { square: '方正', soft: '轻微圆角', rounded: '圆润' } as const;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function resourceList(document: HudConfigDocument, kind: HudWorkspace): HudResource[] {
  if (kind === 'preset') return [getBuiltinPreset(), ...document.customPresets];
  if (kind === 'layout') return [getBuiltinLayout(), ...document.customLayouts];
  return [getBuiltinTheme(), ...document.customThemes];
}

function resourceFor(
  document: HudConfigDocument,
  kind: HudWorkspace,
  id: string,
): HudResource | undefined {
  return resourceList(document, kind).find((resource) => resource.id === id);
}

function resourceName(resource: HudResource | undefined): string {
  return resource?.name ?? '未找到资源';
}

function widgetLabel(id: HudWidgetId): string {
  return HUD_WIDGET_REGISTRY.find((descriptor) => descriptor.id === id)?.label ?? id;
}

function isBuiltin(id: string): boolean {
  return id.startsWith('builtin:');
}

function isSame(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function activePresetId(document: HudConfigDocument): string {
  return document.activePreset.kind === 'custom'
    ? document.activePreset.sourceId
    : BUILTIN_PRESET_ID;
}

function connectionLabel(state: LocalChannelConnectionState): string {
  switch (state) {
    case 'live':
      return '已接收初始状态';
    case 'awaiting-baseline':
      return '等待初始状态';
    case 'connecting':
      return '正在连接';
    case 'reconnecting':
      return '正在重连';
    case 'protocol-error':
      return '协议不兼容';
    case 'closed':
      return '已关闭';
    default:
      return '未启动';
  }
}

function useProgramConnection(): {
  readonly current: ProgramSnapshot | null;
  readonly state: LocalChannelConnectionState;
} {
  const client = useLocalChannelClient('program');
  const snapshot = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  return { current: snapshot.current, state: snapshot.state };
}

export function HudConsolePage() {
  const hudConfig = useHudConfigClient(import.meta.env.VITE_VISUAL_FIXTURES !== '1');
  const hudEditor = useHudConfigEditorClient(import.meta.env.VITE_VISUAL_FIXTURES !== '1');
  const program = useProgramConnection();
  const initialDocument = hudEditor.document ?? createDefaultHudConfigDocument();
  const configDocument = hudEditor.document ?? initialDocument;
  const [workspace, setWorkspace] = useState<HudWorkspace>('preset');
  const [selectedPresetId, setSelectedPresetId] = useState(() => activePresetId(initialDocument));
  const [selectedLayoutId, setSelectedLayoutId] = useState(() => {
    const preset = resourceFor(initialDocument, 'preset', activePresetId(initialDocument));
    return preset !== undefined && 'layoutId' in preset ? preset.layoutId : BUILTIN_LAYOUT_ID;
  });
  const [selectedThemeId, setSelectedThemeId] = useState(() => {
    const preset = resourceFor(initialDocument, 'preset', activePresetId(initialDocument));
    return preset !== undefined && 'themeId' in preset ? preset.themeId : BUILTIN_THEME_ID;
  });
  const [presetDraft, setPresetDraft] = useState<HudPreset>(() =>
    clone(resourceFor(initialDocument, 'preset', activePresetId(initialDocument)) as HudPreset),
  );
  const [layoutDraft, setLayoutDraft] = useState<HudLayout>(() =>
    clone(resourceFor(initialDocument, 'layout', selectedLayoutId) as HudLayout),
  );
  const [themeDraft, setThemeDraft] = useState<HudTheme>(() =>
    clone(resourceFor(initialDocument, 'theme', selectedThemeId) as HudTheme),
  );
  const [selectedWidgetId, setSelectedWidgetId] = useState<HudWidgetId | null>(null);
  const [previewSource, setPreviewSource] = useState<'fixture' | 'current-live'>('fixture');
  const [fixtureId, setFixtureId] = useState<ProgramFixtureId>('live-canonical');
  const [showGrid, setShowGrid] = useState(true);
  const [showCenter, setShowCenter] = useState(true);
  const [showSafeArea, setShowSafeArea] = useState(false);
  const [snapToGridEnabled, setSnapToGridEnabled] = useState(true);
  const [commandState, setCommandState] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const skipNextExternalSync = useRef(false);
  const [lastValidPreview, setLastValidPreview] = useState<HudResolvedPreset>(() =>
    getBuiltinResolvedPreset(),
  );
  const [drag, setDrag] = useState<{
    readonly kind: 'move' | 'resize';
    readonly widgetId: HudWidgetId;
    readonly startX: number;
    readonly startY: number;
    readonly placement: HudLayout['widgets'][HudWidgetId];
  } | null>(null);
  const fixture = useMemo(() => getProgramFixture(fixtureId), [fixtureId]);
  const previewSourceLive = hasAcceptedProgramSnapshot(program.current, program.state);
  const activePreviewSource = previewSource;
  const activeSnapshot = activePreviewSource === 'current-live' ? program.current : fixture;

  const savedPreset = resourceFor(configDocument, 'preset', selectedPresetId) as
    HudPreset | undefined;
  const savedLayout = resourceFor(configDocument, 'layout', selectedLayoutId) as
    HudLayout | undefined;
  const savedTheme = resourceFor(configDocument, 'theme', selectedThemeId) as HudTheme | undefined;
  const presetDirty = savedPreset === undefined || !isSame(savedPreset, presetDraft);
  const layoutDirty = savedLayout === undefined || !isSame(savedLayout, layoutDraft);
  const themeDirty = savedTheme === undefined || !isSame(savedTheme, themeDraft);
  const themeDraftInvalid = !/^#[0-9a-fA-F]{6}$/.test(themeDraft.brandColor);
  const dirtyDrafts: HudDraftDirtyState = {
    preset: presetDirty,
    layout: layoutDirty,
    theme: themeDirty,
  };
  const hasDirtyDraft = presetDirty || layoutDirty || themeDirty;
  const activationStale = hudEditor.activationStale;

  useEffect(() => {
    if (skipNextExternalSync.current) {
      skipNextExternalSync.current = false;
      return;
    }
    if (hudEditor.document === null || hasDirtyDraft) return;
    const nextDocument = hudEditor.document;
    const nextPresetId = activePresetId(nextDocument);
    const nextPreset = resourceFor(nextDocument, 'preset', nextPresetId) as HudPreset;
    const nextLayoutId = nextPreset.layoutId;
    const nextThemeId = nextPreset.themeId;
    // The persisted Companion snapshot is an external source; refresh local drafts after it arrives.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedPresetId(nextPresetId);
    setSelectedLayoutId(nextLayoutId);
    setSelectedThemeId(nextThemeId);
    setPresetDraft(clone(nextPreset));
    setLayoutDraft(clone(resourceFor(nextDocument, 'layout', nextLayoutId) as HudLayout));
    setThemeDraft(clone(resourceFor(nextDocument, 'theme', nextThemeId) as HudTheme));
  }, [hasDirtyDraft, hudEditor.document, hudEditor.revision]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasDirtyDraft) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [hasDirtyDraft]);

  useEffect(() => {
    if (drag === null) return;

    const logicalPoint = (
      clientX: number,
      clientY: number,
    ): { readonly x: number; readonly y: number } => {
      const frame = globalThis.document.querySelector<HTMLDivElement>('.hud-console__canvas-frame');
      if (frame === null) return { x: clientX, y: clientY };
      const rect = frame.getBoundingClientRect();
      return {
        x: ((clientX - rect.left) / rect.width) * HUD_CANVAS_WIDTH,
        y: ((clientY - rect.top) / rect.height) * HUD_CANVAS_HEIGHT,
      };
    };
    const move = (event: globalThis.PointerEvent) => {
      const point = logicalPoint(event.clientX, event.clientY);
      if (drag.kind === 'move') {
        setLayoutDraft((current) => ({
          ...current,
          widgets: {
            ...current.widgets,
            [drag.widgetId]: moveWidgetPlacement(
              drag.widgetId,
              drag.placement,
              point.x - drag.startX,
              point.y - drag.startY,
              snapToGridEnabled,
            ),
          },
        }));
      } else {
        setLayoutDraft((current) => ({
          ...current,
          widgets: {
            ...current.widgets,
            radar: resizeRadarPlacement(drag.placement, point.x - drag.startX, snapToGridEnabled),
          },
        }));
      }
    };
    const end = () => setDrag(null);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
    };
  }, [drag, snapToGridEnabled]);

  function selectedDraft(kind: HudWorkspace): HudResource {
    if (kind === 'preset') return presetDraft;
    if (kind === 'layout') return layoutDraft;
    return themeDraft;
  }

  function setSelectedDraft(kind: HudWorkspace, value: HudResource): void {
    if (kind === 'preset') setPresetDraft(value as HudPreset);
    else if (kind === 'layout') setLayoutDraft(value as HudLayout);
    else setThemeDraft(value as HudTheme);
  }

  function selectResource(kind: HudWorkspace, id: string): void {
    const resource = resourceFor(configDocument, kind, id);
    if (resource === undefined) return;
    const blockReason = hudResourceNavigationBlockReason(
      kind,
      resource,
      { preset: selectedPresetId, layout: selectedLayoutId, theme: selectedThemeId },
      dirtyDrafts,
    );
    if (blockReason !== null) {
      setCommandState(blockReason);
      return;
    }
    if (kind === 'preset') {
      const preset = resource as HudPreset;
      setSelectedPresetId(id);
      setPresetDraft(clone(preset));
      if (preset.layoutId !== selectedLayoutId) {
        setSelectedLayoutId(preset.layoutId);
        setLayoutDraft(clone(resourceFor(configDocument, 'layout', preset.layoutId) as HudLayout));
      }
      if (preset.themeId !== selectedThemeId) {
        setSelectedThemeId(preset.themeId);
        setThemeDraft(clone(resourceFor(configDocument, 'theme', preset.themeId) as HudTheme));
      }
    } else if (kind === 'layout') {
      setSelectedLayoutId(id);
      setLayoutDraft(clone(resource as HudLayout));
    } else {
      setSelectedThemeId(id);
      setThemeDraft(clone(resource as HudTheme));
    }
    setCommandState(null);
  }

  function changeWorkspace(next: HudWorkspace): void {
    if (next === workspace) return;
    setWorkspace(next);
    setCommandState(null);
  }

  function updatePresetReference(kind: 'layout' | 'theme', id: string): void {
    const resource = resourceFor(configDocument, kind, id);
    if (resource === undefined) return;
    const selectedId = kind === 'layout' ? selectedLayoutId : selectedThemeId;
    const dirty = kind === 'layout' ? layoutDirty : themeDirty;
    if (dirty && id !== selectedId) {
      setCommandState(
        `当前 HUD ${kind === 'layout' ? '布局' : '外观'} 有未保存草稿；修改预设引用会覆盖它，请先保存或放弃。`,
      );
      return;
    }
    setPresetDraft((current) => ({ ...current, [`${kind}Id`]: id }));
    if (id === selectedId) return;
    if (kind === 'layout') {
      setSelectedLayoutId(id);
      setLayoutDraft(clone(resource as HudLayout));
    } else {
      setSelectedThemeId(id);
      setThemeDraft(clone(resource as HudTheme));
    }
  }

  function applyResponse(response: HudConfigMutationResponse): void {
    skipNextExternalSync.current = true;
    hudConfig.applyResponse(response.onAir);
    hudEditor.applyResponse(response.editor);
  }

  async function submitMutation(kind: HudWorkspace, saveAs: boolean): Promise<void> {
    if (busy) return;
    if (kind === 'theme' && themeDraftInvalid) {
      setCommandState('请先修正品牌色格式，再保存 HUD 外观。');
      return;
    }
    const draft = selectedDraft(kind);
    const command: HudConfigMutation = {
      kind: saveAs ? 'save-as' : 'save-resource',
      resource: kind,
      value: { ...draft, name: draft.name.trim() },
    };
    setBusy(true);
    setCommandState(null);
    try {
      const response = await mutateHudConfig(command);
      applyResponse(response);
      if (response.command.resource !== kind || response.command.resourceId === undefined) {
        throw new Error('服务器未返回本次操作对应的 HUD 资源身份');
      }
      const nextId = response.command.resourceId;
      const saved = resourceFor(response.editor.document, kind, nextId);
      if (saved === undefined) throw new Error('服务器未返回已保存的 HUD 资源');
      setSelectedDraft(kind, clone(saved));
      if (kind === 'preset') setSelectedPresetId(nextId);
      if (kind === 'layout') setSelectedLayoutId(nextId);
      if (kind === 'theme') setSelectedThemeId(nextId);
      setCommandState(saveAs ? `已另存为「${saved.name}」。` : 'HUD 草稿已保存。');
    } catch (error: unknown) {
      setCommandState(`HUD 操作未完成：${error instanceof Error ? error.message : '请求失败'}`);
    } finally {
      setBusy(false);
    }
  }

  async function activateSelectedPreset(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setCommandState(null);
    try {
      const response = await mutateHudConfig({
        kind: 'activate-preset',
        sourceId: selectedPresetId,
      });
      applyResponse(response);
      setCommandState('已启用当前 HUD 预设；正式节目会使用这份配置。');
    } catch (error: unknown) {
      setCommandState(`HUD 预设未启用：${error instanceof Error ? error.message : '请求失败'}`);
    } finally {
      setBusy(false);
    }
  }

  function discard(kind: HudWorkspace): void {
    const saved = resourceFor(
      configDocument,
      kind,
      kind === 'preset' ? selectedPresetId : kind === 'layout' ? selectedLayoutId : selectedThemeId,
    );
    if (saved === undefined) return;
    setSelectedDraft(kind, clone(saved));
    setCommandState('已放弃当前草稿改动。');
  }

  function reset(kind: HudWorkspace): void {
    if (kind === 'preset') setPresetDraft(resetPresetDraft(presetDraft));
    else if (kind === 'layout') setLayoutDraft(resetLayoutDraft(layoutDraft));
    else setThemeDraft(resetThemeDraft(themeDraft));
    setCommandState('已恢复第一版默认值；保存前不会影响正式节目。');
  }

  function startMove(widgetId: HudWidgetId, event: PointerEvent<HTMLButtonElement>): void {
    if (workspace !== 'layout') return;
    event.preventDefault();
    const frame = event.currentTarget.closest('.hud-console__canvas-frame');
    const rect = frame?.getBoundingClientRect();
    if (rect === undefined || rect === null) return;
    const point = {
      x: ((event.clientX - rect.left) / rect.width) * HUD_CANVAS_WIDTH,
      y: ((event.clientY - rect.top) / rect.height) * HUD_CANVAS_HEIGHT,
    };
    setSelectedWidgetId(widgetId);
    setDrag({
      kind: 'move',
      widgetId,
      startX: point.x,
      startY: point.y,
      placement: clone(layoutDraft.widgets[widgetId]),
    });
  }

  function startRadarResize(event: PointerEvent<HTMLButtonElement>): void {
    if (workspace !== 'layout') return;
    event.preventDefault();
    event.stopPropagation();
    const frame = event.currentTarget.closest('.hud-console__canvas-frame');
    const rect = frame?.getBoundingClientRect();
    if (rect === undefined || rect === null) return;
    const point = {
      x: ((event.clientX - rect.left) / rect.width) * HUD_CANVAS_WIDTH,
      y: ((event.clientY - rect.top) / rect.height) * HUD_CANVAS_HEIGHT,
    };
    setSelectedWidgetId('radar');
    setDrag({
      kind: 'resize',
      widgetId: 'radar',
      startX: point.x,
      startY: point.y,
      placement: clone(layoutDraft.widgets.radar),
    });
  }

  const previewPreset = useMemo(() => {
    if (workspace === 'layout') return { ...presetDraft, layoutId: selectedLayoutId };
    if (workspace === 'theme') return { ...presetDraft, themeId: selectedThemeId };
    return presetDraft;
  }, [presetDraft, selectedLayoutId, selectedThemeId, workspace]);
  const previewLayout = useMemo(() => {
    if (workspace === 'layout' && selectedLayoutId === layoutDraft.id) return layoutDraft;
    return resourceFor(configDocument, 'layout', previewPreset.layoutId) as HudLayout | undefined;
  }, [configDocument, layoutDraft, previewPreset.layoutId, selectedLayoutId, workspace]);
  const previewTheme = useMemo(() => {
    if (workspace === 'theme' && selectedThemeId === themeDraft.id) return themeDraft;
    return resourceFor(configDocument, 'theme', previewPreset.themeId) as HudTheme | undefined;
  }, [configDocument, previewPreset.themeId, selectedThemeId, themeDraft, workspace]);
  const previewCandidate = useMemo(() => {
    try {
      if (previewLayout === undefined || previewTheme === undefined) return null;
      return resolveHudPreset(previewPreset, previewLayout, previewTheme);
    } catch {
      return null;
    }
  }, [previewLayout, previewPreset, previewTheme]);
  useEffect(() => {
    if (previewCandidate === null) return;
    // Keep the last valid visual model when a draft field is temporarily invalid.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLastValidPreview(previewCandidate);
  }, [previewCandidate]);
  const previewResolved = previewCandidate ?? lastValidPreview;

  const selectedPlacement =
    selectedWidgetId === null ? null : layoutDraft.widgets[selectedWidgetId];
  const selectedBox =
    selectedWidgetId === null
      ? null
      : placementToBox(selectedWidgetId, layoutDraft.widgets[selectedWidgetId]);

  function updateSelectedPlacement(
    update: (placement: HudLayout['widgets'][HudWidgetId]) => HudLayout['widgets'][HudWidgetId],
  ): void {
    if (selectedWidgetId === null) return;
    setLayoutDraft((current) => ({
      ...current,
      widgets: {
        ...current.widgets,
        [selectedWidgetId]: normalizeHudPlacement(
          selectedWidgetId,
          update(current.widgets[selectedWidgetId]),
        ),
      },
    }));
  }

  function renderResourceActions(kind: HudWorkspace, dirty: boolean, id: string) {
    const invalid = kind === 'theme' && themeDraftInvalid;
    return (
      <div className="hud-console__actions">
        <button
          disabled={busy || isBuiltin(id) || invalid}
          onClick={() => void submitMutation(kind, false)}
          type="button"
        >
          保存
        </button>
        <button
          disabled={busy || invalid}
          onClick={() => void submitMutation(kind, true)}
          type="button"
        >
          另存为
        </button>
        <button disabled={busy || !dirty} onClick={() => discard(kind)} type="button">
          放弃
        </button>
        <button disabled={busy} onClick={() => reset(kind)} type="button">
          恢复默认
        </button>
      </div>
    );
  }

  function renderPresetWorkspace() {
    return (
      <section className="hud-console__workspace" aria-label="HUD 预设编辑">
        <div className="hud-console__workspace-heading">
          <div>
            <span className="hud-console__kicker">第一步 · 选择预设</span>
            <h2>决定哪一套配置可以上场</h2>
          </div>
          <span
            className={
              activationStale
                ? 'hud-console__badge hud-console__badge--warning'
                : 'hud-console__badge'
            }
          >
            {activationStale
              ? '已保存，尚未启用'
              : `当前启用：${resourceName(resourceFor(configDocument, 'preset', activePresetId(configDocument)))}`}
          </span>
        </div>
        <label className="hud-console__field">
          预设
          <select
            value={selectedPresetId}
            onChange={(event) => selectResource('preset', event.target.value)}
          >
            {resourceList(configDocument, 'preset').map((resource) => (
              <option key={resource.id} value={resource.id}>
                {resource.name}
                {isBuiltin(resource.id) ? ' · 内置只读' : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="hud-console__field">
          名称
          <input
            value={presetDraft.name}
            onChange={(event) => setPresetDraft({ ...presetDraft, name: event.target.value })}
          />
        </label>
        <div className="hud-console__field-grid">
          <label className="hud-console__field">
            布局引用
            <select
              value={presetDraft.layoutId}
              onChange={(event) => updatePresetReference('layout', event.target.value)}
            >
              {resourceList(configDocument, 'layout').map((resource) => (
                <option key={resource.id} value={resource.id}>
                  {resource.name}
                </option>
              ))}
            </select>
          </label>
          <label className="hud-console__field">
            外观引用
            <select
              value={presetDraft.themeId}
              onChange={(event) => updatePresetReference('theme', event.target.value)}
            >
              {resourceList(configDocument, 'theme').map((resource) => (
                <option key={resource.id} value={resource.id}>
                  {resource.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        {renderResourceActions('preset', presetDirty, selectedPresetId)}
        <button
          className="hud-console__primary-action"
          disabled={busy || hasDirtyDraft}
          onClick={() => void activateSelectedPreset()}
          type="button"
        >
          启用当前预设
        </button>
        <p className="hud-console__hint">
          保存只更新资源；只有明确启用后，正式节目才会使用新的配置。
        </p>
      </section>
    );
  }

  function renderLayoutWorkspace() {
    return (
      <section className="hud-console__workspace" aria-label="HUD 布局编辑">
        <div className="hud-console__workspace-heading">
          <div>
            <span className="hud-console__kicker">第二步 · 编辑布局</span>
            <h2>安排节目结构</h2>
          </div>
          <span className="hud-console__badge">1920 × 1080 · {HUD_GRID_SIZE}px 网格</span>
        </div>
        <label className="hud-console__field">
          布局
          <select
            value={selectedLayoutId}
            onChange={(event) => selectResource('layout', event.target.value)}
          >
            {resourceList(configDocument, 'layout').map((resource) => (
              <option key={resource.id} value={resource.id}>
                {resource.name}
                {isBuiltin(resource.id) ? ' · 内置只读' : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="hud-console__field">
          名称
          <input
            value={layoutDraft.name}
            onChange={(event) => setLayoutDraft({ ...layoutDraft, name: event.target.value })}
          />
        </label>
        <div className="hud-console__widget-list" aria-label="可编辑组件">
          {HUD_WIDGET_IDS.map((id) => (
            <button
              aria-label={`选择${widgetLabel(id)}`}
              className={selectedWidgetId === id ? 'is-selected' : undefined}
              key={id}
              onClick={() => setSelectedWidgetId(id)}
              type="button"
            >
              <span>{widgetLabel(id)}</span>
              <small>{layoutDraft.widgets[id].visible ? '显示' : '隐藏'}</small>
            </button>
          ))}
        </div>
        {selectedWidgetId === null || selectedPlacement === null || selectedBox === null ? (
          <div className="hud-console__inspector hud-console__inspector--empty">
            <strong>请选择一个组件</strong>
            <p className="hud-console__hint">选择画布中的标记或右侧组件列表后编辑位置。</p>
          </div>
        ) : (
          <div className="hud-console__inspector">
            <div className="hud-console__inspector-heading">
              <span>组件设置</span>
              <strong>{widgetLabel(selectedWidgetId)}</strong>
            </div>
            <label className="hud-console__check">
              <input
                checked={selectedPlacement.visible}
                onChange={(event) =>
                  updateSelectedPlacement((placement) => ({
                    ...placement,
                    visible: event.target.checked,
                  }))
                }
                type="checkbox"
              />
              在节目中显示
            </label>
            <label className="hud-console__field">
              锚点
              <select
                value={selectedPlacement.anchor}
                onChange={(event) =>
                  updateSelectedPlacement((placement) => ({
                    ...placement,
                    anchor: event.target.value as HudLayout['widgets'][HudWidgetId]['anchor'],
                  }))
                }
              >
                {HUD_ANCHORS.map((anchor) => (
                  <option key={anchor} value={anchor}>
                    {ANCHOR_LABELS[anchor]}
                  </option>
                ))}
              </select>
            </label>
            <div className="hud-console__field-grid">
              <label className="hud-console__field">
                X 偏移
                <input
                  inputMode="numeric"
                  onChange={(event) =>
                    updateSelectedPlacement((placement) => ({
                      ...placement,
                      offsetX: Number(event.target.value) || 0,
                    }))
                  }
                  type="number"
                  value={selectedPlacement.offsetX}
                />
              </label>
              <label className="hud-console__field">
                Y 偏移
                <input
                  inputMode="numeric"
                  onChange={(event) =>
                    updateSelectedPlacement((placement) => ({
                      ...placement,
                      offsetY: Number(event.target.value) || 0,
                    }))
                  }
                  type="number"
                  value={selectedPlacement.offsetY}
                />
              </label>
            </div>
            <p className="hud-console__hint">
              当前尺寸：{Math.round(selectedBox.width)} × {Math.round(selectedBox.height)}，位置{' '}
              {Math.round(selectedBox.left)}, {Math.round(selectedBox.top)}
              。只有雷达支持保持正方形的尺寸调整。
            </p>
          </div>
        )}
        <div className="hud-console__guide-controls">
          <label className="hud-console__check">
            <input
              checked={showGrid}
              onChange={(event) => setShowGrid(event.target.checked)}
              type="checkbox"
            />{' '}
            网格
          </label>
          <label className="hud-console__check">
            <input
              checked={showCenter}
              onChange={(event) => setShowCenter(event.target.checked)}
              type="checkbox"
            />{' '}
            中心线
          </label>
          <label className="hud-console__check">
            <input
              checked={showSafeArea}
              onChange={(event) => setShowSafeArea(event.target.checked)}
              type="checkbox"
            />{' '}
            安全区
          </label>
          <label className="hud-console__check">
            <input
              checked={snapToGridEnabled}
              onChange={(event) => setSnapToGridEnabled(event.target.checked)}
              type="checkbox"
            />{' '}
            吸附到网格
          </label>
        </div>
        {renderResourceActions('layout', layoutDirty, selectedLayoutId)}
      </section>
    );
  }

  function renderThemeWorkspace() {
    return (
      <section className="hud-console__workspace" aria-label="HUD 外观编辑">
        <div className="hud-console__workspace-heading">
          <div>
            <span className="hud-console__kicker">第三步 · 调整外观</span>
            <h2>只调整品牌外观，不改比赛信息</h2>
          </div>
          <span className="hud-console__badge">比赛信息颜色由系统维护</span>
        </div>
        <label className="hud-console__field">
          外观
          <select
            value={selectedThemeId}
            onChange={(event) => selectResource('theme', event.target.value)}
          >
            {resourceList(configDocument, 'theme').map((resource) => (
              <option key={resource.id} value={resource.id}>
                {resource.name}
                {isBuiltin(resource.id) ? ' · 内置只读' : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="hud-console__field">
          名称
          <input
            value={themeDraft.name}
            onChange={(event) => setThemeDraft({ ...themeDraft, name: event.target.value })}
          />
        </label>
        <div className="hud-console__theme-control">
          <span>品牌色</span>
          <div className="hud-console__color-row">
            <input
              aria-label="品牌色选择器"
              onChange={(event) => setThemeDraft({ ...themeDraft, brandColor: event.target.value })}
              type="color"
              value={
                /^#[0-9a-fA-F]{6}$/.test(themeDraft.brandColor) ? themeDraft.brandColor : '#c8ef78'
              }
            />
            <input
              aria-label="品牌色十六进制值"
              aria-invalid={themeDraftInvalid}
              className={themeDraftInvalid ? 'is-invalid' : undefined}
              onChange={(event) => setThemeDraft({ ...themeDraft, brandColor: event.target.value })}
              placeholder="#RRGGBB"
              spellCheck={false}
              type="text"
              value={themeDraft.brandColor}
            />
          </div>
          {themeDraftInvalid ? (
            <p className="hud-console__field-error" role="alert">
              请输入 6 位十六进制颜色，例如 #C8EF78。
            </p>
          ) : null}
        </div>
        <fieldset className="hud-console__choice-group">
          <legend>面板样式</legend>
          {Object.entries(PANEL_LABELS).map(([value, label]) => (
            <label key={value}>
              <input
                checked={themeDraft.panelStyle === value}
                onChange={() =>
                  setThemeDraft({ ...themeDraft, panelStyle: value as HudTheme['panelStyle'] })
                }
                name="panel-style"
                type="radio"
                value={value}
              />
              {label}
            </label>
          ))}
        </fieldset>
        <fieldset className="hud-console__choice-group">
          <legend>圆角风格</legend>
          {Object.entries(CORNER_LABELS).map(([value, label]) => (
            <label key={value}>
              <input
                checked={themeDraft.cornerStyle === value}
                onChange={() =>
                  setThemeDraft({ ...themeDraft, cornerStyle: value as HudTheme['cornerStyle'] })
                }
                name="corner-style"
                type="radio"
                value={value}
              />
              {label}
            </label>
          ))}
        </fieldset>
        {renderResourceActions('theme', themeDirty, selectedThemeId)}
        <p className="hud-console__hint">
          CT、T、危险、提醒、成功和目标状态等比赛信息颜色由系统维护，不在此处编辑。
        </p>
      </section>
    );
  }

  return (
    <main className="hud-console" data-surface="hud-console">
      <header className="hud-console__header">
        <div>
          <p className="hud-console__eyebrow">RivalHub Broadcast / 节目 HUD</p>
          <h1>把画面边界交给可验证的配置。</h1>
          <p className="hud-console__intro">
            预设、布局和外观各自保存；只有明确启用的预设
            才能进入正式节目。编辑辅助层只服务于编辑，正式节目不会携带编辑控件。
          </p>
        </div>
        <div className="hud-console__header-meta">
          <span>本地配置状态</span>
          <strong>{hudEditor.status === 'error' ? '暂时使用最近有效配置' : '配置已连接'}</strong>
        </div>
      </header>

      <nav aria-label="制播页面" className="hud-console__nav">
        <a href="/program">正式节目</a>
        <a aria-current="page" href="/operator/hud">
          HUD 控制台
        </a>
        <a href="/operator">制作控制</a>
        <a href="/debug">运行诊断</a>
      </nav>

      <section className="hud-console__toolbar" aria-label="HUD 控制台工具栏">
        <div className="hud-console__tabs">
          {WORKSPACES.map((item) => (
            <button
              aria-current={workspace === item.id ? 'page' : undefined}
              className={workspace === item.id ? 'is-active' : undefined}
              key={item.id}
              onClick={() => changeWorkspace(item.id)}
              type="button"
            >
              {item.label}
            </button>
          ))}
        </div>
      </section>

      <section className="hud-console__source-bar" aria-label="HUD 预览来源">
        <div>
          <span className="hud-console__kicker">预览来源</span>
          <strong>
            {activePreviewSource === 'fixture'
              ? PROGRAM_FIXTURE_LABELS[fixtureId]
              : previewSourceLive
                ? '当前实时节目'
                : '当前实时节目不可用'}
          </strong>
        </div>
        <label>
          选择预览来源
          <select
            value={activePreviewSource}
            onChange={(event) => setPreviewSource(event.target.value as 'fixture' | 'current-live')}
          >
            <option value="fixture">测试场景</option>
            <option disabled={!previewSourceLive} value="current-live">
              当前实时节目 · {connectionLabel(program.state)}
            </option>
          </select>
        </label>
        {activePreviewSource === 'fixture' ? (
          <label>
            测试场景
            <select
              aria-label="测试场景"
              value={fixtureId}
              onChange={(event) => setFixtureId(event.target.value as ProgramFixtureId)}
            >
              {PROGRAM_FIXTURE_IDS.map((id) => (
                <option key={id} value={id}>
                  {PROGRAM_FIXTURE_LABELS[id]}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <span className="hud-console__source-status" data-connection-state={program.state}>
          实时来源 · {connectionLabel(program.state)}
          {!previewSourceLive && activePreviewSource === 'current-live' ? ' · 已安全隐藏' : ''}
        </span>
      </section>

      <div className="hud-console__layout">
        <div className="hud-console__preview-column">
          <HudCanvasPreview
            connectionState={program.state}
            editorMode={workspace === 'layout' ? 'layout' : 'preview'}
            liveSource={activePreviewSource === 'current-live'}
            onRadarResizePointerDown={workspace === 'layout' ? startRadarResize : undefined}
            onWidgetPointerDown={workspace === 'layout' ? startMove : undefined}
            resolvedPreset={previewResolved}
            selectedWidgetId={workspace === 'layout' ? selectedWidgetId : null}
            showCenter={showCenter}
            showGrid={showGrid}
            showSafeArea={showSafeArea}
            snapshot={activeSnapshot}
          />
          <p className="hud-console__preview-caption">
            1920 × 1080 画布 · 拖动组件可吸附到 10px 网格 · 暂未提供的节目组件保持隐藏
          </p>
        </div>
        <div className="hud-console__editor-column">
          {workspace === 'preset' ? renderPresetWorkspace() : null}
          {workspace === 'layout' ? renderLayoutWorkspace() : null}
          {workspace === 'theme' ? renderThemeWorkspace() : null}
        </div>
      </div>

      <div
        aria-live="polite"
        className="hud-console__status"
        role={commandState?.includes('未执行') ? 'alert' : 'status'}
      >
        {commandState ?? (hasDirtyDraft ? '当前有未保存草稿。' : '没有未保存改动。')}
      </div>
    </main>
  );
}
