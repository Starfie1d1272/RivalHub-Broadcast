import type { MatchContext } from '../match-context/index.js';
import { canonicalizeCs2MapName } from '../map-name.js';

export interface BpProjection {
  readonly matchId: string;
  readonly competition: string;
  readonly stage: string;
  readonly format: 'bo1' | 'bo3' | 'bo5';
  readonly entrants: { readonly a: BpEntrant; readonly b: BpEntrant };
  readonly cards: readonly BpCard[];
  readonly steps: readonly BpStep[];
}
export interface BpEntrant {
  readonly entryId: string;
  readonly name: string;
  readonly logoUrl: string | null;
}
export interface BpCard {
  readonly mapName: string;
  readonly kind: 'ban' | 'pick' | 'decider';
  readonly entrant: 'a' | 'b' | null;
  readonly startSides: { readonly a: 'CT' | 'T'; readonly b: 'CT' | 'T' } | null;
}
export interface BpStep {
  readonly cardIndex: number;
  readonly kind: 'card' | 'start-side';
}
const opposite = (side: 'CT' | 'T') => (side === 'CT' ? 'T' : 'CT');
const mapKey = (name: string) => canonicalizeCs2MapName(name) ?? name.trim().toLowerCase();

/** Finite presentation of canonical veto facts; no gameplay or provider state. */
export function projectBp(context: MatchContext | undefined): BpProjection | null {
  if (
    !context ||
    context.veto.length === 0 ||
    context.veto.length > 32 ||
    context.entrants.a.entryId === context.entrants.b.entryId
  )
    return null;
  const entrant = (id: string | null) =>
    id === context.entrants.a.entryId
      ? ('a' as const)
      : id === context.entrants.b.entryId
        ? ('b' as const)
        : null;
  const veto = [...context.veto].sort((a, b) => a.stepOrder - b.stepOrder);
  if (new Set(veto.map((v) => v.stepOrder)).size !== veto.length) return null;
  const cards: BpCard[] = [];
  const steps: BpStep[] = [];
  for (const v of veto) {
    const name = mapKey(v.mapName);
    if (v.actionType === 'side_pick') {
      const index = cards.findIndex((c) => c.mapName === name && c.kind !== 'ban');
      const owner = entrant(v.entryId);
      if (
        index < 0 ||
        owner === null ||
        v.side === null ||
        steps.some((s) => s.cardIndex === index && s.kind === 'start-side')
      )
        return null;
      const a = owner === 'a' ? v.side : opposite(v.side);
      const existing = cards[index]!.startSides;
      if (existing !== null && existing.a !== a) return null;
      cards[index] = { ...cards[index]!, startSides: { a, b: opposite(a) } };
      steps.push({ cardIndex: index, kind: 'start-side' });
      continue;
    }
    if (cards.length >= 7 || cards.some((c) => c.mapName === name)) return null;
    const owner = v.actionType === 'decider' ? null : entrant(v.entryId);
    if (v.actionType !== 'decider' && owner === null) return null;
    const map = context.maps.find((m) => mapKey(m.mapName) === name);
    const side = v.actionType === 'ban' ? null : (map?.teamAStartSide ?? null);
    const index = cards.length;
    cards.push({
      mapName: name,
      kind: v.actionType,
      entrant: owner,
      startSides: side === null ? null : { a: side, b: opposite(side) },
    });
    steps.push({ cardIndex: index, kind: 'card' });
    // Embedded pick.side is not a side-choice owner. Only canonical map sides
    // or an explicit side_pick can establish starting sides.
    if (
      side !== null &&
      !veto.some((s) => s.actionType === 'side_pick' && mapKey(s.mapName) === name)
    ) {
      steps.push({ cardIndex: index, kind: 'start-side' });
    }
  }
  const team = (key: 'a' | 'b'): BpEntrant => {
    const { entryId, name, logoUrl } = context.entrants[key];
    return { entryId, name, logoUrl };
  };
  return {
    matchId: context.matchId,
    competition: context.competition.name,
    stage: context.stage,
    format: context.format,
    entrants: { a: team('a'), b: team('b') },
    cards,
    steps,
  };
}
