import { describe, expect, it } from "bun:test";
import type { RepoMap } from "../src/repo-map";
import { buildSystemPrompt } from "../src/system-prompt";

const EMPTY_WORKSPACE_TREE = {
	rootPath: import.meta.dir,
	rendered: "",
	truncated: false,
	totalLines: 0,
	agentsMdFiles: [] as string[],
};

function repoMap(rendered: string, truncated = false): RepoMap {
	return {
		rootPath: import.meta.dir,
		rendered,
		truncated,
		fileCount: rendered ? 1 : 0,
		symbolCount: rendered ? 1 : 0,
	};
}

async function renderPrompt(map: RepoMap): Promise<string> {
	const result = await buildSystemPrompt({
		resolvedCustomPrompt: "Base prompt",
		contextFiles: [],
		skills: [],
		rules: [],
		toolNames: [],
		workspaceTree: EMPTY_WORKSPACE_TREE,
		repoMap: map,
		cwd: import.meta.dir,
	});
	return result.systemPrompt.join("\n");
}

describe("repo map system-prompt injection", () => {
	it("renders a <repo-map> block when a non-empty map is provided", async () => {
		const prompt = await renderPrompt(repoMap("src/thing.ts\n  export function doThing(): void"));
		expect(prompt).toContain("<repo-map>");
		expect(prompt).toContain("export function doThing(): void");
	});

	it("omits the block entirely when the map is empty", async () => {
		const prompt = await renderPrompt(repoMap(""));
		expect(prompt).not.toContain("<repo-map>");
	});

	it("surfaces the truncation notice only when the map was trimmed", async () => {
		const trimmed = await renderPrompt(repoMap("src/a.ts\n  export const a = 1", true));
		expect(trimmed).toContain("Outline truncated to fit the budget");
		const full = await renderPrompt(repoMap("src/a.ts\n  export const a = 1", false));
		expect(full).not.toContain("Outline truncated to fit the budget");
	});
});
