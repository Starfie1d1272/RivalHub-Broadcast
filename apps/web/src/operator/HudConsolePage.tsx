import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { CSSProperties, PointerEvent } from 'react';

import {
  BUILTIN_LAYOUT_ID,
  BUILTIN_PRESET_ID,
  BUILTIN_THEME_ID,
  HUD_ANCHORS,
  HUD_CANVAS_HEIGHT,
  HUD_CANVAS_WIDTH,
  HUD_GRID_SIZE,
  HUD_WIDGET_IDS,
  canonicalJson,
  createDefaultHudConfigDocument,
  getBuiltinLayout,
  getBuiltinPreset,
  getBuiltinResolvedPreset,
  getBuiltinTheme,
  moveWidgetPlacement,
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

import { GameplayHud } from '../program/GameplayHud';
import { getProgramFixture } from '../program/fixtures';
import { createLocalChannelClient, type LocalChannelConnectionState } from '../realtime';
import {
  mutateHudConfig,
  useHudConfigClient,
  type HudConfigMutation,
  type HudConfigResponse,
} from '../realtime/hud-config-client';

import './hud-console.css';

type HudWorkspace = 'preset' | 'layout' | 'theme';
type HudResource = HudPreset | HudLayout | HudTheme;

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
      return '已接受 baseline';
    case 'awaiting-baseline':
      return '等待 baseline';
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
  const client = useMemo(() => createLocalChannelClient('program'), []);
  useEffect(() => {
    client.start();
    return () => client.dispose();
  }, [client]);
  const snapshot = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  return { current: snapshot.current, state: snapshot.state };
}

interface HudCanvasPreviewProps {
  readonly resolvedPreset: HudResolvedPreset;
  readonly snapshot: ProgramSnapshot | null;
  readonly connectionState: LocalChannelConnectionState;
  readonly selectedWidgetId: HudWidgetId | null;
  readonly showGrid: boolean;
  readonly showCenter: boolean;
  readonly showSafeArea: boolean;
  readonly onWidgetPointerDown?:
    ((widgetId: HudWidgetId, event: PointerEvent<HTMLDivElement>) => void) | undefined;
  readonly onRadarResizePointerDown?:
    ((event: PointerEvent<HTMLButtonElement>) => void) | undefined;
}

function HudCanvasPreview({
  resolvedPreset,
  snapshot,
  connectionState,
  selectedWidgetId,
  showGrid,
  showCenter,
  showSafeArea,
  onWidgetPointerDown,
  onRadarResizePointerDown,
}: HudCanvasPreviewProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const updateScale = () => {
      const width = frameRef.current?.getBoundingClientRect().width ?? HUD_CANVAS_WIDTH;
      setScale(width / HUD_CANVAS_WIDTH);
    };
    updateScale();
    window.addEventListener('resize', updateScale);
    return () => window.removeEventListener('resize', updateScale);
  }, []);

  const guideStyle = { width: HUD_CANVAS_WIDTH, height: HUD_CANVAS_HEIGHT } satisfies CSSProperties;

  return (
    <div className="hud-console__canvas-frame" ref={frameRef}>
      <div
        aria-label="Gameplay HUD 预览画布"
        className="hud-console__canvas-logical"
        style={{ transform: `scale(${scale})` }}
      >
        {showGrid ? (
          <div className="hud-console__guide hud-console__guide--grid" style={guideStyle} />
        ) : null}
        {showCenter ? (
          <div className="hud-console__guide hud-console__guide--center" style={guideStyle} />
        ) : null}
        {showSafeArea ? (
          <div className="hud-console__guide hud-console__guide--safe" style={guideStyle} />
        ) : null}
        <GameplayHud
          connectionState={connectionState}
          mode="editor"
          onRadarResizePointerDown={onRadarResizePointerDown}
          onWidgetPointerDown={onWidgetPointerDown}
          resolvedPreset={resolvedPreset}
          selectedWidgetId={selectedWidgetId}
          snapshot={snapshot}
        />
      </div>
    </div>
  );
}

export function HudConsolePage() {
  const hudConfig = useHudConfigClient(import.meta.env.VITE_VISUAL_FIXTURES !== '1');
  const program = useProgramConnection();
  const fixture = useMemo(() => getProgramFixture('live-canonical'), []);
  const initialDocument = hudConfig.document ?? createDefaultHudConfigDocument();
  const [documentOverride, setDocumentOverride] = useState<HudConfigDocument | null>(null);
  const configDocument = documentOverride ?? initialDocument;
  const [workspace, setWorkspace] = useState<HudWorkspace>('preset');
  const [token, setToken] = useState('');
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
  const [selectedWidgetId, setSelectedWidgetId] = useState<HudWidgetId>('radar');
  const [previewSource, setPreviewSource] = useState<'fixture' | 'current-live'>('fixture');
  const [showGrid, setShowGrid] = useState(true);
  const [showCenter, setShowCenter] = useState(true);
  const [showSafeArea, setShowSafeArea] = useState(false);
  const [commandState, setCommandState] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [activationStaleOverride, setActivationStaleOverride] = useState<boolean | null>(null);
  const [drag, setDrag] = useState<{
    readonly kind: 'move' | 'resize';
    readonly widgetId: HudWidgetId;
    readonly startX: number;
    readonly startY: number;
    readonly placement: HudLayout['widgets'][HudWidgetId];
  } | null>(null);
  const previewSourceLive =
    program.state === 'live' &&
    program.current !== null &&
    program.current.payload.status.telemetry === 'fresh';
  const activePreviewSource =
    previewSource === 'current-live' && previewSourceLive ? 'current-live' : 'fixture';
  const activeSnapshot = activePreviewSource === 'current-live' ? program.current : fixture;

  const savedPreset = resourceFor(configDocument, 'preset', selectedPresetId) as
    HudPreset | undefined;
  const savedLayout = resourceFor(configDocument, 'layout', selectedLayoutId) as
    HudLayout | undefined;
  const savedTheme = resourceFor(configDocument, 'theme', selectedThemeId) as HudTheme | undefined;
  const presetDirty = savedPreset === undefined || !isSame(savedPreset, presetDraft);
  const layoutDirty = savedLayout === undefined || !isSame(savedLayout, layoutDraft);
  const themeDirty = savedTheme === undefined || !isSame(savedTheme, themeDraft);
  const hasDirtyDraft = presetDirty || layoutDirty || themeDirty;
  const activationStale = activationStaleOverride ?? hudConfig.activationStale;

  useEffect(() => {
    if (documentOverride !== null || hudConfig.document === null || hasDirtyDraft) return;
    const nextDocument = hudConfig.document;
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
  }, [documentOverride, hasDirtyDraft, hudConfig.document, hudConfig.etag]);

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
            ),
          },
        }));
      } else {
        setLayoutDraft((current) => ({
          ...current,
          widgets: {
            ...current.widgets,
            radar: resizeRadarPlacement(drag.placement, point.x - drag.startX),
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
  }, [drag]);

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
    if (hasDirtyDraft) {
      setCommandState('当前存在未保存草稿，请先保存、另存为或放弃。');
      return;
    }
    const resource = resourceFor(configDocument, kind, id);
    if (resource === undefined) return;
    if (kind === 'preset') {
      const preset = resource as HudPreset;
      setSelectedPresetId(id);
      setPresetDraft(clone(preset));
      setSelectedLayoutId(preset.layoutId);
      setSelectedThemeId(preset.themeId);
      setLayoutDraft(clone(resourceFor(configDocument, 'layout', preset.layoutId) as HudLayout));
      setThemeDraft(clone(resourceFor(configDocument, 'theme', preset.themeId) as HudTheme));
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
    if (hasDirtyDraft) {
      setCommandState('当前存在未保存草稿，请先保存、另存为或放弃。');
      return;
    }
    setWorkspace(next);
    setCommandState(null);
  }

  function applyResponse(response: HudConfigResponse): void {
    setDocumentOverride(response.document);
    setActivationStaleOverride(response.activationStale);
  }

  async function submitMutation(kind: HudWorkspace, saveAs: boolean): Promise<void> {
    if (busy) return;
    const draft = selectedDraft(kind);
    const command: HudConfigMutation = {
      kind: saveAs ? 'save-as' : 'save-resource',
      resource: kind,
      value: { ...draft, name: draft.name.trim() },
    };
    setBusy(true);
    setCommandState(null);
    try {
      const beforeIds = new Set(resourceList(configDocument, kind).map((resource) => resource.id));
      const response = await mutateHudConfig(token, command);
      applyResponse(response);
      let nextId = draft.id;
      if (saveAs) {
        const created = resourceList(response.document, kind).find(
          (resource) => !beforeIds.has(resource.id),
        );
        if (created !== undefined) nextId = created.id;
      }
      const saved = resourceFor(response.document, kind, nextId);
      if (saved === undefined) throw new Error('服务器未返回已保存的 HUD 资源');
      setSelectedDraft(kind, clone(saved));
      if (kind === 'preset') setSelectedPresetId(nextId);
      if (kind === 'layout') setSelectedLayoutId(nextId);
      if (kind === 'theme') setSelectedThemeId(nextId);
      setCommandState(saveAs ? `已另存为「${saved.name}」。` : 'HUD 草稿已保存。');
    } catch (error: unknown) {
      setCommandState(`HUD 命令未执行：${error instanceof Error ? error.message : '请求失败'}`);
    } finally {
      setBusy(false);
    }
  }

  async function activateSelectedPreset(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setCommandState(null);
    try {
      const response = await mutateHudConfig(token, {
        kind: 'activate-preset',
        sourceId: selectedPresetId,
      });
      applyResponse(response);
      setCommandState('已启用当前 HUD 预设；正式节目将在下一次轮询中获取同一 resolved snapshot。');
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

  function startMove(widgetId: HudWidgetId, event: PointerEvent<HTMLDivElement>): void {
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

  let previewPreset = presetDraft;
  let previewLayout = resourceFor(configDocument, 'layout', presetDraft.layoutId) as
    HudLayout | undefined;
  let previewTheme = resourceFor(configDocument, 'theme', presetDraft.themeId) as
    HudTheme | undefined;
  if (workspace === 'layout') {
    previewPreset = { ...presetDraft, layoutId: selectedLayoutId };
    previewLayout =
      selectedLayoutId === layoutDraft.id
        ? layoutDraft
        : (resourceFor(configDocument, 'layout', selectedLayoutId) as HudLayout);
  }
  if (workspace === 'theme') {
    previewPreset = { ...presetDraft, themeId: selectedThemeId };
    previewTheme =
      selectedThemeId === themeDraft.id
        ? themeDraft
        : (resourceFor(configDocument, 'theme', selectedThemeId) as HudTheme);
  }
  const previewResolved = useMemo(() => {
    try {
      if (previewLayout === undefined || previewTheme === undefined)
        return getBuiltinResolvedPreset();
      return resolveHudPreset(previewPreset, previewLayout, previewTheme);
    } catch {
      return getBuiltinResolvedPreset();
    }
  }, [previewLayout, previewPreset, previewTheme]);

  const selectedPlacement = layoutDraft.widgets[selectedWidgetId];
  const selectedBox = placementToBox(selectedWidgetId, selectedPlacement);

  function renderResourceActions(kind: HudWorkspace, dirty: boolean, id: string) {
    return (
      <div className="hud-console__actions">
        <button
          disabled={busy || isBuiltin(id)}
          onClick={() => void submitMutation(kind, false)}
          type="button"
        >
          保存
        </button>
        <button disabled={busy} onClick={() => void submitMutation(kind, true)} type="button">
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
            <span className="hud-console__kicker">01 / Preset</span>
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
              onChange={(event) => {
                setPresetDraft({ ...presetDraft, layoutId: event.target.value });
                setSelectedLayoutId(event.target.value);
                const next = resourceFor(configDocument, 'layout', event.target.value);
                if (next !== undefined) setLayoutDraft(clone(next as HudLayout));
              }}
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
              onChange={(event) => {
                setPresetDraft({ ...presetDraft, themeId: event.target.value });
                setSelectedThemeId(event.target.value);
                const next = resourceFor(configDocument, 'theme', event.target.value);
                if (next !== undefined) setThemeDraft(clone(next as HudTheme));
              }}
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
          保存只更新资源；只有明确启用后，正式节目才会获得新的 resolved snapshot。
        </p>
      </section>
    );
  }

  function renderLayoutWorkspace() {
    return (
      <section className="hud-console__workspace" aria-label="HUD 布局编辑">
        <div className="hud-console__workspace-heading">
          <div>
            <span className="hud-console__kicker">02 / Layout</span>
            <h2>用逻辑坐标安排节目结构</h2>
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
        <div className="hud-console__widget-list" aria-label="HUD 组件">
          {HUD_WIDGET_IDS.map((id) => (
            <button
              className={selectedWidgetId === id ? 'is-selected' : undefined}
              key={id}
              onClick={() => setSelectedWidgetId(id)}
              type="button"
            >
              <span>{id}</span>
              <small>{layoutDraft.widgets[id].visible ? '显示' : '隐藏'}</small>
            </button>
          ))}
        </div>
        <div className="hud-console__inspector">
          <div className="hud-console__inspector-heading">
            <span>组件检查器</span>
            <strong>{selectedWidgetId}</strong>
          </div>
          <label className="hud-console__check">
            <input
              checked={selectedPlacement.visible}
              onChange={(event) =>
                setLayoutDraft({
                  ...layoutDraft,
                  widgets: {
                    ...layoutDraft.widgets,
                    [selectedWidgetId]: { ...selectedPlacement, visible: event.target.checked },
                  },
                })
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
                setLayoutDraft({
                  ...layoutDraft,
                  widgets: {
                    ...layoutDraft.widgets,
                    [selectedWidgetId]: {
                      ...selectedPlacement,
                      anchor: event.target.value as HudLayout['widgets'][HudWidgetId]['anchor'],
                    },
                  },
                })
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
                  setLayoutDraft({
                    ...layoutDraft,
                    widgets: {
                      ...layoutDraft.widgets,
                      [selectedWidgetId]: {
                        ...selectedPlacement,
                        offsetX: Number(event.target.value) || 0,
                      },
                    },
                  })
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
                  setLayoutDraft({
                    ...layoutDraft,
                    widgets: {
                      ...layoutDraft.widgets,
                      [selectedWidgetId]: {
                        ...selectedPlacement,
                        offsetY: Number(event.target.value) || 0,
                      },
                    },
                  })
                }
                type="number"
                value={selectedPlacement.offsetY}
              />
            </label>
          </div>
          <p className="hud-console__hint">
            当前盒子：{Math.round(selectedBox.width)} × {Math.round(selectedBox.height)}，左上角{' '}
            {Math.round(selectedBox.left)}, {Math.round(selectedBox.top)}。只有 Radar
            支持保持正方形的尺寸调整。
          </p>
        </div>
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
            <span className="hud-console__kicker">03 / Theme</span>
            <h2>只调整品牌外观，不改语义状态</h2>
          </div>
          <span className="hud-console__badge">Inter · 固定语义颜色</span>
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
              aria-label="品牌色"
              onChange={(event) => setThemeDraft({ ...themeDraft, brandColor: event.target.value })}
              type="color"
              value={themeDraft.brandColor}
            />
            <code>{themeDraft.brandColor}</code>
          </div>
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
          CT、T、danger、warning、success、objective 等状态语义由系统固定，不在此处编辑。
        </p>
      </section>
    );
  }

  return (
    <main className="hud-console" data-surface="hud-console">
      <header className="hud-console__header">
        <div>
          <p className="hud-console__eyebrow">RivalHub Broadcast / Gameplay HUD</p>
          <h1>把画面边界交给可验证的配置。</h1>
          <p className="hud-console__intro">
            预设、布局和外观各自保存；只有明确启用的 preset
            才能进入正式节目。编辑器预览与正式节目共享同一个 GameplayHud。
          </p>
        </div>
        <div className="hud-console__header-meta">
          <span>本地配置轮询 · 500ms</span>
          <strong>{hudConfig.status === 'error' ? '沿用最近有效版本' : '配置服务在线'}</strong>
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
        <label className="hud-console__token">
          Operator token
          <input
            autoComplete="current-password"
            onChange={(event) => setToken(event.target.value)}
            placeholder="仅保留在当前页面内存"
            type="password"
            value={token}
          />
        </label>
      </section>

      <section className="hud-console__source-bar" aria-label="HUD 预览来源">
        <div>
          <span className="hud-console__kicker">Preview source</span>
          <strong>
            {activePreviewSource === 'fixture' ? 'Test scene / live-canonical' : 'Current Live'}
          </strong>
        </div>
        <label>
          预览来源
          <select
            value={activePreviewSource}
            onChange={(event) => setPreviewSource(event.target.value as 'fixture' | 'current-live')}
          >
            <option value="fixture">Test scene · live-canonical</option>
            <option disabled={!previewSourceLive} value="current-live">
              Current Live ·{' '}
              {previewSourceLive ? connectionLabel(program.state) : '需已接受 baseline'}
            </option>
          </select>
        </label>
        <span className="hud-console__source-status" data-connection-state={program.state}>
          Program source · {connectionLabel(program.state)}
        </span>
      </section>

      <div className="hud-console__layout">
        <div className="hud-console__preview-column">
          <HudCanvasPreview
            connectionState={program.state}
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
            逻辑画布 1920 × 1080 · 拖动组件吸附到 10px 网格 · 生产 renderer 当前对未实现组件
            fail-closed
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
