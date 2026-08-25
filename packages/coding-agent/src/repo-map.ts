/**
 * Repo map: a compact, deterministic outline of the workspace's public symbols
 * (top-level exported declarations, one signature line each), ranked so the most
 * symbol-dense files come first and trimmed to a token budget. Injected into the
 * system prompt (behind `repoMap.enabled`) so the model can see the codebase's
 * shape — which functions/types already exist — without reading whole files.
 *
 * Extraction scans the first line of each top-level (column-0) `export` / `pub`
 * declaration. A line scan (rather than structural ast-grep patterns) is used on
 * purpose: it captures every signature shape — return-type annotations, generics,
 * decorators — that rigid patterns miss, while only ever reading the declaration
 * line we want to show. The rendered block is sorted and carries no timestamps,
 * so it stays byte-identical across sessions and does not bust the provider
 * prompt cache (same discipline as the workspace tree).
 */

import * as path from "node:path";
import { FileType, listWorkspace } from "@oh-my-pi/pi-natives";
import { isEnoent } from "@oh-my-pi/pi-utils";

/** Top-level exported declaration in TypeScript/JavaScript (line-anchored). */
const TS_DECL_RE =
	/^export\s+(?:default\s+)?(?:declare\s+)?(?:async\s+)?(?:abstract\s+)?(?:function\*?|class|interface|type|enum|const|let|var|namespace)\s+[A-Za-z0-9_$]/;

/** Top-level `pub` item in Rust (line-anchored). */
const RUST_DECL_RE =
	/^pub(?:\s*\([^)]*\))?\s+(?:async\s+)?(?:unsafe\s+)?(?:const\s+|default\s+)?(?:fn|struct|enum|trait|type|mod|static|union)\s+[A-Za-z0-9_]/;

const TS_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);
const RUST_EXTENSIONS = new Set([".rs"]);

/** Depth ceiling for the workspace scan; deep enough for real trees, bounded for safety. */
const SCAN_MAX_DEPTH = 32;
/** Cap on files read so a huge repo cannot stall the build. */
const MAX_FILES = 2000;
/** Skip files larger than this; a signature scan of a giant generated file is not worth it. */
const MAX_FILE_BYTES = 512 * 1024;
/** How many files to read concurrently. */
const READ_CONCURRENCY = 64;

export interface BuildRepoMapOptions {
	/** Approximate token ceiling for the rendered block (chars ≈ tokens × 4). Default 1024. */
	tokenBudget?: number;
	/** Abort the workspace scan after this many milliseconds. */
	timeoutMs?: number;
}

export interface RepoMap {
	rootPath: string;
	/** Rendered outline, or "" when nothing was found or the budget was zero. */
	rendered: string;
	/** True when some files/symbols were dropped to fit the budget. */
	truncated: boolean;
	fileCount: number;
	symbolCount: number;
}

interface FileSymbols {
	relPath: string;
	/** Signatures in source order, deduplicated. */
	signatures: string[];
}

/** An empty repo map for `rootPath` (nothing found, budget zero, or disabled). */
export function emptyRepoMap(rootPath: string): RepoMap {
	return { rootPath, rendered: "", truncated: false, fileCount: 0, symbolCount: 0 };
}

/** The declaration matcher for a file extension, or `undefined` for unsupported files. */
function declMatcherForPath(relPath: string): RegExp | undefined {
	const ext = path.extname(relPath).toLowerCase();
	if (TS_EXTENSIONS.has(ext)) return TS_DECL_RE;
	if (RUST_EXTENSIONS.has(ext)) return RUST_DECL_RE;
	return undefined;
}

/** Reduce a declaration line to a single-line signature. */
function toSignature(line: string): string {
	// Drop a trailing block opener so `export class Foo {` reads as `export class Foo`.
	return line.replace(/\s*\{\s*$/, "").trimEnd();
}

/** Extract deduplicated top-level signatures from one file's source. */
function extractSignatures(source: string, matcher: RegExp): string[] {
	const signatures: string[] = [];
	const seen = new Set<string>();
	for (const rawLine of source.split("\n")) {
		// Top-level only: a declaration keyword must sit at column 0.
		if (!matcher.test(rawLine)) continue;
		const signature = toSignature(rawLine);
		if (!signature || seen.has(signature)) continue;
		seen.add(signature);
		signatures.push(signature);
	}
	return signatures;
}

/** Read a file's signatures; returns null when unreadable or empty. */
async function readFileSignatures(rootPath: string, relPath: string): Promise<FileSymbols | null> {
	const matcher = declMatcherForPath(relPath);
	if (!matcher) return null;
	let source: string;
	try {
		source = await Bun.file(path.join(rootPath, relPath)).text();
	} catch (error) {
		if (isEnoent(error)) return null;
		return null;
	}
	const signatures = extractSignatures(source, matcher);
	return signatures.length > 0 ? { relPath, signatures } : null;
}

/**
 * Build a deterministic, budget-limited outline of the workspace's exported
 * symbols. Files are ranked by symbol count (then path) so the densest, most
 * central files survive trimming; within a file, signatures keep source order.
 */
export async function buildRepoMap(cwd: string, options: BuildRepoMapOptions = {}): Promise<RepoMap> {
	const rootPath = path.resolve(cwd);
	const tokenBudget = options.tokenBudget ?? 1024;
	if (tokenBudget <= 0) return emptyRepoMap(rootPath);

	let entries: readonly { path: string; fileType: FileType; size?: number }[];
	try {
		const result = await listWorkspace({
			path: rootPath,
			maxDepth: SCAN_MAX_DEPTH,
			hidden: false,
			gitignore: true,
			timeoutMs: options.timeoutMs,
		});
		entries = result.entries;
	} catch {
		return emptyRepoMap(rootPath);
	}

	// Deterministic candidate order before the file cap so the same repo always
	// scans the same files regardless of native walk order.
	const candidates = entries
		.filter(entry => entry.fileType === FileType.File && declMatcherForPath(entry.path) !== undefined)
		.filter(entry => (entry.size ?? 0) <= MAX_FILE_BYTES)
		.map(entry => entry.path)
		.sort((a, b) => a.localeCompare(b))
		.slice(0, MAX_FILES);

	const files: FileSymbols[] = [];
	for (let i = 0; i < candidates.length; i += READ_CONCURRENCY) {
		const batch = candidates.slice(i, i + READ_CONCURRENCY);
		const results = await Promise.all(batch.map(relPath => readFileSignatures(rootPath, relPath)));
		for (const result of results) {
			if (result) files.push(result);
		}
	}

	// Densest files first, ties broken by path for stable, cache-friendly output.
	files.sort((a, b) => b.signatures.length - a.signatures.length || a.relPath.localeCompare(b.relPath));

	const charBudget = tokenBudget * 4;
	const blocks: string[] = [];
	let usedChars = 0;
	let renderedFiles = 0;
	let renderedSymbols = 0;
	let truncated = false;
	for (const file of files) {
		const headerCost = file.relPath.length + 1;
		if (usedChars + headerCost > charBudget) {
			truncated = true;
			break;
		}
		// Fill the budget signature-by-signature so a single dense file (ranked
		// first) is included partially rather than dropped wholesale.
		const lines = [file.relPath];
		let fileChars = headerCost;
		let fileSymbols = 0;
		let fileTruncated = false;
		for (const sig of file.signatures) {
			const line = `  ${sig}`;
			const cost = line.length + 1;
			if (usedChars + fileChars + cost > charBudget) {
				fileTruncated = true;
				break;
			}
			lines.push(line);
			fileChars += cost;
			fileSymbols += 1;
		}
		if (fileSymbols === 0) {
			truncated = true;
			break;
		}
		if (fileTruncated) lines.push("  …");
		blocks.push(lines.join("\n"));
		usedChars += fileChars;
		renderedFiles += 1;
		renderedSymbols += fileSymbols;
		if (fileTruncated) {
			truncated = true;
			break;
		}
	}

	return {
		rootPath,
		rendered: blocks.join("\n"),
		truncated: truncated || renderedFiles < files.length,
		fileCount: renderedFiles,
		symbolCount: renderedSymbols,
	};
}
