import { describe, expect, it } from "vitest";
import { loadStore } from "../src/store.js";
import { findFreeSlots, getBusyTimes } from "../src/tools.js";

describe("tools", () => {
  it("returns busy times", () => {
    const store = loadStore();
    expect(getBusyTimes(store, { person: "sam", date: "2026-11-04" })).toEqual([
      { start: "09:00", end: "09:30", title: "Standup" },
    ]);
  });

  it("finds free slots for two people in the afternoon", () => {
    const store = loadStore();
    const slots = findFreeSlots(store, {
      attendees: ["priya", "sam"],
      date: "2026-11-03",
      duration_minutes: 30,
      earliest: "13:00",
    });
    expect(slots).toEqual([
      { start: "13:00", end: "13:30" },
      { start: "13:30", end: "14:00" },
      { start: "15:00", end: "15:30" },
      { start: "16:00", end: "16:30" },
    ]);
  });

  it("finds an hour-long meeting", () => {
    const store = loadStore();
    const slots = findFreeSlots(store, {
      attendees: ["priya", "sam"],
      date: "2026-11-03",
      duration_minutes: 60,
    });
    expect(slots).toContainEqual({ start: "13:00", end: "14:00" });
  });
});
