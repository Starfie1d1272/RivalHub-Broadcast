import type { CSSProperties } from 'react';

import {
  HUD_WIDGET_REGISTRY,
  placementToBox,
  type HudResolvedPreset,
} from '@rivalhub-broadcast/hud-config';
import type { ProgramSnapshot } from '@rivalhub-broadcast/protocol/program';

import {
  getHudRendererEntry,
  HUD_RENDERER_REGISTRY,
  type HudRendererRegistry,
} from './hud-renderer-registry';
import './gameplay-hud.css';
import './widgets/focused-player/focused-player.css';
import './widgets/match-header/match-header.css';
import './widgets/player-rails/player-rails.css';

export interface GameplayHudProps {
  readonly snapshot: ProgramSnapshot | null;
  readonly resolvedPreset: HudResolvedPreset;
  /** Test-only injection keeps the production registry closed while exercising the React seam. */
  readonly rendererRegistry?: HudRendererRegistry;
}

export function themeStyle(theme: HudResolvedPreset['theme']): CSSProperties {
  return {
    '--rh-hud-brand': theme.brandColor,
    '--rh-hud-text-primary': theme.semantic.colors.textPrimary,
    '--rh-hud-text-muted': theme.semantic.colors.textMuted,
    '--rh-hud-side-ct': theme.semantic.colors.sideCt,
    '--rh-hud-side-t': theme.semantic.colors.sideT,
    '--rh-hud-state-danger': theme.semantic.colors.stateDanger,
    '--rh-hud-state-warning': theme.semantic.colors.stateWarning,
    '--rh-hud-state-success': theme.semantic.colors.stateSuccess,
    '--rh-hud-state-unknown': theme.semantic.colors.stateUnknown,
    '--rh-hud-objective-bomb': theme.semantic.colors.objectiveBomb,
    '--rh-hud-objective-defuse': theme.semantic.colors.objectiveDefuse,
    '--rh-hud-surface-primary': theme.semantic.surface.primary,
    '--rh-hud-surface-strong': theme.semantic.surface.strong,
    '--rh-hud-surface-opacity': theme.semantic.surface.opacity,
    '--rh-hud-border-opacity': theme.semantic.surface.borderOpacity,
    '--rh-hud-radius-sm': `${theme.semantic.radius.sm}px`,
    '--rh-hud-radius-md': `${theme.semantic.radius.md}px`,
    '--rh-hud-radius-lg': `${theme.semantic.radius.lg}px`,
    '--rh-hud-font-family': theme.semantic.fontFamily,
  } as CSSProperties;
}

export function GameplayHud({
  snapshot,
  resolvedPreset,
  rendererRegistry = HUD_RENDERER_REGISTRY,
}: GameplayHudProps) {
  if (snapshot === null || snapshot.payload.status.telemetry !== 'fresh') return null;

  return (
    <div
      className="gameplay-hud"
      data-gameplay-hud="true"
      data-hud-preset-id={resolvedPreset.preset.id}
      style={themeStyle(resolvedPreset.theme)}
    >
      {HUD_WIDGET_REGISTRY.map((descriptor) => {
        const placement = resolvedPreset.layout.widgets[descriptor.id];
        if (placement === undefined || !placement.visible) return null;
        const rendererEntry = getHudRendererEntry(descriptor.id, rendererRegistry);
        if (rendererEntry.renderer === null) return null;
        const Renderer = rendererEntry.renderer;
        const box = placementToBox(descriptor.id, placement);
        return (
          <div
            className="gameplay-hud__widget"
            data-hud-widget={descriptor.id}
            data-renderer-availability={descriptor.rendererAvailability}
            key={descriptor.id}
            style={{
              height: `${box.height}px`,
              left: `${box.left}px`,
              top: `${box.top}px`,
              width: `${box.width}px`,
            }}
          >
            <Renderer
              box={box}
              placement={placement}
              resolvedPreset={resolvedPreset}
              settings={resolvedPreset.widgets[descriptor.id]}
              snapshot={snapshot}
              widgetId={descriptor.id}
            />
          </div>
        );
      })}
    </div>
  );
}
