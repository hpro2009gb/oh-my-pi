#!/usr/bin/env bun
/**
 * Install this checkout as a sidecar `superpi` command.
 *
 * Leaves the official `omp` binary and `~/.omp` data untouched. Super Pi uses
 * `~/.superpi` and `<cwd>/.superpi`.
 *
 * Usage:
 *   bun scripts/install-superpi.ts           # source launcher (default)
 *   bun scripts/install-superpi.ts --binary  # compile a standalone binary
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { DEFAULT_PRODUCT_NAME, SUPERPI_PRODUCT_NAME } from "@oh-my-pi/pi-utils/product-identity";

export const SUPERPI_BIN = SUPERPI_PRODUCT_NAME;

function posixQuote(value: string): string {
	return `'${value.replace(/'/g, `'"'"'`)}'`;
}

/** Shell launcher that pins `OMP_PRODUCT=superpi` and never execs `omp`. */
export function renderSuperpiSourceLauncher(options: { bunPath: string; cliPath: string; product?: string }): string {
	const product = options.product ?? SUPERPI_PRODUCT_NAME;
	if (product === DEFAULT_PRODUCT_NAME) {
		throw new Error("Refusing to install a launcher that impersonates the official omp command");
	}
	return `#!/bin/sh
export OMP_PRODUCT=${posixQuote(product)}
exec ${posixQuote(options.bunPath)} ${posixQuote(options.cliPath)} "$@"
`;
}

export function superpiInstallPath(installDir: string, product: string = SUPERPI_PRODUCT_NAME): string {
	const dest = path.join(installDir, product);
	if (path.basename(dest) === DEFAULT_PRODUCT_NAME) {
		throw new Error("Refusing to replace the official omp command");
	}
	return dest;
}

export async function installSuperpiSourceLauncher(options: {
	installDir: string;
	bunPath: string;
	cliPath: string;
	product?: string;
}): Promise<string> {
	const dest = superpiInstallPath(options.installDir, options.product);
	await fs.mkdir(options.installDir, { recursive: true });
	await Bun.write(
		dest,
		renderSuperpiSourceLauncher({
			bunPath: options.bunPath,
			cliPath: options.cliPath,
			product: options.product,
		}),
	);
	await fs.chmod(dest, 0o755);
	return dest;
}

function printHelp(): void {
	process.stdout.write(`Install this checkout as a separate Super Pi release.

Usage (from the clone folder that contains scripts/install-superpi.ts):
  bun scripts/install-superpi.ts           Install a source launcher named ${SUPERPI_BIN}
  bun scripts/install-superpi.ts --binary  Compile a standalone ${SUPERPI_BIN} binary
  bun scripts/install-superpi.ts --help

This is a local install. It does not upload Super Pi to GitHub.
Does not replace \`omp\` or write to ~/.omp.
Data: ~/.${SUPERPI_BIN}   Project config: <cwd>/.${SUPERPI_BIN}
Install dir: $PI_INSTALL_DIR or ~/.local/bin

Weapons: ${SUPERPI_BIN} starts on pi-super. Switch with --preset / --weapon,
/weapon (opens a table of packs), or Settings → Tools → Weapons
(pi-minimal, opm-verify, pi-super). GitHub stays off until you enable it.
`);
}

/** Operator summary after a successful install. Includes the clone path so a fake folder is obvious. */
export function formatInstallReport(options: {
	dest: string;
	repoRoot: string;
	installDir: string;
	pathEnv: string;
}): string {
	const pathParts = options.pathEnv.split(path.delimiter);
	const runLine = pathParts.includes(options.installDir)
		? `Run '${SUPERPI_BIN}' to get started.`
		: `Add ${options.installDir} to PATH, then run '${SUPERPI_BIN}'.`;
	return [
		"",
		`Installed ${SUPERPI_BIN} to ${options.dest}`,
		`Clone directory: ${options.repoRoot}`,
		`Official omp is unchanged. Super Pi data: ~/.${SUPERPI_BIN}`,
		"This installer does not upload to GitHub.",
		runLine,
		"",
	].join("\n");
}

async function installCompiledBinary(installDir: string, repoRoot: string): Promise<string> {
	const dest = superpiInstallPath(installDir);
	const codingAgentDir = path.join(repoRoot, "packages", "coding-agent");
	const proc = Bun.spawn(["bun", "run", "build"], {
		cwd: codingAgentDir,
		env: { ...process.env, OMP_PRODUCT: SUPERPI_PRODUCT_NAME },
		stdout: "inherit",
		stderr: "inherit",
	});
	const exitCode = await proc.exited;
	if (exitCode !== 0) {
		throw new Error(`Failed to compile ${SUPERPI_BIN} (exit ${exitCode})`);
	}
	const built = path.join(codingAgentDir, "dist", SUPERPI_PRODUCT_NAME);
	if (!(await Bun.file(built).exists())) {
		throw new Error(`Compiled binary missing at ${built}`);
	}
	await fs.mkdir(installDir, { recursive: true });
	await fs.copyFile(built, dest);
	await fs.chmod(dest, 0o755);
	return dest;
}

async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
	if (argv.includes("--help") || argv.includes("-h")) {
		printHelp();
		return;
	}
	const binary = argv.includes("--binary");
	const unknown = argv.filter(arg => arg !== "--binary" && arg !== "--help" && arg !== "-h");
	if (unknown.length > 0) {
		throw new Error(`Unknown option: ${unknown[0]}`);
	}

	const repoRoot = path.join(import.meta.dir, "..");
	const cliPath = path.join(repoRoot, "packages", "coding-agent", "src", "cli.ts");
	if (!(await Bun.file(cliPath).exists())) {
		throw new Error(`CLI entry missing at ${cliPath}`);
	}

	const installDir = process.env.PI_INSTALL_DIR || path.join(os.homedir(), ".local", "bin");
	const dest = binary
		? await installCompiledBinary(installDir, repoRoot)
		: await installSuperpiSourceLauncher({
				installDir,
				bunPath: process.execPath,
				cliPath,
			});

	process.stdout.write(
		formatInstallReport({
			dest,
			repoRoot,
			installDir,
			pathEnv: process.env.PATH ?? "",
		}),
	);
}

if (import.meta.main) {
	try {
		await main();
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		process.stderr.write(`error: ${message}\n`);
		process.exit(1);
	}
}
