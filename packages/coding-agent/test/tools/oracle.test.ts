import { afterEach, describe, expect, it, vi } from "bun:test";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { getDefault } from "@oh-my-pi/pi-coding-agent/config/settings-schema";
import * as completionBridge from "@oh-my-pi/pi-coding-agent/eval/completion-bridge";
import { createTools, OracleTool, type ToolSession } from "@oh-my-pi/pi-coding-agent/tools";
import { ToolError } from "@oh-my-pi/pi-coding-agent/tools/tool-errors";

Bun.env.PI_PYTHON_SKIP_CHECK = "1";

function makeSession(overrides: Partial<ToolSession> = {}): ToolSession {
	return {
		cwd: "/tmp/oracle-test",
		hasUI: false,
		skipPythonPreflight: true,
		getSessionFile: () => null,
		getSessionSpawns: () => "*",
		settings: Settings.isolated(),
		...overrides,
	};
}

describe("oracle tool", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("defaults oracle.enabled to false", () => {
		expect(getDefault("oracle.enabled")).toBe(false);
		expect(Settings.isolated().get("oracle.enabled")).toBe(false);
	});

	it("createIf returns null when oracle.enabled is false", () => {
		expect(OracleTool.createIf(makeSession())).toBeNull();
		expect(
			OracleTool.createIf(
				makeSession({
					settings: Settings.isolated({ "oracle.enabled": false }),
				}),
			),
		).toBeNull();
	});

	it("createIf returns a tool when oracle.enabled is true", () => {
		const tool = OracleTool.createIf(
			makeSession({
				settings: Settings.isolated({ "oracle.enabled": true }),
			}),
		);
		expect(tool).toBeInstanceOf(OracleTool);
		expect(tool?.name).toBe("oracle");
	});

	it("omits oracle from the allowed set when disabled, including explicit requests", async () => {
		const tools = await createTools(makeSession({ settings: Settings.isolated({ "tools.xdev": false }) }));
		expect(tools.map(tool => tool.name)).not.toContain("oracle");

		const requested = await createTools(
			makeSession({
				settings: Settings.isolated({ "oracle.enabled": false }),
			}),
			["oracle", "read"],
		);
		expect(requested.map(tool => tool.name)).toEqual(["read"]);
	});

	it("includes oracle in the allowed set when enabled", async () => {
		const tools = await createTools(
			makeSession({
				settings: Settings.isolated({ "oracle.enabled": true, "tools.xdev": false }),
			}),
		);
		expect(tools.map(tool => tool.name)).toContain("oracle");

		const requested = await createTools(
			makeSession({
				settings: Settings.isolated({ "oracle.enabled": true }),
			}),
			["oracle"],
		);
		expect(requested.map(tool => tool.name)).toEqual(["oracle"]);
	});

	it("rejects an empty or missing question without calling the completion seam", async () => {
		const spy = vi.spyOn(completionBridge, "runEvalCompletion");
		const tool = OracleTool.createIf(
			makeSession({
				settings: Settings.isolated({ "oracle.enabled": true }),
			}),
		);
		if (!tool) throw new Error("expected oracle tool");

		await expect(tool.execute("call-empty", { question: "" })).rejects.toBeInstanceOf(ToolError);
		await expect(tool.execute("call-blank", { question: "   " })).rejects.toBeInstanceOf(ToolError);
		await expect(tool.execute("call-missing", {})).rejects.toBeInstanceOf(ToolError);
		await expect(tool.execute("call-empty-prompt", { prompt: "" })).rejects.toBeInstanceOf(ToolError);

		expect(spy).not.toHaveBeenCalled();
	});

	it("forwards the question to a slow-role completion and returns the text", async () => {
		const spy = vi.spyOn(completionBridge, "runEvalCompletion").mockResolvedValue({
			text: "consider a lock-free ring buffer",
			details: { model: "p/slow", tier: "slow", structured: false },
		});
		const tool = OracleTool.createIf(
			makeSession({
				settings: Settings.isolated({ "oracle.enabled": true }),
			}),
		);
		if (!tool) throw new Error("expected oracle tool");

		const result = await tool.execute("call-question", {
			question: "How should this queue drop the oldest event?",
		});

		expect(spy).toHaveBeenCalledTimes(1);
		const [args] = spy.mock.calls[0] ?? [];
		expect(args).toEqual(
			expect.objectContaining({
				model: "slow",
				prompt: expect.stringContaining("How should this queue drop the oldest event?"),
			}),
		);
		expect(result.content[0]).toEqual({
			type: "text",
			text: "consider a lock-free ring buffer",
		});
	});

	it("accepts prompt as an alias for question and includes optional context", async () => {
		const spy = vi.spyOn(completionBridge, "runEvalCompletion").mockResolvedValue({
			text: "use a bounded channel",
			details: { model: "p/slow", tier: "slow", structured: false },
		});
		const tool = OracleTool.createIf(
			makeSession({
				settings: Settings.isolated({ "oracle.enabled": true }),
			}),
		);
		if (!tool) throw new Error("expected oracle tool");

		const result = await tool.execute("call-prompt", {
			prompt: "Which primitive fits this producer?",
			context: "single consumer, 8-core host",
		});

		expect(spy).toHaveBeenCalledTimes(1);
		const [args] = spy.mock.calls[0] ?? [];
		expect(args).toEqual(
			expect.objectContaining({
				model: "slow",
				prompt: expect.stringContaining("Which primitive fits this producer?"),
			}),
		);
		expect(String((args as { prompt: string }).prompt)).toContain("single consumer, 8-core host");
		expect(result.content[0]).toEqual({ type: "text", text: "use a bounded channel" });
	});

	it("falls back to plan, then default, when slower roles cannot resolve", async () => {
		const spy = vi.spyOn(completionBridge, "runEvalCompletion").mockImplementation(async args => {
			const model = (args as { model?: string }).model;
			if (model === "slow") {
				throw new ToolError('completion() could not resolve a model for the "slow" tier.');
			}
			if (model === "plan") {
				throw new ToolError('completion() could not resolve a model for the "plan" tier.');
			}
			if (model === "default") {
				return {
					text: "default consult",
					details: { model: "p/default", tier: "default", structured: false },
				};
			}
			throw new ToolError(`unexpected tier ${model}`);
		});
		const tool = OracleTool.createIf(
			makeSession({
				settings: Settings.isolated({ "oracle.enabled": true }),
			}),
		);
		if (!tool) throw new Error("expected oracle tool");

		const result = await tool.execute("call-fallback", { question: "What is the tradeoff?" });

		expect(spy.mock.calls.map(call => (call[0] as { model?: string }).model)).toEqual(["slow", "plan", "default"]);
		expect(result.content[0]).toEqual({ type: "text", text: "default consult" });
	});
});
