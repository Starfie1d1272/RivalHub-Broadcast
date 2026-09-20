import { Fragment, type PointerEvent } from 'react';

import {
  HUD_WIDGET_REGISTRY,
  placementToBox,
  type HudResolvedPreset,
  type HudWidgetId,
} from '@rivalhub-broadcast/hud-config';

import { themeStyle } from './GameplayHud';

export interface HudEditorOverlayProps {
  readonly resolvedPreset: HudResolvedPreset;
  readonly selectedWidgetId: HudWidgetId | null;
  readonly onWidgetPointerDown?:
    ((widgetId: HudWidgetId, event: PointerEvent<HTMLButtonElement>) => void) | undefined;
  readonly onRadarResizePointerDown?:
    ((event: PointerEvent<HTMLButtonElement>) => void) | undefined;
}

/** Editor-only chrome. It is a sibling overlay and never enters the Program renderer. */
export function HudEditorOverlay({
  resolvedPreset,
  selectedWidgetId,
  onWidgetPointerDown,
  onRadarResizePointerDown,
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
        const box = placementToBox(descriptor.id, placement);
        const selected = selectedWidgetId === descriptor.id;
        return (
          <Fragment key={descriptor.id}>
            <button
              aria-label={`${descriptor.label}，可拖动`}
              aria-pressed={selected}
              className={`hud-editor-overlay__widget${selected ? ' is-selected' : ''}`}
              data-hud-widget={descriptor.id}
              onPointerDown={(event) => onWidgetPointerDown?.(descriptor.id, event)}
              style={{
                height: `${box.height}px`,
                left: `${box.left}px`,
                top: `${box.top}px`,
                width: `${box.width}px`,
              }}
              type="button"
            >
              <span className="hud-editor-overlay__widget-label">{descriptor.label}</span>
            </button>
            {descriptor.id === 'radar' && selected ? (
              <button
                aria-label="调整雷达大小"
                className="hud-editor-overlay__resize-handle"
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
