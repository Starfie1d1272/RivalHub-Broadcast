// @vitest-environment jsdom

import { act, useState, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import { getBuiltinResolvedPreset } from '@rivalhub-broadcast/hud-config';

import { GameplayHud, themeStyle } from '../src/program/GameplayHud';
import { HudEditorOverlay } from '../src/program/HudEditorOverlay';
import { getProgramFixture } from '../src/program/fixtures';
import {
  assertHudRendererRegistryConsistency,
  HUD_RENDERER_REGISTRY,
  type HudRendererRegistry,
  type HudWidgetRendererProps,
} from '../src/program/hud-renderer-registry';
import { programPresentationBoundaryKey } from '../src/program/ProgramPage';

function childrenOf(element: ReturnType<typeof GameplayHud>): readonly unknown[] {
  if (element === null) throw new Error('HUD element should render');
  return (element as ReactElement<{ readonly children?: readonly unknown[] }>).props.children ?? [];
}

describe('GameplayHud shared renderer boundary', () => {
  let root: Root | undefined;

  afterEach(() => {
    if (root !== undefined) {
      act(() => root?.unmount());
      root = undefined;
    }
  });

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

  it('renders the implemented Match Header widgets while editor keeps the registry chrome', () => {
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
    expect(childrenOf(program).filter((child) => child !== null)).toHaveLength(5);
    expect(editor).toMatchObject({ props: { 'data-hud-editor-overlay': 'true' } });
    expect(childrenOf(editor)).toHaveLength(9);
    const preview = HudEditorOverlay({
      mode: 'preview',
      resolvedPreset,
      selectedWidgetId: null,
    });
    expect(childrenOf(preview)).toHaveLength(9);
  });

  it('adapts every resolved semantic field into theme-owned variables', () => {
    const style = themeStyle(getBuiltinResolvedPreset().theme) as Record<string, string | number>;
    expect(style).toMatchObject({
      '--rh-hud-brand': '#c8ef78',
      '--rh-hud-text-primary': '#f3f6fa',
      '--rh-hud-text-muted': '#aab4c0',
      '--rh-hud-side-ct': '#6aa8ff',
      '--rh-hud-side-t': '#f2bd4f',
      '--rh-hud-state-danger': '#f06f6f',
      '--rh-hud-state-warning': '#f3bd68',
      '--rh-hud-state-success': '#c8ef78',
      '--rh-hud-state-unknown': '#8d9aaa',
      '--rh-hud-objective-bomb': '#f06f6f',
      '--rh-hud-objective-defuse': '#83d8e8',
      '--rh-hud-surface-opacity': 0.88,
      '--rh-hud-border-opacity': 0.18,
      '--rh-hud-radius-sm': '4px',
      '--rh-hud-radius-md': '8px',
      '--rh-hud-radius-lg': '12px',
      '--rh-hud-font-family': 'Inter',
    });
  });

  it('keeps framework-neutral and Web renderer availability aligned', () => {
    expect(() => assertHudRendererRegistryConsistency()).not.toThrow();
    expect(
      Object.values(HUD_RENDERER_REGISTRY).filter((entry) => entry.renderer !== null),
    ).toHaveLength(5);
  });

  it('renders hook-based components through the same registry and resets only at the boundary key', () => {
    function HookRenderer({ snapshot }: HudWidgetRendererProps) {
      const [count, setCount] = useState(0);
      return (
        <button onClick={() => setCount((current) => current + 1)} type="button">
          {snapshot.cursor.runtimeSeq}:{count}
        </button>
      );
    }

    const registry: HudRendererRegistry = {
      ...HUD_RENDERER_REGISTRY,
      radar: { availability: 'implemented', renderer: HookRenderer },
    };
    const resolvedPreset = getBuiltinResolvedPreset();
    const snapshot = getProgramFixture('live-canonical');
    if (snapshot === null) throw new Error('fixture missing');
    const container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root?.render(
        <GameplayHud
          key="accepted:1"
          rendererRegistry={registry}
          resolvedPreset={resolvedPreset}
          snapshot={snapshot}
        />,
      );
    });
    const button = container.querySelector('button');
    expect(button?.textContent).toBe(`${snapshot.cursor.runtimeSeq}:0`);
    act(() => button?.click());
    expect(container.querySelector('button')?.textContent).toBe(`${snapshot.cursor.runtimeSeq}:1`);

    act(() => {
      root?.render(
        <GameplayHud
          key="accepted:1"
          rendererRegistry={registry}
          resolvedPreset={resolvedPreset}
          snapshot={{ ...snapshot, cursor: { ...snapshot.cursor, runtimeSeq: 43 } }}
        />,
      );
    });
    expect(container.querySelector('button')?.textContent).toBe('43:1');

    act(() => {
      root?.render(
        <GameplayHud
          key="accepted:2"
          rendererRegistry={registry}
          resolvedPreset={resolvedPreset}
          snapshot={snapshot}
        />,
      );
    });
    expect(container.querySelector('button')?.textContent).toBe(`${snapshot.cursor.runtimeSeq}:0`);

    const editor = HudEditorOverlay({
      rendererRegistry: registry,
      resolvedPreset,
      selectedWidgetId: null,
    });
    expect(childrenOf(editor).some((child) => child !== null)).toBe(true);
  });

  it('changes the presentation boundary for accepted cursor resets and fail-closed states', () => {
    const snapshot = getProgramFixture('live-canonical');
    if (snapshot === null) throw new Error('fixture missing');

    const accepted = programPresentationBoundaryKey(snapshot, 'live');
    expect(accepted).toContain(
      `${snapshot.cursor.producerInstanceId}:${snapshot.cursor.liveSessionId ?? 'unbound'}:${snapshot.cursor.programSourceGeneration}:${snapshot.cursor.mapEpoch}`,
    );
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
