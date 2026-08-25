import * as fs from "node:fs/promises";
import * as path from "node:path";

/** Workspace-relative taste log. Reviewable markdown; never auto-injected. */
export const TASTE_LOG_RELATIVE_PATH = path.join(".omp", "taste.md");

export type TasteVerdict = "accept" | "reject";

export interface TasteEntry {
	verdict: TasteVerdict;
	targetPath: string;
	reason: string;
	recordedAt: string;
}

export function tasteLogPath(cwd: string): string {
	return path.join(cwd, TASTE_LOG_RELATIVE_PATH);
}

function formatEntry(entry: TasteEntry): string {
	const reason = entry.reason.length > 0 ? entry.reason : "(none)";
	return `### ${entry.verdict} \`${entry.targetPath}\`\n- time: ${entry.recordedAt}\n- reason: ${reason}\n\n`;
}

/** Append one accept/reject note. Creates `.omp/` as needed. */
export async function appendTasteEntry(
	cwd: string,
	entry: Omit<TasteEntry, "recordedAt"> & { recordedAt?: string },
): Promise<string> {
	const recorded: TasteEntry = {
		verdict: entry.verdict,
		targetPath: entry.targetPath,
		reason: entry.reason,
		recordedAt: entry.recordedAt ?? new Date().toISOString(),
	};
	const filePath = tasteLogPath(cwd);
	await fs.mkdir(path.dirname(filePath), { recursive: true });
	await fs.appendFile(filePath, formatEntry(recorded), { encoding: "utf8" });
	return filePath;
}
