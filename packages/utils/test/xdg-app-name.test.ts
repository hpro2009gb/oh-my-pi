import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { getAgentDir, getPythonGatewayDir, getSessionsDir, setAgentDir } from "@oh-my-pi/pi-utils/dirs";
import { Snowflake } from "@oh-my-pi/pi-utils/snowflake";

describe("OMP_XDG_APP_NAME", () => {
	let tempRoot = "";
	let originalAgentDir = "";
	let originalConfigDir: string | undefined;
	let originalXdgData: string | undefined;
	let originalXdgState: string | undefined;
	let originalXdgApp: string | undefined;

	beforeEach(async () => {
		originalAgentDir = getAgentDir();
		originalConfigDir = process.env.PI_CONFIG_DIR;
		originalXdgData = process.env.XDG_DATA_HOME;
		originalXdgState = process.env.XDG_STATE_HOME;
		originalXdgApp = process.env.OMP_XDG_APP_NAME;
		tempRoot = path.join(os.tmpdir(), "pi-utils-xdg-app", Snowflake.next());
		await fs.mkdir(tempRoot, { recursive: true });
	});

	afterEach(async () => {
		if (originalConfigDir === undefined) delete process.env.PI_CONFIG_DIR;
		else process.env.PI_CONFIG_DIR = originalConfigDir;
		if (originalXdgData === undefined) delete process.env.XDG_DATA_HOME;
		else process.env.XDG_DATA_HOME = originalXdgData;
		if (originalXdgState === undefined) delete process.env.XDG_STATE_HOME;
		else process.env.XDG_STATE_HOME = originalXdgState;
		if (originalXdgApp === undefined) delete process.env.OMP_XDG_APP_NAME;
		else process.env.OMP_XDG_APP_NAME = originalXdgApp;
		setAgentDir(originalAgentDir);
		await fs.rm(tempRoot, { recursive: true, force: true });
	});

	it("does not adopt an existing official $XDG_*_HOME/omp tree", async () => {
		if (process.platform === "win32") return;

		process.env.PI_CONFIG_DIR = ".supper-omp";
		process.env.OMP_XDG_APP_NAME = "supper-omp";
		process.env.XDG_DATA_HOME = path.join(tempRoot, "data");
		process.env.XDG_STATE_HOME = path.join(tempRoot, "state");
		await fs.mkdir(path.join(process.env.XDG_DATA_HOME, "omp"), { recursive: true });
		await fs.mkdir(path.join(process.env.XDG_STATE_HOME, "omp"), { recursive: true });

		const isolatedAgent = path.join(os.homedir(), ".supper-omp", "agent");
		setAgentDir(isolatedAgent);

		expect(getSessionsDir()).toBe(path.join(isolatedAgent, "sessions"));
		expect(getSessionsDir()).not.toBe(path.join(process.env.XDG_DATA_HOME, "omp", "sessions"));
		expect(getPythonGatewayDir()).toBe(path.join(isolatedAgent, "python-gateway"));
		expect(getPythonGatewayDir()).not.toBe(path.join(process.env.XDG_STATE_HOME, "omp", "python-gateway"));
	});
});
