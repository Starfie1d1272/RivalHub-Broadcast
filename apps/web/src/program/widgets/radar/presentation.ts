import { resolveCs2ItemByGsiName } from '@rivalhub-broadcast/cs2-assets';
import type { RadarSnapshot } from '@rivalhub-broadcast/protocol/radar';
import {
  defaultMapGeometryProvider,
  projectWorldDirection,
  projectWorldPosition,
  type MapGeometry,
  type RadarLayer,
  type RadarProjectedPosition,
} from '@rivalhub-broadcast/radar';

// Issue #34 freezes the broadcast smoke presentation at 20 s. This is not a
// server cvar or a claim about the exact volumetric visibility/collision field.
export const SMOKE_PRESENTATION_DURATION_SECONDS = 20;
export const RADAR_PRESENTATION = Object.freeze({
  smoothingMs: 55,
  teleportBaseWorld: 160,
  teleportSpeedWorldPerSecond: 1100,
  sampleGapMs: 500,
  trailPoints: 32,
  trailMs: 1800,
  exitMs: 240,
  damageMs: 220,
  shootingMs: 110,
  maxPlayers: 64,
  maxGrenades: 128,
  maxFlames: 512,
  zoomPadding: 0.12,
  maxZoom: 2.5,
});

type Player = RadarSnapshot['payload']['players'][number];
type Grenade = RadarSnapshot['payload']['grenades'][number];
type Vector = NonNullable<Player['position']>;
export type RadarSide = Player['side'];
export interface TrailPoint {
  x: number;
  y: number;
  at: number;
}
export interface Motion {
  x: number;
  y: number;
  angle: number;
  target: RadarProjectedPosition;
  targetAngle: number;
  world: Vector;
  sampledAt: number;
}
export interface PlayerMarker extends Motion {
  source: Player;
  damageUntil: number;
  shootingUntil: number;
}
export interface GrenadeMarker extends Motion {
  source: Grenade;
  side: RadarSide;
  trail: TrailPoint[];
  airborne: boolean;
}
export interface GrenadeExit {
  marker: GrenadeMarker;
  until: number;
}

export function shortestAngle(from: number, to: number): number {
  return ((((to - from + 540) % 360) + 360) % 360) - 180;
}
export function smokeRemaining(effectTimeSeconds: number | null): number | null {
  return effectTimeSeconds === null
    ? null
    : Math.max(
        0,
        Math.min(
          SMOKE_PRESENTATION_DURATION_SECONDS,
          SMOKE_PRESENTATION_DURATION_SECONDS - effectTimeSeconds,
        ),
      );
}
export function radarBoundary(snapshot: RadarSnapshot): string {
  const c = snapshot.cursor;
  return JSON.stringify([
    c.producerInstanceId,
    c.liveSessionId,
    c.programSourceGeneration,
    c.mapEpoch,
    snapshot.payload.mapName,
  ]);
}
export function selectLayer(snapshot: RadarSnapshot, geometry: MapGeometry): RadarLayer {
  if (geometry.layerRule.kind === 'single') return 'single';
  const players = snapshot.payload.players;
  const focused = players.find((p) => p.sourcePlayerId === snapshot.payload.observedPlayerSourceId);
  const focusPosition = focused && projectWorldPosition(focused.position, geometry);
  if (focusPosition && !focusPosition.outOfBounds && focusPosition.layer !== 'unknown')
    return focusPosition.layer;
  let upper = 0;
  let lower = 0;
  for (const player of players) {
    if (player.lifeState !== 'alive') continue;
    const point = projectWorldPosition(player.position, geometry);
    if (!point || point.outOfBounds) continue;
    if (point.layer === 'upper') upper++;
    if (point.layer === 'lower') lower++;
  }
  return upper === lower ? 'unknown' : upper > lower ? 'upper' : 'lower';
}
export function onLayer(point: RadarProjectedPosition, layer: RadarLayer): boolean {
  if (point.outOfBounds) return false;
  if (layer === 'unknown') return false;
  return point.layer === layer || point.layer === 'single';
}
function direction(player: Player): number {
  const d = player.lifeState === 'alive' ? projectWorldDirection(player.forward) : null;
  return d ? (Math.atan2(d.y, d.x) * 180) / Math.PI : 0;
}
function discontinuous(
  previous: Motion,
  world: Vector,
  point: RadarProjectedPosition,
  now: number,
): boolean {
  const dt = now - previous.sampledAt;
  const distance = Math.hypot(
    world.x - previous.world.x,
    world.y - previous.world.y,
    world.z - previous.world.z,
  );
  return (
    dt < 0 ||
    dt > RADAR_PRESENTATION.sampleGapMs ||
    previous.target.layer !== point.layer ||
    distance >
      RADAR_PRESENTATION.teleportBaseWorld +
        (RADAR_PRESENTATION.teleportSpeedWorldPerSecond * dt) / 1000
  );
}
function motion(world: Vector, point: RadarProjectedPosition, angle: number, now: number): Motion {
  return {
    x: point.x,
    y: point.y,
    angle,
    target: point,
    targetAngle: angle,
    world,
    sampledAt: now,
  };
}
function isShooting(before: Player, after: Player): boolean {
  const a = before.activeWeapon;
  const b = after.activeWeapon;
  if (
    !a ||
    !b ||
    a.name === null ||
    a.name !== b.name ||
    a.state !== 'active' ||
    b.state !== 'active' ||
    a.ammoClip === null ||
    b.ammoClip === null ||
    b.ammoClip < 0 ||
    b.ammoClip >= a.ammoClip
  )
    return false;
  const item = resolveCs2ItemByGsiName(a.name);
  return item.kind === 'known' && item.item.kind === 'firearm';
}
export function grenadeIcon(kind: string | null): string | null {
  // GSI firebomb is deliberately generic; owner equipment cannot prove subtype.
  const name = (
    {
      smoke: 'weapon_smokegrenade',
      flashbang: 'weapon_flashbang',
      frag: 'weapon_hegrenade',
      hegrenade: 'weapon_hegrenade',
      decoy: 'weapon_decoy',
    } as Record<string, string>
  )[kind ?? ''];
  if (!name) return null;
  const item = resolveCs2ItemByGsiName(name);
  return item.kind === 'known' ? item.asset.outputPath : null;
}
export function isActiveSmoke(g: Grenade): boolean {
  return (
    g.kind === 'smoke' &&
    g.position !== null &&
    ((g.effectTimeSeconds !== null && g.effectTimeSeconds >= 0) ||
      (g.velocity !== null && Math.hypot(g.velocity.x, g.velocity.y, g.velocity.z) === 0))
  );
}

/** All history is local presentation, bounded, and disposable; never a domain reducer. */
export class RadarPresentation {
  snapshot: RadarSnapshot | null = null;
  geometry: MapGeometry | null = null;
  layer: RadarLayer = 'unknown';
  unsupportedMap: string | null = null;
  diagnosticReason: 'unsupported-map' | 'stale' | 'awaiting' | null = 'awaiting';
  readonly players = new Map<string, PlayerMarker>();
  readonly grenades = new Map<string, GrenadeMarker>();
  readonly exits = new Map<string, GrenadeExit>();
  zoom = { x: 0.5, y: 0.5, scale: 1 };
  private boundary: string | null = null;
  private lastFrame: number | null = null;
  private acceptedAt: number | null = null;
  private bombTerminalAt: number | null = null;

  reset(reason: 'unsupported-map' | 'stale' | 'awaiting' | null = null): void {
    this.snapshot = null;
    this.geometry = null;
    this.layer = 'unknown';
    this.players.clear();
    this.grenades.clear();
    this.exits.clear();
    this.zoom = { x: 0.5, y: 0.5, scale: 1 };
    this.boundary = null;
    this.lastFrame = null;
    this.acceptedAt = null;
    this.bombTerminalAt = null;
    if (reason !== null) {
      this.diagnosticReason = reason;
    }
  }

  accept(snapshot: RadarSnapshot | null, now: number, reconnect = false): void {
    if (!snapshot) {
      this.unsupportedMap = null;
      this.reset('awaiting');
      return;
    }
    if (snapshot.payload.telemetryFreshness !== 'fresh') {
      this.reset('stale');
      return;
    }
    const geometry = defaultMapGeometryProvider.resolve(snapshot.payload.mapName);
    if (!geometry) {
      this.unsupportedMap = snapshot.payload.mapName;
      this.reset('unsupported-map');
      return;
    }
    this.unsupportedMap = null;
    this.diagnosticReason = null;
    const boundary = radarBoundary(snapshot);
    const layer = selectLayer(snapshot, geometry);
    if (
      reconnect ||
      this.boundary !== boundary ||
      this.layer !== layer ||
      (this.acceptedAt !== null && now - this.acceptedAt > RADAR_PRESENTATION.sampleGapMs)
    )
      this.reset();
    if (this.snapshot && snapshot.channelSeq <= this.snapshot.channelSeq) return;
    // Runtime-only publications do not constitute a new GSI HP/ammo/trail sample.
    if (this.snapshot?.cursor.programReceiveSequence === snapshot.cursor.programReceiveSequence) {
      this.snapshot = snapshot;
      return;
    }
    const previousBomb = this.snapshot?.payload.bomb?.state;
    this.boundary = boundary;
    this.geometry = geometry;
    this.layer = layer;
    this.acceptedAt = now;
    const currentPlayers = new Set<string>();
    for (const source of snapshot.payload.players.slice(0, RADAR_PRESENTATION.maxPlayers)) {
      const point = projectWorldPosition(source.position, geometry);
      if (!source.position || !point || !onLayer(point, layer)) continue;
      const id = source.sourcePlayerId;
      currentPlayers.add(id);
      const old = this.players.get(id);
      const angle = direction(source);
      const continuous =
        old &&
        !discontinuous(old, source.position, point, now) &&
        old.source.lifeState === source.lifeState &&
        old.source.side === source.side &&
        snapshot.payload.coverage.allPlayers === 'present' &&
        this.snapshot?.payload.coverage.allPlayers === 'present';
      const next: PlayerMarker = {
        ...(continuous ? old : motion(source.position, point, angle, now)),
        source,
        target: point,
        targetAngle: angle,
        world: source.position,
        sampledAt: now,
        damageUntil: continuous ? old.damageUntil : 0,
        shootingUntil: continuous ? old.shootingUntil : 0,
      };
      if (
        continuous &&
        old.source.health !== null &&
        source.health !== null &&
        source.health < old.source.health
      )
        next.damageUntil = now + RADAR_PRESENTATION.damageMs;
      if (continuous && source.lifeState === 'alive' && isShooting(old.source, source))
        next.shootingUntil = now + RADAR_PRESENTATION.shootingMs;
      this.players.set(id, next);
    }
    for (const id of this.players.keys()) if (!currentPlayers.has(id)) this.players.delete(id);
    const currentGrenades = new Set<string>();
    for (const source of snapshot.payload.grenades.slice(0, RADAR_PRESENTATION.maxGrenades)) {
      const point = projectWorldPosition(source.position, geometry);
      if (!source.position || !point || !onLayer(point, layer)) continue;
      const id = source.sourceEntityId;
      currentGrenades.add(id);
      this.exits.delete(id);
      const owner = snapshot.payload.players.find((p) => p.sourcePlayerId === source.ownerSourceId);
      const side = owner?.side ?? 'unknown';
      const old = this.grenades.get(id);
      const continuous =
        old &&
        old.source.kind === source.kind &&
        old.source.ownerSourceId === source.ownerSourceId &&
        !discontinuous(old, source.position, point, now) &&
        !(
          old.source.lifetimeSeconds !== null &&
          source.lifetimeSeconds !== null &&
          source.lifetimeSeconds < old.source.lifetimeSeconds
        );
      const airborne =
        source.velocity !== null &&
        !isActiveSmoke(source) &&
        source.kind !== 'inferno' &&
        Math.hypot(source.velocity.x, source.velocity.y, source.velocity.z) > 0;
      const trail =
        continuous && airborne
          ? old.trail.filter((p) => now - p.at <= RADAR_PRESENTATION.trailMs)
          : [];
      if (airborne) trail.push({ x: point.x, y: point.y, at: now });
      if (trail.length > RADAR_PRESENTATION.trailPoints)
        trail.splice(0, trail.length - RADAR_PRESENTATION.trailPoints);
      this.grenades.set(id, {
        ...(continuous ? old : motion(source.position, point, 0, now)),
        source,
        side,
        airborne,
        trail,
        target: point,
        targetAngle: 0,
        world: source.position,
        sampledAt: now,
      });
    }
    for (const [id, marker] of this.grenades)
      if (!currentGrenades.has(id)) {
        if (marker.airborne) this.exits.set(id, { marker, until: now + RADAR_PRESENTATION.exitMs });
        this.grenades.delete(id);
      }
    while (this.exits.size > RADAR_PRESENTATION.maxGrenades)
      this.exits.delete(this.exits.keys().next().value!);
    const bombState = snapshot.payload.bomb?.state;
    if ((bombState === 'defused' || bombState === 'exploded') && bombState !== previousBomb)
      this.bombTerminalAt = now;
    if (bombState !== 'defused' && bombState !== 'exploded') this.bombTerminalAt = null;
    this.snapshot = snapshot;
  }

  bombVisible(now: number): boolean {
    return this.bombTerminalAt === null || now - this.bombTerminalAt < RADAR_PRESENTATION.exitMs;
  }

  tick(now: number, autoZoom: boolean): void {
    const dt = this.lastFrame === null ? 0 : Math.max(0, Math.min(100, now - this.lastFrame));
    this.lastFrame = now;
    const mix = 1 - Math.exp(-dt / RADAR_PRESENTATION.smoothingMs);
    for (const marker of [...this.players.values(), ...this.grenades.values()]) {
      marker.x += (marker.target.x - marker.x) * mix;
      marker.y += (marker.target.y - marker.y) * mix;
      marker.angle += shortestAngle(marker.angle, marker.targetAngle) * mix;
    }
    for (const [id, exit] of this.exits) if (now >= exit.until) this.exits.delete(id);
    for (const grenade of this.grenades.values())
      grenade.trail = grenade.trail.filter((p) => now - p.at <= RADAR_PRESENTATION.trailMs);
    const alive = [...this.players.values()].filter((p) => p.source.lifeState === 'alive');
    let x = 0.5;
    let y = 0.5;
    let scale = 1;
    if (autoZoom && alive.length) {
      const minX = Math.min(...alive.map((p) => p.target.x));
      const maxX = Math.max(...alive.map((p) => p.target.x));
      const minY = Math.min(...alive.map((p) => p.target.y));
      const maxY = Math.max(...alive.map((p) => p.target.y));
      scale = Math.max(
        1,
        Math.min(
          RADAR_PRESENTATION.maxZoom,
          1 / (Math.max(maxX - minX, maxY - minY) + 2 * RADAR_PRESENTATION.zoomPadding),
        ),
      );
      const half = 0.5 / scale;
      x = Math.max(half, Math.min(1 - half, (minX + maxX) / 2));
      y = Math.max(half, Math.min(1 - half, (minY + maxY) / 2));
    }
    this.zoom.x += (x - this.zoom.x) * mix;
    this.zoom.y += (y - this.zoom.y) * mix;
    this.zoom.scale += (scale - this.zoom.scale) * mix;
  }
}
