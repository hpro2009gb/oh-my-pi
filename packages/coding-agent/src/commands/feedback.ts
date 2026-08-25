/**
 * List locally recorded `/feedback` notes. Notes are never uploaded.
 */

import { getAgentDir } from "@oh-my-pi/pi-utils";
import { Command, Flags } from "@oh-my-pi/pi-utils/cli";
import { feedbackHelp as commandHelp } from "../cli/command-help";
import { FEEDBACK_LIST_DEFAULT_LIMIT, formatFeedbackList, listFeedback } from "../feedback";

export default class Feedback extends Command {
	static description = commandHelp.description;
	static flags = {
		list: Flags.boolean({ description: "List recent local feedback notes", default: false }),
		limit: Flags.integer({
			char: "n",
			description: "Number of recent notes to show",
			default: FEEDBACK_LIST_DEFAULT_LIMIT,
		}),
		json: Flags.boolean({ char: "j", description: "Output as JSON", default: false }),
	};
	static examples = ["omp feedback --list", "omp feedback --list --limit 5", "omp feedback --json"];

	async run(): Promise<void> {
		const { flags } = await this.parse(Feedback);
		if (!flags.list && !flags.json) {
			process.stderr.write("Usage: omp feedback --list [--limit 20]\n");
			process.exitCode = 1;
			return;
		}
		const records = await listFeedback({ agentDir: getAgentDir(), limit: flags.limit });
		if (flags.json) {
			process.stdout.write(`${JSON.stringify(records, null, 2)}\n`);
			return;
		}
		process.stdout.write(`${formatFeedbackList(records)}\n`);
	}
}
