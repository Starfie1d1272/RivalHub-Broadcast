# Ammo semantic evidence

本目录的 ammo presentation 是逐 item 的 presentation metadata，不会改写
'ammoClip'、'ammoClipMax' 或 'ammoReserve'。本次导入使用 Steam App ID 730
公开 Windows depot 2347770 的 Steam build '25218825'，并以仓库内 pinned
'Source2Viewer-CLI 20.0.6980+a06886f7d06049052d32a7381ec05523064a2ca0' 导出下列官方 game-data 证据。

| Evidence source | Extracted output SHA-256 | 用途 |
| --- | --- | --- |
| 'scripts/items/items_game.txt' | '3005506d74a7e8d0dfad104f732c56db0e2555a0a340da6f0636efbb6d281a8d' | item class、weapon type、primary ammo |
| 'scripts/weapons.vdata_c' | 'fbd0d6f754c234efb24ec5c6b8c335f190e67f17ac7ec98dc2cd2ea2ddb4037e' | per-weapon 'm_bReserveAmmoAsClips' 与 shotgun reload flags |

关键逐项判定：

- 'weapon_ssg08'、'weapon_m249'、'weapon_negev' 的官方 data 标记
  'm_bReserveAmmoAsClips = true'，因此 catalog 使用 'magazine'。
- 'weapon_mag7' 同时标记 'reloads_per_shell = false'、
  'reloads_with_clip = true' 与 'm_bReserveAmmoAsClips = true'，因此不把
  所有 shotgun 按 family 猜成 'shells'，catalog 使用 'magazine'。
- 'weapon_nova'、'weapon_xm1014'、'weapon_sawedoff' 标记
  'reloads_per_shell = true' 且 'm_bReserveAmmoAsClips = false'，catalog
  使用 'shells'。
- 'weapon_taser' 的 official data 只有 'AMMO_TYPE_TASERCHARGE' 这一
  weapon signal；没有稳定的 GSI numeric charge contract，因此 catalog
  保持 'none'，不伪造 recharge timer 或 reserve 数值。
- 'weapon_hkp2000' 的 'magazine' 语义另外由
  'packages/telemetry-gsi/test/fixtures/real-derived.ts' 中的 sanitized
  real-derived frame（'ammo_clip=13'、'ammo_clip_max=13'、
  'ammo_reserve=4'）覆盖。

这些 evidence 文件是维护审计记录，不是 runtime 输入；raw VPK、compiled
resource、VRF binary 与机器本地路径均不提交。
