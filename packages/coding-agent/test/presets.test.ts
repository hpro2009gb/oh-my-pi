import { describe, expect, it } from "bun:test";
import { parseArgs } from "../src/cli/args";
import { applyPreset, PRESET_NAMES, PRESETS, resolveLaunchPreset, resolvePreset } from "../src/config/presets";
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

	it("opm-safe confines bash to the workspace with network off and keeps the verify toolkit", () => {
		const settings = Settings.isolated();
		const result = applyPreset(settings, "opm-safe");

		expect(result?.preset.name).toBe("opm-safe");
		expect(settings.get("sandbox.mode")).toBe("workspace");
		expect(settings.get("sandbox.allowNetwork")).toBe(false);
		expect(result?.applied).toContain("sandbox.mode");
		expect(result?.applied).toContain("sandbox.allowNetwork");
		// Engineer toolkit stays on — this is verify + sandbox, not a minimal pack.
		expect(settings.get("lsp.enabled")).toBe(true);
		expect(settings.get("todo.enabled")).toBe(true);
	});

	it("does not override a user-configured sandbox.mode when applying opm-safe", () => {
		const settings = Settings.isolated({ "sandbox.mode": "off" });
		const result = applyPreset(settings, "opm-safe");

		expect(settings.get("sandbox.mode")).toBe("off");
		expect(result?.skipped).toContain("sandbox.mode");
		expect(result?.applied).not.toContain("sandbox.mode");
		expect(settings.get("sandbox.allowNetwork")).toBe(false);
	});

	it("pi-super enables the verify toolkit and super runtimes without sandbox confinement", () => {
		const settings = Settings.isolated();
		const result = applyPreset(settings, "pi-super");

		expect(result?.preset.name).toBe("pi-super");
		// Engineer toolkit on — unlike pi-minimal, which turns these off.
		expect(settings.get("lsp.enabled")).toBe(true);
		expect(settings.get("todo.enabled")).toBe(true);
		expect(settings.get("ask.enabled")).toBe(true);
		expect(settings.get("web_search.enabled")).toBe(true);
		expect(settings.get("astGrep.enabled")).toBe(true);
		expect(settings.get("astEdit.enabled")).toBe(true);
		expect(settings.get("security.enabled")).toBe(true);
		// Super runtimes on — unlike opm-verify, which leaves schema defaults (off).
		expect(settings.get("advisor.enabled")).toBe(true);
		expect(settings.get("prewalk.enabled")).toBe(true);
		expect(settings.get("checkpoint.enabled")).toBe(true);
		expect(settings.get("github.enabled")).toBe(true);
		expect(result?.applied).toContain("advisor.enabled");
		expect(result?.applied).toContain("prewalk.enabled");
		expect(result?.applied).toContain("checkpoint.enabled");
		expect(result?.applied).toContain("github.enabled");
		// Unconfined bash — unlike opm-safe's workspace sandbox.
		expect(settings.get("sandbox.mode")).toBe("off");
		expect(result?.applied).toContain("sandbox.mode");
	});

	it("pi-super is not an alias of pi-minimal, opm-verify, or opm-safe", () => {
		const superSettings = Settings.isolated();
		applyPreset(superSettings, "pi-super");
		const minimal = Settings.isolated();
		applyPreset(minimal, "pi-minimal");
		const verify = Settings.isolated();
		applyPreset(verify, "opm-verify");
		const safe = Settings.isolated();
		applyPreset(safe, "opm-safe");

		// A consumer asking for pi-super must not get a stripped harness.
		expect(superSettings.get("lsp.enabled")).not.toBe(minimal.get("lsp.enabled"));
		expect(superSettings.get("web_search.enabled")).not.toBe(minimal.get("web_search.enabled"));
		// A consumer asking for pi-super must not get verify-only (advisor stays off).
		expect(superSettings.get("advisor.enabled")).not.toBe(verify.get("advisor.enabled"));
		expect(superSettings.get("github.enabled")).not.toBe(verify.get("github.enabled"));
		// A consumer asking for pi-super must not get a confined sandbox.
		expect(superSettings.get("sandbox.mode")).not.toBe(safe.get("sandbox.mode"));
	});
});

describe("--preset flag parsing", () => {
	it("parses both --preset=value and --preset value forms", () => {
		expect(parseArgs(["--preset=pi-minimal"]).preset).toBe("pi-minimal");
		expect(parseArgs(["--preset", "opm-verify"]).preset).toBe("opm-verify");
		expect(parseArgs(["--preset", "opm-safe"]).preset).toBe("opm-safe");
		expect(parseArgs(["--preset=pi-super"]).preset).toBe("pi-super");
		expect(parseArgs(["--preset", "pi-super"]).preset).toBe("pi-super");
	});

	it("does not consume the following token as a message", () => {
		const parsed = parseArgs(["--preset", "pi-minimal", "fix the bug"]);
		expect(parsed.preset).toBe("pi-minimal");
		expect(parsed.messages).toEqual(["fix the bug"]);
	});
});

describe("resolveLaunchPreset", () => {
	it("lets an explicit --preset flag win over OMP_DEFAULT_PRESET", () => {
		expect(resolveLaunchPreset("opm-safe", "pi-super")).toBe("opm-safe");
	});

	it("falls back to OMP_DEFAULT_PRESET when --preset is omitted", () => {
		expect(resolveLaunchPreset(undefined, "pi-super")).toBe("pi-super");
		expect(resolveLaunchPreset("", "pi-super")).toBe("pi-super");
		expect(resolveLaunchPreset("  ", "pi-super")).toBe("pi-super");
	});

	it("treats a blank env value as unset so official omp does not inherit a pack", () => {
		expect(resolveLaunchPreset(undefined, undefined)).toBeUndefined();
		expect(resolveLaunchPreset(undefined, "")).toBeUndefined();
		expect(resolveLaunchPreset(undefined, "   ")).toBeUndefined();
	});
});
