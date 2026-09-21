import type { ReactNode } from 'react';

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

export interface HudWidgetRendererProps {
  readonly snapshot: ProgramSnapshot;
  readonly resolvedPreset: HudResolvedPreset;
  readonly widgetId: HudWidgetId;
  readonly placement: HudWidgetPlacement;
  readonly box: HudWidgetBox;
  readonly settings: HudWidgetSettings;
}

export type HudWidgetRenderer = (props: HudWidgetRendererProps) => ReactNode;

export interface HudRendererEntry {
  readonly availability: 'implemented' | 'unimplemented';
  readonly renderer: HudWidgetRenderer | null;
}

const UNIMPLEMENTED_RENDERER_ENTRY: HudRendererEntry = Object.freeze({
  availability: 'unimplemented',
  renderer: null,
});

/** Web-owned React seam. Future component Issues add their renderer here only. */
export const HUD_RENDERER_REGISTRY: Readonly<Record<HudWidgetId, HudRendererEntry>> = Object.freeze(
  Object.fromEntries(HUD_WIDGET_IDS.map((id) => [id, UNIMPLEMENTED_RENDERER_ENTRY])) as Record<
    HudWidgetId,
    HudRendererEntry
  >,
);

export function getHudRendererEntry(id: HudWidgetId): HudRendererEntry {
  const entry = HUD_RENDERER_REGISTRY[id];
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
