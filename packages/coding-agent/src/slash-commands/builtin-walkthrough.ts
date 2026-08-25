import { buildWalkthrough, collectWalkthroughInput } from "../walkthrough";
import { commandConsumed, usage } from "./helpers/parse";
import type { SlashCommandSpec } from "./types";

const WALKTHROUGH_DISABLED_MESSAGE =
	"Walkthrough is off. Enable walkthrough.enabled in Developer settings to generate an artifact.";

export const BUILTIN_WALKTHROUGH_SLASH_COMMANDS: ReadonlyArray<SlashCommandSpec> = [
	{
		name: "walkthrough",
		icon: "clipboard",
		description: "Build a walkthrough artifact from this session's tool history",
		acpDescription: "Build a walkthrough artifact from session tool history",
		handle: async (_command, runtime) => {
			if (!runtime.settings.get("walkthrough.enabled")) {
				return usage(WALKTHROUGH_DISABLED_MESSAGE, runtime);
			}
			const markdown = buildWalkthrough(collectWalkthroughInput(runtime.session.messages));
			await runtime.output(markdown);
			return commandConsumed();
		},
	},
];
