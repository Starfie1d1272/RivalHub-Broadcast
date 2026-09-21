import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { PointerEvent } from 'react';

import {
  BUILTIN_LAYOUT_ID,
  BUILTIN_THEME_ID,
  HUD_CANVAS_HEIGHT,
  HUD_CANVAS_WIDTH,
  changePlacementAnchor,
  createDefaultHudConfigDocument,
  getBuiltinLayout,
  getBuiltinPreset,
  getBuiltinTheme,
  moveWidgetPlacement,
  normalizeHudPlacement,
  placementToBox,
  resetLayoutDraft,
  resetPresetDraft,
  resetThemeDraft,
  resizeRadarPlacement,
  type HudConfigDocument,
  type HudLayout,
  type HudPreset,
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
import { HudConsoleWorkspaces } from './HudConsoleWorkspaces';
import { clientPointToHudLogicalPoint } from './hud-canvas-geometry';
import {
  activePresetId,
  cloneHudValue as clone,
  isHudResourceSame as isSame,
  mergeHudEditorDocument,
  resourceFor,
} from './hud-console-drafts';
import { resolveHudPreview } from './hud-console-preview';
import {
  hudResourceNameError,
  hudResourceNavigationBlockReason,
  type HudDraftDirtyState,
  type HudResource,
  type HudWorkspace,
} from './hud-console-state';
import { type LocalChannelConnectionState, useLocalChannelClient } from '../realtime';
import {
  HudConfigMutationError,
  mutateHudConfig,
  useHudConfigEditorClient,
  type HudConfigMutation,
  type HudConfigMutationResponse,
} from '../realtime/hud-config-client';

import './hud-console.css';

const WORKSPACES: readonly { readonly id: HudWorkspace; readonly label: string }[] = [
  { id: 'preset', label: 'HUD 预设' },
  { id: 'layout', label: 'HUD 布局' },
  { id: 'theme', label: 'HUD 外观' },
];

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
  const visualFixtureMode = import.meta.env.VITE_VISUAL_FIXTURES === '1';
  const hudEditor = useHudConfigEditorClient(!visualFixtureMode);
  const program = useProgramConnection();
  const fixtureDocument = useMemo(() => createDefaultHudConfigDocument(), []);
  const authoritativeDocument = hudEditor.document ?? (visualFixtureMode ? fixtureDocument : null);
  const configDocument = authoritativeDocument ?? fixtureDocument;
  const editorReady = authoritativeDocument !== null;
  const editorStatus = visualFixtureMode ? 'ready' : hudEditor.status;
  const initialDocument = fixtureDocument;
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
  const [lastValidTheme, setLastValidTheme] = useState<HudTheme>(themeDraft);
  const [selectedWidgetId, setSelectedWidgetId] = useState<HudWidgetId | null>(null);
  const [previewSource, setPreviewSource] = useState<'fixture' | 'current-live'>('fixture');
  const [fixtureId, setFixtureId] = useState<ProgramFixtureId>('live-canonical');
  const [showGrid, setShowGrid] = useState(true);
  const [showCenter, setShowCenter] = useState(true);
  const [showSafeArea, setShowSafeArea] = useState(false);
  const [snapToGridEnabled, setSnapToGridEnabled] = useState(true);
  const [commandState, setCommandState] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canvasFrameRef = useRef<HTMLDivElement>(null);
  const authoritativeDocumentRef = useRef<HudConfigDocument | null>(null);
  const observedRevisionRef = useRef<string | null>(null);
  const pendingMutationRef = useRef<{
    readonly kind: HudWorkspace;
    readonly resourceId: string;
  } | null>(null);
  const draftBaseRevisionRef = useRef<Record<HudWorkspace, string | null>>({
    preset: null,
    layout: null,
    theme: null,
  });
  const [draftConflicts, setDraftConflicts] = useState<Record<HudWorkspace, boolean>>({
    preset: false,
    layout: false,
    theme: false,
  });
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
  const presetNameError = hudResourceNameError(presetDraft.name);
  const layoutNameError = hudResourceNameError(layoutDraft.name);
  const themeNameError = hudResourceNameError(themeDraft.name);
  const themeDraftInvalid = !/^#[0-9a-fA-F]{6}$/.test(themeDraft.brandColor);
  const dirtyDrafts: HudDraftDirtyState = {
    preset: presetDirty,
    layout: layoutDirty,
    theme: themeDirty,
  };
  const hasDirtyDraft = presetDirty || layoutDirty || themeDirty;
  const activationStale = hudEditor.activationStale;

  useEffect(() => {
    const nextDocument = authoritativeDocument;
    const nextRevision = visualFixtureMode ? 'fixture' : hudEditor.revision;
    if (nextDocument === null || nextRevision === null) return;
    if (observedRevisionRef.current === nextRevision) return;

    const merged = mergeHudEditorDocument({
      previousDocument: authoritativeDocumentRef.current,
      nextDocument,
      currentIds: {
        preset: selectedPresetId,
        layout: selectedLayoutId,
        theme: selectedThemeId,
      },
      currentDrafts: { preset: presetDraft, layout: layoutDraft, theme: themeDraft },
      currentConflicts: draftConflicts,
      baseRevisions: draftBaseRevisionRef.current,
      nextRevision,
      committed: pendingMutationRef.current,
    });

    authoritativeDocumentRef.current = nextDocument;
    observedRevisionRef.current = nextRevision;
    pendingMutationRef.current = null;
    draftBaseRevisionRef.current = merged.baseRevisions;
    setSelectedPresetId(merged.ids.preset);
    setSelectedLayoutId(merged.ids.layout);
    setSelectedThemeId(merged.ids.theme);
    setPresetDraft(merged.drafts.preset);
    setLayoutDraft(merged.drafts.layout);
    setThemeDraft(merged.drafts.theme);
    setDraftConflicts(merged.conflicts);
    if (Object.values(merged.conflicts).some(Boolean)) {
      setCommandState('已在另一页面更新，请先处理冲突。');
    }
  }, [
    authoritativeDocument,
    draftConflicts,
    hudEditor.revision,
    layoutDraft,
    layoutDirty,
    presetDraft,
    presetDirty,
    selectedLayoutId,
    selectedPresetId,
    selectedThemeId,
    themeDirty,
    themeDraft,
    visualFixtureMode,
  ]);

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

    const logicalPoint = (clientX: number, clientY: number) =>
      clientPointToHudLogicalPoint(
        clientX,
        clientY,
        canvasFrameRef.current?.getBoundingClientRect() ?? {
          left: 0,
          top: 0,
          width: HUD_CANVAS_WIDTH,
          height: HUD_CANVAS_HEIGHT,
        },
      );
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
    window.addEventListener('pointercancel', end);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
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
    else setThemeDraftValue(value as HudTheme);
  }

  function setThemeDraftValue(next: HudTheme): void {
    const currentIsValid = !themeDraftInvalid && themeNameError === null;
    const nextIsValid =
      /^#[0-9a-fA-F]{6}$/.test(next.brandColor) && hudResourceNameError(next.name) === null;
    setThemeDraft(next);
    if (nextIsValid) setLastValidTheme(clone(next));
    else if (currentIsValid) setLastValidTheme(clone(themeDraft));
  }

  function selectResource(kind: HudWorkspace, id: string): void {
    if (!editorReady) return;
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
        setThemeDraftValue(clone(resourceFor(configDocument, 'theme', preset.themeId) as HudTheme));
      }
    } else if (kind === 'layout') {
      setSelectedLayoutId(id);
      setLayoutDraft(clone(resource as HudLayout));
    } else {
      setSelectedThemeId(id);
      setThemeDraftValue(clone(resource as HudTheme));
    }
    setCommandState(null);
  }

  function changeWorkspace(next: HudWorkspace): void {
    if (next === workspace) return;
    setWorkspace(next);
    setCommandState(null);
  }

  function updatePresetReference(kind: 'layout' | 'theme', id: string): void {
    if (!editorReady) return;
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
      setThemeDraftValue(clone(resource as HudTheme));
    }
  }

  function applyResponse(response: HudConfigMutationResponse): void {
    if (response.command.resource !== undefined && response.command.resourceId !== undefined) {
      pendingMutationRef.current = {
        kind: response.command.resource,
        resourceId: response.command.resourceId,
      };
      if (response.command.resource === 'preset') setSelectedPresetId(response.command.resourceId);
      if (response.command.resource === 'layout') setSelectedLayoutId(response.command.resourceId);
      if (response.command.resource === 'theme') setSelectedThemeId(response.command.resourceId);
    } else {
      pendingMutationRef.current = null;
    }
    hudEditor.applyResponse(response.editor);
  }

  async function submitMutation(kind: HudWorkspace, saveAs: boolean): Promise<void> {
    if (busy || !editorReady) return;
    const nameError = hudResourceNameError(selectedDraft(kind).name);
    if (nameError !== null) {
      setCommandState(nameError);
      return;
    }
    if (kind === 'theme' && themeDraftInvalid) {
      setCommandState('请先修正品牌色格式，再保存 HUD 外观。');
      return;
    }
    const draft = selectedDraft(kind);
    const expectedEditorRevision = draftBaseRevisionRef.current[kind] ?? hudEditor.revision;
    if (expectedEditorRevision === null) {
      setCommandState('正在读取 HUD 配置，请稍后再试。');
      return;
    }
    const command: HudConfigMutation = {
      kind: saveAs ? 'save-as' : 'save-resource',
      resource: kind,
      value: { ...draft, name: draft.name.trim() },
      expectedEditorRevision,
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
      if (error instanceof HudConfigMutationError && error.status === 409) {
        setDraftConflicts((current) => ({ ...current, [kind]: true }));
        setCommandState('已在另一页面更新，请先处理冲突。');
      } else {
        setCommandState(`HUD 操作未完成：${error instanceof Error ? error.message : '请求失败'}。`);
      }
    } finally {
      setBusy(false);
    }
  }

  async function activateSelectedPreset(): Promise<void> {
    if (busy || !editorReady || hudEditor.revision === null) return;
    setBusy(true);
    setCommandState(null);
    try {
      const response = await mutateHudConfig({
        kind: 'activate-preset',
        sourceId: selectedPresetId,
        expectedEditorRevision: hudEditor.revision,
      });
      applyResponse(response);
      setCommandState('已启用当前 HUD 预设；正式节目会使用这份配置。');
    } catch (error: unknown) {
      setCommandState(
        error instanceof HudConfigMutationError && error.status === 409
          ? '已在另一页面更新，请先处理冲突。'
          : `HUD 预设未启用：${error instanceof Error ? error.message : '请求失败'}。`,
      );
    } finally {
      setBusy(false);
    }
  }

  function discard(kind: HudWorkspace): void {
    if (!editorReady) return;
    const saved = resourceFor(
      configDocument,
      kind,
      kind === 'preset' ? selectedPresetId : kind === 'layout' ? selectedLayoutId : selectedThemeId,
    );
    if (saved === undefined) return;
    setSelectedDraft(kind, clone(saved));
    setDraftConflicts((current) => ({ ...current, [kind]: false }));
    if (hudEditor.revision !== null) draftBaseRevisionRef.current[kind] = hudEditor.revision;
    setCommandState('已放弃当前草稿改动。');
  }

  function reset(kind: HudWorkspace): void {
    if (!editorReady) return;
    if (kind === 'preset') setPresetDraft(resetPresetDraft(presetDraft));
    else if (kind === 'layout') setLayoutDraft(resetLayoutDraft(layoutDraft));
    else setThemeDraftValue(resetThemeDraft(themeDraft));
    setCommandState('已恢复第一版默认值；保存前不会影响正式节目。');
  }

  function startMove(widgetId: HudWidgetId, event: PointerEvent<HTMLButtonElement>): void {
    if (workspace !== 'layout') return;
    event.preventDefault();
    const rect = canvasFrameRef.current?.getBoundingClientRect();
    if (rect === undefined) return;
    const point = clientPointToHudLogicalPoint(event.clientX, event.clientY, rect);
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
    const rect = canvasFrameRef.current?.getBoundingClientRect();
    if (rect === undefined) return;
    const point = clientPointToHudLogicalPoint(event.clientX, event.clientY, rect);
    setSelectedWidgetId('radar');
    setDrag({
      kind: 'resize',
      widgetId: 'radar',
      startX: point.x,
      startY: point.y,
      placement: clone(layoutDraft.widgets.radar),
    });
  }

  const previewPreset = useMemo(
    () => ({ ...presetDraft, layoutId: selectedLayoutId, themeId: selectedThemeId }),
    [presetDraft, selectedLayoutId, selectedThemeId],
  );
  const previewLayout = useMemo(() => {
    if (selectedLayoutId === layoutDraft.id) return layoutDraft;
    return resourceFor(configDocument, 'layout', selectedLayoutId) as HudLayout | undefined;
  }, [configDocument, layoutDraft, selectedLayoutId]);
  const previewTheme = useMemo(() => {
    if (selectedThemeId === themeDraft.id) return themeDraft;
    return resourceFor(configDocument, 'theme', selectedThemeId) as HudTheme | undefined;
  }, [configDocument, selectedThemeId, themeDraft]);
  const previewResolved = useMemo(
    () =>
      resolveHudPreview({
        fallbackLayout: savedLayout ?? getBuiltinLayout(),
        fallbackPreset: savedPreset ?? getBuiltinPreset(),
        fallbackTheme: lastValidTheme,
        layout: previewLayout ?? savedLayout ?? getBuiltinLayout(),
        preset: previewPreset,
        theme: previewTheme ?? savedTheme ?? getBuiltinTheme(),
      }),
    [
      lastValidTheme,
      previewLayout,
      previewPreset,
      previewTheme,
      savedLayout,
      savedPreset,
      savedTheme,
    ],
  );

  const selectedPlacement =
    selectedWidgetId === null ? null : layoutDraft.widgets[selectedWidgetId];
  const selectedBox =
    selectedWidgetId === null
      ? null
      : placementToBox(selectedWidgetId, layoutDraft.widgets[selectedWidgetId]);

  function updateSelectedPlacement(
    update: (placement: HudLayout['widgets'][HudWidgetId]) => HudLayout['widgets'][HudWidgetId],
    preserveVisualBox = false,
  ): void {
    if (selectedWidgetId === null) return;
    setLayoutDraft((current) => ({
      ...current,
      widgets: {
        ...current.widgets,
        [selectedWidgetId]: (() => {
          const currentPlacement = current.widgets[selectedWidgetId];
          const updatedPlacement = update(currentPlacement);
          return preserveVisualBox
            ? changePlacementAnchor(selectedWidgetId, currentPlacement, updatedPlacement.anchor)
            : normalizeHudPlacement(selectedWidgetId, updatedPlacement);
        })(),
      },
    }));
  }

  const workspaceProps = {
    activationStale,
    busy,
    configDocument,
    editorReady,
    hasDirtyDraft,
    layoutDirty,
    layoutDraft,
    layoutNameError,
    onActivate: () => void activateSelectedPreset(),
    onDiscard: discard,
    onLayoutDraftChange: (draft: HudLayout) => setLayoutDraft(draft),
    onPresetDraftChange: (draft: HudPreset) => setPresetDraft(draft),
    onReset: reset,
    onSelectResource: selectResource,
    onSelectWidget: (id: HudWidgetId) => setSelectedWidgetId(id),
    onShowCenterChange: (value: boolean) => setShowCenter(value),
    onShowGridChange: (value: boolean) => setShowGrid(value),
    onShowSafeAreaChange: (value: boolean) => setShowSafeArea(value),
    onSnapToGridChange: (value: boolean) => setSnapToGridEnabled(value),
    onSubmitMutation: (kind: HudWorkspace, saveAs: boolean) => void submitMutation(kind, saveAs),
    onThemeDraftChange: setThemeDraftValue,
    onUpdatePresetReference: updatePresetReference,
    onUpdateSelectedPlacement: updateSelectedPlacement,
    presetDirty,
    presetDraft,
    presetNameError,
    selectedBox,
    selectedLayoutId,
    selectedPlacement,
    selectedPresetId,
    selectedThemeId,
    selectedWidgetId,
    showCenter,
    showGrid,
    showSafeArea,
    snapToGridEnabled,
    themeDirty,
    themeDraft,
    themeDraftInvalid,
    themeNameError,
    workspace,
  };

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
          <strong>
            {!editorReady
              ? '正在读取 HUD 配置'
              : editorStatus === 'error'
                ? '暂时使用最近有效配置'
                : '配置已连接'}
          </strong>
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
            canvasFrameRef={canvasFrameRef}
            connectionState={program.state}
            editorMode={workspace === 'layout' ? 'layout' : 'preview'}
            editorInteractive={editorReady && workspace === 'layout'}
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
          <fieldset className="hud-console__editor-fieldset" disabled={!editorReady}>
            <HudConsoleWorkspaces {...workspaceProps} />
          </fieldset>
        </div>
      </div>

      <div
        aria-live="polite"
        className="hud-console__status"
        role={
          commandState?.includes('冲突') || commandState?.includes('未完成') ? 'alert' : 'status'
        }
      >
        {commandState ??
          (!editorReady
            ? '正在读取 HUD 配置。'
            : hasDirtyDraft
              ? '当前有未保存草稿。'
              : '没有未保存改动。')}
      </div>
    </main>
  );
}
