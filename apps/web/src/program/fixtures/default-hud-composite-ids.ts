export const DEFAULT_HUD_COMPOSITE_FIXTURES = [
  'default-live-5v5',
  'default-avatar-present',
  'default-avatar-missing',
  'default-freezetime',
  'default-observed',
  'default-dead',
  'default-low-hp',
  'default-planted',
  'default-critical',
  'default-defusing',
  'default-timeout',
  'default-tech-pause',
  'default-halftime',
  'default-nuke-multifloor',
  'default-missing-logo',
] as const;

export type DefaultHudCompositeFixture = (typeof DEFAULT_HUD_COMPOSITE_FIXTURES)[number];
