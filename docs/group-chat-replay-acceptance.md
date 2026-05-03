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

---

## 第二期回放补充（2026-04-23）

本轮聚焦 `@` 与 handoff 连续多轮稳定性，采用“真实运行时逻辑 + 自动化回放断言”的方式补齐回归保障。

### 回放与断言范围

- `@` 解析：`@name` / `@agent-id` / `@全角＠` / 去重 / 顺序稳定
- 显式 `@` 优先：不被 handoff active 成员抢位
- handoff 连续多轮：`A -> B -> C` 接棒状态稳定演进
- 与既有执行批次（并行/串行/依赖/冲突）一起跑烟测

### 自动化回放结果

| 场景 | 断言 | 结果 |
|---|---|---|
| mention 解析 | 支持 name/id/fullwidth，且未命中 token 可识别 | ✅ 通过 |
| 显式 @ 顺序优先 | `@Designer @Coder` 结果顺序保持为 Designer -> Coder，即使 handoff.active 是 Coder | ✅ 通过 |
| handoff 两轮连续 | 首轮 Coder @Designer，次轮 Designer @Tester，active/lastSpeaker/revision 连续正确 | ✅ 通过 |
| 执行批次回归 | 并行/串行/冲突/并发上限持续通过 | ✅ 通过 |

执行命令：

- `npm run test:smoke`
- `npm run beta:check`

### 结论

- 第二期目标（`@` + handoff 连续多轮稳定性）已完成并进入自动化回归范围。
- 当前剩余重点转向：群聊过程消息体验收口与导出能力最小可用。

---

## 真实 Provider 回放补充（2026-05-02）

本轮使用真实 Qwen / DashScope Provider 跑完整群聊可靠性回放。每个场景使用独立临时 runtime、独立群组会话和独立 workspace，避免长上下文或失败 run 污染后续场景。

### 执行环境

- Provider: Qwen / DashScope OpenAI-compatible
- Model: `qwen3.5-plus`
- API Key: 已脱敏
- 命令：`npm run test:provider-replay`
- 报告：`/var/folders/s8/txhb_s8x7ndd7t90zhy1jgxc0000gn/T/teamaligned-provider-replay-KpXOe9/provider-replay-report.json`

### 回放结果

| 场景 | 验收重点 | 结果 | 耗时 |
|---|---|---:|---:|
| `@` 指定 Agent | Coder 被明确 @ 后独占回复，不被其他 Agent 抢答 | ✅ 通过 | 86s |
| 无 `@` 自动选人 | orchestrator / fallback 能选择合适 Agent，并输出 selection 过程消息 | ✅ 通过 | 85s |
| 多轮 handoff | Designer -> Coder 接棒稳定，handoff 过程消息存在 | ✅ 通过 | 42s |
| 并行执行 | 互不依赖文件可并行执行，并触发 `write_text_file` | ✅ 通过 | 84s |
| 依赖等待 | Coder 等待 Designer，出现 `execution_waiting`，并完成 read/write 工具链路 | ✅ 通过 | 92s |
| 图片附件 | 群聊 Agent 能读取图片并回答主色 | ✅ 通过 | 35s |
| Web 工具 | `web_fetch` 可抓取 `https://example.com`，过程消息与来源链接可见 | ✅ 通过 | 38s |
| 取消 | 运行中取消后 run 进入 `cancelled`，handoff 被重置 | ✅ 通过 | 1s |
| `/clear` | 清理消息、runs 和 handoff 状态 | ✅ 通过 | 1s |

### 本轮修复

- 回放脚本改为每个场景独立 runtime，避免上一场景的长上下文、未完成 run 或取消状态污染下一场景。
- 群聊 orchestrator 增加默认 30 秒超时，超时后走本地 fallback，避免真实 Provider 长尾导致群聊像卡住。
- fallback 执行计划现在能识别用户文本里的 Agent 名称和 workspace 路径，例如 `Designer`、`Coder`、`docs/...`、`src/...`。
- 依赖等待验收收紧为：必须有 waiting 过程消息、`read_text_file`、`write_text_file`，且不能出现失败工具调用。

### 残余观察（非阻断）

- 真实 Provider 仍可能出现网络长尾或偶发连接超时；当前 runtime 会给出可读错误提示，回放脚本可单场景重跑。
- 无 `@` 自动选人仍依赖 orchestrator，超时回退后可靠性更高，但下一步仍可继续优化速度与过程消息密度。
