import { applyPreset, formatApplyPresetResult, formatWeaponTable, PRESET_NAMES } from "../../config/presets";
import type { Settings } from "../../config/settings";

/** Multi-line weapon table: id, label, maturity, features, and source. */
export function formatPresetList(): string {
	return formatWeaponTable();
}

/**
 * Handle `/weapon [name]` (alias `/preset`): with no name, list the available
 * packs as a feature table; with a name, apply it to `settings` (persisted
 * keys stay yours — packs replace a previous weapon's runtime overrides) and
 * summarize the outcome.
 *
 * The active tool slate is derived once at session start, so tool-gating
 * changes take effect on the next session start; the message says so rather
 * than implying an immediate mid-turn effect.
 */
export function runPresetSlashCommand(settings: Settings, args: string): string {
	const name = args.trim();
	if (!name) return formatWeaponTable();

	const result = applyPreset(settings, name);
	if (!result) {
		return `Unknown weapon "${name}". Available: ${PRESET_NAMES.join(", ")}.`;
	}

	return formatApplyPresetResult(result);
}
