/** The scheduling agent: a bounded tool-calling loop that tolerates a misbehaving model. */

import type { Message, Model } from "./model.js";
import { buildSystemPrompt } from "./prompts.js";
import type { Store } from "./store.js";
import { TOOLS, ToolError } from "./tools.js";

export interface AgentOptions {
  /** Hard cap on model calls per request, so a request can never run forever. */
  maxSteps?: number;
  /** Give up after this many bad replies/tool calls in a row. */
  maxConsecutiveErrors?: number;
}

export const DEFAULT_MAX_STEPS = 8;
export const DEFAULT_MAX_CONSECUTIVE_ERRORS = 3;

export const GIVE_UP_MESSAGE =
  "Sorry, I wasn't able to complete that request. Please try rephrasing it, or try again in a moment.";
export const STEP_LIMIT_MESSAGE =
  "Sorry, I couldn't finish working that out within a reasonable number of steps. " +
  "Please try a more specific request.";
export const MODEL_FAILURE_MESSAGE =
  "Sorry, the assistant is temporarily unavailable. Please try again in a moment.";

type Action =
  | { kind: "final"; text: string }
  | { kind: "tool"; name: string; args: unknown }
  | { kind: "invalid"; reason: string };

/** Strip a Markdown code fence if the model wrapped its JSON in one. */
function stripFence(raw: string): string {
  const m = raw.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return m ? m[1] : raw.trim();
}

/** Turn raw model text into a validated action, never throwing. */
export function parseAction(raw: unknown): Action {
  if (typeof raw !== "string") return { kind: "invalid", reason: "Reply was not text." };
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFence(raw));
  } catch {
    return { kind: "invalid", reason: "Reply was not valid JSON." };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { kind: "invalid", reason: "Reply must be a single JSON object." };
  }
  const obj = parsed as Record<string, unknown>;
  const hasFinal = "final" in obj;
  const hasTool = "tool" in obj;
  if (hasFinal && hasTool) {
    return { kind: "invalid", reason: 'Reply must contain either "final" or "tool", not both.' };
  }
  if (hasFinal) {
    if (typeof obj.final !== "string" || obj.final.trim() === "") {
      return { kind: "invalid", reason: '"final" must be a non-empty string.' };
    }
    return { kind: "final", text: obj.final };
  }
  if (hasTool) {
    if (typeof obj.tool !== "string") {
      return { kind: "invalid", reason: '"tool" must be a string.' };
    }
    const args = obj.args === undefined ? {} : obj.args;
    if (typeof args !== "object" || args === null || Array.isArray(args)) {
      return { kind: "invalid", reason: '"args" must be a JSON object.' };
    }
    return { kind: "tool", name: obj.tool, args };
  }
  return { kind: "invalid", reason: 'Reply must contain a "tool" or a "final" key.' };
}

export class SchedulingAgent {
  private maxSteps: number;
  private maxConsecutiveErrors: number;

  constructor(
    private model: Model,
    private store: Store,
    private today = "2026-11-02",
    options: AgentOptions = {},
  ) {
    this.maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
    this.maxConsecutiveErrors = options.maxConsecutiveErrors ?? DEFAULT_MAX_CONSECUTIVE_ERRORS;
  }

  /** Handle one user request and return the assistant's final answer. Never throws. */
  async run(userRequest: string): Promise<string> {
    const messages: Message[] = [
      { role: "system", content: buildSystemPrompt(this.store.people, this.today) },
      { role: "user", content: userRequest },
    ];
    const unknownPeople = new Set<string>();
    let consecutiveErrors = 0;

    for (let step = 0; step < this.maxSteps; step++) {
      let raw: string;
      try {
        raw = await this.model.complete(messages);
      } catch {
        return MODEL_FAILURE_MESSAGE;
      }
      messages.push({ role: "assistant", content: typeof raw === "string" ? raw : "" });

      const action = parseAction(raw);

      if (action.kind === "final") {
        return withUnknownPeopleNote(action.text, unknownPeople);
      }

      let feedback: Message;
      if (action.kind === "invalid") {
        feedback = {
          role: "user",
          content:
            `Your last reply was rejected: ${action.reason} ` +
            'Respond with exactly one JSON object: {"tool": ..., "args": {...}} or {"final": "..."}.',
        };
        consecutiveErrors++;
      } else if (!Object.hasOwn(TOOLS, action.name)) {
        feedback = {
          role: "tool",
          content: JSON.stringify({
            error: `Unknown tool "${action.name}". Available tools: ${Object.keys(TOOLS).join(", ")}.`,
          }),
        };
        consecutiveErrors++;
      } else {
        try {
          const result = TOOLS[action.name](this.store, action.args);
          feedback = { role: "tool", content: JSON.stringify(result) };
          consecutiveErrors = 0;
        } catch (err) {
          if (err instanceof ToolError) {
            err.unknownPeople.forEach((p) => unknownPeople.add(p));
            feedback = { role: "tool", content: JSON.stringify({ error: err.message }) };
          } else {
            // Unexpected bug: don't leak internals to the model or user.
            feedback = {
              role: "tool",
              content: JSON.stringify({ error: "The tool failed unexpectedly. Try different arguments." }),
            };
          }
          consecutiveErrors++;
        }
      }
      messages.push(feedback);

      if (consecutiveErrors >= this.maxConsecutiveErrors) {
        return withUnknownPeopleNote(GIVE_UP_MESSAGE, unknownPeople);
      }
    }

    return withUnknownPeopleNote(STEP_LIMIT_MESSAGE, unknownPeople);
  }
}

/**
 * If a tool reported people missing from the directory, make sure the user
 * hears about it even if the model's answer forgot to mention them.
 */
function withUnknownPeopleNote(text: string, unknown: Set<string>): string {
  const lower = text.toLowerCase();
  const unmentioned = [...unknown].filter((p) => !lower.includes(p.trim().toLowerCase()));
  if (unmentioned.length === 0) return text;
  return `${text}\n\nNote: I couldn't find ${unmentioned.join(", ")} in the employee directory.`;
}
