import { afterEach, describe, expect, test, vi } from "bun:test";
import { isSubcommand } from "@oh-my-pi/pi-coding-agent/cli-commands";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { getFeedbackLogPath, listFeedback } from "@oh-my-pi/pi-coding-agent/feedback";
import type { InteractiveModeContext } from "@oh-my-pi/pi-coding-agent/modes/types";
import { executeAcpBuiltinSlashCommand } from "@oh-my-pi/pi-coding-agent/slash-commands/acp-builtins";
import { buildAvailableSlashCommands } from "@oh-my-pi/pi-coding-agent/slash-commands/available-commands";
import {
	buildTuiBuiltinSlashCommands,
	executeBuiltinSlashCommand,
} from "@oh-my-pi/pi-coding-agent/slash-commands/builtin-registry";
import type { SlashCommandRuntime } from "@oh-my-pi/pi-coding-agent/slash-commands/types";
import { TempDir } from "@oh-my-pi/pi-utils";

describe("/feedback slash command", () => {
	const dirs: TempDir[] = [];

	afterEach(async () => {
		vi.restoreAllMocks();
		await Promise.all(dirs.splice(0).map(dir => dir.remove()));
	});

	async function harness(enabled?: boolean) {
		const dir = await TempDir.create("pi-feedback-slash-");
		dirs.push(dir);
		const settings = enabled === undefined ? Settings.isolated() : Settings.isolated({ "feedback.enabled": enabled });
		vi.spyOn(settings, "getAgentDir").mockReturnValue(dir.path());
		const output = vi.fn();
		const runtime = {
			settings,
			session: {
				sessionId: "sess-42",
				model: { id: "model-9" },
			},
			output,
		} as unknown as SlashCommandRuntime;
		return { dir: dir.path(), output, runtime, settings };
	}

	test("is hidden and writes nothing when feedback.enabled is off by default", async () => {
		expect(Settings.isolated().get("feedback.enabled")).toBe(false);
		const { dir, output, runtime, settings } = await harness();

		expect(await executeAcpBuiltinSlashCommand("/feedback too slow", runtime)).toBe(false);
		expect(output).not.toHaveBeenCalled();
		expect(await Bun.file(getFeedbackLogPath(dir)).exists()).toBe(false);

		const tuiHandled = await executeBuiltinSlashCommand("/feedback too slow", {
			ctx: { settings } as InteractiveModeContext,
		});
		expect(tuiHandled).toBe(false);

		const advertised = await buildAvailableSlashCommands(
			{
				settings,
				customCommands: [],
				skills: [],
				sessionManager: { getCwd: () => process.cwd() },
				setSlashCommands() {},
			},
			async () => [],
		);
		expect(advertised.some(command => command.name === "feedback")).toBe(false);

		const tuiCommands = buildTuiBuiltinSlashCommands({
			ctx: { settings } as InteractiveModeContext,
		});
		expect(tuiCommands.some(command => command.name === "feedback")).toBe(false);
		expect(isSubcommand("feedback")).toBe(true);
	});

	test("records a JSONL note with the user text when feedback.enabled is true", async () => {
		const { dir, output, runtime, settings } = await harness(true);

		expect(await executeAcpBuiltinSlashCommand("/feedback  the retry was noisy", runtime)).toEqual({
			consumed: true,
		});
		expect(output).toHaveBeenCalledWith("Saved local feedback note.");

		const records = await listFeedback({ agentDir: dir });
		expect(records).toHaveLength(1);
		expect(records[0]?.text).toBe("the retry was noisy");
		expect(records[0]?.sessionId).toBe("sess-42");
		expect(records[0]?.modelId).toBe("model-9");
		expect(records[0]?.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);

		const advertised = await buildAvailableSlashCommands(
			{
				settings,
				customCommands: [],
				skills: [],
				sessionManager: { getCwd: () => process.cwd() },
				setSlashCommands() {},
			},
			async () => [],
		);
		expect(advertised.some(command => command.name === "feedback")).toBe(true);
	});

	test("rejects empty /feedback without writing a log file", async () => {
		const { dir, output, runtime } = await harness(true);

		expect(await executeAcpBuiltinSlashCommand("/feedback   ", runtime)).toEqual({ consumed: true });
		expect(output).toHaveBeenCalledWith("Usage: /feedback <note> or /feedback list");
		expect(await Bun.file(getFeedbackLogPath(dir)).exists()).toBe(false);
	});

	test("lists recent notes without appending when invoked as /feedback list", async () => {
		const { dir, output, runtime } = await harness(true);
		await executeAcpBuiltinSlashCommand("/feedback first note", runtime);
		output.mockClear();

		expect(await executeAcpBuiltinSlashCommand("/feedback list", runtime)).toEqual({ consumed: true });
		const printed = String(output.mock.calls[0]?.[0]);
		expect(printed).toContain("first note");
		expect(await listFeedback({ agentDir: dir })).toHaveLength(1);
	});
});
