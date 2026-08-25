import { afterEach, describe, expect, it, vi } from "bun:test";
import type {
	Api,
	ApiKeyResolver,
	AssistantMessage,
	AssistantMessageEvent,
	AssistantMessageEventStream,
	Context,
	Model,
} from "@oh-my-pi/pi-ai";
import { parseBakeoffModels, renderBakeoffReport, runBakeoffCommand } from "@oh-my-pi/pi-coding-agent/bakeoff";
import type { BenchModelRegistry } from "@oh-my-pi/pi-coding-agent/cli/bench-runtime";
import Bakeoff from "@oh-my-pi/pi-coding-agent/commands/bakeoff";

afterEach(() => {
	vi.restoreAllMocks();
});

function fakeModel(provider: string, id: string): Model<Api> {
	return {
		provider,
		id,
		name: id,
		api: "openai-completions",
		maxTokens: 4096,
		contextWindow: 128_000,
	} as unknown as Model<Api>;
}

function replyStream(text: string): AssistantMessageEventStream {
	const message = {
		role: "assistant",
		content: [{ type: "text", text }],
		stopReason: "stop",
		usage: { input: 10, output: 5 },
		duration: 100,
	} as unknown as AssistantMessage;
	const events = [{ type: "done", message }] as unknown as AssistantMessageEvent[];
	const iterator = (async function* () {
		for (const event of events) yield event;
	})();
	return Object.assign(iterator, { result: async () => message }) as unknown as AssistantMessageEventStream;
}

const alpha = fakeModel("acme", "alpha");
const beta = fakeModel("acme", "beta");
const gamma = fakeModel("acme", "gamma");

const registry: BenchModelRegistry = {
	getAll: () => [alpha, beta, gamma],
	getAvailable: () => [alpha, gamma],
	getApiKey: async model => (model.id === "beta" ? undefined : "sk-test"),
	resolver: () => (() => Promise.resolve("sk-test")) as unknown as ApiKeyResolver,
	hasConfiguredAuth: model => model.id !== "beta",
};

describe("renderBakeoffReport", () => {
	it("lists every model and marks skipped ones; two calls with the same results are equal", () => {
		const results = [
			{ model: "acme/alpha", output: "hello from alpha" },
			{ model: "acme/beta", skippedReason: 'no configured auth for provider "acme"' },
			{ model: "acme/gamma", output: "hello from gamma" },
		];
		const report = renderBakeoffReport(results);
		expect(report).toBe(renderBakeoffReport(results));
		expect(report).toContain("| acme/alpha | completed |");
		expect(report).toContain("| acme/beta | skipped |");
		expect(report).toContain("| acme/gamma | completed |");
		expect(report).toContain("## acme/alpha");
		expect(report).toContain("hello from alpha");
		expect(report).toContain("## acme/beta");
		expect(report).toContain('Skipped: no configured auth for provider "acme"');
		expect(report).toContain("## acme/gamma");
		expect(report).toContain("hello from gamma");
		expect(report.indexOf("acme/alpha")).toBeLessThan(report.indexOf("acme/beta"));
		expect(report.indexOf("acme/beta")).toBeLessThan(report.indexOf("acme/gamma"));
	});
});

describe("--models parsing", () => {
	it("splits a comma list, trims whitespace, and drops empty tokens", () => {
		expect(parseBakeoffModels("opus,sonnet,gpt-5.2")).toEqual(["opus", "sonnet", "gpt-5.2"]);
		expect(parseBakeoffModels("opus, sonnet ,gpt-5.2")).toEqual(["opus", "sonnet", "gpt-5.2"]);
		expect(parseBakeoffModels("opus,,sonnet,")).toEqual(["opus", "sonnet"]);
	});

	it("parses the --models flag as that comma list", async () => {
		const command = new Bakeoff(["--models", "opus, sonnet,gpt-5.2", "Say", "hi"], {
			bin: "omp",
			version: "0",
			commands: new Map(),
		});
		const parsed = await command.parse(Bakeoff);
		expect(parsed.flags.models).toBe("opus, sonnet,gpt-5.2");
		expect(parseBakeoffModels(parsed.flags.models)).toEqual(["opus", "sonnet", "gpt-5.2"]);
		expect(parsed.args.prompt).toEqual(["Say", "hi"]);
	});
});

describe("bakeoff completion seam", () => {
	it("calls each requested model through the injected seam and aggregates without a real API key", async () => {
		const prompt = "Write a haiku about Bun";
		const seam = {
			streamSimple: (model: Model<Api>, _context: Context) => replyStream(`from ${model.id}`),
		};
		const spy = vi.spyOn(seam, "streamSimple");
		const calledIds: string[] = [];
		spy.mockImplementation((model, context) => {
			calledIds.push(`${model.provider}/${model.id}`);
			const last = context.messages[context.messages.length - 1];
			expect(typeof last?.content === "string" ? last.content : "").toBe(prompt);
			return replyStream(`from ${model.id}`);
		});

		const results = await runBakeoffCommand(
			{ models: ["acme/alpha", "acme/beta", "acme/gamma"], prompt },
			{
				createRuntime: async () => ({ modelRegistry: registry, close: () => {} }),
				streamSimple: (model, context, options) => seam.streamSimple(model, context, options),
				randomSessionId: () => "sess-0",
				writeStdout: () => {},
				writeStderr: () => {},
				setExitCode: () => {},
			},
		);

		expect(calledIds).toEqual(["acme/alpha", "acme/gamma"]);
		expect(spy).toHaveBeenCalledTimes(2);
		expect(results).toEqual([
			{ model: "acme/alpha", output: "from alpha" },
			{ model: "acme/beta", skippedReason: 'no configured auth for provider "acme"' },
			{ model: "acme/gamma", output: "from gamma" },
		]);
		const report = renderBakeoffReport(results);
		expect(report).toContain("| acme/beta | skipped |");
		expect(report).toContain("from alpha");
		expect(report).toContain("from gamma");
	});
});
