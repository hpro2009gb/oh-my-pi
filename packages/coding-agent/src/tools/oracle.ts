import { type } from "@oh-my-pi/omptype";
import type { AgentTool, AgentToolResult } from "@oh-my-pi/pi-agent-core";
import type { ToolExample } from "@oh-my-pi/pi-ai";
import { logger, prompt } from "@oh-my-pi/pi-utils";
import * as completionBridge from "../eval/completion-bridge";
import oracleDescription from "../prompts/tools/oracle.md" with { type: "text" };
import oracleConsultTemplate from "../prompts/tools/oracle-consult.md" with { type: "text" };
import oracleSystemPrompt from "../prompts/tools/oracle-system.md" with { type: "text" };
import type { ToolSession } from ".";
import { ToolError } from "./tool-errors";

const ORACLE_TIERS = ["slow", "plan", "default"] as const;

const oracleSchema = type({
	"question?": type("string").describe("consult question"),
	"prompt?": type("string").describe("alias for question"),
	"context?": type("string").describe("optional isolated context for the consult"),
});

type OracleParams = typeof oracleSchema.infer;

interface OracleToolDetails {
	model: string;
	tier: string;
}

const EMPTY_QUESTION_ERROR = "oracle requires a non-empty `question` (or `prompt`) string";

function resolveQuestion(params: OracleParams): string {
	const raw = typeof params.question === "string" ? params.question : params.prompt;
	return typeof raw === "string" ? raw.trim() : "";
}

function isUnresolvedTierError(err: unknown): err is ToolError {
	return err instanceof ToolError && err.message.includes("could not resolve a model");
}

async function runOracleConsult(
	userPrompt: string,
	options: { session: ToolSession; signal?: AbortSignal },
): Promise<completionBridge.EvalCompletionResult> {
	const system = prompt.render(oracleSystemPrompt).trim();
	let lastError: unknown;
	for (const model of ORACLE_TIERS) {
		try {
			return await completionBridge.runEvalCompletion({ prompt: userPrompt, model, system }, options);
		} catch (err) {
			lastError = err;
			if (!isUnresolvedTierError(err)) throw err;
			logger.debug("oracle consult tier unavailable, trying next", { model, reason: err.message });
		}
	}
	if (lastError instanceof Error) throw lastError;
	throw new ToolError("oracle could not resolve a consult model for the slow, plan, or default roles.");
}

/** Isolated one-shot high-reasoning consult. Hidden unless `oracle.enabled` is true. */
export class OracleTool implements AgentTool<typeof oracleSchema, OracleToolDetails> {
	readonly name = "oracle";
	readonly approval = "read" as const;
	readonly label = "Oracle";
	readonly summary = "Isolated high-reasoning consult";
	readonly description: string;
	readonly parameters = oracleSchema;
	readonly strict = true;
	readonly loadMode = "discoverable";
	readonly examples: readonly ToolExample<typeof oracleSchema.infer>[] = [
		{
			caption: "Architecture tradeoff",
			call: { question: "Should this queue drop the oldest event or block the producer?" },
		},
		{
			caption: "Consult with isolated context",
			call: {
				question: "Which primitive fits this producer?",
				context: "single consumer, 8-core host, no persistence",
			},
		},
	];

	constructor(private readonly session: ToolSession) {
		this.description = prompt.render(oracleDescription);
	}

	static createIf(session: ToolSession): OracleTool | null {
		return session.settings.get("oracle.enabled") ? new OracleTool(session) : null;
	}

	async execute(
		_toolCallId: string,
		params: OracleParams,
		signal?: AbortSignal,
	): Promise<AgentToolResult<OracleToolDetails>> {
		const question = resolveQuestion(params);
		if (!question) {
			throw new ToolError(EMPTY_QUESTION_ERROR);
		}
		const context = typeof params.context === "string" ? params.context.trim() : "";
		const userPrompt = prompt.render(oracleConsultTemplate, {
			question,
			context: context.length > 0 ? context : undefined,
		});
		const result = await runOracleConsult(userPrompt, { session: this.session, signal });
		return {
			content: [{ type: "text", text: result.text }],
			details: { model: result.details.model, tier: result.details.tier },
		};
	}
}
