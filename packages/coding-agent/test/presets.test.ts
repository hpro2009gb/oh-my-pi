import { describe, expect, it } from "bun:test";
import { parseArgs } from "../src/cli/args";
import { applyPreset, PRESET_NAMES, PRESETS, resolvePreset } from "../src/config/presets";
import { Settings } from "../src/config/settings";
import { SETTINGS_SCHEMA } from "../src/config/settings-schema";

describe("presets", () => {
	it("only references setting paths that exist in the schema", () => {
		// A typo'd key would silently no-op at apply time; assert every override
		// targets a real schema key so a bad rename is caught here.
		for (const name of PRESET_NAMES) {
			for (const override of PRESETS[name].settings) {
				expect(Object.hasOwn(SETTINGS_SCHEMA, override.path)).toBe(true);
			}
		}
	});

	it("pi-minimal disables advanced tools but leaves core tools at their default", () => {
		const settings = Settings.isolated();
		const result = applyPreset(settings, "pi-minimal");

		expect(result?.preset.name).toBe("pi-minimal");
		// Advanced tools the pack turns off:
		expect(settings.get("lsp.enabled")).toBe(false);
		expect(settings.get("browser.enabled")).toBe(false);
		expect(settings.get("web_search.enabled")).toBe(false);
		// Core tool the pack does not touch keeps its schema default (enabled):
		expect(settings.get("bash.enabled")).toBe(true);
	});

	it("does not override a setting the user already configured", () => {
		// User explicitly wants LSP on; pi-minimal must not force it off.
		const settings = Settings.isolated({ "lsp.enabled": true });
		const result = applyPreset(settings, "pi-minimal");

		expect(settings.get("lsp.enabled")).toBe(true);
		expect(result?.skipped).toContain("lsp.enabled");
		expect(result?.applied).not.toContain("lsp.enabled");
		// An unconfigured advanced key is still turned off.
		expect(settings.get("browser.enabled")).toBe(false);
		expect(result?.applied).toContain("browser.enabled");
	});

	it("returns undefined for an unknown preset name", () => {
		expect(resolvePreset("does-not-exist")).toBeUndefined();
		expect(applyPreset(Settings.isolated(), "does-not-exist")).toBeUndefined();
	});
});

describe("--preset flag parsing", () => {
	it("parses both --preset=value and --preset value forms", () => {
		expect(parseArgs(["--preset=pi-minimal"]).preset).toBe("pi-minimal");
		expect(parseArgs(["--preset", "opm-verify"]).preset).toBe("opm-verify");
	});

	it("does not consume the following token as a message", () => {
		const parsed = parseArgs(["--preset", "pi-minimal", "fix the bug"]);
		expect(parsed.preset).toBe("pi-minimal");
		expect(parsed.messages).toEqual(["fix the bug"]);
	});
});
