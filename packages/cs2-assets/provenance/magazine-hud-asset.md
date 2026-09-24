# Valve reserve-magazine HUD graphic

| Field                 | Value                                                                                        |
| --------------------- | -------------------------------------------------------------------------------------------- |
| Owner                 | Valve, Counter-Strike 2                                                                      |
| Steam App ID          | `730`                                                                                        |
| Game build            | `25218825` (`1.41.8.1`)                                                                      |
| Depot                 | `2347770` (Windows game content)                                                             |
| Depot manifest        | `2053759441494650084`                                                                        |
| Container             | `game/csgo/pak01_dir.vpk`                                                                    |
| `sourcePath`          | `panorama/images/hud/ammo_reserve_magazine.vsvg_c`                                           |
| `sourceSha256`        | `dd6d877cb72da18bc2bb9b5bae8f3c395e1227d4a9995db7aac69d34e23c7f71`                           |
| Extractor             | ValveResourceFormat `Source2Viewer-CLI` `20.0.6980+a06886f7d06049052d32a7381ec05523064a2ca0` |
| Imported `outputPath` | `/assets/cs2/equipment/magazine.922432c975fd.svg`                                            |
| `outputSha256`        | `922432c975fdc03b5b9b93df9f245fbfe25473218a57562d68171fe5cfd01819`                           |

The raw `.vsvg_c` was downloaded from Valve's pinned Steam depot and imported with the existing `pnpm cs2-assets:import` pipeline. `ammo_reserve_magazine` is the HUD resource for a reserve magazine; `ammo_single` is a separate single-projectile graphic and is not used for this presentation. The catalog entry is presentation-only and has no GSI weapon names or aliases.

Per-item ammo semantics remain sourced from `provenance/ammo-evidence.md`: only `magazine` renders this icon with its numeric reserve count. `shells` and `reserve-rounds` retain their distinct text labels and do not fall back to this graphic.
