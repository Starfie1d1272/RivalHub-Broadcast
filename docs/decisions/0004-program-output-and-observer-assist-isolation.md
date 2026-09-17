# ADR-0004：Program 输出与 Observer Assist 隔离

- 状态：**Accepted**

## 背景

正式节目与观察辅助可以同时依赖同一场比赛，但数据资格不同：正式 Program 只能展示当前节目时间轴允许观众看到的信息；Lookahead 可以读取较早时间轴，为制作人员提供私有未来提示。

## 决策

### 单一制作角色

产品默认现场角色是同一名解说兼 OB / 制作人员。Program、Operator 和 Observer Assist 是不同职责界面，不建模成彼此独立的现场用户。

### Program 与 Lookahead 不对等

```text
Delayed Program source
  → Program-safe Runtime
  → ProgramProjection
  → Program renderer
  → OBS / 本机正式节目显示
```

```text
No-delay Lookahead source
  → machine-only evidence
  → timeline alignment
  → ObserverAssistProjection
  → private assist host
```

Lookahead 没有 Program fallback 资格。Program source 故障是正式节目输入故障；Lookahead source 故障只关闭或降级 Assist。

### Projection → Renderer → Host

三个层次分离：

```text
Projection
  决定 consumer 可以看到什么
        ↓
Renderer
  决定如何绘制
        ↓
Host
  决定在哪里运行和被谁消费
```

同一 Program renderer 可以运行在浏览器、OBS Browser Source 或经过验证的本机桌面 host 中，不形成第二份 RuntimeState。

Observer Assist 可以是透明置顶窗口，也可以是 Broadcast Workspace 的私有区域。透明 Overlay 是一种 host，不是产品定义。

### Safety by construction

- Future 字段不得进入 ProgramProjection；
- Assist 数据不得先发给 Program 再靠 CSS / crop / visibility 隐藏；
- Program 与 Assist 使用独立 schema / projection；
- OBS capture selection 只是第二道部署防线；
- #615 等公共 live output 只能消费 Program-safe timeline。

### Source-local continuity

Program 与 Lookahead 各自拥有 source generation、sequence、tick 和 health。Lookahead reconnect / generation change 后旧 alignment 立即失效，重新证明 same match / map / tick relation 后才能恢复 cue。

## 结果

Program 和 Assist 可以共享 Runtime Foundation，但不能共享无边界 payload。产品可以自由演进 host / workspace 形态，同时保持数据安全边界不变。
