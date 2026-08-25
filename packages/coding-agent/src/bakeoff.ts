/**
 * `omp bakeoff` — one-shot side-by-side completions of the same prompt.
 *
 * Each requested model gets a single completion (not a full agent run). Models
 * without configured auth are skipped with a note rather than crashing the
 * comparison; unresolved selectors are skipped the same way so the report
 * always lists every requested model.
 */
import type { ResolvedThinkingLevel } from "@oh-my-pi/pi-agent-core";
import { type Api, type AssistantMessage, type Context, type Model, streamSimple } from "@oh-my-pi/pi-ai";
import chalk from "@oh-my-pi/pi-utils/chalk";
import {
	type BenchModelRegistry,
	type BenchRuntime,
	createDefaultBenchRuntime,
	type StreamSimpleFn,
} from "./cli/bench-runtime";
import {
	formatModelString,
	getModelMatchPreferences,
	normalizeModelPatternList,
	resolveCliModel,
} from "./config/model-resolver";
import {
	concreteThinkingLevel,
	resolveThinkingLevelForModel,
	shouldDisableReasoning,
	toReasoningEffort,
} from "./thinking";

const DEFAULT_MAX_TOKENS = 8192;

/** One requested model's outcome: a completion, or why it was skipped. */
export interface BakeoffModelResult {
	model: string;
	output?: string;
	skippedReason?: string;
}

export interface BakeoffCommandArgs {
	models: string[];
	prompt: string;
}

export interface BakeoffDependencies {
	createRuntime?: () => Promise<BenchRuntime>;
	streamSimple?: StreamSimpleFn;
	randomSessionId?: () => string;
	writeStdout?: (text: string) => void;
	writeStderr?: (text: string) => void;
	setExitCode?: (code: number) => void;
}

/** Split `--models` into ordered selectors: commas, surrounding whitespace, empty tokens dropped. */
export function parseBakeoffModels(value: string | string[] | undefined): string[] {
	return normalizeModelPatternList(value);
}

/**
 * Deterministic markdown report: one table row and one section per result, in
 * request order. Skipped models are labeled `skipped` and their reason is the
 * section body. Two calls with the same results return the same string.
 */
export function renderBakeoffReport(results: readonly BakeoffModelResult[]): string {
	const lines: string[] = ["# Bakeoff", "", "| Model | Result |", "| --- | --- |"];
	for (const result of results) {
		const status = result.skippedReason ? "skipped" : "completed";
		lines.push(`| ${result.model} | ${status} |`);
	}
	for (const result of results) {
		lines.push("", `## ${result.model}`, "");
		if (result.skippedReason) {
			lines.push(`Skipped: ${result.skippedReason}`);
		} else {
			lines.push(result.output ?? "");
		}
	}
	return `${lines.join("\n")}\n`;
}

function assistantText(message: AssistantMessage): string {
	return message.content
		.filter(content => content.type === "text")
		.map(content => content.text)
		.join("");
}

function errorText(error: unknown): string {
	if (error instanceof Error && error.message) return error.message;
	return String(error);
}

function skipReasonForMissingAuth(model: Model<Api>): string {
	return `no configured auth for provider "${model.provider}"`;
}

async function modelHasConfiguredAuth(registry: BenchModelRegistry, model: Model<Api>): Promise<boolean> {
	if (registry.hasConfiguredAuth) return registry.hasConfiguredAuth(model);
	return (await registry.getApiKey(model)) !== undefined;
}

async function completeOnce(
	model: Model<Api>,
	prompt: string,
	runtime: BenchRuntime,
	stream: StreamSimpleFn,
	sessionId: string,
	thinking: ResolvedThinkingLevel | undefined,
): Promise<{ output?: string; skippedReason?: string }> {
	const context: Context = {
		messages: [{ role: "user", content: prompt, timestamp: 0, attribution: "user" }],
	};
	const maxTokens =
		model.maxTokens !== null && Number.isFinite(model.maxTokens) && model.maxTokens > 0
			? Math.min(DEFAULT_MAX_TOKENS, model.maxTokens)
			: DEFAULT_MAX_TOKENS;
	try {
		const streamResult = stream(model, context, {
			apiKey: runtime.modelRegistry.resolver(model, sessionId),
			sessionId,
			maxTokens,
			temperature: 0,
			reasoning: toReasoningEffort(thinking),
			disableReasoning: shouldDisableReasoning(thinking) ? true : undefined,
		});
		let message: AssistantMessage | undefined;
		for await (const event of streamResult) {
			if (event.type === "error") {
				return { skippedReason: event.error.errorMessage ?? "request failed" };
			}
			if (event.type === "done") message = event.message;
		}
		message ??= await streamResult.result();
		if (message.stopReason === "error" || message.errorMessage) {
			return { skippedReason: message.errorMessage ?? "request failed" };
		}
		return { output: assistantText(message) };
	} catch (error) {
		return { skippedReason: errorText(error) };
	}
}

async function bakeoffOne(
	selector: string,
	prompt: string,
	runtime: BenchRuntime,
	stream: StreamSimpleFn,
	sessionId: string,
	writeStderr: (text: string) => void,
): Promise<BakeoffModelResult> {
	const preferences = getModelMatchPreferences(runtime.settings);
	const resolved = resolveCliModel({
		cliModel: selector,
		modelRegistry: runtime.modelRegistry,
		availableModels: runtime.modelRegistry.getAll(),
		settings: runtime.settings,
		preferences,
	});
	if (resolved.error || !resolved.model) {
		const skippedReason = resolved.error ?? "model not found";
		writeStderr(`${chalk.yellow(`Skipping ${selector}: ${skippedReason}`)}\n`);
		return { model: selector, skippedReason };
	}
	if (resolved.warning) writeStderr(`${chalk.yellow(`Warning: ${resolved.warning}`)}\n`);
	const model = resolved.model;
	const label = formatModelString(model);
	if (!(await modelHasConfiguredAuth(runtime.modelRegistry, model))) {
		const skippedReason = skipReasonForMissingAuth(model);
		writeStderr(`${chalk.yellow(`Skipping ${label}: ${skippedReason}`)}\n`);
		return { model: label, skippedReason };
	}
	const thinking = resolveThinkingLevelForModel(model, concreteThinkingLevel(resolved.thinkingLevel));
	const outcome = await completeOnce(model, prompt, runtime, stream, sessionId, thinking);
	return { model: label, ...outcome };
}

/** Resolve selectors, complete every authenticated model, and print the report. */
export async function runBakeoffCommand(
	command: BakeoffCommandArgs,
	deps: BakeoffDependencies = {},
): Promise<BakeoffModelResult[]> {
	if (command.models.length === 0) {
		throw new Error('Pass at least one model via --models, e.g. `omp bakeoff --models opus,sonnet "Hello"`');
	}
	if (!command.prompt.trim()) {
		throw new Error('Pass a prompt after --models, e.g. `omp bakeoff --models opus,sonnet "Hello"`');
	}

	const writeStdout = deps.writeStdout ?? ((text: string) => process.stdout.write(text));
	const writeStderr = deps.writeStderr ?? ((text: string) => process.stderr.write(text));
	const setExitCode =
		deps.setExitCode ??
		((code: number) => {
			process.exitCode = code;
		});
	const stream = deps.streamSimple ?? streamSimple;
	const randomSessionId = deps.randomSessionId ?? (() => Bun.randomUUIDv7());

	const runtime = await (deps.createRuntime ?? createDefaultBenchRuntime)();
	try {
		const results: BakeoffModelResult[] = [];
		for (const selector of command.models) {
			results.push(await bakeoffOne(selector, command.prompt, runtime, stream, randomSessionId(), writeStderr));
		}
		writeStdout(renderBakeoffReport(results));
		if (results.every(result => result.skippedReason !== undefined)) setExitCode(1);
		return results;
	} finally {
		runtime.close?.();
	}
}
