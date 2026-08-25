import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Settings } from "../src/config/settings";
import { handleTasteCommand } from "../src/slash-commands/helpers/taste";
import type { SlashCommandRuntime } from "../src/slash-commands/types";
import { TASTE_LOG_RELATIVE_PATH, tasteLogPath } from "../src/taste";

let temporaryRoot = "";
let settings: Settings;
let output: string[] = [];

beforeEach(async () => {
	temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "omp-taste-"));
	settings = Settings.isolated({ "taste.enabled": true });
	output = [];
});

afterEach(async () => {
	settings.cancelPendingSaves();
	await fs.rm(temporaryRoot, { recursive: true, force: true });
});

function runtime(): SlashCommandRuntime {
	return {
		session: {} as SlashCommandRuntime["session"],
		sessionManager: {} as SlashCommandRuntime["sessionManager"],
		settings,
		cwd: temporaryRoot,
		output: text => {
			output.push(text);
		},
		refreshCommands: () => undefined,
		reloadPlugins: async () => undefined,
	};
}

async function command(args: string) {
	return handleTasteCommand({ name: "taste", args, text: `/taste ${args}` }, runtime());
}

describe("/taste", () => {
	test("disabled setting writes nothing so a consumer never sees a taste log", async () => {
		settings = Settings.isolated({ "taste.enabled": false });
		await command("accept src/foo.ts looks good");
		expect(output.at(-1)).toContain("Taste is disabled");
		expect(await Bun.file(tasteLogPath(temporaryRoot)).exists()).toBe(false);
	});

	test("accept appends a markdown heading a reviewer can grep for the path and verdict", async () => {
		await command("accept src/foo.ts keep this helper");
		const body = await Bun.file(tasteLogPath(temporaryRoot)).text();
		expect(body).toContain("### accept `src/foo.ts`");
		expect(body).toContain("keep this helper");
		expect(output.at(-1)).toContain(TASTE_LOG_RELATIVE_PATH);
	});

	test("reject records a distinct verdict from accept for the same path", async () => {
		await command("reject src/foo.ts too clever");
		const body = await Bun.file(tasteLogPath(temporaryRoot)).text();
		expect(body).toContain("### reject `src/foo.ts`");
		expect(body).not.toContain("### accept `src/foo.ts`");
	});

	test("two appends keep both lines so a second note cannot clobber the first", async () => {
		await command("accept a.ts first");
		await command("reject b.ts second");
		const body = await Bun.file(tasteLogPath(temporaryRoot)).text();
		expect(body).toContain("### accept `a.ts`");
		expect(body).toContain("### reject `b.ts`");
		expect(body.indexOf("### accept `a.ts`")).toBeLessThan(body.indexOf("### reject `b.ts`"));
	});

	test("missing path does not create a log file", async () => {
		await command("accept");
		expect(output.at(-1)).toContain("Usage:");
		expect(await Bun.file(tasteLogPath(temporaryRoot)).exists()).toBe(false);
	});
});
