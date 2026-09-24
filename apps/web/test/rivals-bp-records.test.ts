import { describe, expect, it } from 'vitest';

import { RIVALS_BP_RECORDS, rivalsSeriesCut } from '../src/program/fixtures/rivals-bp-records';
import { getProgramFixture } from '../src/program/fixtures';
import { buildMatchHeaderPresentation } from '../src/program/widgets/match-header/presentation';

describe('Rivals BP preview records', () => {
  it('keeps each picked map tied to its source veto and never assigns a picker to a decider', () => {
    for (const record of Object.values(RIVALS_BP_RECORDS)) {
      expect(record.veto).toHaveLength(7);
      expect(record.entrants.a.logoUrl).toContain('/storage/v1/object/public/team-logos/');
      expect(record.entrants.b.logoUrl).toContain('/storage/v1/object/public/team-logos/');
      for (const map of record.maps) {
        const step = record.veto.find((candidate) => candidate.mapName === map.mapName);
        expect(step).toBeDefined();
        expect(step?.actionType).toBe(map.selection.kind);
        if (map.selection.kind === 'pick') {
          expect(map.selection.entryId).toBe(step?.entryId);
          expect(map.teamAStartSide).not.toBeNull();
        }
        if (map.selection.kind === 'decider') expect(map.winnerEntryId).toBeNull();
      }
    }
  });

  it('derives the final map-four cut from recorded results without revealing future scores', () => {
    const cut = rivalsSeriesCut(RIVALS_BP_RECORDS.final, 4);
    expect(cut.score).toEqual({ a: 2, b: 1 });
    expect(cut.maps.map((map) => map.status)).toEqual([
      'completed',
      'completed',
      'completed',
      'current',
      'pending',
    ]);
    expect(cut.maps[3]?.finalScore).toBeNull();
    expect(cut.maps[4]?.teamAStartSide).toBeNull();
    const rendered = getProgramFixture('bp-rivals-final-map4');
    if (rendered === null) throw new Error('final preview missing');
    const maps = buildMatchHeaderPresentation(rendered.payload).seriesMaps;
    expect(maps?.[0]).toMatchObject({ statusText: '4–13', pickOutcome: 'loss', picker: 'b' });
    expect(maps?.[1]).toMatchObject({ statusText: '13–1', pickOutcome: 'win', picker: 'a' });
    expect(maps?.[2]).toMatchObject({ statusText: '13–9', pickOutcome: 'win', picker: 'b' });
  });

  it('keeps the recorded unplayed decider and the side choice in the other semifinal', () => {
    const final = rivalsSeriesCut(RIVALS_BP_RECORDS.final, null);
    expect(final.score).toEqual({ a: 3, b: 1 });
    expect(final.maps[4]).toMatchObject({
      status: 'not_played',
      finalScore: null,
      teamAStartSide: null,
    });
    const semi = rivalsSeriesCut(RIVALS_BP_RECORDS.semifinalA, null);
    expect(semi.score).toEqual({ a: 0, b: 2 });
    expect(semi.maps[2]).toMatchObject({ selection: { kind: 'decider' }, teamAStartSide: 'CT' });
  });
});
