import { describe, expect, it } from "bun:test";
import * as path from "node:path";
import { buildRepoMap } from "../src/repo-map";

const FIXTURE_DIR = path.join(import.meta.dir, "fixtures", "repo-map");

describe("buildRepoMap", () => {
	it("outlines exported declarations and omits non-exported ones", async () => {
		const map = await buildRepoMap(FIXTURE_DIR, { tokenBudget: 4096 });
		expect(map.fileCount).toBe(2);
		expect(map.rendered).toContain("alphaOne");
		expect(map.rendered).toContain("AlphaShape");
		expect(map.rendered).toContain("alphaConst");
		expect(map.rendered).toContain("BetaThing");
		expect(map.rendered).toContain("BetaId");
		// A local (non-exported) function is not part of the public outline.
		expect(map.rendered).not.toContain("hiddenHelper");
	});

	it("drops the block opener so signatures read cleanly", async () => {
		const map = await buildRepoMap(FIXTURE_DIR, { tokenBudget: 4096 });
		expect(map.rendered).toContain("export class BetaThing");
		expect(map.rendered).not.toContain("export class BetaThing {");
	});

	it("is deterministic and stays within the token budget", async () => {
		const first = await buildRepoMap(FIXTURE_DIR, { tokenBudget: 40 });
		const second = await buildRepoMap(FIXTURE_DIR, { tokenBudget: 40 });
		expect(first.rendered).toBe(second.rendered);
		expect(first.rendered.length).toBeLessThanOrEqual(40 * 4);
	});

	it("marks truncation and drops content when the budget is tiny", async () => {
		const tiny = await buildRepoMap(FIXTURE_DIR, { tokenBudget: 20 });
		const large = await buildRepoMap(FIXTURE_DIR, { tokenBudget: 4096 });
		expect(tiny.truncated).toBe(true);
		expect(tiny.symbolCount).toBeLessThan(large.symbolCount);
	});

	it("returns an empty map for a zero budget", async () => {
		const map = await buildRepoMap(FIXTURE_DIR, { tokenBudget: 0 });
		expect(map.rendered).toBe("");
		expect(map.fileCount).toBe(0);
	});
});
