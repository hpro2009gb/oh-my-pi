/**
 * Named capability packs ("weapons") that flip a curated bundle of existing
 * settings in one step, so a user can pick a whole working mode before a run
 * instead of toggling tools one at a time.
 *
 * Design constraints:
 *   - A pack is applied through the runtime override layer via
 *     {@link applyPreset}, so it never persists to `config.yml`.
 *   - A key the user has already written to persisted config
 *     (global/project/overlay) wins over the pack. Runtime overrides from a
 *     previous pack are replaced so switching weapons actually switches.
 *   - Keys managed by any pack but omitted from the newly applied pack are
 *     cleared back to schema defaults (unless persisted).
 *   - Pack keys are a closed boolean-path list, so a typo is a compile error
 *     without expanding the full settings-schema union.
 */

import { SUPERPI_PRODUCT_NAME } from "@oh-my-pi/pi-utils/product-identity";
import type { Settings } from "./settings";
import type { SettingTab } from "./settings-schema";

/** Stable pack identifiers accepted by `--preset`, `/weapon`, and the selector UI. */
export const PRESET_NAMES = ["pi-minimal", "opm-verify", "pi-super"] as const;

export type PresetName = (typeof PRESET_NAMES)[number];

/** Boolean setting keys any weapon pack may flip. */
export const PRESET_BOOLEAN_PATHS = [
	"lsp.enabled",
	"browser.enabled",
	"computer.enabled",
	"debug.enabled",
	"github.enabled",
	"web_search.enabled",
	"todo.enabled",
	"ask.enabled",
	"astGrep.enabled",
	"astEdit.enabled",
	"security.enabled",
	"advisor.enabled",
	"prewalk.enabled",
	"checkpoint.enabled",
] as const;

export type PresetPath = (typeof PRESET_BOOLEAN_PATHS)[number];

export interface PresetSettingOverride {
	readonly path: PresetPath;
	readonly value: boolean;
}

function ov(path: PresetPath, value: boolean): PresetSettingOverride {
	return { path, value };
}

export interface PresetDefinition {
	readonly name: PresetName;
	/** Short human label for selector UIs. */
	readonly label: string;
	/** One-line description of what the pack does. */
	readonly description: string;
	/** Feature bullets shown in the weapon table and picker preview. */
	readonly highlights: readonly string[];
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
		highlights: [
			"Read, write, bash, grep, and glob only",
			"LSP, browser, computer, GitHub, and web search off",
			"Smallest tool slate for a fast harness",
		],
		learnedFrom: "Pi core",
		settings: [
			ov("lsp.enabled", false),
			ov("browser.enabled", false),
			ov("computer.enabled", false),
			ov("debug.enabled", false),
			ov("github.enabled", false),
			ov("web_search.enabled", false),
			ov("todo.enabled", false),
			ov("ask.enabled", false),
			ov("astGrep.enabled", false),
			ov("astEdit.enabled", false),
			ov("security.enabled", false),
		],
	},
	"opm-verify": {
		name: "opm-verify",
		label: "OMP Verify",
		description: "Standard OMP — full engineer toolkit for read → edit → verify workflows.",
		highlights: [
			"LSP, todo, ask, and web search on",
			"ast-grep, ast-edit, and security scans on",
			"Advisor, prewalk, checkpoint, and GitHub stay off",
		],
		learnedFrom: "OMP",
		settings: [
			ov("lsp.enabled", true),
			ov("todo.enabled", true),
			ov("ask.enabled", true),
			ov("web_search.enabled", true),
			ov("astGrep.enabled", true),
			ov("astEdit.enabled", true),
			ov("security.enabled", true),
		],
	},
	"pi-super": {
		name: "pi-super",
		label: "Pi Super",
		description: "Full engineer toolkit plus advisor, prewalk, checkpoint, and GitHub — Super Pi's default loadout.",
		highlights: [
			"Full OMP engineer toolkit on",
			"Advisor, prewalk, and checkpoint on",
			"GitHub on for PRs and issues",
		],
		learnedFrom: "Cline, Claude Code, Codex, Aider",
		settings: [
			ov("lsp.enabled", true),
			ov("todo.enabled", true),
			ov("ask.enabled", true),
			ov("web_search.enabled", true),
			ov("astGrep.enabled", true),
			ov("astEdit.enabled", true),
			ov("security.enabled", true),
			ov("advisor.enabled", true),
			ov("prewalk.enabled", true),
			ov("checkpoint.enabled", true),
			ov("github.enabled", true),
		],
	},
};

/** Maturity shown on Settings weapon cards. Data, not renderer copy. */
export type PresetMaturity = "stable" | "experimental";

export const PRESET_MATURITY: Record<PresetName, PresetMaturity> = {
	"pi-minimal": "stable",
	"opm-verify": "stable",
	"pi-super": "experimental",
};

/** Settings tab/group that hosts the weapon intro cards. */
export const PRESET_CARD_TAB: SettingTab = "tools";
export const PRESET_CARD_GROUP = "Weapons";
export const PRESET_CARD_ID_PREFIX = "preset:";

/**
 * Same next-session contract as `/weapon`: the tool slate is built at session
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

/** Fields the weapon table and picker preview show for one pack. */
export interface WeaponPreview {
	readonly name: PresetName;
	readonly label: string;
	readonly maturity: PresetMaturity;
	readonly description: string;
	readonly highlights: readonly string[];
	readonly learnedFrom: string;
}

/** Catalog row for the weapon table / picker, in {@link PRESET_NAMES} order. */
export function weaponPreview(name: PresetName): WeaponPreview {
	const preset = PRESETS[name];
	return {
		name,
		label: preset.label,
		maturity: PRESET_MATURITY[name],
		description: preset.description,
		highlights: preset.highlights,
		learnedFrom: preset.learnedFrom,
	};
}

/**
 * Plain-text table of every pack: id, label, maturity, description, feature
 * bullets, and source. Used by ACP `/weapon` and print-only UIs. The TUI
 * picker renders the same fields in a selectable preview pane.
 */
export function formatWeaponTable(): string {
	const blocks = PRESET_NAMES.map(name => {
		const preview = weaponPreview(name);
		const bullets = preview.highlights.map(line => `    • ${line}`);
		return [
			`  ${preview.name}  ${preview.label}  ${preview.maturity}`,
			`    ${preview.description}`,
			...bullets,
			`    Learned from ${preview.learnedFrom}.`,
		].join("\n");
	});
	return [
		"Available weapons:",
		"",
		blocks.join("\n\n"),
		"",
		"Apply one with /weapon <name> or /preset <name>.",
		PRESET_SESSION_REFRESH_MESSAGE,
	].join("\n");
}

/**
 * Operator summary after a pack is applied. Shared by `/weapon <name>` and the
 * TUI picker so both surfaces report the same next-session contract.
 */
export function formatApplyPresetResult(result: ApplyPresetResult): string {
	const appliedCount = result.applied.length;
	const keptNote = result.skipped.length > 0 ? ` (${result.skipped.length} kept from your existing config)` : "";
	return (
		`Applied weapon "${result.preset.name}": ${appliedCount} setting${appliedCount === 1 ? "" : "s"} set${keptNote}. ` +
		PRESET_SESSION_REFRESH_MESSAGE
	);
}

/**
 * The pack whose specified keys all match `settings`, preferring the pack that
 * specifies the most keys so `pi-super` wins over `opm-verify` when both match.
 * Returns `undefined` when the loadout is mixed and no pack fits.
 */
export function matchingPresetName(settings: Settings): PresetName | undefined {
	const target = packSettings(settings);
	let best: PresetName | undefined;
	let bestCount = -1;
	for (const name of PRESET_NAMES) {
		const preset = PRESETS[name];
		if (!preset.settings.every(setting => target.get(setting.path) === setting.value)) continue;
		if (preset.settings.length > bestCount) {
			best = name;
			bestCount = preset.settings.length;
		}
	}
	return best;
}

export function presetCardId(name: PresetName): string {
	return `${PRESET_CARD_ID_PREFIX}${name}`;
}

export function parsePresetCardId(id: string): PresetName | undefined {
	if (!id.startsWith(PRESET_CARD_ID_PREFIX)) return undefined;
	const name = id.slice(PRESET_CARD_ID_PREFIX.length);
	return isPresetName(name) ? name : undefined;
}

/** Settings-list rows for the Weapons group: label, description+source, maturity badge. */
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
 * name. Same persisted-wins / previous-pack-replaced contract as {@link applyPreset}.
 */
export function applyPresetCard(settings: Settings, id: string): ApplyPresetResult | undefined {
	const name = parsePresetCardId(id) ?? (isPresetName(id) ? id : undefined);
	if (!name) return undefined;
	return applyPreset(settings, name);
}

/** Type guard: whether `name` is a known pack identifier. */
export function isPresetName(name: string): name is PresetName {
	return (PRESET_NAMES as readonly string[]).includes(name);
}

/** Resolve a pack by name, or `undefined` when the name is unknown. */
export function resolvePreset(name: string): PresetDefinition | undefined {
	return isPresetName(name) ? PRESETS[name] : undefined;
}

/**
 * Super Pi starts with the `pi-super` weapon unless the user passed `--preset`
 * or `--weapon`. Official `omp` starts with no pack so vanilla behavior is
 * unchanged.
 */
export function defaultPresetForProduct(appName: string): PresetName | undefined {
	return appName === SUPERPI_PRODUCT_NAME ? "pi-super" : undefined;
}

/**
 * Launch-time pack name: an explicit `--preset` / `--weapon` value wins, Super
 * Pi falls back to `pi-super`, and `omp` starts with no pack.
 */
export function resolveLaunchPresetName(presetFlag: string | undefined, appName: string): string | undefined {
	return presetFlag ?? defaultPresetForProduct(appName);
}

/**
 * Narrow Settings to the boolean pack keys. Avoids instantiating
 * `Settings.override` across the full schema union.
 */
interface PackSettings {
	get(path: PresetPath): boolean;
	isPersisted(path: PresetPath): boolean;
	clearOverride(path: PresetPath): void;
	override(path: PresetPath, value: boolean): void;
}

function packSettings(settings: Settings): PackSettings {
	return settings as unknown as PackSettings;
}

/** Outcome of {@link applyPreset}: which keys the pack set vs. left to the user. */
export interface ApplyPresetResult {
	readonly preset: PresetDefinition;
	/** Keys the pack overrode (were not persisted). */
	readonly applied: PresetPath[];
	/** Keys the pack left untouched because they were already in persisted config. */
	readonly skipped: PresetPath[];
}

/**
 * Apply a pack to `settings` through the non-persistent runtime override
 * layer. Keys the user has already persisted are skipped so explicit
 * configuration always wins. Previous pack runtime overrides are replaced so
 * `/weapon` actually switches loadouts. Returns `undefined` for an unknown
 * pack name so callers can surface a usage error.
 */
export function applyPreset(settings: Settings, name: string): ApplyPresetResult | undefined {
	const preset = resolvePreset(name);
	if (!preset) return undefined;

	const target = packSettings(settings);
	const specified = new Set<PresetPath>(preset.settings.map(setting => setting.path));
	for (const path of PRESET_BOOLEAN_PATHS) {
		if (target.isPersisted(path) || specified.has(path)) continue;
		target.clearOverride(path);
	}

	const applied: PresetPath[] = [];
	const skipped: PresetPath[] = [];
	for (const override of preset.settings) {
		if (target.isPersisted(override.path)) {
			skipped.push(override.path);
			continue;
		}
		target.override(override.path, override.value);
		applied.push(override.path);
	}
	return { preset, applied, skipped };
}
