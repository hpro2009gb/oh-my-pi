import { beforeAll, describe, expect, it } from "bun:test";
import { PRESETS } from "@oh-my-pi/pi-coding-agent/config/presets";
import { WeaponSelectorComponent } from "@oh-my-pi/pi-coding-agent/modes/components/weapon-selector";
import { initTheme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import type { SgrMouseEvent } from "@oh-my-pi/pi-tui";

beforeAll(async () => {
	await initTheme();
});

function leftClick(line: number): SgrMouseEvent {
	return { button: 0, col: 0, row: line, release: false, wheel: null, motion: false, leftClick: true };
}

function renderPlain(component: WeaponSelectorComponent): string {
	return Bun.stripANSI(component.render(80).join("\n"));
}

describe("WeaponSelectorComponent", () => {
	it("shows the highlighted pack's feature bullets in the preview pane", () => {
		const component = new WeaponSelectorComponent("pi-super", {
			onSelect: () => {},
			onClose: () => {},
		});
		const output = renderPlain(component);
		expect(output).toContain("Weapons");
		expect(output).toContain("Pi Super");
		expect(output).toContain("pi-super");
		expect(output).toContain("current");
		for (const line of PRESETS["pi-super"].highlights) {
			expect(output).toContain(line);
		}
		expect(output).toContain("Learned from Cline, Claude Code, Codex, Aider");
		expect(output).toContain("Tool changes take effect when the session next starts.");
	});

	it("replaces the preview with the next pack's features when the cursor moves", () => {
		const component = new WeaponSelectorComponent("pi-super", {
			onSelect: () => {},
			onClose: () => {},
		});
		// pi-super is last; down wraps to pi-minimal.
		component.handleInput("\x1b[B");
		const output = renderPlain(component);
		expect(output).toContain("Smallest tool slate for a fast harness");
		expect(output).not.toContain("Advisor, prewalk, and checkpoint on");
		expect(output).not.toContain("GitHub on for PRs and issues");
	});

	it("arms the highlighted pack on Enter and closes on Esc", () => {
		const armed: string[] = [];
		let closed = 0;
		const component = new WeaponSelectorComponent("pi-minimal", {
			onSelect: name => armed.push(name),
			onClose: () => {
				closed += 1;
			},
		});
		component.handleInput("\n");
		expect(armed).toEqual(["pi-minimal"]);

		const closer = new WeaponSelectorComponent("opm-verify", {
			onSelect: () => {},
			onClose: () => {
				closed += 1;
			},
		});
		closer.handleInput("\x1b");
		expect(closed).toBe(1);
	});

	it("ignores a click on the title and arms the first pack from the row below it", () => {
		const armed: string[] = [];
		const component = new WeaponSelectorComponent("pi-super", {
			onSelect: name => armed.push(name),
			onClose: () => {},
		});
		component.render(80);
		component.routeMouse(leftClick(0), 0, 0);
		expect(armed).toEqual([]);
		component.routeMouse(leftClick(1), 1, 0);
		expect(armed).toEqual(["pi-minimal"]);
	});
});
