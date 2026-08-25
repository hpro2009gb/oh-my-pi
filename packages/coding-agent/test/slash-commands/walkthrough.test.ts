import { describe, expect, it, vi } from "bun:test";
import type { AgentMessage } from "@oh-my-pi/pi-agent-core";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { executeAcpBuiltinSlashCommand } from "@oh-my-pi/pi-coding-agent/slash-commands/acp-builtins";
import { lookupBuiltinSlashCommand } from "@oh-my-pi/pi-coding-agent/slash-commands/builtin-registry";
import type { SlashCommandRuntime } from "@oh-my-pi/pi-coding-agent/slash-commands/types";

function assistantCalls(
	toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>,
): AgentMessage {
	return {
		role: "assistant",
		content: toolCalls.map(tc => ({
			type: "toolCall",
			id: tc.id,
			name: tc.name,
			arguments: tc.arguments,
		})),
	} as unknown as AgentMessage;
}

function toolResult(toolCallId: string, toolName: string, details: unknown): AgentMessage {
	return {
		role: "toolResult",
		toolCallId,
		toolName,
		content: [{ type: "text", text: "" }],
		details,
		isError: false,
		timestamp: 0,
	} as unknown as AgentMessage;
}

function acpRuntime(options?: { enabled?: boolean; messages?: AgentMessage[] }) {
	const settings =
		options?.enabled === undefined
			? Settings.isolated()
			: Settings.isolated({ "walkthrough.enabled": options.enabled });
	const output = vi.fn();
	const runtime = {
		session: { messages: options?.messages ?? [] },
		settings,
		output,
	} as unknown as SlashCommandRuntime;
	return { output, runtime, settings };
}

describe("/walkthrough slash command", () => {
	it("is registered as a builtin slash command", () => {
		const spec = lookupBuiltinSlashCommand("walkthrough");
		expect(spec?.name).toBe("walkthrough");
		expect(spec?.handle).toBeTypeOf("function");
	});

	it("tells the user the feature is off when walkthrough.enabled is unset", async () => {
		const h = acpRuntime();
		expect(h.settings.get("walkthrough.enabled")).toBe(false);
		expect(await executeAcpBuiltinSlashCommand("/walkthrough", h.runtime)).toEqual({ consumed: true });
		expect(h.output).toHaveBeenCalledTimes(1);
		const message = String(h.output.mock.calls[0]?.[0]);
		expect(message.toLowerCase()).toContain("off");
		expect(message).not.toContain("## Summary");
	});

	it("tells the user the feature is off when walkthrough.enabled is false", async () => {
		const h = acpRuntime({ enabled: false });
		expect(await executeAcpBuiltinSlashCommand("/walkthrough", h.runtime)).toEqual({ consumed: true });
		const message = String(h.output.mock.calls[0]?.[0]);
		expect(message.toLowerCase()).toContain("off");
	});

	it("emits a walkthrough citing session file changes and bash evidence when enabled", async () => {
		const h = acpRuntime({
			enabled: true,
			messages: [
				assistantCalls([
					{ id: "w1", name: "write", arguments: { path: "src/hello.ts", content: "export {}" } },
					{
						id: "b1",
						name: "bash",
						arguments: { command: "bun test src/hello.test.ts", purpose: "cover src/hello.ts" },
					},
				]),
				toolResult("w1", "write", {}),
				toolResult("b1", "bash", { exitCode: 0 }),
			],
		});
		expect(await executeAcpBuiltinSlashCommand("/walkthrough", h.runtime)).toEqual({ consumed: true });
		expect(h.output).toHaveBeenCalledTimes(1);
		const markdown = String(h.output.mock.calls[0]?.[0]);
		expect(markdown).toContain("## Summary");
		expect(markdown).toContain("`src/hello.ts` (write)");
		expect(markdown).toContain("`bun test src/hello.test.ts` (exit 0) — cover src/hello.ts");
	});
});
