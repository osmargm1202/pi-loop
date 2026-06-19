import type { AgentEndEvent, AgentMessage, BeforeAgentStartEvent, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { isOrgmExtensionEnabled } from "./lib/orgm-extension-config.ts";

export const PI_LOOP_EVENT = "pi-loop:state-changed";

const LOOP_DONE_SIGNAL = "[LOOP:DONE]";
const DEFAULT_MAX_ITERATIONS = 25;

function buildLoopSystemPromptBlock(iteration: number, maxIterations: number): string {
	return `

## Loop Mode Active (iteration ${iteration}/${maxIterations})

You are in loop mode. Work until the task is COMPLETELY done.

Rules:
1. Never simplify if the user asked for something complex — take the correct path even if it takes longer
2. Before declaring done: verify your changes are NEW and actually present in the code (check git diff or file contents — do not assume something is done)
3. Resolve ambiguity with the most comprehensive approach that fits the main objective
4. When TRULY complete: include ${LOOP_DONE_SIGNAL} at the very end of your response
5. Do NOT include ${LOOP_DONE_SIGNAL} if any work remains
`;
}

const CONTINUATION_MESSAGE = `Continue. Check: is the original task fully complete?
- Verify your changes actually exist in the code (not just planned)
- If you simplified something complex, redo it properly
- Resolve any remaining ambiguity with the most fitting approach
- Only end with ${LOOP_DONE_SIGNAL} when truly done`;

function loadMaxIterations(): number {
	const configPath = join(process.env.HOME ?? homedir(), ".pi", "agent", "orgm.json");
	try {
		if (!existsSync(configPath)) return DEFAULT_MAX_ITERATIONS;
		const raw = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
		const loopConfig = raw?.loop as Record<string, unknown> | undefined;
		if (typeof loopConfig?.maxIterations === "number" && loopConfig.maxIterations > 0) {
			return loopConfig.maxIterations;
		}
	} catch {}
	return DEFAULT_MAX_ITERATIONS;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function findDoneSignal(messages: AgentMessage[]): boolean {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (!isRecord(msg) || msg.role !== "assistant") continue;
		const content = msg.content;
		if (Array.isArray(content)) {
			for (const block of content) {
				if (isRecord(block) && block.type === "text" && typeof block.text === "string") {
					if (block.text.includes(LOOP_DONE_SIGNAL)) return true;
				}
			}
		}
		// Only check the last assistant message
		break;
	}
	return false;
}

function emitState(pi: ExtensionAPI, active: boolean, iteration: number, maxIterations: number): void {
	pi.events.emit(PI_LOOP_EVENT, { active, iteration, maxIterations });
}

type ParseResult =
  | { type: "lifecycle"; command: "on" | "off" | "status" }
  | { type: "prompt"; mode: "duration" | "count"; intervalMs?: number; maxChecks?: number; prompt: string }
  | { type: "invalid"; error: string };

export function parseLoopArgs(args: string): ParseResult {
  const trimmed = args.trim();
  if (!trimmed) return { type: "lifecycle", command: "status" };

  const first = trimmed.split(/\s+/)[0]?.toLowerCase() ?? "";
  const rest = trimmed.slice(first.length).trim();

  if (["on", "off", "status"].includes(first)) {
    return { type: "lifecycle", command: first as "on" | "off" | "status" };
  }

  // Duration match: 30s, 2m, 1h
  const durationMatch = first.match(/^(\d+)([smh])$/);
  if (durationMatch) {
    const value = parseInt(durationMatch[1]!, 10);
    const unit = durationMatch[2]!;
    const multipliers: Record<string, number> = { s: 1000, m: 60000, h: 3600000 };
    if (!rest) return { type: "invalid", error: "Missing prompt for duration-mode loop" };
    return {
      type: "prompt",
      mode: "duration",
      intervalMs: value * (multipliers[unit] ?? 1000),
      prompt: rest,
    };
  }

  // Count match: positive integer
  const countMatch = first.match(/^(\d+)$/);
  if (countMatch && parseInt(countMatch[1]!, 10) > 0) {
    if (!rest) return { type: "invalid", error: "Missing prompt for count-mode loop" };
    return {
      type: "prompt",
      mode: "count",
      maxChecks: parseInt(countMatch[1]!, 10),
      prompt: rest,
    };
  }

  return { type: "invalid", error: `Unrecognized loop argument: ${first}` };
}

export default function loopExtension(pi: ExtensionAPI) {
	if (!isOrgmExtensionEnabled("loop")) return;

	let loopActive = false;
	let loopIteration = 0;
	let loopIsInjecting = false;
	const loopMaxIterations = loadMaxIterations();
	let loopPromptText = "";
	let loopPromptMode: "duration" | "count" | null = null;
	let loopIntervalMs = 0;
	let loopMaxChecks = 0;
	let loopCurrentCheck = 0;
	let loopCheckTimeout: ReturnType<typeof setTimeout> | null = null;

	pi.on("session_start", async () => {
		loopActive = false;
		loopIteration = 0;
		loopIsInjecting = false;
		loopPromptMode = null;
		loopPromptText = "";
		if (loopCheckTimeout) clearTimeout(loopCheckTimeout);
		loopCheckTimeout = null;
		emitState(pi, false, 0, loopMaxIterations);
	});

	pi.on("before_agent_start", async (event: BeforeAgentStartEvent) => {
		if (!loopIsInjecting) {
			loopIteration = 0;
		}
		loopIsInjecting = false;

		if (!loopActive) return undefined;

		return {
			systemPrompt: event.systemPrompt + buildLoopSystemPromptBlock(loopIteration, loopMaxIterations),
		};
	});

	pi.on("agent_end", async (event: AgentEndEvent, ctx: ExtensionContext) => {
		if (!loopActive) return;

		if (findDoneSignal(event.messages)) {
			loopActive = false;
			if (loopCheckTimeout) clearTimeout(loopCheckTimeout);
			loopCheckTimeout = null;
			loopPromptMode = null;
			emitState(pi, false, loopIteration, loopMaxIterations);
			ctx.ui.notify(`Loop complete after ${loopIteration} iteration${loopIteration === 1 ? "" : "s"}.`, "success");
			return;
		}

		// Prompt mode (duration) scheduling
		if (loopPromptMode === "duration") {
			loopIteration++;
			loopIsInjecting = true;
			emitState(pi, true, loopIteration, loopMaxIterations);

			if (loopCheckTimeout) clearTimeout(loopCheckTimeout);
			loopCheckTimeout = setTimeout(() => {
				pi.sendUserMessage(CONTINUATION_MESSAGE, { deliverAs: "nextTurn" });
			}, loopIntervalMs);
			return;
		}

		// Prompt mode (count) scheduling
		if (loopPromptMode === "count") {
			loopCurrentCheck++;
			if (loopCurrentCheck >= loopMaxChecks) {
				loopActive = false;
				loopPromptMode = null;
				emitState(pi, false, loopIteration, loopMaxIterations);
				ctx.ui.notify(`Loop stopped: count (${loopMaxChecks}) reached`, "warning");
				return;
			}
			loopIteration++;
			loopIsInjecting = true;
			emitState(pi, true, loopIteration, loopMaxIterations);
			pi.sendUserMessage(CONTINUATION_MESSAGE, { deliverAs: "nextTurn" });
			return;
		}

		if (loopIteration >= loopMaxIterations) {
			loopActive = false;
			emitState(pi, false, loopIteration, loopMaxIterations);
			ctx.ui.notify(`Loop stopped: max iterations (${loopMaxIterations}) reached`, "warning");
			return;
		}

		loopIteration++;
		loopIsInjecting = true;
		emitState(pi, true, loopIteration, loopMaxIterations);
		pi.sendUserMessage(CONTINUATION_MESSAGE, { deliverAs: "nextTurn" });
	});

	pi.registerCommand("loop", {
		description: "Agent loop mode: /loop [on|off|status|duration prompt|count prompt]",
		getArgumentCompletions: (prefix) => {
			const options = [
				{ value: "on", label: "on — activate loop mode" },
				{ value: "off", label: "off — deactivate loop mode" },
				{ value: "status", label: "status — show current loop state" },
				{ value: "30s", label: "30s <prompt> — check every 30 seconds" },
				{ value: "2m", label: "2m <prompt> — check every 2 minutes" },
				{ value: "5m", label: "5m <prompt> — check every 5 minutes" },
				{ value: "1h", label: "1h <prompt> — check every hour" },
				{ value: "20", label: "20 <prompt> — check up to 20 times" },
			];
			const normalized = prefix.trimStart().toLowerCase();
			return options.filter((o) => o.value.startsWith(normalized));
		},
		handler: async (args, ctx) => {
			const result = parseLoopArgs(args);

			if (result.type === "lifecycle") {
				if (result.command === "on") {
					loopActive = true;
					emitState(pi, true, loopIteration, loopMaxIterations);
					ctx.ui.notify(`Loop mode ON (max ${loopMaxIterations} iterations)`, "success");
					return;
				}

				if (result.command === "off") {
					loopActive = false;
					loopIteration = 0;
					loopIsInjecting = false;
					if (loopCheckTimeout) clearTimeout(loopCheckTimeout);
					loopCheckTimeout = null;
					loopPromptMode = null;
					loopPromptText = "";
					emitState(pi, false, 0, loopMaxIterations);
					ctx.ui.notify("Loop mode OFF", "info");
					return;
				}

				const state = loopActive
					? `ON — iteration ${loopIteration}/${loopMaxIterations}`
					: "OFF";
				ctx.ui.notify(`Loop: ${state}`, "info");
				return;
			}

			if (result.type === "prompt") {
				loopActive = true;
				loopPromptText = result.prompt;
				loopPromptMode = result.mode;
				if (result.intervalMs) loopIntervalMs = result.intervalMs;
				if (result.maxChecks) {
					loopMaxChecks = result.maxChecks;
					loopCurrentCheck = 0;
				}
				loopIteration = 1;
				loopIsInjecting = true;
				emitState(pi, true, loopIteration, loopMaxIterations);
				pi.sendUserMessage(result.prompt, { deliverAs: "nextTurn" });
				ctx.ui.notify(`Loop ${result.mode} mode started (prompt: "${result.prompt}")`, "success");
				return;
			}

			// invalid
			ctx.ui.notify(`Loop error: ${result.error}`, "error");
		},
	});
}
