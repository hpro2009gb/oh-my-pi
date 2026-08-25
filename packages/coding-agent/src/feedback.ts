/**
 * Local session feedback log.
 *
 * Opt-in notes from `/feedback` are appended as JSONL under the agent dir
 * (`feedback.jsonl`). Nothing is uploaded.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { isEnoent } from "@oh-my-pi/pi-utils";
import type { Settings } from "./config/settings";

export const FEEDBACK_LOG_FILENAME = "feedback.jsonl";
export const FEEDBACK_TEXT_MAX_CHARS = 4000;
export const FEEDBACK_LIST_DEFAULT_LIMIT = 20;

/** One locally stored `/feedback` note. */
export interface FeedbackRecord {
	ts: string;
	text: string;
	sessionId?: string;
	modelId?: string;
}

export interface AppendFeedbackInput {
	agentDir: string;
	text: string;
	sessionId?: string;
	modelId?: string;
	/** Test seam. Production callers omit this and get `new Date().toISOString()`. */
	ts?: string;
}

export type AppendFeedbackResult = { ok: true; record: FeedbackRecord } | { ok: false; error: string };

export function isFeedbackEnabled(settings: Pick<Settings, "get"> | undefined): boolean {
	return settings?.get("feedback.enabled") === true;
}

export function getFeedbackLogPath(agentDir: string): string {
	return path.join(agentDir, FEEDBACK_LOG_FILENAME);
}

export async function appendFeedback(input: AppendFeedbackInput): Promise<AppendFeedbackResult> {
	const text = input.text.trim();
	if (!text) return { ok: false, error: "Feedback text is empty." };
	if (text.length > FEEDBACK_TEXT_MAX_CHARS) {
		return { ok: false, error: `Feedback text exceeds ${FEEDBACK_TEXT_MAX_CHARS} characters.` };
	}

	const record: FeedbackRecord = {
		ts: input.ts ?? new Date().toISOString(),
		text,
	};
	if (input.sessionId) record.sessionId = input.sessionId;
	if (input.modelId) record.modelId = input.modelId;

	try {
		await fs.appendFile(getFeedbackLogPath(input.agentDir), `${JSON.stringify(record)}\n`, "utf8");
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { ok: false, error: `Failed to write feedback log: ${message}` };
	}
	return { ok: true, record };
}

export async function listFeedback(options: { agentDir: string; limit?: number }): Promise<FeedbackRecord[]> {
	const limit = options.limit ?? FEEDBACK_LIST_DEFAULT_LIMIT;
	let content: string;
	try {
		content = await Bun.file(getFeedbackLogPath(options.agentDir)).text();
	} catch (error) {
		if (isEnoent(error)) return [];
		throw error;
	}

	const records: FeedbackRecord[] = [];
	for (const line of content.split("\n")) {
		if (!line.trim()) continue;
		const record = parseFeedbackRecord(line);
		if (record) records.push(record);
	}
	if (limit <= 0) return [];
	return records.slice(-limit).reverse();
}

export function formatFeedbackList(records: readonly FeedbackRecord[]): string {
	if (records.length === 0) return "No local feedback recorded yet.";
	return records
		.map(record => {
			const meta = [record.ts];
			if (record.sessionId) meta.push(`session=${record.sessionId}`);
			if (record.modelId) meta.push(`model=${record.modelId}`);
			return `${meta.join("  ")}\n  ${record.text}`;
		})
		.join("\n\n");
}

function parseFeedbackRecord(line: string): FeedbackRecord | null {
	let value: unknown;
	try {
		value = JSON.parse(line);
	} catch {
		return null;
	}
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const row: Record<string, unknown> = value as Record<string, unknown>;
	if (typeof row.ts !== "string" || !row.ts || typeof row.text !== "string" || !row.text) return null;
	const record: FeedbackRecord = { ts: row.ts, text: row.text };
	if (typeof row.sessionId === "string" && row.sessionId) record.sessionId = row.sessionId;
	if (typeof row.modelId === "string" && row.modelId) record.modelId = row.modelId;
	return record;
}
