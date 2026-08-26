import { afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { listPresetCards } from "@oh-my-pi/pi-coding-agent/config/presets";
import { resetSettingsForTest, Settings, settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { SettingsSelectorComponent } from "@oh-my-pi/pi-coding-agent/modes/components/settings-selector";
import { initTheme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";

beforeAll(async () => {
	await initTheme();
});

let geometryStub: { restore(): void } | undefined;

beforeEach(async () => {
	resetSettingsForTest();
	await Settings.init({ inMemory: true });
	geometryStub = stubStdoutGeometry(120);
});

afterEach(() => {
	resetSettingsForTest();
	geometryStub?.restore();
	geometryStub = undefined;
});

function stubStdoutGeometry(cols: number): { restore(): void } {
	const rowsDesc = Object.getOwnPropertyDescriptor(process.stdout, "rows");
	const colsDesc = Object.getOwnPropertyDescriptor(process.stdout, "columns");
	const rows = 40;
	Object.defineProperty(process.stdout, "rows", { configurable: true, get: () => rows, set: () => {} });
	Object.defineProperty(process.stdout, "columns", { configurable: true, get: () => cols, set: () => {} });
	return {
		restore() {
			if (rowsDesc) Object.defineProperty(process.stdout, "rows", rowsDesc);
			if (colsDesc) Object.defineProperty(process.stdout, "columns", colsDesc);
		},
	};
}

function createSelector(): SettingsSelectorComponent {
	return new SettingsSelectorComponent(
		{
			availableThinkingLevels: [],
			thinkingLevel: undefined,
			availableThemes: ["dark"],
			providers: [],
			cwd: process.cwd(),
		},
		{
			onChange: () => {},
			onCancel: () => {},
		},
	);
}

function renderPlain(component: SettingsSelectorComponent): string {
	return Bun.stripANSI(component.render(70).join("\n"))
		.replace(/[^\x20-\x7E]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function typeQuery(component: SettingsSelectorComponent, query: string): void {
	for (const ch of query) component.handleInput(ch);
}

describe("SettingsSelectorComponent weapon cards", () => {
	it("renders each pack's learnedFrom string and maturity badge", () => {
		for (const card of listPresetCards()) {
			const comp = createSelector();
			typeQuery(comp, card.label);
			const output = renderPlain(comp);
			expect(output).toContain(card.label);
			expect(output).toContain(card.learnedFrom);
			expect(output).toContain(card.maturity);
			expect(output).toContain("Learned from");
			expect(output).toContain("Tool changes take effect");
		}
	});

	it("applies the selected pack from the card without overriding persisted keys", () => {
		settings.set("lsp.enabled", true);
		expect(settings.get("lsp.enabled")).toBe(true);
		expect(settings.get("browser.enabled")).toBe(true);

		const comp = createSelector();
		typeQuery(comp, "Pi Minimal");
		expect(renderPlain(comp)).toContain("Pi core");

		comp.handleInput("\n");
		comp.handleInput("\n");

		expect(settings.get("lsp.enabled")).toBe(true);
		expect(settings.get("browser.enabled")).toBe(false);
	});
});
