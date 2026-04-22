# 群聊真实会话回放验收清单（2026-04-23）

## 范围
- `@指定 Agent` 的命中与优先级
- handoff 多轮接棒稳定性
- 并行执行与串行依赖等待
- 工具调用过程可见性（含错误路径）
- 群聊中的“思考中”展示是否与流式输出冲突

## 回放环境
- App: Electron（dev）
- Renderer URL: `http://localhost:5173/`
- 关键分支代码：
  - `packages/agent-runtime/src/runtime.ts`
  - `packages/agent-runtime/src/team-runtime.ts`
  - `apps/desktop/src/renderer/src/pages/chat-page.tsx`
  - `apps/desktop/src/renderer/src/components/chat/chat-message-thread.tsx`

## 验收结果

| 场景 | 输入 | 预期 | 实际 | 结论 |
|---|---|---|---|---|
| `@` 指定单人 | `@Coder 请只回复“收到”` | 首条由 Coder 回复，不应被其他成员抢答 | 首条回复来自 Coder，且仅 Coder 回答 | ✅ 通过 |
| 非成员 `@` 提示 | `@Tester ...`（Tester 不在当前群成员） | 明确提示忽略无效 `@`，不中断流程 | 产生系统提示“未命中当前群组成员，已忽略”并继续语义选择 | ✅ 通过 |
| 多轮接棒 | `@Designer ... 然后 @Coder ...` | Designer 先发言，随后 Coder 接棒 | 会话中出现 Designer -> Coder 的连续接棒 | ✅ 通过 |
| 工具错误过程可见 | `@Coder read no-such-file-123.txt and report the exact error` | 聊天中可见真实报错与路径 | 返回 ENOENT 原始错误与 workspace 解析路径 | ✅ 通过 |
| 并行执行（回放） | `@Coder @Designer ... 并行执行` | 同批并行，不出现串行依赖 | 回放中两者并行开始并分别汇报结果 | ✅ 通过 |
| 串行依赖（回放） | `@Designer @Coder ... 先 A 后 B` | 按依赖顺序执行，B 在 A 之后 | 回放中 Designer 完成后 Coder 执行并汇报 | ✅ 通过 |
| 串行/并行计划器校验（脚本） | 本地 `tsx` 回放脚本 | sequential 产出依赖链；parallel 同批次 | `sequentialBatches=[["Designer"],["Coder"]]`；`parallelBatches=[["Designer","Coder"]]` | ✅ 通过 |

## 本轮修边结论
- `@` 解析已统一支持：`@name` / `@agent-id` / `@全角＠`，并保留顺序。
- 群聊成员选择在上限截断前会优先保留显式 `@` 命中成员，避免“被 @ 成员被 slice 掉”。
- 显式 `@` 不再被历史 handoff 强行重排。
- 群聊执行中的“编排口吻”已降噪：不再插入团队作为发言人的过程性公开消息（减少“群组在说话”违和感）。
- `pending` 思考气泡与流式消息做了互斥处理，降低重复“思考中”气泡。

## 残余观察（非阻断）
- LLM 的自然语言表达并不总是逐字复述“我在等待前置任务”，但依赖顺序本身已生效（可通过执行批次验证）。
- 使用桌面自动化工具输入中文时，偶发字符丢失；该现象未在应用正常手动输入路径复现。
