import { describe, expect, it } from "bun:test";
import type { AgentMessage } from "@oh-my-pi/pi-agent-core";
import {
	buildWalkthrough,
	collectWalkthroughInput,
	type WalkthroughInput,
} from "@oh-my-pi/pi-coding-agent/walkthrough";

const FIXTURE: WalkthroughInput = {
	summary: "Patched the walkthrough renderer and added coverage.",
	changes: [
		{ path: "packages/coding-agent/src/walkthrough.ts", kind: "write" },
		{ path: "packages/coding-agent/test/walkthrough.test.ts", kind: "edit" },
		{ path: "packages/coding-agent/src/obsolete.ts", kind: "delete" },
	],
	commands: [
		{
			command: "bun test packages/coding-agent/test/walkthrough.test.ts",
			exitCode: 0,
			purpose: "verify walkthrough.test.ts citations",
		},
		{
			command: "bunx biome check packages/coding-agent/src/walkthrough.ts",
			exitCode: 0,
			purpose: "lint walkthrough.ts",
		},
		{ command: "echo leftover", exitCode: 0, purpose: "unrelated smoke" },
	],
};

function assistantCalls(
	toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown>; intent?: string }>,
): AgentMessage {
	return {
		role: "assistant",
		content: toolCalls.map(tc => ({
			type: "toolCall",
			id: tc.id,
			name: tc.name,
			arguments: tc.arguments,
			intent: tc.intent,
		})),
	} as unknown as AgentMessage;
}

function toolResult(toolCallId: string, toolName: string, details: unknown, isError = false): AgentMessage {
	return {
		role: "toolResult",
		toolCallId,
		toolName,
		content: [{ type: "text", text: "" }],
		details,
		isError,
		timestamp: 0,
	} as unknown as AgentMessage;
}

describe("buildWalkthrough", () => {
	it("renders file changes with purpose-matched evidence citations", () => {
		const markdown = buildWalkthrough(FIXTURE);

		expect(markdown).toContain("## Summary");
		expect(markdown).toContain("## Changes");
		expect(markdown).toContain("## Evidence");
		expect(markdown).toContain("`packages/coding-agent/src/walkthrough.ts` (write)");
		expect(markdown).toContain("`packages/coding-agent/test/walkthrough.test.ts` (edit)");
		expect(markdown).toContain("`packages/coding-agent/src/obsolete.ts` (delete)");
		expect(markdown).toContain(
			"`bunx biome check packages/coding-agent/src/walkthrough.ts` (exit 0) — lint walkthrough.ts",
		);
		expect(markdown).toContain(
			"`bun test packages/coding-agent/test/walkthrough.test.ts` (exit 0) — verify walkthrough.test.ts citations",
		);

		const walkthroughBlock = markdown.slice(
			markdown.indexOf("`packages/coding-agent/src/walkthrough.ts` (write)"),
			markdown.indexOf("`packages/coding-agent/test/walkthrough.test.ts` (edit)"),
		);
		expect(walkthroughBlock).toContain("bunx biome check packages/coding-agent/src/walkthrough.ts");
		expect(walkthroughBlock).not.toContain("bun test packages/coding-agent/test/walkthrough.test.ts");
		expect(walkthroughBlock).not.toContain("echo leftover");

		const testBlock = markdown.slice(
			markdown.indexOf("`packages/coding-agent/test/walkthrough.test.ts` (edit)"),
			markdown.indexOf("`packages/coding-agent/src/obsolete.ts` (delete)"),
		);
		expect(testBlock).toContain("bun test packages/coding-agent/test/walkthrough.test.ts");
		expect(testBlock).not.toContain("bunx biome check");
	});

	it("lists every command when no purpose or command string matches a change", () => {
		const markdown = buildWalkthrough({
			changes: [{ path: "src/unrelated.ts", kind: "edit" }],
			commands: [{ command: "bun test", exitCode: 0, purpose: "suite" }],
		});
		const changeBlock = markdown.slice(markdown.indexOf("## Changes"), markdown.indexOf("## Evidence"));
		expect(changeBlock).toContain("`bun test` (exit 0) — suite");
	});

	it("emits a no-changes artifact for empty input", () => {
		const markdown = buildWalkthrough({ changes: [], commands: [] });
		expect(markdown).toBe(
			[
				"## Summary",
				"",
				"No changes recorded.",
				"",
				"## Changes",
				"",
				"No changes recorded.",
				"",
				"## Evidence",
				"",
				"No commands recorded.",
				"",
			].join("\n"),
		);
	});

	it("returns identical markdown for the same input", () => {
		expect(buildWalkthrough(FIXTURE)).toBe(buildWalkthrough(FIXTURE));
		const empty = { changes: [], commands: [] };
		expect(buildWalkthrough(empty)).toBe(buildWalkthrough(empty));
	});
});

describe("collectWalkthroughInput", () => {
	it("maps edit/write/delete/apply_patch calls and bash exit codes from the transcript", () => {
		const input = collectWalkthroughInput([
			assistantCalls([
				{ id: "w1", name: "write", arguments: { path: "src/a.ts", content: "export {}" } },
				{ id: "e1", name: "edit", arguments: { path: "src/b.ts" } },
				{ id: "d1", name: "delete", arguments: { path: "src/gone.ts" } },
				{
					id: "p1",
					name: "apply_patch",
					arguments: {
						input: ["*** Begin Patch", "*** Add File: src/new.ts", "+hi", "*** End Patch"].join("\n"),
					},
				},
				{
					id: "b1",
					name: "bash",
					arguments: { command: "bun test src/a.test.ts", purpose: "verify src/a.ts" },
				},
			]),
			toolResult("w1", "write", {}),
			toolResult("e1", "edit", {}),
			toolResult("d1", "delete", {}),
			toolResult("p1", "apply_patch", {}),
			toolResult("b1", "bash", { exitCode: 0 }),
		]);

		expect(input.changes).toEqual([
			{ path: "src/a.ts", kind: "write" },
			{ path: "src/b.ts", kind: "edit" },
			{ path: "src/gone.ts", kind: "delete" },
			{ path: "src/new.ts", kind: "write" },
		]);
		expect(input.commands).toEqual([{ command: "bun test src/a.test.ts", exitCode: 0, purpose: "verify src/a.ts" }]);
	});
});
