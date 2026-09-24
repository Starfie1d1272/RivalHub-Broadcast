# Radar utility effect rendering

This note records the external implementation references used for the broadcast radar utility pass.

## References

- **Eon** (`mortenlein/eon`) — package metadata declares the project under the **ISC** license.
  Its radar keeps projectile rendering separate from active smoke and inferno effects, and uses
  team-aware smoke/inferno presentation. RivalHub reuses that presentation split as a design
  reference, not source code.
- **Lexogrine CS2 React HUD** (`lexogrine/cs2-react-hud`) — **MIT** licensed.
  Its radar distinguishes airborne grenade icons from landed smoke / inferno presentation.
  RivalHub reuses that state-model pattern as a design reference, not source assets or source code.
- **Boltobserv** (`boltgolt/boltobserv`) — **GPL-3.0** licensed.
  It was inspected for comparison only. No Boltobserv source or assets are copied into RivalHub.

RivalHub itself is AGPL-3.0. The effect renderer in
`apps/web/src/program/widgets/radar/Radar.tsx` is an original Canvas implementation.

## Rendering contract

- Airborne utility uses the existing Valve-derived official grenade assets and a thin team-colored
  trajectory.
- Active smoke is a deterministic irregular soft footprint. Ownership is represented by a subtle
  CT/T outline while the cloud itself stays neutral.
- Smoke lifetime remains presentation-only and uses the existing 20 s broadcast duration contract.
- Active inferno consumes the real GSI flame positions and merges them visually into a continuous
  heat footprint. Individual flame circles are not exposed as the final visual language.
- HE detonation is a short shock pulse.
- Flash detonation is a short starburst.
- No protocol, telemetry, map calibration, or domain truth is inferred by this renderer.

The intent is to preserve calibrated spatial truth while replacing the previous debug-like
"circle per effect point" presentation with a broadcast-oriented visual grammar.
