# RFC

RFC（Request for Comments）用于在实现前讨论**尚未冻结、影响较大且存在真实替代方案的产品或技术设计**。它不是实现任务，也不是已经接受的架构真相。

## RFC、ADR 与 Issue 的边界

- **RFC**：回答“我们是否应该这样做，以及为什么”；允许存在未决问题、备选方案和待验证假设。
- **ADR**：记录已经接受、需要长期约束实现的架构决定与 invariant。
- **Issue**：把已经足够明确的目标拆成可实施、可验收的工作单元。

典型流转：

```text
Idea / research
      ↓
RFC: Draft → In Review
      ↓
Accepted / Rejected
      ↓
必要时固化 ADR
      ↓
Issue / Milestone implementation
```

RFC 被接受不等于立即进入当前 Milestone，也不等于所有未来可能性都被承诺实现。

## 状态

- `Draft`：作者仍在补充研究或方案；可以评论，但尚未请求最终决定。
- `In Review`：关键上下文、方案、替代项和验证计划已经完整，可以进行设计评审。
- `Accepted`：核心方向被接受；仍可有明确列出的实现期开放问题。
- `Rejected`：当前不采用；保留文档作为研究记录。
- `Superseded`：被后续 RFC / ADR 替代。

## 推荐结构

RFC 不为填模板而填模板，但对于跨模块或高风险设计，通常至少回答：

1. **Metadata / Status**：日期、状态、相关 Issue/PR、决策范围。
2. **Summary**：一段话说明提议与核心理由。
3. **Context / Problem / Motivation**：用户问题、当前约束、为什么现在值得讨论。
4. **Goals / Non-goals**：本 RFC 要解决和明确不解决什么。
5. **Proposal**：产品行为、架构数据流、ownership、关键接口/概念、失败语义。
6. **Alternatives / Trade-offs**：认真比较替代方案、什么情况下应选另一方案，以及“不做”的影响。
7. **Prior art / Evidence**：现有项目、协议、论文、生产实践能证明什么，不能证明什么。
8. **Cross-cutting concerns**：性能、可靠性、安全、兼容性、许可证、运维、维护成本等适用项。
9. **Validation / Success criteria**：哪些假设必须通过 PoC / replay / real-environment acceptance 验证；如何判断值得继续。
10. **Rollout / Implementation boundaries**：若接受，按什么阶段推进；哪些工作仍然不进入当前 critical path。
11. **Risks / Mitigations**：失败方式与降级策略。
12. **Open questions / Decision requested**：仍未冻结的问题，以及评审者这次到底需要决定什么。

上述结构参考 Rust、PyTorch、TensorFlow 等项目的 RFC / design proposal 实践：强调问题与动机、详细设计、替代方案、缺点、成功指标和未决问题，而不是把一个已经决定的实现方案包装成 RFC。

## 文件与接受规则

- 路径：`docs/rfcs/NNNN-short-name.md`。
- RFC PR 是主要异步评审面；重要讨论应最终回写到 RFC，而不是只留在聊天或 review comment。
- 如果评审接受了长期 architecture invariant，应在实现前按需新增/更新 ADR；不要让 Accepted RFC 与现有 ADR 形成两份互相冲突的 canonical truth。
- 如果 RFC 只确定产品方向、但实现仍属于 Future/Post-v1，可以保持 roadmap 不变，后续在真正进入 Milestone 前再做 just-in-time design freeze。
