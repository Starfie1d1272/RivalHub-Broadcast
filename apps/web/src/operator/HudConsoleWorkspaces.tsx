import {
  HUD_ANCHORS,
  HUD_GRID_SIZE,
  HUD_WIDGET_LABELS,
  HUD_WIDGET_IDS,
  type HudConfigDocument,
  type HudLayout,
  type HudPreset,
  type HudTheme,
  type HudWidgetBox,
  type HudWidgetId,
  type HudWidgetPlacement,
} from '@rivalhub-broadcast/hud-config';

import { activePresetId, resourceFor, resourceList } from './hud-console-drafts';
import type { HudWorkspace } from './hud-console-state';

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

export interface HudConsoleWorkspaceProps {
  readonly workspace: HudWorkspace;
  readonly configDocument: HudConfigDocument;
  readonly editorReady: boolean;
  readonly busy: boolean;
  readonly activationStale: boolean;
  readonly hasDirtyDraft: boolean;
  readonly selectedPresetId: string;
  readonly selectedLayoutId: string;
  readonly selectedThemeId: string;
  readonly presetDraft: HudPreset;
  readonly layoutDraft: HudLayout;
  readonly themeDraft: HudTheme;
  readonly presetDirty: boolean;
  readonly layoutDirty: boolean;
  readonly themeDirty: boolean;
  readonly presetNameError: string | null;
  readonly layoutNameError: string | null;
  readonly themeNameError: string | null;
  readonly themeDraftInvalid: boolean;
  readonly selectedWidgetId: HudWidgetId | null;
  readonly selectedPlacement: HudWidgetPlacement | null;
  readonly selectedBox: HudWidgetBox | null;
  readonly showGrid: boolean;
  readonly showCenter: boolean;
  readonly showSafeArea: boolean;
  readonly snapToGridEnabled: boolean;
  readonly onSelectResource: (kind: HudWorkspace, id: string) => void;
  readonly onUpdatePresetReference: (kind: 'layout' | 'theme', id: string) => void;
  readonly onPresetDraftChange: (draft: HudPreset) => void;
  readonly onLayoutDraftChange: (draft: HudLayout) => void;
  readonly onThemeDraftChange: (draft: HudTheme) => void;
  readonly onSelectWidget: (id: HudWidgetId) => void;
  readonly onUpdateSelectedPlacement: (
    update: (placement: HudWidgetPlacement) => HudWidgetPlacement,
    preserveVisualBox?: boolean,
  ) => void;
  readonly onShowGridChange: (value: boolean) => void;
  readonly onShowCenterChange: (value: boolean) => void;
  readonly onShowSafeAreaChange: (value: boolean) => void;
  readonly onSnapToGridChange: (value: boolean) => void;
  readonly onSubmitMutation: (kind: HudWorkspace, saveAs: boolean) => void;
  readonly onDiscard: (kind: HudWorkspace) => void;
  readonly onReset: (kind: HudWorkspace) => void;
  readonly onActivate: () => void;
}

function isBuiltin(id: string): boolean {
  return id.startsWith('builtin:');
}

function widgetLabel(id: HudWidgetId): string {
  return HUD_WIDGET_LABELS[id];
}

function resourceName(resource: HudPreset | HudLayout | HudTheme | undefined): string {
  return resource?.name ?? '未找到资源';
}

export function HudConsoleWorkspaces({
  workspace,
  configDocument,
  editorReady,
  busy,
  activationStale,
  hasDirtyDraft,
  selectedPresetId,
  selectedLayoutId,
  selectedThemeId,
  presetDraft,
  layoutDraft,
  themeDraft,
  presetDirty,
  layoutDirty,
  themeDirty,
  presetNameError,
  layoutNameError,
  themeNameError,
  themeDraftInvalid,
  selectedWidgetId,
  selectedPlacement,
  selectedBox,
  showGrid,
  showCenter,
  showSafeArea,
  snapToGridEnabled,
  onSelectResource,
  onUpdatePresetReference,
  onPresetDraftChange,
  onLayoutDraftChange,
  onThemeDraftChange,
  onSelectWidget,
  onUpdateSelectedPlacement,
  onShowGridChange,
  onShowCenterChange,
  onShowSafeAreaChange,
  onSnapToGridChange,
  onSubmitMutation,
  onDiscard,
  onReset,
  onActivate,
}: HudConsoleWorkspaceProps) {
  const activePresetResourceId = activePresetId(configDocument);
  const activePresetName = resourceName(
    resourceFor(configDocument, 'preset', activePresetResourceId),
  );
  const previewMatchesPresetReferences =
    selectedLayoutId === presetDraft.layoutId && selectedThemeId === presetDraft.themeId;
  const activationLabel = hasDirtyDraft
    ? '有未保存草稿'
    : !previewMatchesPresetReferences
      ? '当前预览尚未关联到预设'
      : selectedPresetId !== activePresetResourceId
        ? '当前预设尚未启用'
        : activationStale
          ? '已保存修改尚未启用'
          : '与正式节目一致';

  function renderResourceActions(kind: HudWorkspace, dirty: boolean, id: string) {
    const invalid =
      (kind === 'preset' && presetNameError !== null) ||
      (kind === 'layout' && layoutNameError !== null) ||
      (kind === 'theme' && (themeNameError !== null || themeDraftInvalid));
    return (
      <div className="hud-console__actions">
        <button
          disabled={busy || !editorReady || isBuiltin(id) || invalid}
          onClick={() => onSubmitMutation(kind, false)}
          type="button"
        >
          保存
        </button>
        <button
          disabled={busy || !editorReady || invalid}
          onClick={() => onSubmitMutation(kind, true)}
          type="button"
        >
          另存为
        </button>
        <button
          disabled={busy || !editorReady || !dirty}
          onClick={() => onDiscard(kind)}
          type="button"
        >
          放弃
        </button>
        <button disabled={busy || !editorReady} onClick={() => onReset(kind)} type="button">
          恢复默认
        </button>
      </div>
    );
  }

  if (workspace === 'preset') {
    return (
      <section className="hud-console__workspace" aria-label="HUD 预设编辑">
        <div className="hud-console__workspace-heading">
          <div>
            <span className="hud-console__kicker">预设 · 上屏方案</span>
            <h2>管理保存与上屏</h2>
          </div>
        </div>
        <div className="hud-console__preset-status" aria-label="HUD 预设状态">
          <div>
            <span>当前上屏</span>
            <strong>{activePresetName}</strong>
          </div>
          <div>
            <span>当前编辑</span>
            <strong>{presetDraft.name.trim() || '未命名预设'}</strong>
          </div>
          <span
            className={
              activationLabel === '与正式节目一致'
                ? 'hud-console__badge'
                : 'hud-console__badge hud-console__badge--warning'
            }
          >
            {activationLabel}
          </span>
        </div>
        <label className="hud-console__field">
          预设
          <select
            value={selectedPresetId}
            onChange={(event) => onSelectResource('preset', event.target.value)}
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
            aria-invalid={presetNameError !== null}
            disabled={!editorReady}
            value={presetDraft.name}
            onChange={(event) => onPresetDraftChange({ ...presetDraft, name: event.target.value })}
          />
        </label>
        {presetNameError !== null ? (
          <p className="hud-console__field-error" role="alert">
            {presetNameError}
          </p>
        ) : null}
        <div className="hud-console__field-grid">
          <label className="hud-console__field">
            布局引用
            <select
              value={presetDraft.layoutId}
              onChange={(event) => onUpdatePresetReference('layout', event.target.value)}
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
              onChange={(event) => onUpdatePresetReference('theme', event.target.value)}
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
          disabled={busy || !editorReady || hasDirtyDraft || !previewMatchesPresetReferences}
          onClick={onActivate}
          type="button"
        >
          启用到正式节目
        </button>
        <p className="hud-console__hint">
          保存不会改变正式节目；启用会把当前已保存预设冻结为新的上屏配置。
        </p>
      </section>
    );
  }

  if (workspace === 'layout') {
    return (
      <section className="hud-console__workspace" aria-label="HUD 布局编辑">
        <div className="hud-console__workspace-heading">
          <div>
            <span className="hud-console__kicker">布局 · 几何与显隐</span>
            <h2>安排组件位置</h2>
          </div>
          <span className="hud-console__badge">1920 × 1080 · {HUD_GRID_SIZE}px 网格</span>
        </div>
        <label className="hud-console__field">
          布局
          <select
            value={selectedLayoutId}
            onChange={(event) => onSelectResource('layout', event.target.value)}
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
            aria-invalid={layoutNameError !== null}
            disabled={!editorReady}
            value={layoutDraft.name}
            onChange={(event) => onLayoutDraftChange({ ...layoutDraft, name: event.target.value })}
          />
        </label>
        {layoutNameError !== null ? (
          <p className="hud-console__field-error" role="alert">
            {layoutNameError}
          </p>
        ) : null}
        <div className="hud-console__widget-list" aria-label="可编辑组件">
          {HUD_WIDGET_IDS.map((id) => (
            <button
              aria-label={`选择${widgetLabel(id)}`}
              className={selectedWidgetId === id ? 'is-selected' : undefined}
              key={id}
              onClick={() => onSelectWidget(id)}
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
                  onUpdateSelectedPlacement((placement) => ({
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
                  onUpdateSelectedPlacement(
                    (placement) => ({
                      ...placement,
                      anchor: event.target.value as HudWidgetPlacement['anchor'],
                    }),
                    true,
                  )
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
                    onUpdateSelectedPlacement((placement) => ({
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
                    onUpdateSelectedPlacement((placement) => ({
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
              onChange={(event) => onShowGridChange(event.target.checked)}
              type="checkbox"
            />{' '}
            网格
          </label>
          <label className="hud-console__check">
            <input
              checked={showCenter}
              onChange={(event) => onShowCenterChange(event.target.checked)}
              type="checkbox"
            />{' '}
            中心线
          </label>
          <label className="hud-console__check">
            <input
              checked={showSafeArea}
              onChange={(event) => onShowSafeAreaChange(event.target.checked)}
              type="checkbox"
            />{' '}
            安全区
          </label>
          <label className="hud-console__check">
            <input
              checked={snapToGridEnabled}
              onChange={(event) => onSnapToGridChange(event.target.checked)}
              type="checkbox"
            />{' '}
            吸附到网格
          </label>
        </div>
        {renderResourceActions('layout', layoutDirty, selectedLayoutId)}
      </section>
    );
  }

  return (
    <section className="hud-console__workspace" aria-label="HUD 外观编辑">
      <div className="hud-console__workspace-heading">
        <div>
          <span className="hud-console__kicker">外观 · 视觉语言</span>
          <h2>调整品牌外观，不改比赛信息</h2>
        </div>
        <span className="hud-console__badge">比赛信息颜色由系统维护</span>
      </div>
      <label className="hud-console__field">
        外观
        <select
          value={selectedThemeId}
          onChange={(event) => onSelectResource('theme', event.target.value)}
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
          aria-invalid={themeNameError !== null}
          disabled={!editorReady}
          value={themeDraft.name}
          onChange={(event) => onThemeDraftChange({ ...themeDraft, name: event.target.value })}
        />
      </label>
      {themeNameError !== null ? (
        <p className="hud-console__field-error" role="alert">
          {themeNameError}
        </p>
      ) : null}
      <div className="hud-console__theme-control">
        <span>品牌色</span>
        <div className="hud-console__color-row">
          <input
            aria-label="品牌色选择器"
            onChange={(event) =>
              onThemeDraftChange({ ...themeDraft, brandColor: event.target.value })
            }
            type="color"
            value={
              /^#[0-9a-fA-F]{6}$/.test(themeDraft.brandColor) ? themeDraft.brandColor : '#c8ef78'
            }
          />
          <input
            aria-label="品牌色十六进制值"
            aria-invalid={themeDraftInvalid}
            className={themeDraftInvalid ? 'is-invalid' : undefined}
            onChange={(event) =>
              onThemeDraftChange({ ...themeDraft, brandColor: event.target.value })
            }
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
                onThemeDraftChange({ ...themeDraft, panelStyle: value as HudTheme['panelStyle'] })
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
                onThemeDraftChange({ ...themeDraft, cornerStyle: value as HudTheme['cornerStyle'] })
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
