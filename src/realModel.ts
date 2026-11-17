/**
 * Optional adapter for any OpenAI-compatible chat completions endpoint.
 *
 * Works with OpenAI, Azure OpenAI (v1-compatible endpoints), Ollama
 * (http://localhost:11434/v1) and similar. Configure with environment variables:
 *
 *   LLM_BASE_URL   e.g. http://localhost:11434/v1
 *   LLM_API_KEY    optional for local servers
 *   LLM_MODEL      e.g. llama3.1
 *
 * You do NOT need this to complete the assignment. All grading uses FakeModel.
 */

import type { Message, Model } from "./model.js";

export class OpenAICompatibleModel implements Model {
  private baseUrl = process.env.LLM_BASE_URL!.replace(/\/$/, "");
  private apiKey = process.env.LLM_API_KEY ?? "";
  private model = process.env.LLM_MODEL!;

  async complete(messages: Message[]): Promise<string> {
    // Most endpoints don't accept a bare "tool" role without tool_call ids,
    // so tool results are sent back as user messages.
    const converted = messages.map((m) =>
      m.role === "tool" ? { role: "user", content: `Tool result: ${m.content}` } : m,
    );
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ model: this.model, messages: converted }),
      // A hung endpoint must not hang the assistant (the agent turns this into a friendly error).
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) throw new Error(`Model endpoint returned HTTP ${response.status}`);
    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error("Model response had no text content");
    return content;
  }
}
