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
 * Presets that depend on features not yet built (an OS sandbox pack, a plan
 * gate pack) are intentionally omitted until those settings exist, rather than
 * shipped as misleading duplicates of an existing preset.
 */

import type { Settings } from "./settings";
import type { SettingPath, SettingTab, SettingValue } from "./settings-schema";

/** Stable preset identifiers accepted by `--preset` and the selector UI. */
export const PRESET_NAMES = ["pi-minimal", "opm-verify"] as const;

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
};

/** Maturity shown on Settings cards. Data, not renderer copy. */
export type PresetMaturity = "stable" | "experimental";

export const PRESET_MATURITY: Record<PresetName, PresetMaturity> = {
	"pi-minimal": "stable",
	"opm-verify": "experimental",
};

/** Settings tab/group that hosts the pack intro cards. */
export const PRESET_CARD_TAB: SettingTab = "tools";
export const PRESET_CARD_GROUP = "Presets";
export const PRESET_CARD_ID_PREFIX = "preset:";

/**
 * Same next-session contract as `/preset`: the tool slate is built at session
 * start, so pack tool-gating takes effect when the session next starts.
 */
export const PRESET_SESSION_REFRESH_MESSAGE = "Tool changes take effect when the session next starts.";

export interface PresetCard {
	readonly name: PresetName;
	readonly label: string;
	readonly description: string;
	readonly learnedFrom: string;
	readonly maturity: PresetMaturity;
}

export interface PresetCardItem {
	readonly id: string;
	readonly label: string;
	readonly description: string;
	readonly currentValue: PresetMaturity;
}

/** One intro card per pack, in {@link PRESET_NAMES} order. */
export function listPresetCards(): readonly PresetCard[] {
	return PRESET_NAMES.map(name => {
		const preset = PRESETS[name];
		return {
			name,
			label: preset.label,
			description: preset.description,
			learnedFrom: preset.learnedFrom,
			maturity: PRESET_MATURITY[name],
		};
	});
}

export function formatPresetCardDescription(card: PresetCard): string {
	return `${card.description} Learned from ${card.learnedFrom}. ${PRESET_SESSION_REFRESH_MESSAGE}`;
}

export function presetCardId(name: PresetName): string {
	return `${PRESET_CARD_ID_PREFIX}${name}`;
}

export function parsePresetCardId(id: string): PresetName | undefined {
	if (!id.startsWith(PRESET_CARD_ID_PREFIX)) return undefined;
	const name = id.slice(PRESET_CARD_ID_PREFIX.length);
	return isPresetName(name) ? name : undefined;
}

/** Settings-list rows for the Presets group: label, description+source, maturity badge. */
export function listPresetCardItems(): readonly PresetCardItem[] {
	return listPresetCards().map(card => ({
		id: presetCardId(card.name),
		label: card.label,
		description: formatPresetCardDescription(card),
		currentValue: card.maturity,
	}));
}

/**
 * Apply a pack from a Settings card id (`preset:<name>`) or a bare preset
 * name. Same skip-configured-keys contract as {@link applyPreset}.
 */
export function applyPresetCard(settings: Settings, id: string): ApplyPresetResult | undefined {
	const name = parsePresetCardId(id) ?? (isPresetName(id) ? id : undefined);
	if (!name) return undefined;
	return applyPreset(settings, name);
}

/** Type guard: whether `name` is a known preset identifier. */
export function isPresetName(name: string): name is PresetName {
	return (PRESET_NAMES as readonly string[]).includes(name);
}

/** Resolve a preset by name, or `undefined` when the name is unknown. */
export function resolvePreset(name: string): PresetDefinition | undefined {
	return isPresetName(name) ? PRESETS[name] : undefined;
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
