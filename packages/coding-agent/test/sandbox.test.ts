import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { resetSettingsForTest, Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { executeBash } from "@oh-my-pi/pi-coding-agent/exec/bash-executor";
import { buildSandboxArgv, buildSandboxCommand } from "@oh-my-pi/pi-coding-agent/exec/sandbox";
import { $which, removeSyncWithRetries } from "@oh-my-pi/pi-utils";

const FAKE_BWRAP = "/usr/bin/bwrap";
const CWD = "/tmp/omp-sandbox-workspace";

function makeTempDir(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "omp-sandbox-"));
}

describe("buildSandboxArgv", () => {
	it("returns off with the original command when mode is off", () => {
		const result = buildSandboxArgv("echo hi", {
			mode: "off",
			allowNetwork: false,
			cwd: CWD,
			bwrapPath: FAKE_BWRAP,
		});
		expect(result.kind).toBe("off");
		expect(result.argv).toBeUndefined();
	});

	it("returns unconfined with a missing-binary reason when bwrap is absent", () => {
		const result = buildSandboxArgv("echo hi", {
			mode: "workspace",
			allowNetwork: false,
			cwd: CWD,
			bwrapPath: null,
		});
		expect(result.kind).toBe("unconfined");
		if (result.kind !== "unconfined") throw new Error("expected unconfined");
		expect(result.reason).toMatch(/bwrap/i);
		expect(result.argv).toBeUndefined();
	});

	it("builds a workspace argv that binds / read-only, the cwd read-write, and unshares the net", () => {
		const result = buildSandboxArgv("echo hi", {
			mode: "workspace",
			allowNetwork: false,
			cwd: CWD,
			bwrapPath: FAKE_BWRAP,
		});
		expect(result.kind).toBe("confined");
		if (result.kind !== "confined") throw new Error("expected confined");
		expect(result.argv[0]).toBe(FAKE_BWRAP);
		expect(result.argv).toContain("--ro-bind");
		expect(result.argv).toContain("--unshare-net");
		const bindIdx = result.argv.indexOf("--bind");
		expect(bindIdx).toBeGreaterThan(-1);
		expect(result.argv[bindIdx + 1]).toBe(path.resolve(CWD));
		expect(result.argv[bindIdx + 2]).toBe(path.resolve(CWD));
		expect(result.argv.slice(-4)).toEqual(["--", "/bin/sh", "-c", "echo hi"]);
	});

	it("omits --unshare-net when allowNetwork is true", () => {
		const result = buildSandboxArgv("curl example.com", {
			mode: "workspace",
			allowNetwork: true,
			cwd: CWD,
			bwrapPath: FAKE_BWRAP,
		});
		expect(result.kind).toBe("confined");
		if (result.kind !== "confined") throw new Error("expected confined");
		expect(result.argv).not.toContain("--unshare-net");
	});

	it("adds pid/ipc/uts unshare flags in container mode", () => {
		const result = buildSandboxArgv("echo hi", {
			mode: "container",
			allowNetwork: false,
			cwd: CWD,
			bwrapPath: FAKE_BWRAP,
		});
		expect(result.kind).toBe("confined");
		if (result.kind !== "confined") throw new Error("expected confined");
		expect(result.argv).toContain("--unshare-pid");
		expect(result.argv).toContain("--unshare-ipc");
		expect(result.argv).toContain("--unshare-uts");
		expect(result.argv).toContain("--unshare-net");
	});
});

describe("buildSandboxCommand", () => {
	it("returns the original command string when mode is off", () => {
		const result = buildSandboxCommand("echo hi", {
			mode: "off",
			allowNetwork: false,
			cwd: CWD,
			bwrapPath: FAKE_BWRAP,
		});
		expect(result.confined).toBe(false);
		expect(result.command).toBe("echo hi");
		expect(result.reason).toBeUndefined();
	});

	it("joins a confined argv into a POSIX-quoted command the embedded shell can run", () => {
		const result = buildSandboxCommand("echo it's fine", {
			mode: "workspace",
			allowNetwork: false,
			cwd: CWD,
			bwrapPath: FAKE_BWRAP,
		});
		expect(result.confined).toBe(true);
		expect(result.command.startsWith(`'${FAKE_BWRAP}'`)).toBe(true);
		expect(result.command).toContain("--unshare-net");
		expect(result.command).toContain("echo it'\\''s fine");
	});

	it("does not rewrite the command when bwrap is missing", () => {
		const result = buildSandboxCommand("echo hi", {
			mode: "workspace",
			allowNetwork: false,
			cwd: CWD,
			bwrapPath: null,
		});
		expect(result.confined).toBe(false);
		expect(result.command).toBe("echo hi");
		expect(result.reason).toMatch(/bwrap/i);
	});
});

describe("executeBash OS sandbox", () => {
	let tempDir: string;
	const bwrap = process.platform === "linux" ? $which("bwrap") : null;

	beforeEach(async () => {
		tempDir = makeTempDir();
		resetSettingsForTest();
		await Settings.init({ inMemory: true, cwd: tempDir });
	});

	afterEach(() => {
		resetSettingsForTest();
		if (fs.existsSync(tempDir)) {
			removeSyncWithRetries(tempDir);
		}
	});

	it("runs unconfined when sandbox.mode is off (the default)", async () => {
		const result = await executeBash("echo unconfined-ok", { cwd: tempDir, timeout: 5000 });
		expect(result.exitCode).toBe(0);
		expect(result.output).toContain("unconfined-ok");
	});

	it.skipIf(!bwrap)("blocks outbound TCP when sandbox.mode is workspace and allowNetwork is false", async () => {
		const settings = await Settings.init();
		settings.set("sandbox.mode", "workspace");
		settings.set("sandbox.allowNetwork", false);
		const probe = "bash -c 'exec 3<>/dev/tcp/1.1.1.1/53 && echo CONNECTED' 2>/dev/null || echo BLOCKED";
		const result = await executeBash(probe, { cwd: tempDir, timeout: 8000 });
		expect(result.output).toContain("BLOCKED");
		expect(result.output).not.toContain("CONNECTED");
	});

	it.skipIf(!bwrap)("lets the command write inside the bound workspace", async () => {
		const settings = await Settings.init();
		settings.set("sandbox.mode", "workspace");
		const marker = path.join(tempDir, "inside.txt");
		const result = await executeBash(
			`echo sandbox-write > ${JSON.stringify(marker)} && cat ${JSON.stringify(marker)}`,
			{
				cwd: tempDir,
				timeout: 5000,
			},
		);
		expect(result.exitCode).toBe(0);
		expect(result.output).toContain("sandbox-write");
		expect(fs.readFileSync(marker, "utf8")).toContain("sandbox-write");
	});
});
