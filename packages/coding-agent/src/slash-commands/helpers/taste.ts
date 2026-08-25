import { appendTasteEntry, type TasteVerdict } from "../../taste";
import { shortenPath } from "../../tools/render-utils";
import { parseCommandArgs } from "../../utils/command-args";
import type { ParsedSlashCommand, SlashCommandResult, SlashCommandRuntime } from "../types";
import { commandConsumed, errorMessage, parseSubcommand, usage } from "./parse";

const VERDICTS = new Set<TasteVerdict>(["accept", "reject"]);

/**
 * `/taste accept|reject <path> [reason]` — append-only project taste log.
 * Disabled unless `taste.enabled` is on; never injects into the system prompt.
 */
export async function handleTasteCommand(
	command: ParsedSlashCommand,
	runtime: SlashCommandRuntime,
): Promise<SlashCommandResult> {
	if (!runtime.settings.get("taste.enabled")) {
		return usage("Taste is disabled. Enable taste.enabled before using /taste.", runtime);
	}

	const { verb, rest } = parseSubcommand(command.args);
	if (!VERDICTS.has(verb as TasteVerdict)) {
		return usage("Usage: /taste accept|reject <path> [reason]", runtime);
	}

	const tokens = parseCommandArgs(rest);
	const targetPath = tokens[0];
	if (!targetPath) {
		return usage("Usage: /taste accept|reject <path> [reason]", runtime);
	}

	const reason = tokens.slice(1).join(" ").trim();
	try {
		const filePath = await appendTasteEntry(runtime.cwd, {
			verdict: verb as TasteVerdict,
			targetPath,
			reason,
		});
		await runtime.output(`Recorded ${verb} for ${targetPath} in ${shortenPath(filePath)}.`);
		return commandConsumed();
	} catch (error) {
		return usage(errorMessage(error), runtime);
	}
}
