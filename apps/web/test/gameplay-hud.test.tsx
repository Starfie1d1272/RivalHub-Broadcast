import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';

import { getBuiltinResolvedPreset } from '@rivalhub-broadcast/hud-config';

import { GameplayHud } from '../src/program/GameplayHud';
import { getProgramFixture } from '../src/program/fixtures';

function childrenOf(element: ReturnType<typeof GameplayHud>): readonly unknown[] {
  if (element === null) throw new Error('HUD element should render');
  return (element as ReactElement<{ readonly children?: readonly unknown[] }>).props.children ?? [];
}

describe('GameplayHud shared renderer boundary', () => {
  it('fails closed for a missing or non-fresh Program snapshot', () => {
    const resolvedPreset = getBuiltinResolvedPreset();
    expect(
      GameplayHud({
        connectionState: 'live',
        mode: 'program',
        resolvedPreset,
        snapshot: null,
      }),
    ).toBeNull();
    expect(
      GameplayHud({
        connectionState: 'live',
        mode: 'program',
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
      connectionState: 'live',
      mode: 'program',
      resolvedPreset,
      snapshot,
    });
    const editor = GameplayHud({ mode: 'editor', resolvedPreset, snapshot });

    expect(program).toMatchObject({ props: { 'data-gameplay-hud': 'true' } });
    expect(childrenOf(program)).toHaveLength(9);
    expect(childrenOf(program).every((child) => child === null)).toBe(true);
    expect(editor).not.toBeNull();
    expect(childrenOf(editor)).toHaveLength(9);
  });
});
