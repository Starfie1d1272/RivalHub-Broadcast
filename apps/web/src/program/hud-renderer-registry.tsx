import type { ComponentType } from 'react';

import {
  HUD_WIDGET_IDS,
  HUD_WIDGET_REGISTRY,
  type HudResolvedPreset,
  type HudWidgetBox,
  type HudWidgetId,
  type HudWidgetPlacement,
  type HudWidgetSettings,
} from '@rivalhub-broadcast/hud-config';
import type { ProgramSnapshot } from '@rivalhub-broadcast/protocol/program';

import { RoundHistory, SeriesStrip, TopScoreBar } from './widgets/match-header';

export interface HudWidgetRendererProps {
  readonly snapshot: ProgramSnapshot;
  readonly resolvedPreset: HudResolvedPreset;
  readonly widgetId: HudWidgetId;
  readonly placement: HudWidgetPlacement;
  readonly box: HudWidgetBox;
  readonly settings: HudWidgetSettings;
}

export type HudWidgetRenderer = ComponentType<HudWidgetRendererProps>;

export interface HudRendererEntry {
  readonly availability: 'implemented' | 'unimplemented';
  readonly renderer: HudWidgetRenderer | null;
}

export type HudRendererRegistry = Readonly<Record<HudWidgetId, HudRendererEntry>>;

const UNIMPLEMENTED_RENDERER_ENTRY: HudRendererEntry = Object.freeze({
  availability: 'unimplemented',
  renderer: null,
});

const IMPLEMENTED_RENDERERS: Partial<Record<HudWidgetId, HudWidgetRenderer>> = {
  'top-score-bar': TopScoreBar,
  'series-strip': SeriesStrip,
  'round-history': RoundHistory,
};

/** Web-owned React seam. Future component Issues add their renderer here only. */
export const HUD_RENDERER_REGISTRY: HudRendererRegistry = Object.freeze(
  Object.fromEntries(
    HUD_WIDGET_IDS.map((id) => {
      const renderer = IMPLEMENTED_RENDERERS[id];
      return [
        id,
        renderer === undefined
          ? UNIMPLEMENTED_RENDERER_ENTRY
          : { availability: 'implemented' as const, renderer },
      ];
    }),
  ) as Record<HudWidgetId, HudRendererEntry>,
);

export function getHudRendererEntry(
  id: HudWidgetId,
  registry: HudRendererRegistry = HUD_RENDERER_REGISTRY,
): HudRendererEntry {
  const entry = registry[id];
  if (entry === undefined) throw new Error(`缺少 Web HUD renderer registry entry：${id}`);
  return entry;
}

/** Keep framework-neutral descriptor availability and Web renderer availability in lockstep. */
export function assertHudRendererRegistryConsistency(): void {
  for (const descriptor of HUD_WIDGET_REGISTRY) {
    const entry = getHudRendererEntry(descriptor.id);
    if (entry.availability !== descriptor.rendererAvailability) {
      throw new Error(`HUD renderer availability 不一致：${descriptor.id}`);
    }
    if ((entry.renderer === null) !== (entry.availability === 'unimplemented')) {
      throw new Error(`HUD renderer entry 状态不一致：${descriptor.id}`);
    }
  }
}

assertHudRendererRegistryConsistency();
