import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { adaptGsiPayload } from '../src/index.js';

const receive = { sequence: 1, receivedAt: '2026-09-22T00:00:00Z', receivedMonotonicMs: 0 };
describe('Radar effecttime normalization', () => {
  it.each(['0.000', '9.172', '20.250'])(
    'retains raw decimal %s without calculating remaining',
    (effecttime) => {
      const result = adaptGsiPayload(
        { grenades: { smoke: { type: 'smoke', effecttime, lifetime: '33.000' } } },
        receive,
      );
      if (!result.ok) throw new Error('Adaptation failed');
      expect(result.observation.telemetry.grenades?.[0]?.effectTimeSeconds).toBe(
        Number(effecttime),
      );
    },
  );
  it.each([null, {}, 4, 'NaN', 'Infinity', '', '9s'])(
    'fails closed for malformed %s',
    (effecttime) => {
      const result = adaptGsiPayload(
        { grenades: { smoke: { type: 'smoke', effecttime } } },
        receive,
      );
      if (!result.ok) throw new Error('Adaptation failed');
      expect(result.observation.telemetry.grenades?.[0]?.effectTimeSeconds).toBeUndefined();
      expect(
        result.diagnostics.entries.some((d) => d.path.endsWith('grenades.smoke.effecttime')),
      ).toBe(true);
    },
  );
  it('preserves real smoke effecttime and each inferno flame', () => {
    interface RawGrenade {
      readonly effecttime?: string;
      readonly flames?: Record<string, unknown>;
    }
    interface RawPayload {
      readonly grenades: Record<string, RawGrenade>;
    }
    interface RawFrame {
      readonly payload: RawPayload;
    }
    const frame = JSON.parse(
      readFileSync(
        new URL(
          '../../../fixtures/gsi/semantic/observer/rich-live-state/frames.jsonl',
          import.meta.url,
        ),
        'utf8',
      ).trim(),
    ) as RawFrame;
    const result = adaptGsiPayload(frame.payload, receive);
    if (!result.ok) throw new Error('Adaptation failed');
    let smokes = 0;
    let flames = 0;
    for (const g of result.observation.telemetry.grenades ?? []) {
      const raw = frame.payload.grenades[g.sourceEntityId];
      if (raw?.effecttime !== undefined) {
        expect(g.effectTimeSeconds).toBe(Number(raw.effecttime));
        smokes++;
      }
      if (raw?.flames) {
        expect(g.flames).toHaveLength(Object.keys(raw.flames).length);
        flames++;
      }
    }
    expect(smokes).toBeGreaterThan(1);
    expect(flames).toBeGreaterThan(0);
  });
});
