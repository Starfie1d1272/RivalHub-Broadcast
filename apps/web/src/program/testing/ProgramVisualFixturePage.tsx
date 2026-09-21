import { useEffect, useState } from 'react';

import type { ProgramSnapshot } from '@rivalhub-broadcast/protocol/program';

import { ProgramCanvas } from '../ProgramCanvas';
import { GameplayHud } from '../GameplayHud';
import { getProgramFixture, getProgramFixtureProvenance } from '../fixtures';
import { ProgramFoundationProbe } from './ProgramFoundationProbe';
import { getBuiltinResolvedPreset } from '@rivalhub-broadcast/hud-config';

export function ProgramVisualFixturePage({ fixtureId }: { readonly fixtureId: string }) {
  const snapshot = getProgramFixture(fixtureId);
  if (snapshot === null) {
    return <ProgramVisualFixtureNotFound fixtureId={fixtureId} />;
  }

  return (
    <ProgramCanvas>
      <div
        style={{ display: 'contents' }}
        data-program-fixture-kind={getProgramFixtureProvenance(fixtureId)?.kind}
        data-program-fixture-id={fixtureId}
      >
        {fixtureId === 'player-rails-carryover' ? (
          <CarryoverVisualFixture snapshot={snapshot} />
        ) : (
          <>
            <GameplayHud resolvedPreset={getBuiltinResolvedPreset()} snapshot={snapshot} />
            <ProgramFoundationProbe fixtureId={fixtureId} snapshot={snapshot} />
          </>
        )}
      </div>
    </ProgramCanvas>
  );
}

function CarryoverVisualFixture({ snapshot }: { readonly snapshot: ProgramSnapshot }) {
  const carryoverSource = getProgramFixture('player-rails-freezetime');
  const [displayedSnapshot, setDisplayedSnapshot] = useState<ProgramSnapshot>(
    carryoverSource ?? snapshot,
  );

  useEffect(() => {
    const timer = window.setTimeout(() => setDisplayedSnapshot(snapshot), 50);
    return () => window.clearTimeout(timer);
  }, [snapshot]);

  return (
    <>
      <GameplayHud resolvedPreset={getBuiltinResolvedPreset()} snapshot={displayedSnapshot} />
      <ProgramFoundationProbe fixtureId="player-rails-carryover" snapshot={displayedSnapshot} />
    </>
  );
}

export function ProgramVisualFixtureNotFound({ fixtureId }: { readonly fixtureId: string | null }) {
  return (
    <main className="program-visual-not-found" data-visual-fixture-state="not-found">
      <section className="program-visual-not-found__panel">
        <h1>视觉测试场景不可用</h1>
        <p>
          {fixtureId === null
            ? '视觉测试路由需要指定场景 ID，且必须启用开发环境测试开关。'
            : `未注册 ID 为“${fixtureId}”的节目状态测试场景。`}
        </p>
      </section>
    </main>
  );
}
