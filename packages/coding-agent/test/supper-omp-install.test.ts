import { describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Snowflake } from "@oh-my-pi/pi-utils/snowflake";
import { installSupperOmp } from "../scripts/install-supper-omp";
import { isOfficialOmpBinName, SIDE_APP_BIN } from "../src/cli/side-app";

describe("supper-omp installer", () => {
	it("refuses names that would replace the official omp command", () => {
		expect(isOfficialOmpBinName("omp")).toBe(true);
		expect(isOfficialOmpBinName("OMP.EXE")).toBe(true);
		expect(isOfficialOmpBinName("C:\\\\bin\\\\omp.cmd")).toBe(true);
		expect(isOfficialOmpBinName(SIDE_APP_BIN)).toBe(false);
		expect(isOfficialOmpBinName(`${SIDE_APP_BIN}.cmd`)).toBe(false);
	});

	it("links supper-omp into a bin dir without rewriting a sibling omp binary", async () => {
		const binDir = path.join(os.tmpdir(), "supper-omp-install", Snowflake.next());
		const official = path.join(binDir, "omp");
		const officialBytes = "official-omp-marker\n";
		await fs.mkdir(binDir, { recursive: true });
		try {
			await Bun.write(official, officialBytes);
			const result = await installSupperOmp({
				binDir,
				scriptsDir: path.join(import.meta.dir, "..", "scripts"),
				platform: "linux",
			});

			expect(path.basename(result.dest)).toBe(SIDE_APP_BIN);
			expect(result.dest).not.toBe(official);
			const destStat = await fs.lstat(result.dest);
			expect(destStat.isSymbolicLink()).toBe(true);
			expect(await fs.readFile(official, "utf8")).toBe(officialBytes);
		} finally {
			await fs.rm(binDir, { recursive: true, force: true });
		}
	});
});
