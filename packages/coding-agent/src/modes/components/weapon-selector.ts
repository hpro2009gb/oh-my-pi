import { routeSgrMouseInput, type SelectItem, SelectList, type SgrMouseEvent, Text } from "@oh-my-pi/pi-tui";
import {
	isPresetName,
	PRESET_NAMES,
	PRESET_SESSION_REFRESH_MESSAGE,
	type PresetName,
	weaponPreview,
} from "../../config/presets";
import { getSelectListTheme, theme } from "../theme/theme";
import { OverlayPanel, PanelDivider } from "./overlay-box";
import { routeSelectListMouseWithTopBorder } from "./select-list-mouse-routing";

export interface WeaponSelectorCallbacks {
	onSelect: (name: PresetName) => void;
	onClose: () => void;
}

/**
 * Fullscreen `/weapon` picker: a table of packs on top and a feature preview
 * for the highlighted row. Enter arms the pack; Esc closes.
 */
export class WeaponSelectorComponent extends OverlayPanel {
	#selectList: SelectList;
	#preview: Text;
	#onSelect: (name: PresetName) => void;

	constructor(current: PresetName | undefined, callbacks: WeaponSelectorCallbacks) {
		super("Weapons");
		this.#onSelect = callbacks.onSelect;

		const items: SelectItem[] = PRESET_NAMES.map(name => {
			const preview = weaponPreview(name);
			const currentTag = name === current ? " · current" : "";
			return {
				value: name,
				label: preview.label,
				description: `${preview.name} · ${preview.maturity}${currentTag}`,
			};
		});

		this.#selectList = new SelectList(items, PRESET_NAMES.length, getSelectListTheme());
		const currentIndex = current ? PRESET_NAMES.indexOf(current) : -1;
		if (currentIndex !== -1) this.#selectList.setSelectedIndex(currentIndex);

		this.#selectList.onSelect = item => {
			if (isPresetName(item.value)) this.#onSelect(item.value);
		};
		this.#selectList.onCancel = callbacks.onClose;
		this.#selectList.onSelectionChange = () => this.#syncPreview();

		this.#preview = new Text("", 0, 0);
		this.addChild(this.#selectList);
		this.addChild(new PanelDivider());
		this.addChild(this.#preview);
		this.#syncPreview();
	}

	getSelectList(): SelectList {
		return this.#selectList;
	}

	handleInput(keyData: string): void {
		if (
			routeSgrMouseInput(keyData, event => {
				this.routeMouse(event, event.row, event.col);
				return true;
			})
		) {
			this.#syncPreview();
			return;
		}
		this.#selectList.handleInput(keyData);
		this.#syncPreview();
	}

	routeMouse(event: SgrMouseEvent, line: number, col: number): void {
		routeSelectListMouseWithTopBorder(this.#selectList, event, line, col);
	}

	#syncPreview(): void {
		const item = this.#selectList.getSelectedItem();
		if (!item || !isPresetName(item.value)) return;
		if (this.#preview.setText(formatWeaponSelectorPreview(item.value))) this.invalidate();
	}
}

function formatWeaponSelectorPreview(name: PresetName): string {
	const preview = weaponPreview(name);
	return [
		`${theme.bold(preview.label)}${theme.fg("dim", `  ${preview.name} · ${preview.maturity}`)}`,
		theme.fg("muted", preview.description),
		"",
		...preview.highlights.map(line => `  ${theme.fg("accent", "•")} ${line}`),
		"",
		theme.fg("dim", `Learned from ${preview.learnedFrom}`),
		theme.fg("dim", PRESET_SESSION_REFRESH_MESSAGE),
		theme.fg("muted", "↑/↓ select · ↵ arm · Esc close"),
	].join("\n");
}
