/**
 * Named capability presets ("packs") that flip a curated bundle of existing
 * settings in one step, so a user can pick a whole working mode before a run
 * instead of toggling tools one at a time.
 *
 * Design constraints:
 *   - A preset is applied through the runtime override layer via
 *     {@link applyPreset}, so it never persists to `config.yml`.
 *   - A key the user has already configured (global/project/overlay/runtime)
 *     wins over the preset — presets fill in unconfigured keys only. This keeps
 *     the contract "your explicit settings beat the preset" and mirrors
 *     `applyDefaultSettingOverrides` in `main.ts`.
 *   - Each override is expressed as a `{ path, value }` pair whose value type is
 *     correlated to the setting path, so a typo'd key or a wrong value type is a
 *     compile error at the preset definition, not a silent no-op at runtime.
 *
 * `opm-plan` (plan-gate pack) is still omitted until that feature exists,
 * rather than shipped as a misleading duplicate of an existing preset.
 */

import type { Settings } from "./settings";
import type { SettingPath, SettingValue } from "./settings-schema";

/** Stable preset identifiers accepted by `--preset` and the selector UI. */
export const PRESET_NAMES = ["pi-minimal", "opm-verify", "opm-safe", "pi-super"] as const;

export type PresetName = (typeof PRESET_NAMES)[number];

/**
 * One setting override with its value type bound to its path, so the compiler
 * checks every entry of a preset against the schema. Widened at the apply site
 * to the full `SettingPath` union, which `Settings.override` accepts.
 */
export type PresetSettingOverride = {
	[P in SettingPath]: { readonly path: P; readonly value: SettingValue<P> };
}[SettingPath];

export interface PresetDefinition {
	readonly name: PresetName;
	/** Short human label for selector UIs. */
	readonly label: string;
	/** One-line description of what the pack does. */
	readonly description: string;
	/** Which agent/design the pack takes after, surfaced in the selector card. */
	readonly learnedFrom: string;
	/** Curated overrides applied to unconfigured keys. */
	readonly settings: readonly PresetSettingOverride[];
}

export const PRESETS: Record<PresetName, PresetDefinition> = {
	"pi-minimal": {
		name: "pi-minimal",
		label: "Pi Minimal",
		description: "Bare, fast harness — read/write/bash/grep/glob only; advanced tools off.",
		learnedFrom: "Pi core",
		settings: [
			{ path: "lsp.enabled", value: false },
			{ path: "browser.enabled", value: false },
			{ path: "computer.enabled", value: false },
			{ path: "debug.enabled", value: false },
			{ path: "github.enabled", value: false },
			{ path: "web_search.enabled", value: false },
			{ path: "todo.enabled", value: false },
			{ path: "ask.enabled", value: false },
			{ path: "astGrep.enabled", value: false },
			{ path: "astEdit.enabled", value: false },
			{ path: "security.enabled", value: false },
		],
	},
	"opm-verify": {
		name: "opm-verify",
		label: "OMP Verify",
		description: "Standard OMP — full engineer toolkit for read → edit → verify workflows.",
		learnedFrom: "OMP",
		settings: [
			{ path: "lsp.enabled", value: true },
			{ path: "todo.enabled", value: true },
			{ path: "ask.enabled", value: true },
			{ path: "web_search.enabled", value: true },
			{ path: "astGrep.enabled", value: true },
			{ path: "astEdit.enabled", value: true },
			{ path: "security.enabled", value: true },
		],
	},
	"opm-safe": {
		name: "opm-safe",
		label: "OMP Safe",
		description:
			"Verify toolkit inside a Linux workspace sandbox with network off (bubblewrap). Degrades to unconfined if bwrap is missing.",
		learnedFrom: "Codex",
		settings: [
			{ path: "lsp.enabled", value: true },
			{ path: "todo.enabled", value: true },
			{ path: "ask.enabled", value: true },
			{ path: "web_search.enabled", value: true },
			{ path: "astGrep.enabled", value: true },
			{ path: "astEdit.enabled", value: true },
			{ path: "security.enabled", value: true },
			{ path: "sandbox.mode", value: "workspace" },
			{ path: "sandbox.allowNetwork", value: false },
		],
	},
	"pi-super": {
		name: "pi-super",
		label: "Pi Super",
		description:
			"Full engineer toolkit plus advisor, prewalk, checkpoint, and GitHub — a super-agent slate without sandbox confinement.",
		learnedFrom: "OMP Super",
		settings: [
			{ path: "lsp.enabled", value: true },
			{ path: "todo.enabled", value: true },
			{ path: "ask.enabled", value: true },
			{ path: "web_search.enabled", value: true },
			{ path: "astGrep.enabled", value: true },
			{ path: "astEdit.enabled", value: true },
			{ path: "security.enabled", value: true },
			{ path: "advisor.enabled", value: true },
			{ path: "prewalk.enabled", value: true },
			{ path: "checkpoint.enabled", value: true },
			{ path: "github.enabled", value: true },
			{ path: "sandbox.mode", value: "off" },
		],
	},
};

/** Type guard: whether `name` is a known preset identifier. */
export function isPresetName(name: string): name is PresetName {
	return (PRESET_NAMES as readonly string[]).includes(name);
}

/** Resolve a preset by name, or `undefined` when the name is unknown. */
export function resolvePreset(name: string): PresetDefinition | undefined {
	return isPresetName(name) ? PRESETS[name] : undefined;
}

/**
 * Launch-time preset selection: an explicit `--preset` flag wins over
 * `OMP_DEFAULT_PRESET` (used by the `supper-omp` side-by-side launcher).
 * Empty/whitespace values are treated as unset so a blank env cannot
 * clobber a real flag or silently apply nothing.
 */
export function resolveLaunchPreset(
	flagPreset: string | undefined,
	defaultPreset: string | undefined,
): string | undefined {
	const flag = flagPreset?.trim();
	if (flag) return flag;
	const fallback = defaultPreset?.trim();
	return fallback || undefined;
}

/**
 * Apply a single correlated `{ path, value }` override. The pair's value type is
 * bound to its path at the preset definition, so this is sound; the assertion is
 * only needed because TypeScript cannot carry that correlation across iteration
 * (widening `SettingValue<SettingPath>` collapses the `override` value parameter
 * to `never`).
 */
function applyOverride(settings: Settings, override: PresetSettingOverride): void {
	settings.override(override.path, override.value as never);
}

/** Outcome of {@link applyPreset}: which keys the preset set vs. left to the user. */
export interface ApplyPresetResult {
	readonly preset: PresetDefinition;
	/** Keys the preset overrode (were unconfigured). */
	readonly applied: SettingPath[];
	/** Keys the preset left untouched because the user already configured them. */
	readonly skipped: SettingPath[];
}

/**
 * Apply a preset to `settings` through the non-persistent runtime override
 * layer. Keys the user has already configured are skipped so explicit
 * configuration always wins. Returns `undefined` for an unknown preset name so
 * callers can surface a usage error.
 */
export function applyPreset(settings: Settings, name: string): ApplyPresetResult | undefined {
	const preset = resolvePreset(name);
	if (!preset) return undefined;

	const applied: SettingPath[] = [];
	const skipped: SettingPath[] = [];
	for (const override of preset.settings) {
		if (settings.isConfigured(override.path)) {
			skipped.push(override.path);
			continue;
		}
		applyOverride(settings, override);
		applied.push(override.path);
	}
	return { preset, applied, skipped };
}
