import { describe, expect, it, vi } from "bun:test";
import type { InteractiveModeContext } from "@oh-my-pi/pi-coding-agent/modes/types";
import { executeBuiltinSlashCommand } from "@oh-my-pi/pi-coding-agent/slash-commands/builtin-registry";
import { Settings } from "../src/config/settings";
import { lookupBuiltinSlashCommand } from "../src/slash-commands/builtin-registry";
import { formatPresetList, runPresetSlashCommand } from "../src/slash-commands/helpers/preset";
import type { ParsedSlashCommand, SlashCommandRuntime } from "../src/slash-commands/types";

describe("runPresetSlashCommand", () => {
	it("lists every weapon with its features when no name is given", () => {
		const list = formatPresetList();
		expect(list).toContain("pi-minimal");
		expect(list).toContain("opm-verify");
		expect(list).toContain("pi-super");
		expect(list).toContain("Learned from");
		expect(list).toContain("Available weapons:");
		expect(list).toContain("Smallest tool slate for a fast harness");
		expect(list).toContain("Advisor, prewalk, and checkpoint on");
		expect(runPresetSlashCommand(Settings.isolated(), "")).toBe(list);
	});

	it("applies a named weapon to unconfigured keys and reports the count", () => {
		const settings = Settings.isolated();
		const message = runPresetSlashCommand(settings, "pi-minimal");
		expect(message).toContain('Applied weapon "pi-minimal"');
		expect(settings.get("lsp.enabled")).toBe(false);
	});

	it("keeps a persisted key and notes it was kept", () => {
		const settings = Settings.isolated();
		settings.set("lsp.enabled", true);
		const message = runPresetSlashCommand(settings, "pi-minimal");
		expect(settings.get("lsp.enabled")).toBe(true);
		expect(message).toContain("kept from your existing config");
	});

	it("reports an unknown weapon without changing settings", () => {
		const settings = Settings.isolated();
		const message = runPresetSlashCommand(settings, "nope");
		expect(message).toContain('Unknown weapon "nope"');
		expect(settings.get("lsp.enabled")).toBe(true);
	});
});

describe("/weapon builtin registration", () => {
	it("registers /weapon with /preset and /weapons aliases", () => {
		const spec = lookupBuiltinSlashCommand("weapon");
		expect(spec?.name).toBe("weapon");
		expect(spec?.allowArgs).toBe(true);
		expect(spec?.handle).toBeDefined();
		expect(spec?.handleTui).toBeDefined();
		expect(lookupBuiltinSlashCommand("preset")).toBe(spec);
		expect(lookupBuiltinSlashCommand("weapons")).toBe(spec);
	});

	it("applies the weapon and emits output when its handler runs", async () => {
		const spec = lookupBuiltinSlashCommand("weapon");
		const settings = Settings.isolated();
		const outputs: string[] = [];
		const runtime = {
			settings,
			output: (text: string) => {
				outputs.push(text);
			},
		} as unknown as SlashCommandRuntime;
		const command: ParsedSlashCommand = { name: "weapon", args: "pi-minimal", text: "/weapon pi-minimal" };

		await spec?.handle?.(command, runtime);

		expect(outputs[0]).toContain('Applied weapon "pi-minimal"');
		expect(settings.get("browser.enabled")).toBe(false);
	});

	it("opens the weapon table in the TUI when invoked without a name", async () => {
		const showWeaponSelector = vi.fn();
		const setText = vi.fn();
		const handled = await executeBuiltinSlashCommand("/weapon", {
			ctx: {
				editor: { setText } as unknown as InteractiveModeContext["editor"],
				showWeaponSelector,
			} as unknown as InteractiveModeContext,
		});
		expect(handled).toBe(true);
		expect(showWeaponSelector).toHaveBeenCalledTimes(1);
		expect(setText).toHaveBeenCalledWith("");
	});

	it("applies a named pack from the TUI without opening the table", async () => {
		const showWeaponSelector = vi.fn();
		const showStatus = vi.fn();
		const setText = vi.fn();
		const settings = Settings.isolated();
		const handled = await executeBuiltinSlashCommand("/weapon pi-minimal", {
			ctx: {
				editor: { setText } as unknown as InteractiveModeContext["editor"],
				showWeaponSelector,
				showStatus,
				settings,
			} as unknown as InteractiveModeContext,
		});
		expect(handled).toBe(true);
		expect(showWeaponSelector).not.toHaveBeenCalled();
		expect(showStatus).toHaveBeenCalledWith(expect.stringContaining('Applied weapon "pi-minimal"'));
		expect(settings.get("lsp.enabled")).toBe(false);
		expect(setText).toHaveBeenCalledWith("");
	});
});
