// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { getProgramFixture } from '../src/program/fixtures';
import { buildFocusedPlayerPresentation } from '../src/program/widgets/focused-player/presentation';
import { FocusedPlayerCard } from '../src/program/widgets/focused-player/FocusedPlayer';
import { TopScoreBar } from '../src/program/widgets/match-header/TopScoreBar';
import { getBuiltinResolvedPreset, placementToBox } from '@rivalhub-broadcast/hud-config';

const BUILTIN_RESOLVED_PRESET = getBuiltinResolvedPreset();
let root: Root | undefined;
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
});
function host() {
  const container = document.createElement('div');
  root = createRoot(container);
  return container;
}
describe('Focused media and combat presentation lifecycle', () => {
  it('loads optional media, hides failed image without retry, resets on player/URL/boundary', () => {
    const container = host();
    const player = buildFocusedPlayerPresentation(getProgramFixture('focused-avatar')!.payload)!;
    const render = (p = player, key = 'boundary') => {
      act(() => {
        root!.render(<FocusedPlayerCard key={key} player={p} />);
      });
    };
    render();
    const media = () => container.querySelector<HTMLImageElement>('.focused-player__media img');
    expect(container.querySelector('[data-avatar="true"]')).toBeNull();
    act(() => {
      media()!.dispatchEvent(new Event('load'));
    });
    expect(container.querySelector('[data-avatar="true"]')).not.toBeNull();
    act(() => {
      media()!.dispatchEvent(new Event('error'));
    });
    expect(media()).toBeNull();
    render();
    expect(media()).toBeNull();
    render({ ...player, sourcePlayerId: 'next' });
    expect(media()).not.toBeNull();
    act(() => {
      media()!.dispatchEvent(new Event('error'));
    });
    render({ ...player, sourcePlayerId: 'next', avatarUrl: `${player.avatarUrl}#new` });
    expect(media()).not.toBeNull();
    act(() => {
      media()!.dispatchEvent(new Event('error'));
    });
    render(player, 'new-boundary');
    expect(media()).not.toBeNull();
    render({ ...player, avatarUrl: null });
    expect(media()).toBeNull();
  });
  it('keeps the fixed avatar slot while removing team identity duplication', () => {
    const container = host();
    const player = buildFocusedPlayerPresentation(getProgramFixture('focused-long-name')!.payload)!;
    act(() => root!.render(<FocusedPlayerCard player={player} />));
    expect(container.querySelector('[data-avatar-slot="true"]')).not.toBeNull();
    expect(container.querySelector('.focused-player__team-logo')).toBeNull();
    expect(container.textContent).not.toContain(player.teamName);
    expect(container.textContent).toContain(player.displayName);
  });
  it('clears weapon/ammo on missing evidence or death without retaining old icon', () => {
    const container = host();
    const player = buildFocusedPlayerPresentation(getProgramFixture('real-live-rich')!.payload)!;
    act(() => root!.render(<FocusedPlayerCard player={player} />));
    expect(container.textContent).toContain('MAG ×3');
    act(() =>
      root!.render(
        <FocusedPlayerCard
          player={{ ...player, activeItem: null, clip: null, clipFill: null, reserveText: null }}
        />,
      ),
    );
    expect(container.querySelector('.focused-player__active [data-asset-id]')).toBeNull();
    expect(container.textContent).not.toContain('MAG');
    act(() => root!.render(<FocusedPlayerCard player={{ ...player, dead: true }} />));
    expect(container.textContent).toContain('DEAD');
    expect(container.querySelector('.focused-player__utility')).toBeNull();
    expect(container.querySelector('.focused-player__vitals')).toBeNull();
  });
  it('renders completed ADR and partial KAD independently', () => {
    const container = host();
    const player = buildFocusedPlayerPresentation(getProgramFixture('real-live-rich')!.payload)!;
    act(() =>
      root!.render(
        <FocusedPlayerCard
          player={{
            ...player,
            completedAdr: 82.25,
            stats: { kills: null, assists: 4, deaths: 11 },
          }}
        />,
      ),
    );
    expect(container.querySelector('.focused-player__metrics')?.textContent).toBe('K—A4D11ADR82.3');
  });
  it('objective defaults never reveal exact objective seconds, and phase fallback has no fake dual tracks', () => {
    const container = host();
    for (const id of [
      'real-planting',
      'real-planted',
      'real-defusing',
      'objective-dual-progress-edge',
    ]) {
      const snapshot = getProgramFixture(id)!;
      const placement = BUILTIN_RESOLVED_PRESET.layout.widgets['top-score-bar'];
      act(() =>
        root!.render(
          <TopScoreBar
            snapshot={snapshot}
            resolvedPreset={BUILTIN_RESOLVED_PRESET}
            widgetId="top-score-bar"
            placement={placement}
            box={placementToBox('top-score-bar', placement)}
            settings={BUILTIN_RESOLVED_PRESET.widgets['top-score-bar']}
          />,
        ),
      );
      expect(container.querySelector('.objective-center')?.textContent).not.toMatch(/\d+\.\d|\d+s/);
    }
  });
});
