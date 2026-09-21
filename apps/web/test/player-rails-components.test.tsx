// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SUMMARY_HOLD_MS, TeamSummary } from '../src/program/widgets/player-rails/TeamSummary';
import type { TeamSummaryPresentation } from '../src/program/widgets/player-rails/presentation';

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
    expect(container.textContent).toContain('$4,200');
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
});
