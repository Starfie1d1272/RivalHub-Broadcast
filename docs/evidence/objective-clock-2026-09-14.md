# Objective Clock 非资格实证记录：2026-09-14 Windows capture

这份记录固化一次已去敏的真实 Windows observer capture 的测量结果。它是可复核的
non-qualifying evidence，不是 production qualification PASS；后续完整 probe 应追加新的
capture、reference 和报告，不覆盖这份历史记录。

## 证据来源

- Capture：`fixtures/gsi/semantic/bomb/defuse`
- `captureId`：`sanitized-20260914T060149Z-4cda66b7-recovered-match-seq-5522-5544`
- `sourceCaptureId`：`20260914T060149Z-4cda66b7-recovered-match`
- 平台：`win32`；Windows `11 Pro for Workstations`
- Broadcast commit：`08c0239ef2ae5fea1286d0163d3b7b3cb423039b`
- 选取的 source sequence：`5522..5544`；共 23 帧，recorder complete，dropped `0`
- sanitized source frames SHA-256：`7a2dfed10f28903de6a94e782ca3f0955593fe2f653e7e831e05305d8e99347a`
- 仓库 fixture `frames.jsonl` SHA-256：`188320f5a2637683e55a5cc4e2cbf9b88ccdd5ceaf7a4be64b62c0306d7ad633`
- provenance：`fixtureKind=sanitized-real-capture`、`sanitizerVersion=1`、lifecycle coverage=`partial`

复核命令：

```text
node scripts/qualification/evidence/objective-timing.mjs \
  fixtures/gsi/semantic/bomb/defuse
```

## 实测结果

| 项目 | 结果 |
| --- | --- |
| active frame interval | p50 `249.3 ms`；p95 `255.3 ms`；p99/max `255.8 ms` |
| countdown delta vs monotonic | p95 `1.7 ms`；max `1.7 ms` |
| source-local state → first matching countdown | p95/max `0 ms`；这不是 observer-visible transition residual |
| source-local bomb/phase residual | p95/max `88.0 ms`；同一 GSI source 内部一致性，不是 absolute/common-mode 证明 |
| phase semantics | active frames `21` checked，mismatch `0` |
| `round.bomb` semantics | active frames `21` checked，mismatch `0` |
| matching defuser kit evidence | `true=20`、`false=0`、`unknown=0`、`conflict=0` |
| reconnect / sequence gap | `0` / `0` |
| terminal residual | defuse p95/max `49.1 ms`；plant/explosion 无样本 |
| provider timestamp vs receive | p95 `810 ms`；当前 provider timestamp 粒度不足以证明 absolute offset |

这段 source 语义是 `planted → defusing → defused → round over`。它证明了该 capture 中
`bomb.countdown` 在 `defusing` 时可作为 defuse action clock、`bomb.player` 能关联当前
defuser、`hasDefuser=true` 能派生 kit duration，并提供了 round-over terminal frame 的
source cross-check；Core 对 round-over residue 的 action 清理由确定性测试覆盖。它没有覆盖
plant abort、爆炸、no-kit、defuse abort/restart 或 reconnect。

## Qualification 结论

本次 analyzer 的数字结论为：

- numeric `0.1 s`：`FAIL`。active p99 `255.8 ms > 200 ms`，且 capture 使用的
  `buffer=0.1`、`throttle=0.1`、`heartbeat=60` 不匹配 canonical production config 的
  `buffer=0`、`throttle=0`、`heartbeat=10`。
- semantic scenario coverage：这份历史 sanitized capture 没有新的显式 before/after
  objective marker；按当前 8 场景 contract 计为 `0/8`。旧版报告里的 `defuse-kit` 形状
  不能替代 `defuse-kit-abort-restart` 场景，因此 `manifest.complete=true` 不被当作
  semantic coverage。
- raw production provenance：`realObserverProvenance=false`。sanitized fixture 只作为
  regression evidence，不能替代 qualification run 绑定的 raw recorder identity、环境和
  artifact SHA。
- independent observer reference：没有 `objective-events.jsonl` CSTV/demo reference，
  因此 observer-visible transition residual、fixed offset 和 random/common-mode delay
  结论均为 `unknown`，不能用 source-local 的 `0 ms` 或 `88 ms` 代替。
- canonical Core policy：configured lease `1000 ms`，measured `3 × p99 = 767.4 ms`，
  `maximum=2000 ms`；lease sufficiency=`true`。因此这次 `0.1 s` FAIL 不构成放宽 lease
  的理由。
- numeric `0.01 s`：`NOT_PROMISED`；`precision_time=3` 不是 1 ms accuracy guarantee。

这份 capture 不能作为 #49 的最终 production qualification，也不能填补真实最小
`planting → planted → defusing → abort → defusing → defused/exploded` regression fixture
要求。缺失的完整真实 capture 必须由 Windows + CS2/CSTV observer probe 提供；合成 fixture
只用于验证 analyzer 和 Core 的确定性行为。
