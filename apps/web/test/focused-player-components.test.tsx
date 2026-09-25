// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { getProgramFixture } from '../src/program/fixtures';
import {
  buildFocusedPlayerPresentation,
  buildReserveAmmoPresentation,
} from '../src/program/widgets/focused-player/presentation';
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
    const player = {
      ...buildFocusedPlayerPresentation(getProgramFixture('focused-avatar')!.payload)!,
      observerSlot: 9,
    };
    const render = (p = player, key = 'boundary') => {
      act(() => {
        root!.render(<FocusedPlayerCard key={key} player={p} />);
      });
    };
    render();
    const media = () => container.querySelector<HTMLImageElement>('.focused-player__media img');
    expect(container.querySelector('[data-avatar="true"]')).toBeNull();
    expect(container.querySelector('.focused-player__observer-tile-number')?.textContent).toBe('0');
    expect(container.querySelector('.focused-player__media')?.getAttribute('aria-label')).toBe(
      'Observer hotkey 0',
    );
    act(() => {
      media()!.dispatchEvent(new Event('load'));
    });
    expect(container.querySelector('[data-avatar="true"]')).not.toBeNull();
    expect(container.querySelector('.focused-player__slot-badge')?.textContent).toBe('0');
    expect(container.querySelector('.focused-player__media')?.getAttribute('aria-label')).toBe(
      `${player.displayName} avatar, observer hotkey 0`,
    );
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
    expect(player.reserveMagazine).toMatchObject({
      count: 3,
      asset: { canonicalKey: 'ammo.magazine' },
    });
    expect(container.querySelector('[data-ammo-presentation="magazine"]')?.textContent).toBe('3');
    expect(container.querySelector('.focused-player__reserve-magazine-icon')).not.toBeNull();
    expect(container.textContent).not.toContain('MAG');
    act(() =>
      root!.render(
        <FocusedPlayerCard
          player={{
            ...player,
            activeItem: null,
            clip: null,
            clipFill: null,
            reserveText: null,
            reserveMagazine: null,
          }}
        />,
      ),
    );
    expect(container.querySelector('.focused-player__active [data-asset-id]')).toBeNull();
    expect(container.querySelector('.focused-player__reserve-magazine-icon')).toBeNull();
    expect(container.textContent).not.toContain('MAG');
    act(() => root!.render(<FocusedPlayerCard player={{ ...player, dead: true }} />));
    expect(container.textContent).not.toContain('DEAD');
    expect(container.querySelector('.focused-player__dead-state')).not.toBeNull();
    expect(container.querySelector('.focused-player__death-mark')).toBeNull();
    expect(container.querySelector('.focused-player__active')).toBeNull();
    expect(container.querySelector('.focused-player__ammo')).toBeNull();
    expect(container.querySelector('.focused-player__utility')).toBeNull();
    expect(container.querySelector('.focused-player__vitals')?.textContent).toBe('');
  });
  it('keeps shell and reserve-round counts textual and fails closed without the magazine icon', () => {
    const magazineAsset = { canonicalKey: 'ammo.magazine', outputPath: '/unused.svg' };
    expect(buildReserveAmmoPresentation('shells', 12, magazineAsset)).toEqual({
      reserveText: 'SHELL 12',
      reserveMagazine: null,
    });
    expect(buildReserveAmmoPresentation('reserve-rounds', 42, magazineAsset)).toEqual({
      reserveText: 'RDS 42',
      reserveMagazine: null,
    });
    expect(buildReserveAmmoPresentation('magazine', 3, null)).toEqual({
      reserveText: null,
      reserveMagazine: null,
    });
    expect(buildReserveAmmoPresentation('charge', 1, magazineAsset)).toEqual({
      reserveText: null,
      reserveMagazine: null,
    });
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
