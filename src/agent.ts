/** The scheduling agent: a simple tool-calling loop. */

import type { Message, Model } from "./model.js";
import { buildSystemPrompt } from "./prompts.js";
import type { Store } from "./store.js";
import { TOOLS } from "./tools.js";

export class SchedulingAgent {
  constructor(
    private model: Model,
    private store: Store,
    private today = "2026-11-02",
  ) {}

  /** Handle one user request and return the assistant's final answer. */
  async run(userRequest: string): Promise<string> {
    const messages: Message[] = [
      { role: "system", content: buildSystemPrompt(this.store.people, this.today) },
      { role: "user", content: userRequest },
    ];

    while (true) {
      const raw = await this.model.complete(messages);
      const action = JSON.parse(raw);
      messages.push({ role: "assistant", content: raw });

      if ("final" in action) {
        return action.final;
      }

      const tool = TOOLS[action.tool];
      const result = tool(this.store, action.args);
      messages.push({ role: "tool", content: JSON.stringify(result) });
    }
  }
}
