#!/usr/bin/env bun
/**
 * Install the `supper-omp` command next to Bun's global bins without touching
 * the official `omp` binary. Data stays under ~/.supper-omp via the wrapper.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { isEnoent } from "@oh-my-pi/pi-utils";
import { $ } from "bun";
import { isOfficialOmpBinName, SIDE_APP_BIN, SIDE_APP_CONFIG_DIR } from "../src/cli/side-app";

export interface InstallSupperOmpOptions {
	readonly binDir: string;
	readonly scriptsDir?: string;
	readonly platform?: NodeJS.Platform;
}

export interface InstallSupperOmpResult {
	readonly dest: string;
	readonly binDir: string;
}

function wrapperName(platform: NodeJS.Platform): string {
	return platform === "win32" ? `${SIDE_APP_BIN}.cmd` : SIDE_APP_BIN;
}

export async function resolveDefaultBinDir(): Promise<string> {
	const probed = await $`bun pm -g bin`.quiet().nothrow();
	if (probed.exitCode === 0) {
		const dir = probed.text().trim();
		if (dir) return dir;
	}
	return path.join(process.env.BUN_INSTALL ?? path.join(os.homedir(), ".bun"), "bin");
}

export async function installSupperOmp(options: InstallSupperOmpOptions): Promise<InstallSupperOmpResult> {
	const platform = options.platform ?? process.platform;
	const destName = wrapperName(platform);
	if (isOfficialOmpBinName(destName) || isOfficialOmpBinName(options.binDir)) {
		throw new Error(`Refusing to install over the official omp command (${destName}).`);
	}

	const scriptsDir = options.scriptsDir ?? import.meta.dir;
	const source = path.join(scriptsDir, destName);
	const dest = path.join(options.binDir, destName);
	if (isOfficialOmpBinName(path.basename(dest))) {
		throw new Error(`Refusing to install over the official omp command (${dest}).`);
	}

	await fs.promises.mkdir(options.binDir, { recursive: true });
	if (platform === "win32") {
		await Bun.write(dest, await Bun.file(source).text());
	} else {
		try {
			await fs.promises.unlink(dest);
		} catch (err) {
			if (!isEnoent(err)) throw err;
		}
		await fs.promises.symlink(source, dest);
		await fs.promises.chmod(source, 0o755);
	}
	return { dest, binDir: options.binDir };
}

async function main(): Promise<void> {
	const binDir = await resolveDefaultBinDir();
	const result = await installSupperOmp({ binDir });
	process.stdout.write(
		`install-supper-omp: linked ${result.dest} (official omp was not modified)\n` +
			`Data directory: ~/${SIDE_APP_CONFIG_DIR}  (not ~/.omp)\n` +
			`Try: ${SIDE_APP_BIN} --help\n`,
	);
}

if (import.meta.main) {
	await main();
}
