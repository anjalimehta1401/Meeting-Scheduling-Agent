/**
 * Command-line entry point.
 *
 *   npm start -- "Find an hour for Priya and Sam on Tuesday afternoon"
 *
 * Uses a real model if LLM_BASE_URL and LLM_MODEL are set, otherwise a
 * scripted demo model.
 */

import { SchedulingAgent } from "./agent.js";
import { FakeModel, final, toolCall, type Model } from "./model.js";
import { OpenAICompatibleModel } from "./realModel.js";
import { loadStore } from "./store.js";

function demoModel(): FakeModel {
  return new FakeModel([
    toolCall("find_free_slots", {
      attendees: ["priya", "sam"],
      date: "2026-11-03",
      duration_minutes: 60,
      earliest: "12:00",
    }),
    final("Priya and Sam are both free on Tuesday Nov 3 from 13:00 to 14:00."),
  ]);
}

async function main(): Promise<void> {
  const request =
    process.argv.slice(2).join(" ") || "Find an hour for Priya and Sam on Tuesday afternoon";
  const model: Model =
    process.env.LLM_BASE_URL && process.env.LLM_MODEL
      ? new OpenAICompatibleModel()
      : demoModel();
  const agent = new SchedulingAgent(model, loadStore());
  console.log(await agent.run(request));
}

main();
