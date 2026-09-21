import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  BUILTIN_LAYOUT_ID,
  BUILTIN_PRESET_ID,
  HUD_CANVAS_HEIGHT,
  HUD_CANVAS_WIDTH,
  HUD_GRID_SIZE,
  HUD_WIDGET_IDS,
  canonicalJson,
  createDefaultHudConfigDocument,
  defineHudWidgetDescriptor,
  getBuiltinLayout,
  getBuiltinPreset,
  getBuiltinResolvedPreset,
  getBuiltinTheme,
  getHudWidgetDescriptor,
  moveWidgetPlacement,
  parseHudConfigDocument,
  parseHudLayout,
  parseHudPreset,
  parseHudResolvedPreset,
  placementToBox,
  normalizeHudPlacement,
  resetLayoutDraft,
  resolveActiveHudPreset,
  resolveHudPreset,
  resolveHudTheme,
  resizeRadarPlacement,
  snapToGrid,
} from '../src/index.js';

describe('hud-config schema and framework contract', () => {
  it('provides a complete immutable-by-convention built-in registry', () => {
    const preset = getBuiltinPreset();
    const layout = getBuiltinLayout();

    expect(preset.id).toBe(BUILTIN_PRESET_ID);
    expect(layout.id).toBe(BUILTIN_LAYOUT_ID);
    expect(Object.keys(layout.widgets).sort()).toEqual([...HUD_WIDGET_IDS].sort());
    expect(layout.widgets.radar.size).toEqual({ width: 320, height: 320 });
    expect(
      HUD_WIDGET_IDS.every((id) => {
        const box = placementToBox(id, layout.widgets[id]);
        return (
          box.left >= 0 &&
          box.top >= 0 &&
          box.left + box.width <= HUD_CANVAS_WIDTH &&
          box.top + box.height <= HUD_CANVAS_HEIGHT
        );
      }),
    ).toBe(true);

    const changed = getBuiltinLayout();
    changed.widgets.radar.offsetX = 100;
    expect(getBuiltinLayout().widgets.radar.offsetX).toBe(0);
  });

  it('round-trips a strict v1 document and rejects unknown fields', () => {
    const document = createDefaultHudConfigDocument();
    expect(parseHudConfigDocument(JSON.parse(JSON.stringify(document)))).toEqual(document);
    expect(() => parseHudConfigDocument({ ...document, futureField: true })).toThrow();
    expect(() =>
      parseHudConfigDocument({ ...document, customLayouts: [getBuiltinLayout()] }),
    ).toThrow();
    expect(() => parseHudResolvedPreset({ ...getBuiltinResolvedPreset(), widgets: {} })).toThrow();
    expect(
      parseHudResolvedPreset({
        ...getBuiltinResolvedPreset(),
        theme: {
          ...getBuiltinResolvedPreset().theme,
          semantic: {
            ...getBuiltinResolvedPreset().theme.semantic,
            colors: {
              ...getBuiltinResolvedPreset().theme.semantic.colors,
              textPrimary: '#ffffff',
            },
          },
        },
      }).theme.semantic.colors.textPrimary,
    ).toBe('#ffffff');
    expect(() =>
      parseHudResolvedPreset({
        ...getBuiltinResolvedPreset(),
        theme: {
          ...getBuiltinResolvedPreset().theme,
          semantic: {
            ...getBuiltinResolvedPreset().theme.semantic,
            surface: { ...getBuiltinResolvedPreset().theme.semantic.surface, opacity: 2 },
          },
        },
      }),
    ).toThrow();
    expect(() =>
      parseHudLayout({
        ...getBuiltinLayout(),
        widgets: {
          ...getBuiltinLayout().widgets,
          radar: { ...getBuiltinLayout().widgets.radar, width: 10 },
        },
      }),
    ).toThrow();
    expect(() =>
      parseHudLayout({
        ...getBuiltinLayout(),
        widgets: {
          ...getBuiltinLayout().widgets,
          radar: { ...getBuiltinLayout().widgets.radar, offsetX: 1_000 },
        },
      }),
    ).toThrow();
  });

  it('keeps gameplay semantic colours fixed while resolving user appearance controls', () => {
    const standard = resolveHudTheme(getBuiltinTheme());
    const light = resolveHudTheme({
      schemaVersion: 1,
      id: 'theme-1',
      name: '测试外观',
      brandColor: '#ff00aa',
      panelStyle: 'light',
      cornerStyle: 'rounded',
    });

    expect(standard.semantic.colors.sideCt).toBe('#6aa8ff');
    expect(light.semantic.colors.sideT).toBe('#f2bd4f');
    expect(light.semantic.colors.stateDanger).toBe('#f06f6f');
    expect(light.semantic.surface.opacity).toBeLessThan(1);
    expect(light.semantic.radius.lg).toBeGreaterThan(0);
  });

  it('keeps a valid custom activation snapshot across a recipe change', () => {
    const layout = { ...getBuiltinLayout(), id: 'custom-layout', name: '现场布局' };
    const theme = { ...getBuiltinTheme(), id: 'custom-theme', name: '现场外观' };
    const preset = {
      ...getBuiltinPreset(),
      id: 'custom-preset',
      name: '现场预设',
      layoutId: layout.id,
      themeId: theme.id,
    };
    const activated = resolveHudPreset(preset, layout, theme);
    const oldOnAirSnapshot = {
      ...activated,
      theme: {
        ...activated.theme,
        semantic: {
          ...activated.theme.semantic,
          colors: { ...activated.theme.semantic.colors, textPrimary: '#ffffff' },
          surface: { ...activated.theme.semantic.surface, opacity: 0.61 },
        },
      },
    };
    const document = {
      ...createDefaultHudConfigDocument(),
      customLayouts: [layout],
      customThemes: [theme],
      customPresets: [preset],
      activePreset: { kind: 'custom' as const, sourceId: preset.id, snapshot: oldOnAirSnapshot },
    };

    const parsed = parseHudConfigDocument(document);
    expect(resolveActiveHudPreset(parsed).theme.semantic.colors.textPrimary).toBe('#ffffff');
    expect(resolveActiveHudPreset(parsed).theme.semantic.surface.opacity).toBe(0.61);
    expect(resolveHudPreset(preset, layout, theme).theme.semantic.colors.textPrimary).toBe(
      '#f3f6fa',
    );
  });

  it('lets a future descriptor own a non-default variant while current widgets stay fail-closed', () => {
    const futureDescriptor = defineHudWidgetDescriptor({
      id: 'radar',
      label: '雷达',
      rendererAvailability: 'implemented',
      supportedVariants: ['default', 'compact'] as const,
      defaultVariant: 'compact',
      resizePolicy: 'square',
      defaultPlacement: getBuiltinLayout().widgets.radar,
      settingsSchema: (value: unknown) =>
        z
          .object({ density: z.literal('tight') })
          .strict()
          .parse(value),
    });

    expect(
      futureDescriptor.validateSettings({ variant: 'compact', settings: { density: 'tight' } }),
    ).toEqual({ variant: 'compact', settings: { density: 'tight' } });
    expect(() =>
      getHudWidgetDescriptor('radar').validateSettings({ variant: 'compact', settings: {} }),
    ).toThrow();
    expect(() =>
      parseHudPreset({
        ...getBuiltinPreset(),
        widgets: {
          ...getBuiltinPreset().widgets,
          radar: { variant: 'compact', settings: {} },
        },
      }),
    ).toThrow();
    expect(() =>
      defineHudWidgetDescriptor({
        ...futureDescriptor,
        defaultVariant: 'missing',
        settingsSchema: () => ({}),
      }),
    ).toThrow();
  });

  it('resets a custom layout without changing its identity', () => {
    const custom = { ...getBuiltinLayout(), id: 'custom-layout', name: '现场布局' };
    custom.widgets.radar.offsetX = 111;
    const reset = resetLayoutDraft(custom);
    expect(reset.id).toBe('custom-layout');
    expect(reset.name).toBe('现场布局');
    expect(reset.widgets.radar.offsetX).toBe(0);
  });
});

describe('hud-config logical geometry', () => {
  it('uses logical pixels and clamps dragged boxes to the canvas', () => {
    const placement = getBuiltinLayout().widgets.radar;
    const moved = moveWidgetPlacement('radar', placement, -10_000, 10_000);
    const box = placementToBox('radar', moved);

    expect(box.left).toBe(0);
    expect(box.top + box.height).toBe(HUD_CANVAS_HEIGHT);
    expect(box.left + box.width).toBeLessThanOrEqual(HUD_CANVAS_WIDTH);
    expect(Math.abs(moved.offsetX % HUD_GRID_SIZE)).toBe(0);
  });

  it('allows only square radar resize and snaps to the 10px grid', () => {
    const resized = resizeRadarPlacement(getBuiltinLayout().widgets.radar, 77);
    expect(resized.size?.width).toBe(resized.size?.height);
    expect(resized.size?.width).toBe(400);
    expect(snapToGrid(24)).toBe(20);
    expect(() => resizeRadarPlacement(getBuiltinLayout().widgets['top-score-bar'], 20)).toThrow();
  });

  it('canonicalizes object key order for stable revisions', () => {
    expect(canonicalJson({ b: 2, a: { d: 4, c: 3 } })).toBe('{"a":{"c":3,"d":4},"b":2}');
  });

  it('normalizes numeric edits to a canonical in-canvas placement', () => {
    const placement = getBuiltinLayout().widgets.radar;
    const normalized = normalizeHudPlacement('radar', {
      ...placement,
      offsetX: 1_000,
      offsetY: -1_000,
    });
    const box = placementToBox('radar', normalized);
    expect(box.left).toBe(1_600);
    expect(box.top).toBe(0);
    expect(box.left + box.width).toBeLessThanOrEqual(HUD_CANVAS_WIDTH);
    expect(box.top + box.height).toBeLessThanOrEqual(HUD_CANVAS_HEIGHT);
  });
});
