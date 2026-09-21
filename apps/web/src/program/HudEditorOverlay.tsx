import { Fragment, type PointerEvent } from 'react';

import {
  HUD_WIDGET_REGISTRY,
  placementToBox,
  type HudResolvedPreset,
  type HudWidgetId,
} from '@rivalhub-broadcast/hud-config';

import { themeStyle } from './GameplayHud';
import {
  getHudRendererEntry,
  HUD_RENDERER_REGISTRY,
  type HudRendererRegistry,
} from './hud-renderer-registry';

export interface HudEditorOverlayProps {
  readonly resolvedPreset: HudResolvedPreset;
  readonly mode?: 'layout' | 'preview';
  readonly selectedWidgetId: HudWidgetId | null;
  readonly onWidgetPointerDown?:
    ((widgetId: HudWidgetId, event: PointerEvent<HTMLButtonElement>) => void) | undefined;
  readonly onRadarResizePointerDown?:
    ((event: PointerEvent<HTMLButtonElement>) => void) | undefined;
  readonly rendererRegistry?: HudRendererRegistry;
  readonly interactive?: boolean;
}

/** Editor-only chrome. It is a sibling overlay and never enters the Program renderer. */
export function HudEditorOverlay({
  resolvedPreset,
  mode = 'layout',
  selectedWidgetId,
  onWidgetPointerDown,
  onRadarResizePointerDown,
  rendererRegistry = HUD_RENDERER_REGISTRY,
  interactive = true,
}: HudEditorOverlayProps) {
  return (
    <div
      aria-label="HUD 编辑辅助层"
      className="hud-editor-overlay"
      data-hud-editor-overlay="true"
      style={themeStyle(resolvedPreset.theme)}
    >
      {HUD_WIDGET_REGISTRY.map((descriptor) => {
        const placement = resolvedPreset.layout.widgets[descriptor.id];
        if (placement === undefined || !placement.visible) return null;
        const rendererEntry = getHudRendererEntry(descriptor.id, rendererRegistry);
        const isPlaceholder = rendererEntry.renderer === null;
        if (mode === 'preview' && !isPlaceholder) return null;
        const box = placementToBox(descriptor.id, placement);
        if (mode === 'preview') {
          return (
            <div
              className="hud-editor-overlay__placeholder"
              data-hud-widget={descriptor.id}
              key={descriptor.id}
              style={{
                height: `${box.height}px`,
                left: `${box.left}px`,
                top: `${box.top}px`,
                width: `${box.width}px`,
              }}
            >
              <span className="hud-editor-overlay__widget-label">{descriptor.label}</span>
            </div>
          );
        }
        const selected = selectedWidgetId === descriptor.id;
        return (
          <Fragment key={descriptor.id}>
            <button
              aria-label={`${descriptor.label}，可拖动`}
              aria-pressed={selected}
              className={`hud-editor-overlay__widget${selected ? ' is-selected' : ''}${isPlaceholder ? ' is-placeholder' : ' is-chrome'}`}
              data-hud-widget={descriptor.id}
              disabled={!interactive}
              onPointerDown={
                interactive ? (event) => onWidgetPointerDown?.(descriptor.id, event) : undefined
              }
              style={{
                height: `${box.height}px`,
                left: `${box.left}px`,
                top: `${box.top}px`,
                width: `${box.width}px`,
              }}
              type="button"
            >
              {isPlaceholder ? (
                <span className="hud-editor-overlay__widget-label">{descriptor.label}</span>
              ) : null}
            </button>
            {descriptor.id === 'radar' && selected ? (
              <button
                aria-label="调整雷达大小"
                className="hud-editor-overlay__resize-handle"
                disabled={!interactive}
                onPointerDown={onRadarResizePointerDown}
                style={{
                  left: `${box.left + box.width - 10}px`,
                  top: `${box.top + box.height - 10}px`,
                }}
                type="button"
              />
            ) : null}
          </Fragment>
        );
      })}
    </div>
  );
}
