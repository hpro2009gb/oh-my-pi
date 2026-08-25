# oracle

> Isolated one-shot high-reasoning consult. Hidden unless `oracle.enabled` is true (default off).

## Source
- Entry: `packages/coding-agent/src/tools/oracle.ts`
- Model-facing prompt: `packages/coding-agent/src/prompts/tools/oracle.md`
- Consult system prompt: `packages/coding-agent/src/prompts/tools/oracle-system.md`
- Consult user template: `packages/coding-agent/src/prompts/tools/oracle-consult.md`
- Completion seam: `packages/coding-agent/src/eval/completion-bridge.ts` (`runEvalCompletion`)
- Settings: `packages/coding-agent/src/config/settings-schema.ts` (`oracle.enabled`)

## Inputs

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `question` | `string` | Yes* | Consult question. Trimmed; empty/whitespace is rejected. |
| `prompt` | `string` | Yes* | Alias for `question` when `question` is omitted. |
| `context` | `string` | No | Extra isolated material. Not the parent transcript. |

\* One of `question` or `prompt` must be a non-empty string after trim. Missing or blank values throw `ToolError` and do not call a model.

## Outputs
- Single-shot result.
- `content[0].text` is the consult model's text reply.
- `details.model` is the resolved `provider/id` string from the completion seam.
- `details.tier` is the role that answered (`slow`, `plan`, or `default`).
- Failures throw `ToolError` instead of returning an error payload. The tool does not stream updates.

## Flow
1. `OracleTool.createIf()` returns `null` unless `session.settings.get("oracle.enabled")` is true. `packages/coding-agent/src/tools/index.ts` rechecks the same setting in `isToolAllowed`.
2. `execute()` resolves `question` from `question`, else `prompt`, then trims. Empty values throw `oracle requires a non-empty \`question\` (or \`prompt\`) string` with no model call.
3. It renders the consult user prompt from the question plus optional trimmed `context`, and the consult system prompt from `oracle-system.md`.
4. It runs a fresh toolless completion through `runEvalCompletion`, trying `@slow`, then `@plan`, then default. The parent transcript is not sent.
5. The returned text is the tool result. Unresolved-tier errors continue to the next role; other completion errors propagate.

## Modes / Variants
- **Availability gate**: hidden when `oracle.enabled` is false (default). Discoverable load mode; read approval.
- **Role fallback**: `slow` first, then `plan`, then `default` via the eval completion seam.
- **`prompt` alias**: same as `question` when `question` is omitted; `question` wins when both are present.

## Side Effects
- Network: one (or more, on role fallback) provider completion request. No workspace mutation.
- Session state: reads settings and the session model registry/roles. Does not append the parent transcript.
- Background work / cancellation: forwards the caller `AbortSignal` to `runEvalCompletion`.

## Limits & Caps
- Isolated context only: the consult sees the supplied question plus optional `context`.
- No tools on the consult completion.
- Empty/whitespace `question`/`prompt` never reaches a provider.

## Errors
- Missing/empty question: `ToolError("oracle requires a non-empty \`question\` (or \`prompt\`) string")`.
- No resolvable `slow`/`plan`/`default` model: the last `runEvalCompletion` resolution `ToolError`.
- Provider/abort failures: `ToolError` from `runEvalCompletion` (`completion() request failed.`, `completion() request aborted.`, missing API key, empty text).

## Notes
- Enable with `oracle.enabled` in settings (Available Tools) or project/user config.
- Prefer this over spawning a subagent when you need a single high-reasoning opinion without tools or history.
