import { describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { DEFAULT_PRODUCT_NAME, SUPERPI_PRODUCT_NAME } from "@oh-my-pi/pi-utils/product-identity";
import { Snowflake } from "@oh-my-pi/pi-utils/snowflake";
import {
	installSuperpiSourceLauncher,
	renderSuperpiSourceLauncher,
	SUPERPI_BIN,
	superpiInstallPath,
} from "../../../scripts/install-superpi";

describe("superpi sidecar install", () => {
	it("renders a launcher that pins Super Pi and never execs omp", () => {
		const script = renderSuperpiSourceLauncher({
			bunPath: "/opt/bun",
			cliPath: "/repo/packages/coding-agent/src/cli.ts",
		});
		expect(script.startsWith("#!/bin/sh\n")).toBe(true);
		expect(script).toContain(`export OMP_PRODUCT='${SUPERPI_PRODUCT_NAME}'`);
		expect(script).toContain("exec '/opt/bun' '/repo/packages/coding-agent/src/cli.ts' \"$@\"");
		expect(script.includes(`OMP_PRODUCT='${DEFAULT_PRODUCT_NAME}'`)).toBe(false);
	});

	it("refuses to render a launcher that impersonates omp", () => {
		expect(() =>
			renderSuperpiSourceLauncher({
				bunPath: "/opt/bun",
				cliPath: "/repo/packages/coding-agent/src/cli.ts",
				product: DEFAULT_PRODUCT_NAME,
			}),
		).toThrow("impersonates the official omp command");
	});

	it("refuses a destination that would replace the official omp command", () => {
		expect(() => superpiInstallPath("/usr/local/bin", DEFAULT_PRODUCT_NAME)).toThrow(
			"Refusing to replace the official omp command",
		);
		expect(path.basename(superpiInstallPath("/usr/local/bin"))).toBe(SUPERPI_BIN);
	});

	it("installs superpi beside omp without writing an omp file", async () => {
		const installDir = path.join(os.tmpdir(), `superpi-install-${Snowflake.next()}`);
		const ompPath = path.join(installDir, DEFAULT_PRODUCT_NAME);
		try {
			await fs.mkdir(installDir, { recursive: true });
			await Bun.write(ompPath, "#!/bin/sh\necho official-omp\n");
			const ompBefore = await Bun.file(ompPath).text();

			const dest = await installSuperpiSourceLauncher({
				installDir,
				bunPath: process.execPath,
				cliPath: "/repo/packages/coding-agent/src/cli.ts",
			});

			expect(path.basename(dest)).toBe(SUPERPI_BIN);
			expect(dest).toBe(path.join(installDir, SUPERPI_BIN));
			expect(await Bun.file(dest).exists()).toBe(true);
			expect(await Bun.file(ompPath).text()).toBe(ompBefore);

			const launcher = await Bun.file(dest).text();
			expect(launcher).toContain(`OMP_PRODUCT='${SUPERPI_PRODUCT_NAME}'`);
			expect(launcher).toContain(process.execPath);
		} finally {
			await fs.rm(installDir, { recursive: true, force: true });
		}
	});

	it("running superpi --version does not create ~/.omp", async () => {
		const tmp = path.join(os.tmpdir(), `superpi-run-${Snowflake.next()}`);
		const home = path.join(tmp, "home");
		const installDir = path.join(tmp, "bin");
		const cliPath = path.join(import.meta.dir, "..", "src", "cli.ts");
		try {
			await fs.mkdir(home, { recursive: true });
			const dest = await installSuperpiSourceLauncher({
				installDir,
				bunPath: process.execPath,
				cliPath,
			});
			const childEnv: Record<string, string> = {};
			for (const [key, value] of Object.entries(process.env)) {
				if (value !== undefined) childEnv[key] = value;
			}
			childEnv.HOME = home;
			delete childEnv.PI_CONFIG_DIR;
			delete childEnv.OMP_PROFILE;
			delete childEnv.PI_PROFILE;
			const proc = Bun.spawn([dest, "--version"], {
				cwd: tmp,
				env: childEnv,
				stdout: "pipe",
				stderr: "pipe",
			});
			const [stdout, stderr, exitCode] = await Promise.all([
				new Response(proc.stdout).text(),
				new Response(proc.stderr).text(),
				proc.exited,
			]);
			expect(exitCode).toBe(0);
			expect(`${stdout}${stderr}`).toMatch(/\d+\.\d+/);
			expect(await Bun.file(path.join(home, ".omp")).exists()).toBe(false);
		} finally {
			await fs.rm(tmp, { recursive: true, force: true });
		}
	});
});
