import type { ProgramSnapshot } from '@rivalhub-broadcast/protocol/program';
import { realProgramFixtures, type RealProgramProvenance } from './real-program-fixtures';
import {
  syntheticProgramFixtures,
  SYNTHETIC_FIXTURE_PROVENANCE,
} from './synthetic-program-fixtures';

const aliases = {
  'live-canonical': 'real-live-rich',
  'bomb-planted': 'real-planted',
  'bomb-defusing': 'real-defusing',
  'timeout-ct': 'real-timeout-ct',
  'series-halftime-swap': 'real-halftime-after',
  'series-timeout-a': 'real-timeout-ct',
  'series-timeout-b': 'real-timeout-t',
  'series-paused': 'real-paused',
} as const;
export const programFixtures = {
  ...syntheticProgramFixtures,
  ...(Object.fromEntries(
    Object.entries(realProgramFixtures).map(([id, record]) => [id, record.snapshot]),
  ) as { readonly [K in keyof typeof realProgramFixtures]: ProgramSnapshot }),
  ...(Object.fromEntries(
    Object.entries(aliases).map(([id, source]) => [id, realProgramFixtures[source].snapshot]),
  ) as { readonly [K in keyof typeof aliases]: ProgramSnapshot }),
};
export type ProgramFixtureId = keyof typeof programFixtures;
export const PROGRAM_FIXTURE_IDS = Object.keys(programFixtures) as ProgramFixtureId[];
export type ProgramFixtureProvenance =
  | RealProgramProvenance
  | { readonly kind: 'synthetic-edge' | 'synthetic-presentation'; readonly reason: string };
export const PROGRAM_FIXTURE_PROVENANCE: Readonly<
  Record<ProgramFixtureId, ProgramFixtureProvenance>
> = {
  ...SYNTHETIC_FIXTURE_PROVENANCE,
  ...(Object.fromEntries(
    Object.entries(realProgramFixtures).map(([id, record]) => [id, record.provenance]),
  ) as { readonly [K in keyof typeof realProgramFixtures]: RealProgramProvenance }),
  ...(Object.fromEntries(
    Object.entries(aliases).map(([id, source]) => [id, realProgramFixtures[source].provenance]),
  ) as { readonly [K in keyof typeof aliases]: RealProgramProvenance }),
};
export const PROGRAM_FIXTURE_LABELS: Readonly<Record<ProgramFixtureId, string>> = {
  ...(Object.fromEntries(
    Object.keys(realProgramFixtures).map((id) => [id, `真实回放 · ${id.slice(5)}`]),
  ) as Record<keyof typeof realProgramFixtures, string>),
  'player-rails-freezetime': '选手栏 · 回合切换前置边界',
  'awaiting-neutral': '等待初始状态',
  'live-neutral': '实时中 · 未绑定队伍',
  'live-canonical': '实时中 · 已匹配队伍',
  'context-stale': '比赛上下文过期',
  'identity-degraded': '选手身份部分确认',
  'identity-mismatch': '选手身份不匹配',
  'bomb-planted': '炸弹已安装',
  'bomb-defusing': '正在拆弹',
  'timeout-ct': 'CT 暂停',
  'stress-long-labels': '长名称压力场景',
  'player-rails-eco': '选手栏 · 低装备边界（合成）',
  'player-rails-dead-observed': '选手栏 · 阵亡观察边界（合成）',
  'player-rails-missing-summary': '选手栏 · 汇总证据缺失',
  'player-rails-carryover': '选手栏 · 回合切换延续',
  'series-bo1': 'BO1 系列赛',
  'series-bo3-map1': 'BO3 · Map 1',
  'series-bo5': 'BO5 中盘',
  'series-not-played': '系列赛未进行地图',
  'series-logo-mixed': '队伍 Logo 有/无',
  'series-halftime-swap': '半场换边',
  'series-timeout-a': 'A 队战术暂停',
  'series-timeout-b': 'B 队战术暂停',
  'series-paused': '比赛暂停',
  'series-decider': '决胜图',
  'series-partial-history': '回合历史不完整',
  'series-history-unavailable': '回合历史不可用',
  'series-mapping-unavailable': '队伍映射暂不可用',
  'series-round-unavailable': '回合编号不可用',
  'series-overtime-history': '加时回合密度',
  'series-long-labels': '系列赛长名称压力场景',
};

export function getProgramFixture(id: string): ProgramSnapshot | null {
  return Object.prototype.hasOwnProperty.call(programFixtures, id)
    ? programFixtures[id as ProgramFixtureId]
    : null;
}
export function getProgramFixtureProvenance(id: string): ProgramFixtureProvenance | null {
  return Object.prototype.hasOwnProperty.call(PROGRAM_FIXTURE_PROVENANCE, id)
    ? PROGRAM_FIXTURE_PROVENANCE[id as ProgramFixtureId]
    : null;
}
