## 摘要

<!-- 这个 PR 实际交付了什么能力或修复？ -->

## 关联工作

Closes #

## 已完成范围

- [ ] 任务要求的范围已经实现
- [ ] 未擅自扩张非目标

## 架构与决策

<!-- 列出相关 ADR / 文档；如有偏离必须明确说明。 -->

- 相关 ADR / 文档：
- 偏离：无 / 说明如下

## 关键变更

<!-- 涉及哪些 package / app / ownership / contract？ -->

## 验证证据

```text
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

<!-- 替换或补充实际执行过的命令。 -->

## 平台验证

- 实现环境：跨平台 / macOS 为主 / Windows 专用 / 其它
- 已完成自动化验证：
  - [ ] 本地确定性测试
  - [ ] macOS CI
  - [ ] Windows CI
  - [ ] Linux CI
- 任务要求的真实环境验收：不需要 / 真实 Windows / Windows + CS2 / Windows + OBS / Windows + CS2 + OBS
- 真实环境验收状态：不需要 / 待完成 / 通过 / 失败
- 验收证据 / 验证人：

<!-- 未实际运行真实 Windows / CS2 / OBS 时不得标记为通过。 -->

## 运行时与可靠性

<!-- 只勾选与本 PR 相关的项目。 -->

- [ ] 慢消费者 / 背压
- [ ] 重连
- [ ] 重复 / 乱序
- [ ] session / map epoch
- [ ] wrong-match / stale
- [ ] queue / memory 增长

## 文档

- [ ] 受影响的一手文档已经同步
- [ ] 实现与文档 / ADR 没有已知冲突
- [ ] 用户可见文案符合中文优先与术语规范

## 剩余风险

<!-- 明确写出未完成工作、待补真实环境证据和需要另开的后续任务。 -->
