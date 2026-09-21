// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { getProgramFixture } from '../src/program/fixtures';
import { PlayerCard } from '../src/program/widgets/player-rails/PlayerCard';
import { SUMMARY_HOLD_MS, TeamSummary } from '../src/program/widgets/player-rails/TeamSummary';
import {
  buildPlayerRailsPresentation,
  type TeamSummaryPresentation,
} from '../src/program/widgets/player-rails/presentation';

const summary = (money: number): TeamSummaryPresentation => ({
  side: 'CT',
  money,
  equip: 10_000,
  lossBonus: 1_400,
  utility: { smoke: 1, fire: 2, flash: 3, he: 4, decoy: 5 },
  lineupComplete: true,
  utilityAvailable: true,
});

describe('Player Rails summary lifecycle', () => {
  let root: Root | undefined;

  afterEach(() => {
    if (root !== undefined) {
      act(() => root?.unmount());
      root = undefined;
    }
    vi.useRealTimers();
  });

  it('holds the observed freezetime summary for five seconds across live snapshots', () => {
    vi.useFakeTimers();
    const container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root?.render(<TeamSummary phase="freezetime" side="CT" summary={summary(4_200)} />);
    });
    expect(container.querySelector('[data-summary-visible="true"]')).not.toBeNull();

    act(() => {
      root?.render(<TeamSummary phase="live" side="CT" summary={summary(1_000)} />);
    });
    expect(container.textContent).toContain('$1,000');
    expect(container.textContent).not.toContain('$4,200');
    expect(container.querySelector('[data-summary-visible="true"]')).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(SUMMARY_HOLD_MS - 1);
    });
    expect(container.querySelector('[data-summary-visible="true"]')).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(container.querySelector('[data-summary-visible="false"]')).not.toBeNull();
  });

  it('does not carry a summary into a direct live mount', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(<TeamSummary phase="live" side="CT" summary={summary(4_200)} />);
    });
    expect(container.querySelector('[data-summary-visible="true"]')).toBeNull();
  });

  it('clears the carryover when the presentation boundary remounts', () => {
    vi.useFakeTimers();
    const container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root?.render(<TeamSummary phase="freezetime" side="CT" summary={summary(4_200)} />);
    });
    act(() => {
      root?.render(<TeamSummary phase="live" side="CT" summary={summary(1_000)} />);
    });
    expect(container.querySelector('[data-summary-visible="true"]')).not.toBeNull();

    act(() => {
      root?.render(
        <TeamSummary key="new-boundary" phase="live" side="CT" summary={summary(1_000)} />,
      );
    });
    expect(container.querySelector('[data-summary-visible="true"]')).toBeNull();
  });

  it('clears carryover when an unknown phase interrupts the transition', () => {
    vi.useFakeTimers();
    const container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root?.render(<TeamSummary phase="freezetime" side="CT" summary={summary(4_200)} />);
    });
    act(() => {
      root?.render(<TeamSummary phase="live" side="CT" summary={summary(1_000)} />);
    });
    expect(container.querySelector('[data-summary-visible="true"]')).not.toBeNull();

    act(() => {
      root?.render(<TeamSummary phase="unknown" side="CT" summary={summary(900)} />);
    });
    expect(container.querySelector('[data-summary-visible="true"]')).toBeNull();

    act(() => {
      root?.render(<TeamSummary phase="live" side="CT" summary={summary(800)} />);
    });
    expect(container.querySelector('[data-summary-visible="true"]')).toBeNull();
  });
});

describe('Player Rails card presentation', () => {
  let root: Root | undefined;

  afterEach(() => {
    if (root !== undefined) {
      act(() => root?.unmount());
      root = undefined;
    }
  });

  it('keeps live armor, kit, and C4 owner equipment visible', () => {
    const snapshot = getProgramFixture('stress-long-labels');
    if (snapshot === null) throw new Error('fixture missing');
    const presentation = buildPlayerRailsPresentation(snapshot.payload);
    const carrier = presentation.ct.players.find(
      (player) => player.sourcePlayerId === 'stress-player-1',
    );
    if (carrier === undefined) throw new Error('carrier missing');

    const container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(<PlayerCard player={carrier} />);
    });

    expect(container.querySelector('[data-player-equipment="true"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="护甲"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="拆弹器"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="C4"]')).not.toBeNull();
  });

  it('keeps the dead structural row and renders unavailable spent as a single dash', () => {
    const snapshot = getProgramFixture('series-bo1');
    if (snapshot === null) throw new Error('fixture missing');
    const presentation = buildPlayerRailsPresentation(snapshot.payload);
    const player = presentation.ct.players[0];
    if (player === undefined) throw new Error('player missing');

    const container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(<PlayerCard player={{ ...player, roundMoneySpent: null }} />);
    });
    expect(container.querySelector('.player-rail__spent')?.textContent).toBe('—');
    expect(container.querySelector('.player-rail__spent')?.textContent).not.toBe('-—');

    act(() => {
      root?.render(<PlayerCard player={{ ...player, roundMoneySpent: 1_200 }} />);
    });
    expect(container.querySelector('.player-rail__spent')?.textContent).toBe('-$1,200');

    const dead = buildPlayerRailsPresentation(
      getProgramFixture('stress-long-labels')?.payload ?? snapshot.payload,
    ).ct.players.find((candidate) => candidate.mode === 'dead');
    if (dead === undefined) throw new Error('dead player missing');
    act(() => {
      root?.render(<PlayerCard player={dead} />);
    });
    expect(container.querySelector('[data-health-spacer="true"]')).not.toBeNull();
    expect(container.querySelector('.player-rail__dead-stats')).not.toBeNull();
    expect(container.querySelector('[data-player-equipment="true"]')).toBeNull();
  });

  it('renders unavailable dead ADR as a dash independently of the positive visual fixture', () => {
    const snapshot = getProgramFixture('stress-long-labels');
    if (snapshot === null) throw new Error('fixture missing');
    const dead = buildPlayerRailsPresentation(snapshot.payload).ct.players.find(
      (candidate) => candidate.mode === 'dead',
    );
    if (dead === undefined) throw new Error('dead player missing');

    const container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(<PlayerCard player={{ ...dead, liveAdr: null }} />);
    });

    expect(container.querySelector('.player-rail__dead-stats')?.textContent).toContain('ADR—');
  });

  it('uses the official fixed team utility asset set for both side mappings', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(<TeamSummary phase="freezetime" side="CT" summary={summary(4_200)} />);
    });

    expect(
      [...container.querySelectorAll('[data-utility] [data-asset-id]')].map((element) => [
        element.parentElement?.getAttribute('data-utility'),
        element.getAttribute('data-asset-id'),
      ]),
    ).toEqual([
      ['smoke', 'utility.smokegrenade'],
      ['fire', 'utility.incgrenade'],
      ['flash', 'utility.flashbang'],
      ['he', 'utility.hegrenade'],
      ['decoy', 'utility.decoy'],
    ]);
  });
});
