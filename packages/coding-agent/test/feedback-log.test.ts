import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
	appendFeedback,
	FEEDBACK_LOG_FILENAME,
	FEEDBACK_TEXT_MAX_CHARS,
	getFeedbackLogPath,
	listFeedback,
} from "@oh-my-pi/pi-coding-agent/feedback";
import { TempDir } from "@oh-my-pi/pi-utils";

describe("local feedback JSONL log", () => {
	const dirs: TempDir[] = [];

	afterEach(async () => {
		await Promise.all(dirs.splice(0).map(dir => dir.remove()));
	});

	async function agentDir(): Promise<string> {
		const dir = await TempDir.create("pi-feedback-");
		dirs.push(dir);
		return dir.path();
	}

	test("appends a JSONL line with ISO timestamp, optional session/model ids, and the user text", async () => {
		const dir = await agentDir();
		const result = await appendFeedback({
			agentDir: dir,
			text: "  too much hedging  ",
			sessionId: "sess-1",
			modelId: "gpt-test",
			ts: "2026-08-25T16:00:00.000Z",
		});

		expect(result).toEqual({
			ok: true,
			record: {
				ts: "2026-08-25T16:00:00.000Z",
				text: "too much hedging",
				sessionId: "sess-1",
				modelId: "gpt-test",
			},
		});

		const raw = await Bun.file(getFeedbackLogPath(dir)).text();
		expect(raw).toBe(
			`${JSON.stringify({
				ts: "2026-08-25T16:00:00.000Z",
				text: "too much hedging",
				sessionId: "sess-1",
				modelId: "gpt-test",
			})}\n`,
		);
		expect(path.basename(getFeedbackLogPath(dir))).toBe(FEEDBACK_LOG_FILENAME);
	});

	test("rejects empty or whitespace-only input without creating or changing the log file", async () => {
		const dir = await agentDir();
		const logPath = getFeedbackLogPath(dir);

		expect(await appendFeedback({ agentDir: dir, text: "" })).toEqual({
			ok: false,
			error: "Feedback text is empty.",
		});
		expect(await Bun.file(logPath).exists()).toBe(false);

		const first = await appendFeedback({
			agentDir: dir,
			text: "keep this",
			ts: "2026-08-25T16:00:00.000Z",
		});
		expect(first.ok).toBe(true);
		const before = await Bun.file(logPath).text();

		expect(await appendFeedback({ agentDir: dir, text: "   \n\t  " })).toEqual({
			ok: false,
			error: "Feedback text is empty.",
		});
		expect(await Bun.file(logPath).text()).toBe(before);
	});

	test("rejects malformed input without corrupting existing JSONL lines", async () => {
		const dir = await agentDir();
		const logPath = getFeedbackLogPath(dir);
		await fs.writeFile(
			logPath,
			`${JSON.stringify({ ts: "2026-08-25T16:00:00.000Z", text: "good note" })}\nnot-json\n`,
		);

		expect(
			await appendFeedback({
				agentDir: dir,
				text: "x".repeat(FEEDBACK_TEXT_MAX_CHARS + 1),
			}),
		).toEqual({
			ok: false,
			error: `Feedback text exceeds ${FEEDBACK_TEXT_MAX_CHARS} characters.`,
		});
		expect(await Bun.file(logPath).text()).toBe(
			`${JSON.stringify({ ts: "2026-08-25T16:00:00.000Z", text: "good note" })}\nnot-json\n`,
		);

		const listed = await listFeedback({ agentDir: dir });
		expect(listed).toEqual([{ ts: "2026-08-25T16:00:00.000Z", text: "good note" }]);
	});

	test("lists recent valid records newest-first and skips malformed lines", async () => {
		const dir = await agentDir();
		await appendFeedback({
			agentDir: dir,
			text: "first",
			ts: "2026-08-25T16:00:00.000Z",
		});
		await appendFeedback({
			agentDir: dir,
			text: "second",
			sessionId: "s2",
			ts: "2026-08-25T16:01:00.000Z",
		});

		expect(await listFeedback({ agentDir: dir, limit: 1 })).toEqual([
			{ ts: "2026-08-25T16:01:00.000Z", text: "second", sessionId: "s2" },
		]);
		expect(await listFeedback({ agentDir: "/missing-feedback-dir" })).toEqual([]);
	});
});
