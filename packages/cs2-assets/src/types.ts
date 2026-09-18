export const CS2_ASSET_MANIFEST_SCHEMA_VERSION = 1 as const;
export const CS2_ITEM_CATALOG_SCHEMA_VERSION = 1 as const;

export type Cs2ItemKind = 'firearm' | 'melee' | 'utility' | 'equipment' | 'objective';

export type Cs2AmmoPresentation =
  'magazine' | 'shells' | 'reserve-rounds' | 'charge' | 'none' | 'utility' | 'objective';

export type Cs2AssetTintMode = 'mask' | 'none';

export interface Cs2EvidenceReference {
  readonly kind: 'live-gsi' | 'official-game-data' | 'official-release-note';
  readonly reference: string;
}

export interface Cs2ItemMetadata {
  readonly canonicalKey: string;
  readonly sourceWeaponIds: readonly string[];
  readonly sourcePath: string;
  readonly kind: Cs2ItemKind;
  readonly family: string;
  readonly displayCategory: string;
  readonly assetId: string;
  readonly ammoPresentation: Cs2AmmoPresentation;
  readonly tintMode: Cs2AssetTintMode;
  readonly aliases: readonly string[];
  readonly evidence: readonly Cs2EvidenceReference[];
}

export interface Cs2ItemCatalogFile {
  readonly schemaVersion: typeof CS2_ITEM_CATALOG_SCHEMA_VERSION;
  readonly items: readonly Cs2ItemMetadata[];
}

export interface Cs2AssetRecord {
  readonly sourcePath: string;
  readonly sourceSha256: string;
  readonly outputPath: string;
  readonly outputSha256: string;
  readonly mediaType: 'image/svg+xml';
  readonly tintMode: Cs2AssetTintMode;
}

export interface Cs2AssetManifest {
  readonly schemaVersion: typeof CS2_ASSET_MANIFEST_SCHEMA_VERSION;
  readonly source: {
    readonly appId: 730;
    readonly steamBuildId: string;
    readonly gameVersion?: string;
    readonly container: 'game/csgo/pak01_dir.vpk';
  };
  readonly extractor: {
    readonly project: 'ValveResourceFormat';
    readonly tool: 'Source2Viewer-CLI';
    readonly version: string;
  };
  readonly assets: Readonly<Record<string, Cs2AssetRecord>>;
}

export type Cs2AssetResolution =
  | {
      readonly kind: 'known';
      readonly item: Cs2ItemMetadata;
      readonly asset: Cs2AssetRecord;
    }
  | {
      readonly kind: 'unknown';
      readonly sourceWeaponId: string;
    };
