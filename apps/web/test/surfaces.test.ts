import { describe, expect, it } from 'vitest';

import { SurfacePage, surfaceDefinitions, surfaceForPath } from '../src/App';
import { parseDebugRuntimeResponse } from '../src/debug/runtime';

describe('web surface shell', () => {
  it.each([
    ['/program', 'program'],
    ['/operator', 'operator'],
    ['/debug', 'debug'],
  ] as const)('maps %s to the %s surface', (pathname, expectedId) => {
    expect(surfaceForPath(pathname).id).toBe(expectedId);
  });

  it('renders a surface-owned React page element', () => {
    const page = SurfacePage({ surface: surfaceDefinitions[2] });

    expect(page).toMatchObject({
      type: 'main',
      props: { 'data-surface': 'debug' },
    });
  });

  it('accepts the bounded awaiting debug shape', () => {
    expect(
      parseDebugRuntimeResponse({
        producerInstanceId: 'producer-1',
        sourceGeneration: 0,
        freshness: 'awaiting',
        raw: { current: null },
        normalized: { current: null },
        runtime: { current: {}, lastDisposition: null },
        recentTransitions: [],
        latestGsiDiagnostics: null,
        recentRuntimeDiagnostics: [],
        recorderHealth: { state: 'recording' },
        deliveryHealth: [],
      }),
    ).toMatchObject({ freshness: 'awaiting', sourceGeneration: 0 });
  });

  it('rejects a response missing required debug fields instead of guessing state', () => {
    expect(parseDebugRuntimeResponse({ freshness: 'fresh' })).toBeUndefined();
  });
});
