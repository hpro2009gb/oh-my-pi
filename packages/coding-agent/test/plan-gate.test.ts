/**
 * Contract: `plan.gate.enabled` (default off) starts a new session in existing
 * plan mode and refuses to leave until the user accepts the plan.
 *
 * Failure modes these tests defend:
 * - Default off regresses into forcing plan mode on every new session.
 * - Enabled gate fails to start in plan mode, so mutating tools run before a plan exists.
 * - Enabled gate lets `/plan` or `--plan-yolo` leave plan mode without user acceptance.
 * - After acceptance, mutating tools stay blocked as if plan mode never exited.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "bun:test";
import * as path from "node:path";
import { type } from "@oh-my-pi/omptype";
import { Agent, type AgentTool } from "@oh-my-pi/pi-agent-core";
import { type Api, Effort, type Model } from "@oh-my-pi/pi-ai";
import { createMockModel } from "@oh-my-pi/pi-ai/providers/mock";
import { getBundledModel } from "@oh-my-pi/pi-catalog/models";
import { parseArgs } from "@oh-my-pi/pi-coding-agent/cli/args";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { resetSettingsForTest, Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { InteractiveMode, shouldEnterPlanModeOnStartup } from "@oh-my-pi/pi-coding-agent/modes/interactive-mode";
import { initTheme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import { PLAN_GATE_LEAVE_BLOCKED_MESSAGE } from "@oh-my-pi/pi-coding-agent/plan-mode/plan-gate";
import { AgentSession } from "@oh-my-pi/pi-coding-agent/session/agent-session";
import { AuthStorage } from "@oh-my-pi/pi-coding-agent/session/auth-storage";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import type { ToolSession } from "@oh-my-pi/pi-coding-agent/tools";
import { enforcePlanModeWrite } from "@oh-my-pi/pi-coding-agent/tools/plan-mode-guard";
import { TempDir } from "@oh-my-pi/pi-utils";

function makeTool(name: string): AgentTool {
	return {
		name,
		label: name,
		description: `Fake ${name}`,
		parameters: type({}),
		async execute() {
			return { content: [{ type: "text" as const, text: "ok" }] };
		},
	};
}

function writeGuardSession(session: AgentSession): ToolSession {
	return {
		cwd: session.sessionManager.getCwd(),
		hasUI: false,
		getSessionFile: () => null,
		getSessionSpawns: () => "*",
		settings: session.settings,
		getPlanModeState: () => session.getPlanModeState(),
	} as unknown as ToolSession;
}

describe("plan-gate CLI", () => {
	it("parses --plan-gate as a session toggle and does not consume a following value", () => {
		const result = parseArgs(["--plan-gate", "--model", "opus", "hello"]);
		expect(result.planGate).toBe(true);
		expect(result.model).toBe("opus");
		expect(result.messages).toEqual(["hello"]);
	});

	it("leaves planGate unset when the flag is absent so the default-off setting wins", () => {
		expect(parseArgs([]).planGate).toBeUndefined();
		expect(parseArgs(["--plan-yolo"]).planGate).toBeUndefined();
	});
});

describe("shouldEnterPlanModeOnStartup plan-gate", () => {
	function decide(settings: Settings, options: { conversation?: boolean; explicitMode?: boolean } = {}): boolean {
		return shouldEnterPlanModeOnStartup(
			{
				buildSessionContext: () => ({ messages: options.conversation ? [{}] : [] }) as never,
				getEntries: () => (options.explicitMode ? [{ type: "mode_change" }] : []) as never,
			},
			settings,
		);
	}

	it("does not start in plan mode when the gate is off (existing start path)", () => {
		expect(decide(Settings.isolated())).toBe(false);
		expect(decide(Settings.isolated({ "plan.enabled": true }))).toBe(false);
	});

	it("starts in plan mode when the gate is enabled on a brand-new session", () => {
		expect(decide(Settings.isolated({ "plan.gate.enabled": true }))).toBe(true);
	});

	it("does not start in plan mode when the gate is on but plan mode itself is disabled", () => {
		expect(decide(Settings.isolated({ "plan.gate.enabled": true, "plan.enabled": false }))).toBe(false);
	});

	it("does not start in plan mode when the session already has conversation or an explicit mode", () => {
		const gated = Settings.isolated({ "plan.gate.enabled": true });
		expect(decide(gated, { conversation: true })).toBe(false);
		expect(decide(gated, { explicitMode: true })).toBe(false);
	});
});

describe("InteractiveMode plan-gate", () => {
	let tempDir: TempDir;
	let authStorage: AuthStorage;
	let mode: InteractiveMode | undefined;
	let session: AgentSession | undefined;

	beforeAll(() => {
		initTheme();
	});

	beforeEach(async () => {
		resetSettingsForTest();
		tempDir = TempDir.createSync("@pi-plan-gate-");
		await Settings.init({ inMemory: true, cwd: tempDir.path() });
		Settings.instance.set("startup.quiet", true);
		authStorage = await AuthStorage.create(path.join(tempDir.path(), "testauth.db"));
		authStorage.setRuntimeApiKey("anthropic", "test-key");
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		mode?.stop();
		await session?.dispose();
		authStorage?.close();
		tempDir?.removeSync();
		mode = undefined;
		session = undefined;
		authStorage = undefined as unknown as AuthStorage;
		tempDir = undefined as unknown as TempDir;
		resetSettingsForTest();
	});

	function modelOrThrow(registry: ModelRegistry, id: string): Model<Api> {
		const model = registry.find("anthropic", id);
		if (!model) throw new Error(`Expected anthropic model ${id} to exist`);
		return model;
	}

	function createHarness(settings: Settings): InteractiveMode {
		const registry = new ModelRegistry(authStorage, path.join(tempDir.path(), `models-${Bun.nanoseconds()}.yml`));
		const initialModel = modelOrThrow(registry, "claude-sonnet-4-5");
		const readTool = makeTool("read");
		const writeTool = makeTool("write");
		const toolRegistry = new Map<string, AgentTool>([
			[readTool.name, readTool],
			[writeTool.name, writeTool],
		]);
		const manager = SessionManager.create(tempDir.path(), path.join(tempDir.path(), `active-${Bun.nanoseconds()}`));
		const createdSession = new AgentSession({
			agent: new Agent({
				initialState: {
					model: initialModel,
					systemPrompt: ["Test"],
					tools: [readTool],
					messages: [],
					thinkingLevel: Effort.Medium,
				},
			}),
			sessionManager: manager,
			settings,
			modelRegistry: registry,
			toolRegistry,
			builtInToolNames: ["read", "write"],
		});
		session = createdSession;
		mode = new InteractiveMode(createdSession, "test");
		return mode;
	}

	it("does not enter plan mode at startup when the gate is off", async () => {
		const created = createHarness(Settings.isolated({ "compaction.enabled": false }));
		await created.init({ suppressWelcomeIntro: true });

		expect(created.planModeEnabled).toBe(false);
		expect(session?.getPlanModeState()).toBeUndefined();
		expect(session?.isPlanGatePending()).toBe(false);
		expect(() => enforcePlanModeWrite(writeGuardSession(session!), "src/foo.ts", { op: "update" })).not.toThrow();
	});

	it("starts in plan mode and blocks mutating writes until the user accepts the plan", async () => {
		const created = createHarness(Settings.isolated({ "plan.gate.enabled": true, "compaction.enabled": false }));
		await created.init({ suppressWelcomeIntro: true });

		expect(created.planModeEnabled).toBe(true);
		expect(session?.getPlanModeState()).toMatchObject({ enabled: true });
		expect(session?.isPlanGatePending()).toBe(true);
		expect(() => enforcePlanModeWrite(writeGuardSession(session!), "src/foo.ts", { op: "update" })).toThrow(
			/working tree is read-only/,
		);

		const warning = vi.spyOn(created, "showWarning").mockImplementation(() => {});
		vi.spyOn(created, "showHookConfirm").mockResolvedValue(true);
		await created.handlePlanModeCommand();

		expect(created.planModeEnabled).toBe(true);
		expect(session?.getPlanModeState()?.enabled).toBe(true);
		expect(warning).toHaveBeenCalledWith(PLAN_GATE_LEAVE_BLOCKED_MESSAGE);
		expect(() => enforcePlanModeWrite(writeGuardSession(session!), "src/foo.ts", { op: "update" })).toThrow(
			/working tree is read-only/,
		);
	});

	it("allows mutating writes after the plan is accepted", async () => {
		const created = createHarness(Settings.isolated({ "plan.gate.enabled": true, "compaction.enabled": false }));
		await created.init({ suppressWelcomeIntro: true });
		expect(() => enforcePlanModeWrite(writeGuardSession(session!), "src/foo.ts", { op: "update" })).toThrow(
			/working tree is read-only/,
		);

		session!.satisfyPlanGate();
		await created.handlePlanModeCommand();

		expect(created.planModeEnabled).toBe(false);
		expect(session?.getPlanModeState()).toBeUndefined();
		expect(() => enforcePlanModeWrite(writeGuardSession(session!), "src/foo.ts", { op: "update" })).not.toThrow();
	});
});

describe("plan-yolo does not auto-bypass the gate", () => {
	let tempDir: TempDir;
	let session: AgentSession | undefined;
	let authDir: TempDir;
	let authStorage: AuthStorage;
	let modelRegistry: ModelRegistry;

	beforeAll(async () => {
		authDir = TempDir.createSync("@pi-plan-gate-yolo-auth-");
		authStorage = await AuthStorage.create(authDir.join("auth.db"));
		authStorage.setRuntimeApiKey("anthropic", "test-key");
		modelRegistry = new ModelRegistry(authStorage, authDir.join("models.yml"));
	});

	afterAll(() => {
		authStorage.close();
		authDir.removeSync();
	});

	beforeEach(() => {
		tempDir = TempDir.createSync("@pi-plan-gate-yolo-");
	});

	afterEach(async () => {
		try {
			await session?.dispose();
		} finally {
			session = undefined;
			await tempDir?.remove();
		}
	});

	it("starts plan-yolo in plan mode but does not install the auto-approve handler", async () => {
		const model = getBundledModel("anthropic", "claude-sonnet-4-5");
		if (!model) throw new Error("Expected bundled anthropic model to exist");

		const readTool = makeTool("read");
		const writeTool = makeTool("write");
		const toolRegistry = new Map<string, AgentTool>([
			["read", readTool],
			["write", writeTool],
		]);
		const mock = createMockModel({ responses: [{ content: ["planning"] }] });
		const created = new AgentSession({
			agent: new Agent({
				getApiKey: () => "test-key",
				initialState: {
					model,
					systemPrompt: ["Test"],
					tools: [readTool],
					messages: [],
				},
				streamFn: mock.stream,
			}),
			sessionManager: SessionManager.inMemory(),
			settings: Settings.isolated({
				"compaction.enabled": false,
				"retry.enabled": false,
				"plan.gate.enabled": true,
			}),
			modelRegistry,
			toolRegistry,
			builtInToolNames: ["read", "write"],
			planYolo: { target: model },
		});
		session = created;

		await created.prompt("make a plan");
		await created.waitForIdle();

		expect(created.getPlanModeState()?.enabled).toBe(true);
		expect(created.isPlanGatePending()).toBe(true);
		expect(created.peekPlanProposalHandler()).toBeUndefined();
		expect(() => enforcePlanModeWrite(writeGuardSession(created), "src/foo.ts", { op: "update" })).toThrow(
			/working tree is read-only/,
		);
	});
});
