import { describe, expect, it } from 'vitest';

import { getProgramFixture } from '../src/program/fixtures';
import {
  buildMatchHeaderPresentation,
  formatMatchHeaderScore,
} from '../src/program/widgets/match-header/presentation';

function presentation(fixtureId: string) {
  const snapshot = getProgramFixture(fixtureId);
  if (snapshot === null) throw new Error(`fixture missing: ${fixtureId}`);
  return buildMatchHeaderPresentation(snapshot.payload);
}

describe('Match Header presentation selector', () => {
  it('keeps canonical entrants left/right while joining current side facts by entryId', () => {
    const normal = presentation('live-canonical');
    expect(normal.currentSideMapping).toBe('resolved');
    expect(normal.teamA).toMatchObject({
      name: 'Northstar',
      side: 'CT',
      mapScore: 7,
      timeoutsRemaining: 1,
      seriesScore: 1,
    });
    expect(normal.teamB).toMatchObject({
      name: 'Southpoint',
      side: 'T',
      mapScore: 5,
      timeoutsRemaining: 2,
      seriesScore: 0,
    });

    const swapped = presentation('series-halftime-swap');
    expect(swapped.teamA).toMatchObject({ name: 'Northstar', side: 'T', mapScore: 7 });
    expect(swapped.teamB).toMatchObject({ name: 'Southpoint', side: 'CT', mapScore: 5 });
  });

  it('fails closed for side-owned facts when canonical mapping is unavailable', () => {
    const value = presentation('series-mapping-unavailable');
    expect(value.currentSideMapping).toBe('unavailable');
    expect(value.teamA).toMatchObject({ name: 'Northstar', side: null, mapScore: null });
    expect(value.teamB).toMatchObject({ name: 'Southpoint', side: null, mapScore: null });
    expect(value.timeoutPanel).toMatchObject({
      owner: null,
      ownerName: null,
      remaining: 1,
      clockText: '0:22',
    });
  });

  it('resolves timeout ownership only after the same entryId join', () => {
    const value = presentation('series-timeout-b');
    expect(value.timeoutPanel).toMatchObject({
      owner: 'b',
      ownerName: 'Southpoint',
      remaining: 2,
      clockText: '0:22',
    });
  });

  it('covers entrant A tactical timeout facts with the canonical series', () => {
    expect(presentation('series-timeout-a').timeoutPanel).toMatchObject({
      owner: 'a',
      ownerName: 'Northstar',
      remaining: 1,
      clockText: '0:22',
    });
  });

  it('keeps objective phases free of donor countdown reconstruction', () => {
    const planted = presentation('bomb-planted');
    expect(planted.phaseLabel).toBe('C4 已安装');
    expect(planted.clockText).toBeNull();

    const defusing = presentation('bomb-defusing');
    expect(defusing.phaseLabel).toBe('正在拆弹');
    expect(defusing.clockText).toBeNull();

    const paused = presentation('series-paused');
    expect(paused.phaseLabel).toBe('比赛暂停');
    expect(paused.clockText).toBeNull();
  });

  it('renders the frozen map status and BO5 density model from Program series truth', () => {
    const value = presentation('series-bo5');
    expect(value.bestOfLabel).toBe('BO5');
    expect(value.seriesMaps).toHaveLength(5);
    expect(value.seriesMaps?.map((map) => map.statusText)).toEqual([
      '13 : 11',
      '8 : 13',
      '当前',
      '未开始',
      '未开始',
    ]);
    expect(value.seriesMaps?.[0]).toMatchObject({ selectionText: 'Northstar 选择' });
    expect(value.seriesMaps?.[2]).toMatchObject({ selectionText: '' });
    expect(value.seriesMaps?.[4]).toMatchObject({ selectionText: '决胜图' });
  });

  it('covers the frozen BO3 Map 1, not-played, and logo availability fixtures', () => {
    expect(presentation('series-bo3-map1').seriesMaps?.[0]).toMatchObject({
      mapName: 'Ancient',
      status: 'current',
      selectionText: 'Northstar 选择',
    });
    expect(
      presentation('series-not-played').seriesMaps?.some((map) => map.status === 'not_played'),
    ).toBe(true);
    expect(presentation('series-logo-mixed').teamA.logoUrl).toBe(
      'https://example.test/assets/northstar.svg',
    );
    expect(presentation('series-logo-mixed').teamB.logoUrl).toBeNull();
  });

  it('does not render a production placeholder when roundNumber is unavailable', () => {
    expect(presentation('series-round-unavailable').roundLabel).toBeNull();
  });

  it('keeps dense overtime history bounded to the fixed widget model', () => {
    expect(presentation('series-overtime-history').roundHistory?.rounds).toHaveLength(36);
  });

  it('fills partial history gaps without inventing a winner and hides unavailable history', () => {
    const partial = presentation('series-partial-history');
    expect(partial.roundHistory?.completeness).toBe('partial');
    expect(partial.roundHistory?.rounds.map((round) => round.state)).toEqual([
      'missing',
      'missing',
      'known',
      'missing',
      'known',
    ]);
    expect(partial.roundHistory?.rounds[4]).toMatchObject({ winner: 'b', winnerSide: 'unknown' });
    expect(presentation('series-history-unavailable').roundHistory).toBeNull();
  });

  it('uses a neutral CT/T fallback only when there is no canonical series', () => {
    const value = presentation('live-neutral');
    expect(value.currentSideMapping).toBe('neutral');
    expect(value.teamA).toMatchObject({ name: 'CT', entryId: null, side: 'CT', mapScore: 3 });
    expect(value.teamB).toMatchObject({ name: 'T', entryId: null, side: 'T', mapScore: 2 });
    expect(value.seriesMaps).toBeNull();
  });

  it('keeps fixed-width numeric fallback text explicit', () => {
    expect(formatMatchHeaderScore(null)).toBe('—');
    expect(formatMatchHeaderScore(0)).toBe('0');
  });
});
