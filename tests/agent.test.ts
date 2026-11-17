import { describe, expect, it } from "vitest";
import {
  GIVE_UP_MESSAGE,
  MODEL_FAILURE_MESSAGE,
  STEP_LIMIT_MESSAGE,
  SchedulingAgent,
} from "../src/agent.js";
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

const slotArgs = {
  attendees: ["priya", "sam"],
  date: "2026-11-03",
  duration_minutes: 60,
};

describe("SchedulingAgent: malformed model output", () => {
  it.each([
    ["not JSON", "I think 2pm works!"],
    ["JSON array", "[1,2]"],
    ["JSON null", "null"],
    ["empty object", "{}"],
    ["non-string final", JSON.stringify({ final: 42 })],
    ["empty final", JSON.stringify({ final: "  " })],
    ["both keys", JSON.stringify({ final: "x", tool: "list_people" })],
    ["non-string tool", JSON.stringify({ tool: 7 })],
    ["non-object args", JSON.stringify({ tool: "list_people", args: "oops" })],
    ["empty reply", ""],
  ])("recovers after a bad reply: %s", async (_name, bad) => {
    const model = new FakeModel([bad, final("recovered")]);
    const answer = await new SchedulingAgent(model, loadStore()).run("hi");
    expect(answer).toBe("recovered");
    // The model was told what was wrong.
    const msgs = model.calls[1];
    expect(msgs[msgs.length - 1].content).toContain("rejected");
  });

  it("accepts JSON wrapped in a markdown fence", async () => {
    const model = new FakeModel(["```json\n" + final("fenced") + "\n```"]);
    expect(await new SchedulingAgent(model, loadStore()).run("hi")).toBe("fenced");
  });

  it("gives up gracefully after repeated malformed replies", async () => {
    const model = new FakeModel(["garbage"], true);
    const answer = await new SchedulingAgent(model, loadStore()).run("hi");
    expect(answer).toBe(GIVE_UP_MESSAGE);
    expect(model.calls).toHaveLength(3);
  });
});

describe("SchedulingAgent: bad tool calls", () => {
  it("reports an unknown tool to the model and continues", async () => {
    const model = new FakeModel([toolCall("book_meeting", {}), final("sorry, can't book")]);
    const answer = await new SchedulingAgent(model, loadStore()).run("book it");
    expect(answer).toBe("sorry, can't book");
    const last = model.calls[1].at(-1)!;
    expect(last.role).toBe("tool");
    expect(JSON.parse(last.content).error).toContain("Unknown tool");
  });

  it.each(["constructor", "__proto__", "toString", "hasOwnProperty"])(
    "does not resolve inherited property %s as a tool",
    async (name) => {
      const model = new FakeModel([toolCall(name), final("ok")]);
      expect(await new SchedulingAgent(model, loadStore()).run("hi")).toBe("ok");
      expect(JSON.parse(model.calls[1].at(-1)!.content).error).toContain("Unknown tool");
    },
  );

  it("feeds argument errors back instead of crashing", async () => {
    const model = new FakeModel([
      toolCall("find_free_slots", { ...slotArgs, duration_minutes: "an hour" }),
      toolCall("find_free_slots", { ...slotArgs, earliest: "12:00" }),
      final("13:00"),
    ]);
    const answer = await new SchedulingAgent(model, loadStore()).run("hi");
    expect(answer).toBe("13:00");
    expect(JSON.parse(model.calls[1].at(-1)!.content).error).toContain("duration_minutes");
  });

  it("handles a tool call with missing args", async () => {
    const model = new FakeModel([JSON.stringify({ tool: "find_free_slots" }), final("ok")]);
    expect(await new SchedulingAgent(model, loadStore()).run("hi")).toBe("ok");
  });

  it("does not leak internal error details if a tool throws unexpectedly", async () => {
    const store = loadStore();
    // Corrupt data to force a non-ToolError failure inside a tool.
    store.calendars.priya = { "2026-11-03": 5 as never };
    const model = new FakeModel([
      toolCall("get_busy_times", { person: "priya", date: "2026-11-03" }),
      final("ok"),
    ]);
    expect(await new SchedulingAgent(model, store).run("hi")).toBe("ok");
    const err = JSON.parse(model.calls[1].at(-1)!.content).error;
    expect(err).toContain("unexpectedly");
    expect(err).not.toContain("map");
  });
});

describe("SchedulingAgent: unknown people", () => {
  it("tells the user about an unknown attendee even if the model forgets", async () => {
    const model = new FakeModel([
      toolCall("find_free_slots", { ...slotArgs, attendees: ["priya", "bob"] }),
      final("Here's a time for you: 13:00."),
    ]);
    const answer = await new SchedulingAgent(model, loadStore()).run("meet priya and bob");
    expect(answer).toContain("13:00");
    expect(answer).toMatch(/couldn't find bob/);
  });

  it("does not duplicate the note when the model already mentioned them", async () => {
    const model = new FakeModel([
      toolCall("find_free_slots", { ...slotArgs, attendees: ["priya", "bob"] }),
      final("I couldn't find Bob in the directory."),
    ]);
    const answer = await new SchedulingAgent(model, loadStore()).run("hi");
    expect(answer).toBe("I couldn't find Bob in the directory.");
  });

  it("never returns slots when an attendee is unknown", async () => {
    const model = new FakeModel([
      toolCall("find_free_slots", { ...slotArgs, attendees: ["bob"] }),
      final("done"),
    ]);
    await new SchedulingAgent(model, loadStore()).run("hi");
    const toolMsg = JSON.parse(model.calls[1].at(-1)!.content);
    expect(toolMsg).toHaveProperty("error");
    expect(Array.isArray(toolMsg)).toBe(false);
  });
});

describe("SchedulingAgent: termination", () => {
  it("stops a model that calls tools forever", async () => {
    const model = new FakeModel([toolCall("list_people")], true);
    const answer = await new SchedulingAgent(model, loadStore(), undefined, { maxSteps: 5 }).run("hi");
    expect(answer).toBe(STEP_LIMIT_MESSAGE);
    expect(model.calls).toHaveLength(5);
  });

  it("stops a model that repeats a failing call", async () => {
    const model = new FakeModel([toolCall("nope")], true);
    const answer = await new SchedulingAgent(model, loadStore()).run("hi");
    expect(answer).toBe(GIVE_UP_MESSAGE);
    expect(model.calls).toHaveLength(3);
  });

  it("returns a friendly message when the model itself throws", async () => {
    const model = new FakeModel([]); // exhausted script throws
    expect(await new SchedulingAgent(model, loadStore()).run("hi")).toBe(MODEL_FAILURE_MESSAGE);
  });
});

describe("system prompt", () => {
  it("does not leak contact details but lists ids and tools", async () => {
    const model = new FakeModel([final("ok")]);
    await new SchedulingAgent(model, loadStore()).run("hi");
    const system = model.calls[0][0].content;
    expect(system).not.toContain("@northwind");
    expect(system).not.toContain("555");
    expect(system).toContain('"id": "priya"');
    expect(system).toContain("find_free_slots_in_range");
  });
});

describe("SchedulingAgent: range search end to end", () => {
  it("returns dated slots to the model", async () => {
    const model = new FakeModel([
      toolCall("find_free_slots_in_range", {
        attendees: ["priya", "sam", "dana"],
        start_date: "2026-11-02",
        end_date: "2026-11-04",
        duration_minutes: 120,
        max_results: 1,
      }),
      final("Wednesday Nov 4, 12:00-14:00."),
    ]);
    await new SchedulingAgent(model, loadStore()).run("2 hours for Priya, Sam and Dana this week");
    expect(JSON.parse(model.calls[1].at(-1)!.content)).toEqual([
      { date: "2026-11-04", start: "12:00", end: "14:00" },
    ]);
  });
});
