import { randomUUID } from 'node:crypto';

import {
  DEFAULT_LOCAL_BP_MAP_POOL,
  LOCAL_BP_MAP_CATALOG,
  localBpSequence,
} from '@rivalhub-broadcast/core/projection';
import { localBpDraftSchema, type LocalBpDraft } from '@rivalhub-broadcast/protocol/bp';
import type { BroadcastManifestV1, BroadcastSide } from '@rivalhub-broadcast/rivalhub';
import { canonicalizeCs2MapName } from '@rivalhub-broadcast/core/map-name';
import type { MatchContextBinding } from '../match-context/index.js';

export type LocalBpDraftResult =
  | { readonly ok: true; readonly manifest: BroadcastManifestV1 }
  | { readonly ok: false; readonly code: string; readonly message: string };

const mapCatalog = new Set<string>(LOCAL_BP_MAP_CATALOG.map(({ mapName }) => mapName));

function invalid(code: string, message: string): LocalBpDraftResult {
  return { ok: false, code, message };
}

function safeLogoUrl(value: string): boolean {
  const candidate = value.trim();
  if (candidate.length === 0) return true;
  if (candidate.startsWith('/') && !candidate.startsWith('//')) {
    return ![...candidate].some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return character === '\\' || code < 0x20 || (code >= 0x7f && code <= 0x9f);
    });
  }
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === 'https:' && parsed.username === '' && parsed.password === '';
  } catch {
    return false;
  }
}

function localSlug(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72);
  return slug || 'local-match';
}

export function createLocalBpManifest(input: unknown): LocalBpDraftResult {
  const parsed = localBpDraftSchema.safeParse(input);
  if (!parsed.success) return invalid('bp_draft_invalid', '本地 BP 信息格式有误，请检查填写内容。');
  const draft = parsed.data;
  const pool = draft.mapPool.map((name) => canonicalizeCs2MapName(name));
  const bans = draft.bans.map((name) => canonicalizeCs2MapName(name));
  const picks = draft.picks.map((pick) => ({
    mapName: canonicalizeCs2MapName(pick.mapName),
    side: pick.side,
  }));
  if (draft.entrants.a.name.trim() === '' || draft.entrants.b.name.trim() === '')
    return invalid('bp_draft_names_required', '请填写两支队伍的名称。');
  if (!safeLogoUrl(draft.entrants.a.logoUrl ?? '') || !safeLogoUrl(draft.entrants.b.logoUrl ?? ''))
    return invalid('bp_draft_logo_invalid', '队标地址需使用 HTTPS 或本地相对路径。');
  if (
    pool.length !== 7 ||
    pool.some((name) => name === null || !mapCatalog.has(name)) ||
    new Set(pool).size !== 7
  )
    return invalid('bp_draft_map_pool_invalid', '地图池必须从支持的地图中选出 7 张且不能重复。');

  const expectedBans = draft.format === 'bo1' ? 6 : draft.format === 'bo3' ? 4 : 2;
  const expectedPicks = draft.format === 'bo1' ? 0 : draft.format === 'bo3' ? 2 : 4;
  if (
    bans.length !== expectedBans ||
    picks.length !== expectedPicks ||
    bans.some((name) => name === null || !mapCatalog.has(name)) ||
    picks.some((pick) => pick.mapName === null || !mapCatalog.has(pick.mapName))
  )
    return invalid('bp_draft_maps_incomplete', '请完成所有禁用地图和选择地图。');
  if (
    picks.some((pick) => pick.side === null) ||
    (draft.format !== 'bo5' && draft.deciderSide === null)
  )
    return invalid(
      'bp_draft_sides_incomplete',
      '请填写每张已选地图的 CT / T，以及适用的决胜图选边。',
    );
  if (draft.format === 'bo5' && draft.deciderSide !== null)
    return invalid('bp_draft_decider_knife', 'BO5 决胜图使用 knife round，不填写起始边。');

  const selected = [...bans, ...picks.map((pick) => pick.mapName)].filter(
    (name): name is string => name !== null,
  );
  if (selected.some((name) => !pool.includes(name)) || new Set(selected).size !== selected.length)
    return invalid('bp_draft_maps_duplicate', '每张地图只能使用一次，且必须来自所选地图池。');
  const remaining = pool.filter(
    (name): name is string => name !== null && !selected.includes(name),
  );
  if (remaining.length !== 1)
    return invalid('bp_draft_decider_invalid', '剩余地图不唯一，无法确定决胜图。');

  const entryId = { a: randomUUID(), b: randomUUID() };
  const matchId = randomUUID();
  const mapForPick = draft.picks.map((pick) => canonicalizeCs2MapName(pick.mapName)!);
  const deciderMap = remaining[0]!;
  const sequence = localBpSequence(draft.format, draft.vetoA);
  const sideChoiceFor = (target: 'pick' | 'decider', index: number): 'CT' | 'T' | null =>
    target === 'pick' ? (draft.picks[index]?.side ?? null) : draft.deciderSide;
  const mapNameFor = (action: (typeof sequence)[number]): string => {
    if (action.kind === 'ban') return canonicalizeCs2MapName(draft.bans[action.valueIndex]!)!;
    if (action.kind === 'pick') return mapForPick[action.valueIndex]!;
    if (action.kind === 'side_pick')
      return action.target === 'decider' ? deciderMap : mapForPick[action.targetIndex]!;
    return deciderMap;
  };
  const veto = sequence.map((action, index) => {
    const mapName = mapNameFor(action);
    if (action.kind === 'side_pick') {
      const side = sideChoiceFor(action.target, action.targetIndex);
      const wireSide: BroadcastSide | null = side === null ? null : side === 'CT' ? 'ct' : 't';
      return {
        stepOrder: index + 1,
        actionType: 'side_pick' as const,
        mapName,
        entryId: entryId[action.actor],
        side: wireSide,
      };
    }
    return {
      stepOrder: index + 1,
      actionType: action.kind,
      mapName,
      entryId: action.actor === null ? null : entryId[action.actor],
      side: null,
    };
  });
  const pickMapNames = [...mapForPick, deciderMap];
  const maps = pickMapNames.map((mapName, index) => {
    const choice = sequence.find(
      (action) =>
        action.kind === 'side_pick' &&
        ((index < mapForPick.length && action.target === 'pick' && action.targetIndex === index) ||
          (index === mapForPick.length && action.target === 'decider')),
    );
    const selectedSide =
      choice?.kind === 'side_pick' ? sideChoiceFor(choice.target, choice.targetIndex) : null;
    const teamAStartSide: BroadcastSide | null =
      selectedSide === null || choice?.kind !== 'side_pick'
        ? null
        : choice.actor === 'a'
          ? selectedSide === 'CT'
            ? 'ct'
            : 't'
          : selectedSide === 'CT'
            ? 't'
            : 'ct';
    const picker = sequence.find((action) => action.kind === 'pick' && action.valueIndex === index);
    return {
      mapId: randomUUID(),
      mapOrder: index + 1,
      mapName,
      pickedByEntryId:
        index < mapForPick.length && picker?.kind === 'pick' ? entryId[picker.actor] : null,
      teamAStartSide,
      scoreA: null,
      scoreB: null,
      completedAt: null,
    };
  });
  const competitionName = draft.competitionName.trim() || '本地赛事';
  const manifest: BroadcastManifestV1 = {
    schemaVersion: 'rivalhub.broadcast-manifest.v1',
    revision: `local-${randomUUID()}`,
    match: {
      matchId,
      competition: {
        competitionId: `local-${randomUUID()}`,
        slug: localSlug(competitionName),
        name: competitionName,
        themeColor: null,
      },
      status: 'scheduled',
      format: draft.format,
      stage: draft.stage.trim() || '本地比赛',
      round: null,
      entryRound: null,
      scheduledAt: null,
      startedAt: null,
      completedAt: null,
      scoreA: null,
      scoreB: null,
      isForfeit: false,
    },
    entrants: {
      a: {
        entryId: entryId.a,
        name: draft.entrants.a.name.trim(),
        logoUrl: draft.entrants.a.logoUrl?.trim() || null,
        roster: { rosterId: null, players: [] },
      },
      b: {
        entryId: entryId.b,
        name: draft.entrants.b.name.trim(),
        logoUrl: draft.entrants.b.logoUrl?.trim() || null,
        roster: { rosterId: null, players: [] },
      },
    },
    maps,
    veto,
    commentators: [],
  };
  return { ok: true, manifest };
}

export function localBpDraftFromBinding(binding: MatchContextBinding): LocalBpDraft | null {
  if (binding.origin !== 'local' && binding.cachedFrom !== 'local') return null;
  const manifest = binding.manifest;
  const firstBan = manifest.veto.find((step) => step.actionType === 'ban');
  const vetoA = firstBan?.entryId === manifest.entrants.b.entryId ? 'b' : 'a';
  const sideChoices = new Map<string, 'CT' | 'T' | null>(
    manifest.veto
      .filter((step) => step.actionType === 'side_pick')
      .map((step) => [step.mapName, step.side === 'ct' ? 'CT' : step.side === 't' ? 'T' : null]),
  );
  const picks = manifest.veto
    .filter((step) => step.actionType === 'pick')
    .map((step) => ({ mapName: step.mapName, side: sideChoices.get(step.mapName) ?? null }));
  const decider = manifest.veto.find((step) => step.actionType === 'decider');
  const deciderSide = decider === undefined ? null : (sideChoices.get(decider.mapName) ?? null);
  const poolNames = new Set(manifest.veto.map((step) => canonicalizeCs2MapName(step.mapName)));
  const catalogOrder = LOCAL_BP_MAP_CATALOG.map(({ mapName }) => mapName);
  const mapPool = catalogOrder.filter((mapName) => poolNames.has(mapName));
  if (mapPool.length !== 7) return null;
  return {
    competitionName: manifest.match.competition.name,
    stage: manifest.match.stage,
    format: manifest.match.format,
    entrants: {
      a: { name: manifest.entrants.a.name, logoUrl: manifest.entrants.a.logoUrl },
      b: { name: manifest.entrants.b.name, logoUrl: manifest.entrants.b.logoUrl },
    },
    vetoA,
    mapPool: [...mapPool],
    bans: manifest.veto.filter((step) => step.actionType === 'ban').map((step) => step.mapName),
    picks,
    deciderSide: manifest.match.format === 'bo5' ? null : deciderSide,
  };
}

export const localBpMapOptions = LOCAL_BP_MAP_CATALOG;
export const defaultLocalBpMapPool = DEFAULT_LOCAL_BP_MAP_POOL;
