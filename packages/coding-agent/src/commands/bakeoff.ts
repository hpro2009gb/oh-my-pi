import { Args, Command, Flags } from "@oh-my-pi/pi-utils/cli";
import { parseBakeoffModels, runBakeoffCommand } from "../bakeoff";
import { bakeoffHelp as commandHelp } from "../cli/command-help";
import { CliUsageError } from "../cli/usage-error";

export default class Bakeoff extends Command {
	static description = commandHelp.description;
	static args = {
		prompt: Args.string({
			description: "Prompt sent to every model (remaining words are joined)",
			required: true,
			multiple: true,
		}),
	};

	static flags = {
		models: Flags.string({
			description: "Comma-separated model selectors (provider/model or fuzzy id, e.g. opus,sonnet,gpt-5.2)",
			required: true,
		}),
	};

	static examples = [
		"# Same prompt, three models, one-shot completions\n  omp bakeoff --models opus,sonnet,gpt-5.2 Write a haiku about Bun",
		"# Pin providers when ids collide\n  omp bakeoff --models anthropic/claude-opus-4-5,openai/gpt-5.2 Explain async mutexes",
	];

	async run(): Promise<void> {
		const { args, flags } = await this.parse(Bakeoff);
		const models = parseBakeoffModels(flags.models);
		const prompt = (args.prompt ?? []).join(" ").trim();
		if (models.length === 0) {
			throw new CliUsageError("Pass at least one model via --models, e.g. `--models opus,sonnet`");
		}
		if (!prompt) {
			throw new CliUsageError('Pass a prompt after --models, e.g. `omp bakeoff --models opus,sonnet "Hello"`');
		}
		await runBakeoffCommand({ models, prompt });
	}
}
