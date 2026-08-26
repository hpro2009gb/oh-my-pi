import { describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Snowflake } from "@oh-my-pi/pi-utils/snowflake";
import { SIDE_APP_BIN, SIDE_APP_CONFIG_DIR } from "../src/cli/side-app";

function childEnv(home: string): Record<string, string> {
	const env: Record<string, string> = {};
	for (const [key, value] of Object.entries(process.env)) {
		if (value === undefined) continue;
		if (
			key === "PI_CONFIG_DIR" ||
			key === "OMP_XDG_APP_NAME" ||
			key === "OMP_DEFAULT_PRESET" ||
			key === "OMP_DEV_LAUNCH_DIR"
		) {
			continue;
		}
		env[key] = value;
	}
	env.HOME = home;
	env.USERPROFILE = home;
	return env;
}

describe("supper-omp launcher", () => {
	it("starts without creating ~/.omp and lists the pi-super pack", async () => {
		const home = path.join(os.tmpdir(), "supper-omp-home", Snowflake.next());
		await fs.mkdir(home, { recursive: true });
		try {
			const launcher = path.join(import.meta.dir, "..", "scripts", SIDE_APP_BIN);
			const proc = Bun.spawn([launcher, "--help"], {
				cwd: home,
				env: childEnv(home),
				stdout: "pipe",
				stderr: "pipe",
			});
			const [stdout, stderr, exitCode] = await Promise.all([
				new Response(proc.stdout).text(),
				new Response(proc.stderr).text(),
				proc.exited,
			]);
			expect(exitCode).toBe(0);
			expect(stderr).not.toMatch(/error:/i);
			expect(stdout).toContain("pi-super");
			expect(await exists(path.join(home, SIDE_APP_CONFIG_DIR, ".dev-cwd"))).toBe(true);
			expect(await exists(path.join(home, ".omp"))).toBe(false);
		} finally {
			await fs.rm(home, { recursive: true, force: true });
		}
	});
});

async function exists(filePath: string): Promise<boolean> {
	try {
		await fs.stat(filePath);
		return true;
	} catch {
		return false;
	}
}
