import type { AgentMessage } from "@oh-my-pi/pi-agent-core";
import type { ToolCall, ToolResultMessage } from "@oh-my-pi/pi-ai";
import { isRecord } from "@oh-my-pi/pi-utils";

export type WalkthroughChangeKind = "edit" | "write" | "delete";

export interface WalkthroughChange {
	path: string;
	kind: WalkthroughChangeKind;
}

export interface WalkthroughCommand {
	command: string;
	exitCode: number;
	purpose?: string;
}

export interface WalkthroughInput {
	summary?: string;
	changes: WalkthroughChange[];
	commands: WalkthroughCommand[];
}

const EMPTY_CHANGES_LINE = "No changes recorded.";
const EMPTY_COMMANDS_LINE = "No commands recorded.";

const CHANGE_TOOLS = new Set(["edit", "write", "delete", "apply_patch"]);

interface PendingCall {
	name: string;
	arguments: Record<string, unknown>;
	intent?: string;
}

function basename(filePath: string): string {
	const slash = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
	return slash === -1 ? filePath : filePath.slice(slash + 1);
}

function stringArg(args: Record<string, unknown>, key: string): string | undefined {
	const value = args[key];
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function kindFromPatchMarker(line: string): { path: string; kind: WalkthroughChangeKind } | undefined {
	const add = line.match(/^\*\*\* Add File:\s+(.+)$/);
	if (add?.[1]) return { path: add[1].trim(), kind: "write" };
	const del = line.match(/^\*\*\* Delete File:\s+(.+)$/);
	if (del?.[1]) return { path: del[1].trim(), kind: "delete" };
	const upd = line.match(/^\*\*\* Update File:\s+(.+)$/);
	if (upd?.[1]) return { path: upd[1].trim(), kind: "edit" };
	return undefined;
}

function changesFromPatchInput(input: string | undefined): WalkthroughChange[] {
	if (!input) return [];
	const changes: WalkthroughChange[] = [];
	for (const line of input.split("\n")) {
		const parsed = kindFromPatchMarker(line.trim());
		if (parsed) changes.push(parsed);
	}
	return changes;
}

function changesFromToolCall(name: string, args: Record<string, unknown>): WalkthroughChange[] {
	if (name === "write") {
		const path = stringArg(args, "path");
		return path ? [{ path, kind: "write" }] : [];
	}
	if (name === "delete") {
		const path = stringArg(args, "path");
		return path ? [{ path, kind: "delete" }] : [];
	}
	if (name === "edit" || name === "apply_patch") {
		const fromPatch = changesFromPatchInput(stringArg(args, "input") ?? stringArg(args, "patch"));
		if (fromPatch.length > 0) return fromPatch;
		const path = stringArg(args, "path");
		return path ? [{ path, kind: "edit" }] : [];
	}
	return [];
}

function toolName(call: ToolCall): string {
	return call.customWireName ?? call.name;
}

function purposeFromCall(call: PendingCall): string | undefined {
	const fromArgs = stringArg(call.arguments, "purpose");
	if (fromArgs) return fromArgs;
	return typeof call.intent === "string" && call.intent.length > 0 ? call.intent : undefined;
}

function exitCodeFromResult(result: ToolResultMessage): number {
	if (isRecord(result.details) && typeof result.details.exitCode === "number") {
		return result.details.exitCode;
	}
	return result.isError ? 1 : 0;
}

function commandCitesChange(command: WalkthroughCommand, change: WalkthroughChange): boolean {
	const needles = [change.path, basename(change.path)].filter(needle => needle.length > 0);
	const haystacks = [command.purpose ?? "", command.command];
	for (const needle of needles) {
		for (const hay of haystacks) {
			if (hay.includes(needle)) return true;
		}
	}
	return false;
}

function evidenceForChange(change: WalkthroughChange, commands: WalkthroughCommand[]): WalkthroughCommand[] {
	const matched = commands.filter(command => commandCitesChange(command, change));
	return matched.length > 0 ? matched : commands;
}

function formatCommand(command: WalkthroughCommand): string {
	const purpose = command.purpose ? ` — ${command.purpose}` : "";
	return `\`${command.command}\` (exit ${command.exitCode})${purpose}`;
}

function uniquePaths(changes: WalkthroughChange[]): string[] {
	const seen = new Set<string>();
	const paths: string[] = [];
	for (const change of changes) {
		if (seen.has(change.path)) continue;
		seen.add(change.path);
		paths.push(change.path);
	}
	return paths;
}

function defaultSummary(input: WalkthroughInput): string {
	if (input.changes.length === 0) return EMPTY_CHANGES_LINE;
	const paths = uniquePaths(input.changes).map(path => `\`${path}\``);
	return `Changed ${paths.join(", ")}.`;
}

function formatChange(change: WalkthroughChange, commands: WalkthroughCommand[]): string {
	const evidence = evidenceForChange(change, commands);
	const evidenceLine =
		evidence.length === 0 ? "  - Evidence: none" : `  - Evidence: ${evidence.map(formatCommand).join("; ")}`;
	return `- \`${change.path}\` (${change.kind})\n${evidenceLine}`;
}

/**
 * Render a deterministic markdown walkthrough. Same input always yields the
 * same bytes: no timestamps, no locale, input order preserved.
 */
export function buildWalkthrough(input: WalkthroughInput): string {
	const summary = input.summary?.trim() || defaultSummary(input);
	const changeBody =
		input.changes.length === 0
			? EMPTY_CHANGES_LINE
			: input.changes.map(change => formatChange(change, input.commands)).join("\n");
	const evidenceBody =
		input.commands.length === 0
			? EMPTY_COMMANDS_LINE
			: input.commands.map(command => `- ${formatCommand(command)}`).join("\n");
	return ["## Summary", "", summary, "", "## Changes", "", changeBody, "", "## Evidence", "", evidenceBody, ""].join(
		"\n",
	);
}

/** Collect file changes and bash evidence from a session transcript. */
export function collectWalkthroughInput(messages: readonly AgentMessage[]): WalkthroughInput {
	const pending = new Map<string, PendingCall>();
	const changes: WalkthroughChange[] = [];
	const commands: WalkthroughCommand[] = [];

	for (const message of messages) {
		if (message.role === "assistant") {
			for (const block of message.content) {
				if (block.type !== "toolCall") continue;
				const name = toolName(block);
				pending.set(block.id, { name, arguments: block.arguments, intent: block.intent });
				if (!CHANGE_TOOLS.has(name) && !CHANGE_TOOLS.has(block.name)) continue;
				const mappedName = CHANGE_TOOLS.has(name) ? name : block.name;
				changes.push(...changesFromToolCall(mappedName, block.arguments));
			}
			continue;
		}
		if (message.role !== "toolResult") continue;
		const call = pending.get(message.toolCallId);
		const name = call?.name ?? message.toolName;
		if (name !== "bash") continue;
		const command = call ? stringArg(call.arguments, "command") : undefined;
		if (!command) continue;
		const purpose = call ? purposeFromCall(call) : undefined;
		commands.push({
			command,
			exitCode: exitCodeFromResult(message),
			...(purpose ? { purpose } : {}),
		});
	}

	return { changes, commands };
}
