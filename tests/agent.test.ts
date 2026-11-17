import { describe, expect, it } from "vitest";
import { SchedulingAgent } from "../src/agent.js";
import { FakeModel, final, toolCall } from "../src/model.js";
import { loadStore } from "../src/store.js";

describe("SchedulingAgent", () => {
  it("returns the model's final answer", async () => {
    const model = new FakeModel([final("Happy to help!")]);
    const agent = new SchedulingAgent(model, loadStore());
    expect(await agent.run("hello")).toBe("Happy to help!");
  });

  it("calls a tool and returns the result to the model", async () => {
    const model = new FakeModel([
      toolCall("find_free_slots", {
        attendees: ["priya", "sam"],
        date: "2026-11-03",
        duration_minutes: 60,
        earliest: "12:00",
      }),
      final("13:00 works for both."),
    ]);
    const agent = new SchedulingAgent(model, loadStore());

    const answer = await agent.run("Find an hour for Priya and Sam on Tuesday afternoon");

    expect(answer).toBe("13:00 works for both.");
    const secondCall = model.calls[1];
    const last = secondCall[secondCall.length - 1];
    expect(last.role).toBe("tool");
    expect(JSON.parse(last.content)).toContainEqual({ start: "13:00", end: "14:00" });
  });

  it("includes the directory in the system prompt", async () => {
    const model = new FakeModel([final("ok")]);
    await new SchedulingAgent(model, loadStore()).run("hi");
    expect(model.calls[0][0].content).toContain("Priya Raman");
  });
});
