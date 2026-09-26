import { z } from 'zod';

const entrant = z
  .object({ entryId: z.string().min(1), name: z.string(), logoUrl: z.string().nullable() })
  .strict();
export const bpProjectionSchema = z
  .object({
    matchId: z.string().min(1),
    competition: z.string(),
    stage: z.string(),
    format: z.enum(['bo1', 'bo3', 'bo5']),
    entrants: z.object({ a: entrant, b: entrant }).strict(),
    cards: z
      .array(
        z
          .object({
            mapName: z.string(),
            kind: z.enum(['ban', 'pick', 'decider']),
            entrant: z.enum(['a', 'b']).nullable(),
            startSides: z
              .object({ a: z.enum(['CT', 'T']), b: z.enum(['CT', 'T']) })
              .strict()
              .nullable(),
          })
          .strict(),
      )
      .min(1)
      .max(7),
    steps: z
      .array(
        z
          .object({
            cardIndex: z.number().int().min(0).max(6),
            kind: z.enum(['card', 'start-side']),
          })
          .strict(),
      )
      .min(1)
      .max(14),
  })
  .strict()
  .refine((p) => {
    if (
      p.entrants.a.entryId === p.entrants.b.entryId ||
      new Set(p.cards.map((c) => c.mapName)).size !== p.cards.length
    )
      return false;
    if (
      p.cards.some(
        (c) =>
          (c.kind === 'decider' ? c.entrant !== null : c.entrant === null) ||
          (c.startSides !== null && (c.kind === 'ban' || c.startSides.a === c.startSides.b)),
      )
    )
      return false;
    const cards = new Set<number>();
    const sides = new Set<number>();
    for (const step of p.steps) {
      const card = p.cards[step.cardIndex];
      if (!card) return false;
      if (step.kind === 'card') {
        if (cards.has(step.cardIndex)) return false;
        cards.add(step.cardIndex);
      } else {
        if (!cards.has(step.cardIndex) || sides.has(step.cardIndex) || card.startSides === null)
          return false;
        sides.add(step.cardIndex);
      }
    }
    return (
      cards.size === p.cards.length &&
      p.cards.every((card, index) => (card.startSides !== null) === sides.has(index))
    );
  });
export const bpSnapshotSchema = z
  .object({
    schemaVersion: z.literal('rivalhub.bp.v1'),
    revision: z.string().min(1),
    projection: bpProjectionSchema.nullable(),
    state: z.enum(['hidden', 'revealing', 'shown', 'hiding']),
    revealedCount: z.number().int().min(0).max(14),
  })
  .strict()
  .refine(
    (s) =>
      s.revealedCount <= (s.projection?.steps.length ?? 0) &&
      (s.projection !== null || s.state === 'hidden') &&
      (s.state !== 'hidden' || s.revealedCount === 0) &&
      (s.state === 'hidden' || s.revealedCount > 0) &&
      (s.state !== 'shown' || s.revealedCount === s.projection?.steps.length),
  );
export type BpSnapshot = z.infer<typeof bpSnapshotSchema>;
export type BpProjection = z.infer<typeof bpProjectionSchema>;
