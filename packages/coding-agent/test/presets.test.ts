import { describe, expect, it } from "bun:test";
import { DEFAULT_PRODUCT_NAME, SUPERPI_PRODUCT_NAME } from "@oh-my-pi/pi-utils/product-identity";
import { parseArgs } from "../src/cli/args";
import {
	applyPreset,
	defaultPresetForProduct,
	formatWeaponTable,
	matchingPresetName,
	PRESET_BOOLEAN_PATHS,
	PRESET_NAMES,
	PRESETS,
	resolveLaunchPresetName,
	resolvePreset,
} from "../src/config/presets";
import { Settings } from "../src/config/settings";
import { SETTINGS_SCHEMA } from "../src/config/settings-schema";

describe("presets", () => {
	it("only references setting paths that exist in the schema", () => {
		// A typo'd key would silently no-op at apply time; assert every override
		// targets a real schema key so a bad rename is caught here.
		for (const path of PRESET_BOOLEAN_PATHS) {
			expect(Object.hasOwn(SETTINGS_SCHEMA, path)).toBe(true);
		}
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
		expect(settings.get("lsp.enabled")).toBe(false);
		expect(settings.get("browser.enabled")).toBe(false);
		expect(settings.get("web_search.enabled")).toBe(false);
		expect(settings.get("bash.enabled")).toBe(true);
	});

	it("does not override a setting the user persisted", () => {
		const settings = Settings.isolated();
		settings.set("lsp.enabled", true);
		const result = applyPreset(settings, "pi-minimal");

		expect(settings.get("lsp.enabled")).toBe(true);
		expect(result?.skipped).toContain("lsp.enabled");
		expect(result?.applied).not.toContain("lsp.enabled");
		expect(settings.get("browser.enabled")).toBe(false);
		expect(result?.applied).toContain("browser.enabled");
	});

	it("pi-super turns on advisor, prewalk, checkpoint, and github that vanilla omp leaves off", () => {
		const settings = Settings.isolated();
		applyPreset(settings, "pi-super");

		expect(settings.get("lsp.enabled")).toBe(true);
		expect(settings.get("advisor.enabled")).toBe(true);
		expect(settings.get("prewalk.enabled")).toBe(true);
		expect(settings.get("checkpoint.enabled")).toBe(true);
		expect(settings.get("github.enabled")).toBe(true);
	});

	it("opm-verify enables the engineer toolkit without Super Pi extras", () => {
		const settings = Settings.isolated();
		applyPreset(settings, "opm-verify");

		expect(settings.get("lsp.enabled")).toBe(true);
		expect(settings.get("todo.enabled")).toBe(true);
		expect(settings.get("advisor.enabled")).toBe(false);
		expect(settings.get("prewalk.enabled")).toBe(false);
		expect(settings.get("checkpoint.enabled")).toBe(false);
		expect(settings.get("github.enabled")).toBe(false);
	});

	it("switching from pi-super to pi-minimal replaces the previous loadout", () => {
		const settings = Settings.isolated();
		applyPreset(settings, "pi-super");
		expect(settings.get("advisor.enabled")).toBe(true);
		expect(settings.get("github.enabled")).toBe(true);

		const result = applyPreset(settings, "pi-minimal");
		expect(result?.preset.name).toBe("pi-minimal");
		expect(settings.get("lsp.enabled")).toBe(false);
		expect(settings.get("advisor.enabled")).toBe(false);
		expect(settings.get("prewalk.enabled")).toBe(false);
		expect(settings.get("checkpoint.enabled")).toBe(false);
		expect(settings.get("github.enabled")).toBe(false);
	});

	it("returns undefined for an unknown preset name", () => {
		expect(resolvePreset("does-not-exist")).toBeUndefined();
		expect(applyPreset(Settings.isolated(), "does-not-exist")).toBeUndefined();
	});

	it("identifies the matching pack and prefers the more specific Super Pi loadout", () => {
		const settings = Settings.isolated();
		expect(matchingPresetName(settings)).toBeUndefined();

		applyPreset(settings, "opm-verify");
		expect(matchingPresetName(settings)).toBe("opm-verify");

		applyPreset(settings, "pi-super");
		expect(matchingPresetName(settings)).toBe("pi-super");

		applyPreset(settings, "pi-minimal");
		expect(matchingPresetName(settings)).toBe("pi-minimal");

		settings.override("lsp.enabled", true);
		expect(matchingPresetName(settings)).toBeUndefined();
	});

	it("prints every pack's feature bullets in the weapon table", () => {
		const table = formatWeaponTable();
		expect(table).toContain("Available weapons:");
		for (const name of PRESET_NAMES) {
			const preset = PRESETS[name];
			expect(table).toContain(preset.name);
			expect(table).toContain(preset.label);
			expect(table).toContain(`Learned from ${preset.learnedFrom}.`);
			for (const line of preset.highlights) {
				expect(table).toContain(line);
			}
		}
		expect(table).toContain("Advisor, prewalk, and checkpoint on");
		expect(table).toContain("Advisor, prewalk, checkpoint, and GitHub stay off");
		expect(table).toContain("Smallest tool slate for a fast harness");
	});
});

describe("Super Pi default weapon", () => {
	it("defaults Super Pi to pi-super and leaves omp without a pack", () => {
		expect(defaultPresetForProduct(SUPERPI_PRODUCT_NAME)).toBe("pi-super");
		expect(defaultPresetForProduct(DEFAULT_PRODUCT_NAME)).toBeUndefined();
		expect(resolveLaunchPresetName(undefined, SUPERPI_PRODUCT_NAME)).toBe("pi-super");
		expect(resolveLaunchPresetName("pi-minimal", SUPERPI_PRODUCT_NAME)).toBe("pi-minimal");
		expect(resolveLaunchPresetName(undefined, DEFAULT_PRODUCT_NAME)).toBeUndefined();
	});
});

describe("--preset / --weapon flag parsing", () => {
	it("parses both --preset=value and --preset value forms", () => {
		expect(parseArgs(["--preset=pi-minimal"]).preset).toBe("pi-minimal");
		expect(parseArgs(["--preset", "opm-verify"]).preset).toBe("opm-verify");
	});

	it("accepts --weapon as an alias of --preset", () => {
		expect(parseArgs(["--weapon", "pi-super"]).preset).toBe("pi-super");
		expect(parseArgs(["--weapon=pi-minimal"]).preset).toBe("pi-minimal");
	});

	it("does not consume the following token as a message", () => {
		const parsed = parseArgs(["--preset", "pi-minimal", "fix the bug"]);
		expect(parsed.preset).toBe("pi-minimal");
		expect(parsed.messages).toEqual(["fix the bug"]);
	});
});
