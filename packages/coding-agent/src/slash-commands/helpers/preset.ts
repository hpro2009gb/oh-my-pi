import { applyPreset, PRESET_NAMES, PRESETS } from "../../config/presets";
import type { Settings } from "../../config/settings";

/** Multi-line list of available presets with their intro cards (label · description · source). */
export function formatPresetList(): string {
	const lines = PRESET_NAMES.map(name => {
		const preset = PRESETS[name];
		return `  ${preset.name} — ${preset.description} [learned from ${preset.learnedFrom}]`;
	});
	return ["Available presets:", ...lines, "Apply one with /preset <name>."].join("\n");
}

/**
 * Handle `/preset [name]`: with no name, list the available presets; with a
 * name, apply it to `settings` (unconfigured keys only — your explicit settings
 * always win) and summarize the outcome. Returns the operator feedback line.
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
		return `Unknown preset "${name}". Available: ${PRESET_NAMES.join(", ")}.`;
	}

	const appliedCount = result.applied.length;
	const keptNote = result.skipped.length > 0 ? ` (${result.skipped.length} kept from your existing config)` : "";
	return (
		`Applied preset "${result.preset.name}": ${appliedCount} setting${appliedCount === 1 ? "" : "s"} set${keptNote}. ` +
		"Tool changes take effect when the session next starts."
	);
}
