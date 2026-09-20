import type { CSSProperties } from 'react';

import {
  HUD_WIDGET_REGISTRY,
  placementToBox,
  type HudResolvedPreset,
} from '@rivalhub-broadcast/hud-config';
import type { ProgramSnapshot } from '@rivalhub-broadcast/protocol/program';

import './gameplay-hud.css';

export interface GameplayHudProps {
  readonly snapshot: ProgramSnapshot | null;
  readonly resolvedPreset: HudResolvedPreset;
}

export function themeStyle(theme: HudResolvedPreset['theme']): CSSProperties {
  return {
    '--rh-hud-brand': theme.brandColor,
    '--rh-hud-text': theme.semantic.colors.textPrimary,
    '--rh-hud-muted': theme.semantic.colors.textMuted,
    '--rh-hud-side-ct': theme.semantic.colors.sideCt,
    '--rh-hud-side-t': theme.semantic.colors.sideT,
    '--rh-hud-surface': theme.semantic.surface.primary,
    '--rh-hud-surface-strong': theme.semantic.surface.strong,
    '--rh-hud-surface-opacity': theme.semantic.surface.opacity,
    '--rh-hud-border-opacity': theme.semantic.surface.borderOpacity,
    '--rh-hud-radius-md': `${theme.semantic.radius.md}px`,
  } as CSSProperties;
}

export function GameplayHud({ snapshot, resolvedPreset }: GameplayHudProps) {
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
        if (descriptor.rendererAvailability === 'unimplemented') return null;
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
          />
        );
      })}
    </div>
  );
}
