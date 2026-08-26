import { describe, expect, it } from "bun:test";
import { Settings } from "../src/config/settings";
import { lookupBuiltinSlashCommand } from "../src/slash-commands/builtin-registry";
import { formatPresetList, runPresetSlashCommand } from "../src/slash-commands/helpers/preset";
import type { ParsedSlashCommand, SlashCommandRuntime } from "../src/slash-commands/types";

describe("runPresetSlashCommand", () => {
	it("lists every weapon with its source when no name is given", () => {
		const list = formatPresetList();
		expect(list).toContain("pi-minimal");
		expect(list).toContain("opm-verify");
		expect(list).toContain("pi-super");
		expect(list).toContain("learned from");
		expect(list).toContain("Available weapons:");
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
});
