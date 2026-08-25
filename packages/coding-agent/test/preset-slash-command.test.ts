import { describe, expect, it } from "bun:test";
import { Settings } from "../src/config/settings";
import { lookupBuiltinSlashCommand } from "../src/slash-commands/builtin-registry";
import { formatPresetList, runPresetSlashCommand } from "../src/slash-commands/helpers/preset";
import type { ParsedSlashCommand, SlashCommandRuntime } from "../src/slash-commands/types";

describe("runPresetSlashCommand", () => {
	it("lists every preset with its source when no name is given", () => {
		const list = formatPresetList();
		expect(list).toContain("pi-minimal");
		expect(list).toContain("opm-verify");
		expect(list).toContain("learned from");
		expect(runPresetSlashCommand(Settings.isolated(), "")).toBe(list);
	});

	it("applies a named preset to unconfigured keys and reports the count", () => {
		const settings = Settings.isolated();
		const message = runPresetSlashCommand(settings, "pi-minimal");
		expect(message).toContain('Applied preset "pi-minimal"');
		expect(settings.get("lsp.enabled")).toBe(false);
	});

	it("keeps a user-configured key and notes it was kept", () => {
		const settings = Settings.isolated({ "lsp.enabled": true });
		const message = runPresetSlashCommand(settings, "pi-minimal");
		expect(settings.get("lsp.enabled")).toBe(true);
		expect(message).toContain("kept from your existing config");
	});

	it("reports an unknown preset without changing settings", () => {
		const settings = Settings.isolated();
		const message = runPresetSlashCommand(settings, "nope");
		expect(message).toContain('Unknown preset "nope"');
		// Default preserved (not turned off by a phantom preset).
		expect(settings.get("lsp.enabled")).toBe(true);
	});
});

describe("/preset builtin registration", () => {
	it("is registered as an arg-taking command", () => {
		const spec = lookupBuiltinSlashCommand("preset");
		expect(spec?.allowArgs).toBe(true);
		expect(spec?.handle).toBeDefined();
	});

	it("applies the preset and emits output when its handler runs", async () => {
		const spec = lookupBuiltinSlashCommand("preset");
		const settings = Settings.isolated();
		const outputs: string[] = [];
		const runtime = {
			settings,
			output: (text: string) => {
				outputs.push(text);
			},
		} as unknown as SlashCommandRuntime;
		const command: ParsedSlashCommand = { name: "preset", args: "pi-minimal", text: "/preset pi-minimal" };

		await spec?.handle?.(command, runtime);

		expect(outputs[0]).toContain('Applied preset "pi-minimal"');
		expect(settings.get("browser.enabled")).toBe(false);
	});
});
