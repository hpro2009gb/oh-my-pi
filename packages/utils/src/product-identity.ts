import * as path from "node:path";

/** Official coding-agent product (command `omp`, data in `~/.omp`). */
export const DEFAULT_PRODUCT_NAME = "omp";

/** Official config directory name under home and in a project root. */
export const DEFAULT_PRODUCT_CONFIG_DIR = ".omp";

/**
 * Personal sidecar product installed by `bun scripts/install-superpi.ts`.
 * Command `superpi`, data in `~/.superpi`, project config in `<cwd>/.superpi`.
 */
export const SUPERPI_PRODUCT_NAME = "superpi";

const PRODUCT_NAME_RE = /^[a-z][a-z0-9-]{0,31}$/;

export interface ProductIdentity {
	/** Process / CLI name (`omp`, `superpi`). */
	readonly appName: string;
	/** Dotdir used under `$HOME` and as the project-local config folder. */
	readonly configDir: string;
}

export interface ProductIdentityInput {
	readonly env?: NodeJS.ProcessEnv;
	readonly argv?: readonly string[];
	readonly execPath?: string;
}

/**
 * Direct `process.env.OMP_PRODUCT` read so `bun build --define` can constant-fold
 * a compiled `superpi` binary. Tests pass `env` to bypass this.
 */
function compiledProductName(): string | undefined {
	return process.env.OMP_PRODUCT;
}

function stripExecutableExt(basename: string): string {
	return basename.replace(/\.(exe|cmd|bat|ps1|js|mjs|cjs|ts)$/i, "");
}

function invocationSelectsSuperpi(argv: readonly string[], execPath: string | undefined): boolean {
	for (const candidate of [argv[0], argv[1], execPath]) {
		if (!candidate) continue;
		const base = stripExecutableExt(path.basename(candidate)).toLowerCase();
		if (base === SUPERPI_PRODUCT_NAME) return true;
	}
	return false;
}

/**
 * Normalize a product name. Returns `undefined` for the official `omp` product
 * (including empty / `default`) and for syntactically invalid names so a bad
 * `OMP_PRODUCT` cannot crash `import` of `dirs.ts`.
 */
export function normalizeProductName(product: string | undefined): string | undefined {
	const normalized = product?.trim().toLowerCase();
	if (!normalized || normalized === DEFAULT_PRODUCT_NAME || normalized === "default") return undefined;
	if (!PRODUCT_NAME_RE.test(normalized)) return undefined;
	return normalized;
}

function configDirFor(appName: string): string {
	return `.${appName}`;
}

/**
 * Resolve the running product from `OMP_PRODUCT`, then the invoked executable
 * name. Official `omp` binaries (including `omp-linux-x64` release names) stay
 * on `~/.omp`. A `superpi` install or `OMP_PRODUCT=superpi` uses `~/.superpi`
 * and `<cwd>/.superpi` so it can run beside an existing `omp` install.
 *
 * `PI_CONFIG_DIR` is applied later by `getConfigDirName` and is not folded
 * into this result — it remains a home-root override, not a product.
 */
export function resolveProductIdentity(options: ProductIdentityInput = {}): ProductIdentity {
	const explicit = normalizeProductName(options.env ? options.env.OMP_PRODUCT : compiledProductName());
	if (explicit) {
		return { appName: explicit, configDir: configDirFor(explicit) };
	}

	if (invocationSelectsSuperpi(options.argv ?? process.argv, options.execPath ?? process.execPath)) {
		return { appName: SUPERPI_PRODUCT_NAME, configDir: configDirFor(SUPERPI_PRODUCT_NAME) };
	}

	return { appName: DEFAULT_PRODUCT_NAME, configDir: DEFAULT_PRODUCT_CONFIG_DIR };
}

/** Identity of this process, resolved once at module load. */
export const PRODUCT_IDENTITY: ProductIdentity = resolveProductIdentity();
