import { applyPreset, PRESET_NAMES, PRESETS } from "../../config/presets";
import type { Settings } from "../../config/settings";

/** Multi-line list of available weapons with their intro cards (label · description · source). */
export function formatPresetList(): string {
	const lines = PRESET_NAMES.map(name => {
		const preset = PRESETS[name];
		return `  ${preset.name} — ${preset.description} [learned from ${preset.learnedFrom}]`;
	});
	return ["Available weapons:", ...lines, "Apply one with /weapon <name> or /preset <name>."].join("\n");
}

/**
 * Handle `/weapon [name]` (alias `/preset`): with no name, list the available
 * packs; with a name, apply it to `settings` (persisted keys stay yours —
 * packs replace a previous weapon's runtime overrides) and summarize the
 * outcome.
 *
 * The active tool slate is derived once at session start, so tool-gating
 * changes take effect on the next session start; the message says so rather
 * than implying an immediate mid-turn effect.
 */
export function runPresetSlashCommand(settings: Settings, args: string): string {
	const name = args.trim();
	if (!name) return formatPresetList();

	const result = applyPreset(settings, name);
	if (!result) {
		return `Unknown weapon "${name}". Available: ${PRESET_NAMES.join(", ")}.`;
	}

	const appliedCount = result.applied.length;
	const keptNote = result.skipped.length > 0 ? ` (${result.skipped.length} kept from your existing config)` : "";
	return (
		`Applied weapon "${result.preset.name}": ${appliedCount} setting${appliedCount === 1 ? "" : "s"} set${keptNote}. ` +
		"Tool changes take effect when the session next starts."
	);
}
