import { appendFeedback, formatFeedbackList, isFeedbackEnabled, listFeedback } from "../feedback";
import { commandConsumed, usage } from "./helpers/parse";
import type { SlashCommandSpec } from "./types";

export const BUILTIN_FEEDBACK_SLASH_COMMANDS: ReadonlyArray<SlashCommandSpec> = [
	{
		name: "feedback",
		icon: "inbox",
		description: "Record a short local note about this session",
		inlineHint: "<note> | list",
		allowArgs: true,
		isAvailable: isFeedbackEnabled,
		handle: async (command, runtime) => {
			const agentDir = runtime.settings.getAgentDir();
			const trimmed = command.args.trim();
			if (trimmed.toLowerCase() === "list" || trimmed.toLowerCase() === "--list") {
				const records = await listFeedback({ agentDir });
				await runtime.output(formatFeedbackList(records));
				return commandConsumed();
			}
			if (!trimmed) return usage("Usage: /feedback <note> or /feedback list", runtime);
			const result = await appendFeedback({
				agentDir,
				text: trimmed,
				sessionId: runtime.session.sessionId || undefined,
				modelId: runtime.session.model?.id,
			});
			if (!result.ok) return usage(result.error, runtime);
			await runtime.output("Saved local feedback note.");
			return commandConsumed();
		},
	},
];
