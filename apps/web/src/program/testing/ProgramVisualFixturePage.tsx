import { useEffect, useState } from 'react';

import type { ProgramSnapshot } from '@rivalhub-broadcast/protocol/program';

import { ProgramCanvas } from '../ProgramCanvas';
import { GameplayHud } from '../GameplayHud';
import { getProgramFixture } from '../fixtures';
import { ProgramFoundationProbe } from './ProgramFoundationProbe';
import { getBuiltinResolvedPreset } from '@rivalhub-broadcast/hud-config';

export function ProgramVisualFixturePage({ fixtureId }: { readonly fixtureId: string }) {
  const snapshot = getProgramFixture(fixtureId);
  const carryoverSource =
    fixtureId === 'player-rails-carryover' ? getProgramFixture('series-bo1') : null;
  const [displayedSnapshot, setDisplayedSnapshot] = useState<ProgramSnapshot | null>(
    carryoverSource ?? snapshot,
  );

  useEffect(() => {
    if (carryoverSource === null || snapshot === null) return;
    const timer = window.setTimeout(() => setDisplayedSnapshot(snapshot), 50);
    return () => window.clearTimeout(timer);
  }, [carryoverSource, snapshot]);

  if (snapshot === null || displayedSnapshot === null) {
    return <ProgramVisualFixtureNotFound fixtureId={fixtureId} />;
  }

  return (
    <ProgramCanvas>
      <GameplayHud resolvedPreset={getBuiltinResolvedPreset()} snapshot={displayedSnapshot} />
      <ProgramFoundationProbe fixtureId={fixtureId} snapshot={displayedSnapshot} />
    </ProgramCanvas>
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
