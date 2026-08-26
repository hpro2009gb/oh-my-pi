import { describe, expect, it } from "bun:test";
import * as os from "node:os";
import * as path from "node:path";
import {
	DEFAULT_PRODUCT_CONFIG_DIR,
	DEFAULT_PRODUCT_NAME,
	normalizeProductName,
	resolveProductIdentity,
	SUPERPI_PRODUCT_NAME,
} from "../src/product-identity";

describe("normalizeProductName", () => {
	it("treats empty, omp, and default as the official product", () => {
		expect(normalizeProductName(undefined)).toBeUndefined();
		expect(normalizeProductName("")).toBeUndefined();
		expect(normalizeProductName("omp")).toBeUndefined();
		expect(normalizeProductName("OMP")).toBeUndefined();
		expect(normalizeProductName("default")).toBeUndefined();
	});

	it("accepts sidecar names and rejects invalid ones without throwing", () => {
		expect(normalizeProductName(SUPERPI_PRODUCT_NAME)).toBe(SUPERPI_PRODUCT_NAME);
		expect(normalizeProductName("SuperPi")).toBe(SUPERPI_PRODUCT_NAME);
		expect(normalizeProductName("..")).toBeUndefined();
		expect(normalizeProductName("has space")).toBeUndefined();
	});
});

describe("resolveProductIdentity", () => {
	it("keeps the official omp identity when no sidecar is selected", () => {
		expect(
			resolveProductIdentity({
				env: {},
				argv: ["/usr/bin/bun", "/repo/packages/coding-agent/src/cli.ts"],
				execPath: "/usr/bin/bun",
			}),
		).toEqual({ appName: DEFAULT_PRODUCT_NAME, configDir: DEFAULT_PRODUCT_CONFIG_DIR });
	});

	it("relocates home and project config when OMP_PRODUCT selects superpi", () => {
		expect(
			resolveProductIdentity({
				env: { OMP_PRODUCT: SUPERPI_PRODUCT_NAME },
				argv: ["/usr/bin/bun", "/repo/packages/coding-agent/src/cli.ts"],
				execPath: "/usr/bin/bun",
			}),
		).toEqual({ appName: SUPERPI_PRODUCT_NAME, configDir: `.${SUPERPI_PRODUCT_NAME}` });
	});

	it("treats a superpi executable as a sidecar without touching omp", () => {
		expect(
			resolveProductIdentity({
				env: {},
				argv: ["/home/me/.local/bin/superpi"],
				execPath: "/home/me/.local/bin/superpi",
			}),
		).toEqual({ appName: SUPERPI_PRODUCT_NAME, configDir: `.${SUPERPI_PRODUCT_NAME}` });
	});

	it("does not treat release-named omp binaries as a new product", () => {
		expect(
			resolveProductIdentity({
				env: {},
				argv: ["/opt/omp-linux-x64"],
				execPath: "/opt/omp-linux-x64",
			}),
		).toEqual({ appName: DEFAULT_PRODUCT_NAME, configDir: DEFAULT_PRODUCT_CONFIG_DIR });
	});

	it("does not infer a product from an unrelated script basename", () => {
		expect(
			resolveProductIdentity({
				env: {},
				argv: [process.execPath, "/repo/packages/utils/test/product-identity-probe.ts"],
				execPath: process.execPath,
			}),
		).toEqual({ appName: DEFAULT_PRODUCT_NAME, configDir: DEFAULT_PRODUCT_CONFIG_DIR });
	});

	it("ignores an invalid OMP_PRODUCT instead of crashing module load", () => {
		expect(
			resolveProductIdentity({
				env: { OMP_PRODUCT: "not a product" },
				argv: ["omp"],
				execPath: "/usr/bin/omp",
			}),
		).toEqual({ appName: DEFAULT_PRODUCT_NAME, configDir: DEFAULT_PRODUCT_CONFIG_DIR });
	});
});

describe("product identity module-load wiring", () => {
	async function probe(envOverrides: NodeJS.ProcessEnv): Promise<{
		APP_NAME: string;
		CONFIG_DIR_NAME: string;
		configRoot: string;
		projectDir: string;
	}> {
		const home = path.join(os.tmpdir(), "omp-product-home");
		const childEnv: Record<string, string> = {};
		for (const [key, value] of Object.entries(process.env)) {
			if (value !== undefined) childEnv[key] = value;
		}
		delete childEnv.PI_CONFIG_DIR;
		delete childEnv.OMP_PROFILE;
		delete childEnv.PI_PROFILE;
		delete childEnv.OMP_PRODUCT;
		delete childEnv.PI_CODING_AGENT_DIR;
		childEnv.HOME = home;
		for (const [key, value] of Object.entries(envOverrides)) {
			if (value === undefined || value === "") delete childEnv[key];
			else childEnv[key] = value;
		}
		const proc = Bun.spawn([process.execPath, path.join(import.meta.dir, "product-identity-probe.ts")], {
			cwd: path.join(import.meta.dir, ".."),
			env: childEnv,
			stdout: "pipe",
			stderr: "pipe",
		});
		const [stdout, stderr, exitCode] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited,
		]);
		if (exitCode !== 0) {
			throw new Error(`probe failed (${exitCode}): ${stderr || stdout}`);
		}
		return JSON.parse(stdout) as {
			APP_NAME: string;
			CONFIG_DIR_NAME: string;
			configRoot: string;
			projectDir: string;
		};
	}

	it("loads official omp dirs when OMP_PRODUCT is unset", async () => {
		const result = await probe({ OMP_PRODUCT: "" });
		expect(result.APP_NAME).toBe(DEFAULT_PRODUCT_NAME);
		expect(result.CONFIG_DIR_NAME).toBe(DEFAULT_PRODUCT_CONFIG_DIR);
		expect(result.configRoot.endsWith(`${path.sep}.omp`) || result.configRoot.endsWith("/.omp")).toBe(true);
		expect(result.projectDir).toBe(path.join("/tmp/proj", DEFAULT_PRODUCT_CONFIG_DIR));
	});

	it("loads superpi dirs that do not share ~/.omp or <cwd>/.omp", async () => {
		const result = await probe({ OMP_PRODUCT: SUPERPI_PRODUCT_NAME });
		expect(result.APP_NAME).toBe(SUPERPI_PRODUCT_NAME);
		expect(result.CONFIG_DIR_NAME).toBe(`.${SUPERPI_PRODUCT_NAME}`);
		expect(result.configRoot).toContain(`.${SUPERPI_PRODUCT_NAME}`);
		expect(result.configRoot).not.toMatch(/[/\\]\.omp$/);
		expect(result.projectDir).toBe(path.join("/tmp/proj", `.${SUPERPI_PRODUCT_NAME}`));
		expect(result.projectDir).not.toBe(path.join("/tmp/proj", DEFAULT_PRODUCT_CONFIG_DIR));
	});
});
