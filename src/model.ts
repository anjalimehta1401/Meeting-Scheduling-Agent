/** Model interface plus a deterministic fake for tests and local development. */

export interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
}

export interface Model {
  /** Given the conversation so far, return the model's raw text reply. */
  complete(messages: Message[]): Promise<string>;
}

/**
 * A scripted model. Returns the responses in `script` in order.
 *
 * Each response is the raw text the "model" produces, so you can script
 * malformed output as well as well-formed JSON. If `loopLast` is true, the
 * final response is returned forever once the script runs out (useful for
 * simulating a model that gets stuck).
 */
export class FakeModel implements Model {
  private script: string[];
  readonly calls: Message[][] = [];

  constructor(script: string[], private loopLast = false) {
    this.script = [...script];
  }

  async complete(messages: Message[]): Promise<string> {
    this.calls.push(structuredClone(messages));
    if (this.script.length === 0) {
      throw new Error("FakeModel script exhausted");
    }
    if (this.loopLast && this.script.length === 1) {
      return this.script[0];
    }
    return this.script.shift()!;
  }
}

/** Helper to build a scripted tool-call response. */
export function toolCall(name: string, args: Record<string, unknown> = {}): string {
  return JSON.stringify({ tool: name, args });
}

/** Helper to build a scripted final answer. */
export function final(text: string): string {
  return JSON.stringify({ final: text });
}
