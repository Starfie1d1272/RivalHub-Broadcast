import { describe, expect, it } from 'vitest';

import { SurfacePage, surfaceDefinitions, surfaceForPath } from '../src/App';

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

    expect(page.type).toBe('main');
    expect(page.props['data-surface']).toBe('debug');
  });
});
