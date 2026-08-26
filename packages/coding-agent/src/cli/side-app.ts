/**
 * Side-by-side Super Pi app (`supper-omp`): a second command that runs this
 * checkout without replacing the official `omp` binary or sharing `~/.omp`.
 */

export const SIDE_APP_BIN = "supper-omp";
export const SIDE_APP_CONFIG_DIR = ".supper-omp";
export const SIDE_APP_XDG_NAME = "supper-omp";
export const SIDE_APP_PRESET = "pi-super";
export const SIDE_APP_DEFAULT_PRESET_ENV = "OMP_DEFAULT_PRESET";
export const SIDE_APP_XDG_ENV = "OMP_XDG_APP_NAME";

/** True when installing that name would shadow or replace the official CLI. */
export function isOfficialOmpBinName(name: string): boolean {
	const base = name.replace(/\\/g, "/").split("/").pop() ?? name;
	const lower = base.toLowerCase();
	return lower === "omp" || lower === "omp.exe" || lower === "omp.cmd" || lower === "omp.bat";
}
