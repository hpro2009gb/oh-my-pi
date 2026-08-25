/**
 * Optional OS sandbox for bash: wrap a command in bubblewrap.
 *
 * Two dials:
 * - `sandbox.mode` — capability (`off` | `workspace` | `container`)
 * - `sandbox.allowNetwork` — whether the sandbox may use the host network
 *
 * Linux-only (bubblewrap). Missing `bwrap` degrades to the original command
 * with a reason — it never pretends the command was confined.
 *
 * v1 wraps the command *string* for the embedded-shell path. PTY and
 * persistent-shell `cd` are out of scope (a sandbox `cd` would not persist).
 */
import * as path from "node:path";
import { $which } from "@oh-my-pi/pi-utils";

export type SandboxMode = "off" | "workspace" | "container";

export interface SandboxBuildOptions {
	mode: SandboxMode;
	allowNetwork: boolean;
	cwd: string;
	/**
	 * Explicit bwrap binary. `undefined` looks up `bwrap` on PATH.
	 * `null` forces the missing-binary path (tests).
	 */
	bwrapPath?: string | null;
}

export type SandboxArgvResult =
	| { kind: "off"; argv?: undefined }
	| { kind: "unconfined"; reason: string; argv?: undefined }
	| { kind: "confined"; argv: string[] };

export interface SandboxCommandResult {
	/** Command string for the embedded shell: original, or POSIX-quoted bwrap argv. */
	command: string;
	confined: boolean;
	reason?: string;
	argv?: string[];
}

function quoteShellArg(value: string): string {
	return `'${value.replace(/'/g, "'\\''")}'`;
}

function resolveBwrapPath(explicit: string | null | undefined): string | null {
	if (explicit === null) return null;
	if (explicit !== undefined) return explicit;
	return $which("bwrap");
}

/**
 * Build the bubblewrap argv that would confine `command`, or explain why not.
 */
export function buildSandboxArgv(command: string, options: SandboxBuildOptions): SandboxArgvResult {
	if (options.mode === "off") {
		return { kind: "off" };
	}
	if (process.platform === "win32") {
		return { kind: "unconfined", reason: "sandbox is Linux-only (bubblewrap)" };
	}
	const bwrap = resolveBwrapPath(options.bwrapPath);
	if (!bwrap) {
		return { kind: "unconfined", reason: "bwrap not found; install bubblewrap to confine bash" };
	}

	const cwd = path.resolve(options.cwd);
	const argv: string[] = [
		bwrap,
		"--die-with-parent",
		"--ro-bind",
		"/",
		"/",
		"--dev",
		"/dev",
		"--proc",
		"/proc",
		"--tmpfs",
		"/tmp",
		"--bind",
		cwd,
		cwd,
		"--chdir",
		cwd,
	];
	if (!options.allowNetwork) {
		argv.push("--unshare-net");
	}
	if (options.mode === "container") {
		argv.push("--unshare-pid", "--unshare-ipc", "--unshare-uts");
	}
	argv.push("--", "/bin/sh", "-c", command);
	return { kind: "confined", argv };
}

/**
 * Wrap `command` for the embedded shell, or return it unchanged with a reason.
 */
export function buildSandboxCommand(command: string, options: SandboxBuildOptions): SandboxCommandResult {
	const plan = buildSandboxArgv(command, options);
	if (plan.kind === "off") {
		return { command, confined: false };
	}
	if (plan.kind === "unconfined") {
		return { command, confined: false, reason: plan.reason };
	}
	return {
		command: plan.argv.map(quoteShellArg).join(" "),
		confined: true,
		argv: plan.argv,
	};
}
