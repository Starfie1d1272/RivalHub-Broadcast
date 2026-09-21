import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';

import { getBuiltinResolvedPreset } from '@rivalhub-broadcast/hud-config';

import { GameplayHud } from '../src/program/GameplayHud';
import { HudEditorOverlay } from '../src/program/HudEditorOverlay';
import { getProgramFixture } from '../src/program/fixtures';
import {
  assertHudRendererRegistryConsistency,
  HUD_RENDERER_REGISTRY,
} from '../src/program/hud-renderer-registry';
import { programPresentationBoundaryKey } from '../src/program/ProgramPage';

function childrenOf(element: ReturnType<typeof GameplayHud>): readonly unknown[] {
  if (element === null) throw new Error('HUD element should render');
  return (element as ReactElement<{ readonly children?: readonly unknown[] }>).props.children ?? [];
}

describe('GameplayHud shared renderer boundary', () => {
  it('fails closed for a missing or non-fresh Program snapshot', () => {
    const resolvedPreset = getBuiltinResolvedPreset();
    expect(
      GameplayHud({
        resolvedPreset,
        snapshot: null,
      }),
    ).toBeNull();
    expect(
      GameplayHud({
        resolvedPreset,
        snapshot: getProgramFixture('awaiting-neutral'),
      }),
    ).toBeNull();
  });

  it('keeps production output free of placeholder widgets while editor shows the registry', () => {
    const resolvedPreset = getBuiltinResolvedPreset();
    const snapshot = getProgramFixture('live-canonical');
    expect(snapshot).not.toBeNull();
    const program = GameplayHud({
      resolvedPreset,
      snapshot,
    });
    const editor = HudEditorOverlay({ resolvedPreset, selectedWidgetId: null });

    expect(program).toMatchObject({ props: { 'data-gameplay-hud': 'true' } });
    expect(childrenOf(program)).toHaveLength(9);
    expect(childrenOf(program).every((child) => child === null)).toBe(true);
    expect(editor).toMatchObject({ props: { 'data-hud-editor-overlay': 'true' } });
    expect(childrenOf(editor)).toHaveLength(9);
    const preview = HudEditorOverlay({
      mode: 'preview',
      resolvedPreset,
      selectedWidgetId: null,
    });
    expect(childrenOf(preview)).toHaveLength(9);
  });

  it('keeps framework-neutral and Web renderer availability aligned', () => {
    expect(() => assertHudRendererRegistryConsistency()).not.toThrow();
    expect(Object.values(HUD_RENDERER_REGISTRY).every((entry) => entry.renderer === null)).toBe(
      true,
    );
  });

  it('changes the presentation boundary for accepted cursor resets and fail-closed states', () => {
    const snapshot = getProgramFixture('live-canonical');
    if (snapshot === null) throw new Error('fixture missing');

    const accepted = programPresentationBoundaryKey(snapshot, 'live');
    expect(accepted).toContain('fixture-producer:fixture-session:1:1');
    expect(programPresentationBoundaryKey(snapshot, 'reconnecting')).toBe('fail-closed');
    expect(
      programPresentationBoundaryKey(
        { ...snapshot, cursor: { ...snapshot.cursor, mapEpoch: snapshot.cursor.mapEpoch + 1 } },
        'live',
      ),
    ).not.toBe(accepted);
    expect(
      programPresentationBoundaryKey(
        {
          ...snapshot,
          payload: {
            ...snapshot.payload,
            status: { ...snapshot.payload.status, telemetry: 'stale' },
          },
        },
        'live',
      ),
    ).toBe('fail-closed');
  });
});
