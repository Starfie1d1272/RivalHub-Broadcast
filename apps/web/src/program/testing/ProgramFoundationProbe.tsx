import type { ProgramSnapshot } from '@rivalhub-broadcast/protocol/program';

import './ProgramFoundationProbe.css';

const TOKEN_SWATCHES = [
  '--rh-program-text',
  '--rh-program-muted',
  '--rh-program-surface',
  '--rh-program-surface-strong',
  '--rh-program-border',
  '--rh-program-ct',
  '--rh-program-t',
  '--rh-program-accent',
  '--rh-program-warning',
  '--rh-program-danger',
] as const;

function displayValue(value: string | number | null | undefined, emptyValue = '—'): string {
  return value === null || value === undefined || value === '' ? emptyValue : String(value);
}

function SampleValue({ value }: { readonly value: string | null | undefined }) {
  const empty = value === null || value === undefined || value === '';
  return (
    <span className="program-foundation-probe__sample-value" data-empty={empty}>
      {displayValue(value, 'No value in this fixture')}
    </span>
  );
}

export function ProgramFoundationProbe({
  fixtureId,
  snapshot,
}: {
  readonly fixtureId: string;
  readonly snapshot: ProgramSnapshot;
}) {
  const { payload } = snapshot;
  const firstPlayer = payload.players[0];

  return (
    <div
      className="program-foundation-probe"
      data-fixture-id={fixtureId}
      data-program-foundation-probe="true"
    >
      <span
        aria-hidden="true"
        className="program-foundation-probe__anchor program-foundation-probe__anchor--top-left"
      />
      <span
        aria-hidden="true"
        className="program-foundation-probe__anchor program-foundation-probe__anchor--top-right"
      />
      <span
        aria-hidden="true"
        className="program-foundation-probe__anchor program-foundation-probe__anchor--bottom-left"
      />
      <span
        aria-hidden="true"
        className="program-foundation-probe__anchor program-foundation-probe__anchor--bottom-right"
      />

      <header className="program-foundation-probe__header">
        <p className="program-foundation-probe__kicker">
          RivalHub Broadcast / test-only visual chart
        </p>
        <h1>Program presentation foundation</h1>
        <p>
          A projection-driven probe for the fixed logical canvas. It is deliberately not a Gameplay
          HUD, Radar, or production Program surface.
        </p>
      </header>

      <section className="program-foundation-probe__meta" aria-label="Program snapshot metadata">
        <div className="program-foundation-probe__meta-row">
          <span className="program-foundation-probe__meta-label">Fixture</span>
          <span className="program-foundation-probe__meta-value">
            <code>{fixtureId}</code>
          </span>
        </div>
        <div className="program-foundation-probe__meta-row">
          <span className="program-foundation-probe__meta-label">Canvas</span>
          <span className="program-foundation-probe__meta-value">1920 × 1080 logical pixels</span>
        </div>
        <div className="program-foundation-probe__meta-row">
          <span className="program-foundation-probe__meta-label">Status</span>
          <span className="program-foundation-probe__meta-value">
            {payload.status.telemetry} / {payload.status.context} / {payload.status.identity}
          </span>
        </div>
        <div className="program-foundation-probe__meta-row">
          <span className="program-foundation-probe__meta-label">Protocol cursor</span>
          <span className="program-foundation-probe__meta-value">
            seq {snapshot.cursor.runtimeSeq} · map epoch {snapshot.cursor.mapEpoch}
          </span>
        </div>
      </section>

      <section className="program-foundation-probe__tokens" aria-label="Program design tokens">
        <h2>Neutral presentation tokens</h2>
        <div className="program-foundation-probe__token-grid">
          {TOKEN_SWATCHES.map((tokenName) => (
            <div className="program-foundation-probe__token" key={tokenName}>
              <span
                aria-hidden="true"
                className="program-foundation-probe__token-swatch"
                style={{ backgroundColor: `var(${tokenName})` }}
              />
              <span className="program-foundation-probe__token-name">{tokenName}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="program-foundation-probe__sample" aria-label="Program snapshot sample">
        <h2>ProgramSnapshot sample</h2>
        <div className="program-foundation-probe__sample-row">
          <span className="program-foundation-probe__sample-label">Competition</span>
          <SampleValue value={payload.match?.competition.name} />
        </div>
        <div className="program-foundation-probe__sample-row">
          <span className="program-foundation-probe__sample-label">CT / T</span>
          <span className="program-foundation-probe__sample-value">
            {payload.teams.ct.name} <span aria-hidden="true">/</span> {payload.teams.t.name}
          </span>
        </div>
        <div className="program-foundation-probe__sample-row">
          <span className="program-foundation-probe__sample-label">Observed player</span>
          <SampleValue value={firstPlayer?.displayName} />
        </div>
        <div className="program-foundation-probe__sample-row">
          <span className="program-foundation-probe__sample-label">Map / clock</span>
          <span className="program-foundation-probe__sample-value">
            {displayValue(payload.map.name)} <span aria-hidden="true">/</span>{' '}
            {displayValue(payload.clock?.phase)}
          </span>
        </div>
      </section>

      <footer className="program-foundation-probe__footer">
        local fixture · no external assets
      </footer>
    </div>
  );
}
