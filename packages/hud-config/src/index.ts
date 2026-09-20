import { z } from 'zod';

export const HUD_CONFIG_SCHEMA_VERSION = 1 as const;
export const HUD_CANVAS_WIDTH = 1920 as const;
export const HUD_CANVAS_HEIGHT = 1080 as const;
export const HUD_GRID_SIZE = 10 as const;

export const HUD_WIDGET_IDS = [
  'top-score-bar',
  'team-ct-rail',
  'team-t-rail',
  'radar',
  'focused-player',
  'series-strip',
  'round-history',
  'objective',
  'round-result',
] as const;
export type HudWidgetId = (typeof HUD_WIDGET_IDS)[number];

export const HUD_ANCHORS = [
  'top-left',
  'top-center',
  'top-right',
  'center-left',
  'center',
  'center-right',
  'bottom-left',
  'bottom-center',
  'bottom-right',
] as const;
export type HudAnchor = (typeof HUD_ANCHORS)[number];

export const HUD_RESIZE_POLICIES = ['none', 'square', 'scale', 'width-only'] as const;
export type HudResizePolicy = (typeof HUD_RESIZE_POLICIES)[number];

export const HUD_PANEL_STYLES = ['solid', 'standard', 'light'] as const;
export type HudPanelStyle = (typeof HUD_PANEL_STYLES)[number];

export const HUD_CORNER_STYLES = ['square', 'soft', 'rounded'] as const;
export type HudCornerStyle = (typeof HUD_CORNER_STYLES)[number];

export const BUILTIN_PRESET_ID = 'builtin:rivalhub-default-preset' as const;
export const BUILTIN_LAYOUT_ID = 'builtin:rivalhub-default-layout' as const;
export const BUILTIN_THEME_ID = 'builtin:rivalhub-default-theme' as const;

const finiteNumber = z.number().refine(Number.isFinite, '必须是有限数字');
const resourceNameSchema = z
  .string()
  .refine((value) => value.trim().length > 0, '名称不能为空')
  .refine((value) => [...value.trim()].length <= 80, '名称最多 80 个 Unicode 字符');
const hexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, '必须是 #RRGGBB 格式');

export const hudWidgetPlacementSchema = z
  .object({
    visible: z.boolean(),
    anchor: z.enum(HUD_ANCHORS),
    offsetX: finiteNumber,
    offsetY: finiteNumber,
    size: z
      .object({
        width: finiteNumber.refine((value) => value > 0, '宽度必须大于 0'),
        height: finiteNumber.refine((value) => value > 0, '高度必须大于 0'),
      })
      .strict()
      .optional(),
    scale: finiteNumber.refine((value) => value > 0, '缩放必须大于 0').optional(),
  })
  .strict();

export const hudLayoutSchema = z
  .object({
    schemaVersion: z.literal(HUD_CONFIG_SCHEMA_VERSION),
    id: z.string().min(1),
    name: resourceNameSchema,
    widgets: z.record(z.string(), hudWidgetPlacementSchema),
  })
  .strict();

export const hudThemeSchema = z
  .object({
    schemaVersion: z.literal(HUD_CONFIG_SCHEMA_VERSION),
    id: z.string().min(1),
    name: resourceNameSchema,
    brandColor: hexColorSchema,
    panelStyle: z.enum(HUD_PANEL_STYLES),
    cornerStyle: z.enum(HUD_CORNER_STYLES),
  })
  .strict();

export const hudWidgetSettingsSchema = z
  .object({
    variant: z.literal('default'),
    settings: z.object({}).strict(),
  })
  .strict();

const widgetSettingsRecordSchema = z.record(z.string(), hudWidgetSettingsSchema);

export const hudPresetSchema = z
  .object({
    schemaVersion: z.literal(HUD_CONFIG_SCHEMA_VERSION),
    id: z.string().min(1),
    name: resourceNameSchema,
    layoutId: z.string().min(1),
    themeId: z.string().min(1),
    widgets: widgetSettingsRecordSchema,
  })
  .strict();

export interface HudSemanticColors {
  readonly textPrimary: string;
  readonly textMuted: string;
  readonly sideCt: string;
  readonly sideT: string;
  readonly stateDanger: string;
  readonly stateWarning: string;
  readonly stateSuccess: string;
  readonly stateUnknown: string;
  readonly objectiveBomb: string;
  readonly objectiveDefuse: string;
}

export interface HudSemanticSurface {
  readonly primary: string;
  readonly strong: string;
  readonly opacity: number;
  readonly borderOpacity: number;
}

export interface HudSemanticRadius {
  readonly sm: number;
  readonly md: number;
  readonly lg: number;
}

export interface HudResolvedTheme extends HudTheme {
  readonly semantic: {
    readonly colors: HudSemanticColors;
    readonly surface: HudSemanticSurface;
    readonly radius: HudSemanticRadius;
    readonly fontFamily: 'Inter';
  };
}

export interface HudLayout extends z.infer<typeof hudLayoutSchema> {
  readonly widgets: Record<HudWidgetId, HudWidgetPlacement>;
}

export type HudWidgetPlacement = z.infer<typeof hudWidgetPlacementSchema>;
export type HudTheme = z.infer<typeof hudThemeSchema>;
export type HudWidgetSettings = z.infer<typeof hudWidgetSettingsSchema>;
export type HudPreset = Omit<z.infer<typeof hudPresetSchema>, 'widgets'> & {
  readonly widgets: Record<HudWidgetId, HudWidgetSettings>;
};

export interface HudResolvedPreset {
  readonly schemaVersion: typeof HUD_CONFIG_SCHEMA_VERSION;
  readonly preset: {
    readonly id: string;
    readonly name: string;
    readonly layoutId: string;
    readonly themeId: string;
  };
  readonly layout: HudLayout;
  readonly theme: HudResolvedTheme;
  readonly widgets: Record<HudWidgetId, HudWidgetSettings>;
}

export const hudResolvedThemeSchema = z
  .object({
    schemaVersion: z.literal(HUD_CONFIG_SCHEMA_VERSION),
    id: z.string().min(1),
    name: resourceNameSchema,
    brandColor: hexColorSchema,
    panelStyle: z.enum(HUD_PANEL_STYLES),
    cornerStyle: z.enum(HUD_CORNER_STYLES),
    semantic: z
      .object({
        colors: z
          .object({
            textPrimary: z.string().min(1),
            textMuted: z.string().min(1),
            sideCt: z.string().min(1),
            sideT: z.string().min(1),
            stateDanger: z.string().min(1),
            stateWarning: z.string().min(1),
            stateSuccess: z.string().min(1),
            stateUnknown: z.string().min(1),
            objectiveBomb: z.string().min(1),
            objectiveDefuse: z.string().min(1),
          })
          .strict(),
        surface: z
          .object({
            primary: z.string().min(1),
            strong: z.string().min(1),
            opacity: finiteNumber,
            borderOpacity: finiteNumber,
          })
          .strict(),
        radius: z.object({ sm: finiteNumber, md: finiteNumber, lg: finiteNumber }).strict(),
        fontFamily: z.literal('Inter'),
      })
      .strict(),
  })
  .strict();

export const hudResolvedPresetSchema = z
  .object({
    schemaVersion: z.literal(HUD_CONFIG_SCHEMA_VERSION),
    preset: z
      .object({
        id: z.string().min(1),
        name: resourceNameSchema,
        layoutId: z.string().min(1),
        themeId: z.string().min(1),
      })
      .strict(),
    layout: hudLayoutSchema,
    theme: hudResolvedThemeSchema,
    widgets: widgetSettingsRecordSchema,
  })
  .strict();

const activePresetReferenceSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('builtin'),
      sourceId: z.literal(BUILTIN_PRESET_ID),
    })
    .strict(),
  z
    .object({
      kind: z.literal('custom'),
      sourceId: z.string().min(1),
      snapshot: hudResolvedPresetSchema,
    })
    .strict(),
]);

export const hudConfigDocumentSchema = z
  .object({
    schemaVersion: z.literal(HUD_CONFIG_SCHEMA_VERSION),
    customPresets: z.array(hudPresetSchema),
    customLayouts: z.array(hudLayoutSchema),
    customThemes: z.array(hudThemeSchema),
    activePreset: activePresetReferenceSchema,
  })
  .strict();

export type HudConfigDocument = Omit<
  z.infer<typeof hudConfigDocumentSchema>,
  'customPresets' | 'customLayouts' | 'customThemes'
> & {
  readonly customPresets: HudPreset[];
  readonly customLayouts: HudLayout[];
  readonly customThemes: HudTheme[];
};
export type HudActivePresetReference = HudConfigDocument['activePreset'];

export interface HudWidgetDescriptor {
  readonly id: HudWidgetId;
  readonly label: string;
  readonly rendererAvailability: 'unimplemented';
  readonly supportedVariants: readonly ['default'];
  readonly defaultVariant: 'default';
  readonly resizePolicy: HudResizePolicy;
  readonly defaultPlacement: HudWidgetPlacement;
}

export interface HudWidgetBox {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

const WIDGET_DIMENSIONS: Record<HudWidgetId, { readonly width: number; readonly height: number }> =
  {
    'top-score-bar': { width: 600, height: 96 },
    'team-ct-rail': { width: 300, height: 640 },
    'team-t-rail': { width: 300, height: 640 },
    radar: { width: 320, height: 320 },
    'focused-player': { width: 420, height: 180 },
    'series-strip': { width: 520, height: 96 },
    'round-history': { width: 380, height: 220 },
    objective: { width: 360, height: 160 },
    'round-result': { width: 500, height: 160 },
  };

const DEFAULT_PLACEMENTS: Record<HudWidgetId, HudWidgetPlacement> = {
  'top-score-bar': { visible: true, anchor: 'top-center', offsetX: 0, offsetY: 28 },
  'team-ct-rail': { visible: true, anchor: 'center-left', offsetX: 28, offsetY: 0 },
  'team-t-rail': { visible: true, anchor: 'center-right', offsetX: -28, offsetY: 0 },
  radar: {
    visible: true,
    anchor: 'center',
    offsetX: 0,
    offsetY: 0,
    size: { width: 320, height: 320 },
  },
  'focused-player': { visible: true, anchor: 'bottom-left', offsetX: 28, offsetY: -28 },
  'series-strip': { visible: true, anchor: 'top-left', offsetX: 28, offsetY: 28 },
  'round-history': { visible: true, anchor: 'bottom-right', offsetX: -28, offsetY: -28 },
  objective: { visible: true, anchor: 'top-right', offsetX: -28, offsetY: 28 },
  'round-result': { visible: true, anchor: 'center', offsetX: 0, offsetY: 210 },
};

const WIDGET_LABELS: Record<HudWidgetId, string> = {
  'top-score-bar': '顶部比分条',
  'team-ct-rail': 'CT 选手栏',
  'team-t-rail': 'T 选手栏',
  radar: '雷达',
  'focused-player': '当前观察选手',
  'series-strip': '系列赛信息',
  'round-history': '回合历史',
  objective: 'Objective',
  'round-result': '回合结果',
};

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

function completeWidgetRecord<T>(factory: (id: HudWidgetId) => T): Record<HudWidgetId, T> {
  return Object.fromEntries(HUD_WIDGET_IDS.map((id) => [id, factory(id)])) as Record<
    HudWidgetId,
    T
  >;
}

function hasExactWidgetKeys(value: Record<string, unknown>): boolean {
  const keys = Object.keys(value).sort();
  return keys.length === HUD_WIDGET_IDS.length && HUD_WIDGET_IDS.every((id) => keys.includes(id));
}

export function parseHudLayout(value: unknown): HudLayout {
  const parsed = hudLayoutSchema.parse(value);
  if (!hasExactWidgetKeys(parsed.widgets))
    throw new Error('HudLayout 必须完整包含第一版组件 Registry');
  for (const id of HUD_WIDGET_IDS) {
    const placement = parsed.widgets[id];
    if (placement === undefined) throw new Error(`HudLayout 缺少组件：${id}`);
    if (placement.scale !== undefined) throw new Error('第一版不允许持久化组件 scale');
    if (id !== 'radar' && placement.size !== undefined) {
      throw new Error(`组件 ${id} 不允许调整尺寸`);
    }
    if (id === 'radar' && placement.size !== undefined) {
      if (placement.size.width !== placement.size.height) {
        throw new Error('Radar 只能使用正方形尺寸');
      }
    }
    if (id === 'radar' && placement.size === undefined) {
      throw new Error('Radar 必须显式保存正方形尺寸');
    }
  }
  return parsed;
}

export function parseHudPreset(value: unknown): HudPreset {
  const parsed = hudPresetSchema.parse(value);
  if (!hasExactWidgetKeys(parsed.widgets))
    throw new Error('HudPreset 必须完整包含第一版组件 Registry');
  return parsed;
}

export function parseHudResolvedPreset(value: unknown): HudResolvedPreset {
  const parsed = hudResolvedPresetSchema.parse(value);
  if (!hasExactWidgetKeys(parsed.widgets)) {
    throw new Error('HudResolvedPreset 必须完整包含第一版组件 Registry');
  }
  return parsed;
}

function assertUniqueCustomIds<T extends { readonly id: string }>(
  resources: readonly T[],
  kind: string,
): void {
  const ids = new Set<string>();
  for (const resource of resources) {
    if (resource.id.startsWith('builtin:'))
      throw new Error(`${kind} 自定义资源不得使用 builtin: ID`);
    if (ids.has(resource.id)) throw new Error(`${kind} 自定义资源 ID 不得重复：${resource.id}`);
    ids.add(resource.id);
  }
}

export function parseHudConfigDocument(value: unknown): HudConfigDocument {
  const parsed = hudConfigDocumentSchema.parse(value);
  assertUniqueCustomIds(parsed.customLayouts, '布局');
  assertUniqueCustomIds(parsed.customThemes, '外观');
  assertUniqueCustomIds(parsed.customPresets, '预设');
  const layouts = new Map<string, HudLayout>([
    [BUILTIN_LAYOUT_ID, getBuiltinLayout()],
    ...parsed.customLayouts.map((item) => [item.id, parseHudLayout(item)] as const),
  ]);
  const themes = new Map<string, HudTheme>([
    [BUILTIN_THEME_ID, getBuiltinTheme()] as const,
    ...parsed.customThemes.map((item) => [item.id, hudThemeSchema.parse(item)] as const),
  ]);
  const presets = parsed.customPresets.map((item) => parseHudPreset(item));
  const presetIds = new Set(presets.map((item) => item.id));
  for (const preset of presets) {
    if (!layouts.has(preset.layoutId))
      throw new Error(`HudPreset 引用不存在的布局：${preset.layoutId}`);
    if (!themes.has(preset.themeId))
      throw new Error(`HudPreset 引用不存在的外观：${preset.themeId}`);
  }
  if (parsed.activePreset.kind === 'custom') {
    if (!presetIds.has(parsed.activePreset.sourceId)) {
      throw new Error(`activePreset 引用不存在的预设：${parsed.activePreset.sourceId}`);
    }
    parseHudResolvedPreset(parsed.activePreset.snapshot);
  }
  return {
    ...parsed,
    customPresets: presets,
    customLayouts: [...layouts.values()].filter((item) => item.id !== BUILTIN_LAYOUT_ID),
    customThemes: [...themes.values()].filter((item) => item.id !== BUILTIN_THEME_ID),
  };
}

export const HUD_WIDGET_REGISTRY: readonly HudWidgetDescriptor[] = deepFreeze(
  HUD_WIDGET_IDS.map((id) => ({
    id,
    label: WIDGET_LABELS[id],
    rendererAvailability: 'unimplemented' as const,
    supportedVariants: ['default'] as const,
    defaultVariant: 'default' as const,
    resizePolicy: id === 'radar' ? ('square' as const) : ('none' as const),
    defaultPlacement: cloneJson(DEFAULT_PLACEMENTS[id]),
  })),
);

export function getHudWidgetDescriptor(id: HudWidgetId): HudWidgetDescriptor {
  const descriptor = HUD_WIDGET_REGISTRY.find((item) => item.id === id);
  if (descriptor === undefined) throw new Error(`未知 HUD 组件：${id}`);
  return descriptor;
}

export function getBuiltinLayout(): HudLayout {
  return cloneJson(BUILTIN_LAYOUT);
}

export function getBuiltinTheme(): HudTheme {
  return cloneJson(BUILTIN_THEME);
}

export function getBuiltinPreset(): HudPreset {
  return cloneJson(BUILTIN_PRESET);
}

export function getBuiltinResolvedPreset(): HudResolvedPreset {
  return resolveHudPreset(BUILTIN_PRESET, BUILTIN_LAYOUT, BUILTIN_THEME);
}

const BUILTIN_LAYOUT: HudLayout = deepFreeze({
  schemaVersion: HUD_CONFIG_SCHEMA_VERSION,
  id: BUILTIN_LAYOUT_ID,
  name: 'RivalHub Default Layout',
  widgets: completeWidgetRecord((id) => cloneJson(DEFAULT_PLACEMENTS[id])),
});

const BUILTIN_THEME: HudTheme = deepFreeze({
  schemaVersion: HUD_CONFIG_SCHEMA_VERSION,
  id: BUILTIN_THEME_ID,
  name: 'RivalHub Default',
  brandColor: '#c8ef78',
  panelStyle: 'standard',
  cornerStyle: 'soft',
});

const BUILTIN_PRESET: HudPreset = deepFreeze({
  schemaVersion: HUD_CONFIG_SCHEMA_VERSION,
  id: BUILTIN_PRESET_ID,
  name: 'RivalHub Default Preset',
  layoutId: BUILTIN_LAYOUT_ID,
  themeId: BUILTIN_THEME_ID,
  widgets: completeWidgetRecord(() => ({ variant: 'default', settings: {} })),
});

export function createDefaultHudConfigDocument(): HudConfigDocument {
  return {
    schemaVersion: HUD_CONFIG_SCHEMA_VERSION,
    customPresets: [],
    customLayouts: [],
    customThemes: [],
    activePreset: { kind: 'builtin', sourceId: BUILTIN_PRESET_ID },
  };
}

export function resolveHudTheme(theme: HudTheme): HudResolvedTheme {
  const surface = {
    solid: { primary: '#10151d', strong: '#080c12', opacity: 0.98, borderOpacity: 0.28 },
    standard: { primary: '#111923', strong: '#0b1119', opacity: 0.88, borderOpacity: 0.18 },
    light: { primary: '#17222d', strong: '#111a22', opacity: 0.7, borderOpacity: 0.14 },
  }[theme.panelStyle];
  const radius = {
    square: { sm: 0, md: 0, lg: 0 },
    soft: { sm: 4, md: 8, lg: 12 },
    rounded: { sm: 8, md: 14, lg: 22 },
  }[theme.cornerStyle];
  return {
    ...cloneJson(theme),
    semantic: {
      colors: {
        textPrimary: '#f3f6fa',
        textMuted: '#aab4c0',
        sideCt: '#6aa8ff',
        sideT: '#f2bd4f',
        stateDanger: '#f06f6f',
        stateWarning: '#f3bd68',
        stateSuccess: '#c8ef78',
        stateUnknown: '#8d9aaa',
        objectiveBomb: '#f06f6f',
        objectiveDefuse: '#83d8e8',
      },
      surface,
      radius,
      fontFamily: 'Inter',
    },
  };
}

export function resolveHudPreset(
  preset: HudPreset,
  layout: HudLayout,
  theme: HudTheme,
): HudResolvedPreset {
  const parsedLayout = parseHudLayout(layout);
  const parsedPreset = parseHudPreset(preset);
  const parsedTheme = hudThemeSchema.parse(theme);
  if (parsedPreset.layoutId !== parsedLayout.id)
    throw new Error('HudPreset 与 HudLayout 引用不一致');
  if (parsedPreset.themeId !== parsedTheme.id) throw new Error('HudPreset 与 HudTheme 引用不一致');
  return {
    schemaVersion: HUD_CONFIG_SCHEMA_VERSION,
    preset: {
      id: parsedPreset.id,
      name: parsedPreset.name.trim(),
      layoutId: parsedPreset.layoutId,
      themeId: parsedPreset.themeId,
    },
    layout: cloneJson(parsedLayout),
    theme: resolveHudTheme(parsedTheme),
    widgets: cloneJson(parsedPreset.widgets),
  };
}

export function resolveActiveHudPreset(document: HudConfigDocument): HudResolvedPreset {
  const parsed = parseHudConfigDocument(document);
  if (parsed.activePreset.kind === 'custom') return cloneJson(parsed.activePreset.snapshot);
  return getBuiltinResolvedPreset();
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
    .join(',')}}`;
}

export function getWidgetDimensions(
  id: HudWidgetId,
  placement: HudWidgetPlacement = DEFAULT_PLACEMENTS[id],
): { readonly width: number; readonly height: number } {
  if (id === 'radar' && placement.size !== undefined) {
    return { width: placement.size.width, height: placement.size.height };
  }
  return WIDGET_DIMENSIONS[id];
}

function anchorPoint(anchor: HudAnchor): { readonly x: number; readonly y: number } {
  return {
    'top-left': { x: 0, y: 0 },
    'top-center': { x: HUD_CANVAS_WIDTH / 2, y: 0 },
    'top-right': { x: HUD_CANVAS_WIDTH, y: 0 },
    'center-left': { x: 0, y: HUD_CANVAS_HEIGHT / 2 },
    center: { x: HUD_CANVAS_WIDTH / 2, y: HUD_CANVAS_HEIGHT / 2 },
    'center-right': { x: HUD_CANVAS_WIDTH, y: HUD_CANVAS_HEIGHT / 2 },
    'bottom-left': { x: 0, y: HUD_CANVAS_HEIGHT },
    'bottom-center': { x: HUD_CANVAS_WIDTH / 2, y: HUD_CANVAS_HEIGHT },
    'bottom-right': { x: HUD_CANVAS_WIDTH, y: HUD_CANVAS_HEIGHT },
  }[anchor];
}

function anchorAlignment(anchor: HudAnchor): { readonly x: number; readonly y: number } {
  return {
    'top-left': { x: 0, y: 0 },
    'top-center': { x: 0.5, y: 0 },
    'top-right': { x: 1, y: 0 },
    'center-left': { x: 0, y: 0.5 },
    center: { x: 0.5, y: 0.5 },
    'center-right': { x: 1, y: 0.5 },
    'bottom-left': { x: 0, y: 1 },
    'bottom-center': { x: 0.5, y: 1 },
    'bottom-right': { x: 1, y: 1 },
  }[anchor];
}

export function placementToBox(id: HudWidgetId, placement: HudWidgetPlacement): HudWidgetBox {
  const dimensions = getWidgetDimensions(id, placement);
  const point = anchorPoint(placement.anchor);
  const alignment = anchorAlignment(placement.anchor);
  return clampWidgetBox({
    left: point.x + placement.offsetX - dimensions.width * alignment.x,
    top: point.y + placement.offsetY - dimensions.height * alignment.y,
    width: dimensions.width,
    height: dimensions.height,
  });
}

function offsetForBox(
  anchor: HudAnchor,
  box: HudWidgetBox,
): { readonly offsetX: number; readonly offsetY: number } {
  const point = anchorPoint(anchor);
  const alignment = anchorAlignment(anchor);
  return {
    offsetX: box.left + box.width * alignment.x - point.x,
    offsetY: box.top + box.height * alignment.y - point.y,
  };
}

export function clampWidgetBox(box: HudWidgetBox): HudWidgetBox {
  const width = Math.min(box.width, HUD_CANVAS_WIDTH);
  const height = Math.min(box.height, HUD_CANVAS_HEIGHT);
  return {
    left: Math.max(0, Math.min(box.left, HUD_CANVAS_WIDTH - width)),
    top: Math.max(0, Math.min(box.top, HUD_CANVAS_HEIGHT - height)),
    width,
    height,
  };
}

export function placementFromBox(
  id: HudWidgetId,
  base: HudWidgetPlacement,
  box: HudWidgetBox,
): HudWidgetPlacement {
  const clamped = clampWidgetBox(box);
  const offsets = offsetForBox(base.anchor, clamped);
  return {
    ...base,
    offsetX: offsets.offsetX,
    offsetY: offsets.offsetY,
    ...(id === 'radar' && base.size !== undefined
      ? { size: { width: clamped.width, height: clamped.height } }
      : {}),
  };
}

export function snapToGrid(value: number, grid = HUD_GRID_SIZE): number {
  return Math.round(value / grid) * grid;
}

export function moveWidgetPlacement(
  id: HudWidgetId,
  placement: HudWidgetPlacement,
  deltaX: number,
  deltaY: number,
  snap = true,
): HudWidgetPlacement {
  const box = placementToBox(id, placement);
  const moved = {
    ...box,
    left: snap ? snapToGrid(box.left + deltaX) : box.left + deltaX,
    top: snap ? snapToGrid(box.top + deltaY) : box.top + deltaY,
  };
  return placementFromBox(id, placement, moved);
}

export function resizeRadarPlacement(
  placement: HudWidgetPlacement,
  delta: number,
): HudWidgetPlacement {
  if (placement.size === undefined) throw new Error('Radar placement 缺少 square size');
  const current = placementToBox('radar', placement);
  const size = Math.max(160, Math.min(640, snapToGrid(current.width + delta)));
  return placementFromBox('radar', placement, { ...current, width: size, height: size });
}

export function resetLayoutDraft(draft: HudLayout): HudLayout {
  return {
    ...getBuiltinLayout(),
    id: draft.id,
    name: draft.name,
  };
}

export function resetThemeDraft(draft: HudTheme): HudTheme {
  return {
    ...getBuiltinTheme(),
    id: draft.id,
    name: draft.name,
  };
}

export function resetPresetDraft(draft: HudPreset): HudPreset {
  return {
    ...getBuiltinPreset(),
    id: draft.id,
    name: draft.name,
  };
}

export function createCustomResourceId(): string {
  return crypto.randomUUID();
}
