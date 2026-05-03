# Group Chat Replay Acceptance

[中文版本](../group-chat-replay-acceptance.md)

Updated: 2026-05-02

## Goal

Use realistic conversation replays as release evidence and regression baselines for group-chat behavior.

## Replay Focus

- Explicit `@agent` targeting.
- Semantic speaker routing without `@`.
- Multi-round handoff continuity.
- Parallel execution and dependency waiting.
- Natural process output while running.
- Image attachment understanding.
- Web tool invocation.
- Cancel and `/clear` stop conditions.

## Real Provider Replay: 2026-05-02

This run used the real Qwen / DashScope Provider. Each scenario used an isolated temporary runtime, group conversation, and workspace so previous long contexts or failed runs could not pollute later scenarios.

Environment:

- Provider: Qwen / DashScope OpenAI-compatible
- Model: `qwen3.5-plus`
- API Key: redacted
- Command: `npm run test:provider-replay`
- Report: `/var/folders/s8/txhb_s8x7ndd7t90zhy1jgxc0000gn/T/teamaligned-provider-replay-KpXOe9/provider-replay-report.json`

Results:

| Scenario | Acceptance focus | Result | Duration |
|---|---|---:|---:|
| Explicit `@` Agent | Coder is explicitly mentioned and replies without extra speakers | ✅ Pass | 86s |
| No-`@` speaker routing | Orchestrator / fallback selects a suitable Agent and emits selection updates | ✅ Pass | 85s |
| Multi-round handoff | Designer hands off to Coder with handoff process output | ✅ Pass | 42s |
| Parallel execution | Independent files can be written in parallel with `write_text_file` | ✅ Pass | 84s |
| Dependency waiting | Coder waits for Designer, emits `execution_waiting`, then completes read/write tools | ✅ Pass | 92s |
| Image attachment | Team Agent reads the image and answers the main color | ✅ Pass | 35s |
| Web tool invocation | `web_fetch` fetches `https://example.com` with process output and source link | ✅ Pass | 38s |
| Cancel | Active run becomes `cancelled` and handoff is reset | ✅ Pass | 1s |
| `/clear` | Messages, runs, and handoff state are cleared | ✅ Pass | 1s |

Fixes validated by this run:

- Provider replay now isolates every scenario in a separate runtime to prevent state pollution.
- Team orchestrator has a default 30-second timeout and falls back to local routing when the Provider stalls.
- Fallback execution planning recognizes inline Agent names and workspace paths such as `Designer`, `Coder`, `docs/...`, and `src/...`.
- Dependency-waiting assertions now require a waiting update, `read_text_file`, `write_text_file`, and zero failed tool invocations.

Residual observations:

- Real Providers can still have network tail latency or occasional connection timeouts; the runtime surfaces readable recovery messages.
- No-`@` routing still benefits from the orchestrator when it returns quickly, but fallback now protects the chat from silent freezes.
