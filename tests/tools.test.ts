import { describe, expect, it } from "vitest";
import { loadStore } from "../src/store.js";
import { ToolError, findFreeSlots, findFreeSlotsInRange, getBusyTimes, listPeople } from "../src/tools.js";

describe("tools", () => {
  it("returns busy times", () => {
    const store = loadStore();
    expect(getBusyTimes(store, { person: "sam", date: "2026-11-04" })).toEqual([
      { start: "09:00", end: "09:30" }, // titles are intentionally not exposed
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
      { start: "16:30", end: "17:00" },
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

describe("tools: correctness", () => {
  const store = loadStore();
  const base = { attendees: ["priya", "sam"], date: "2026-11-03" };

  it("rounds a 45-minute request up to two slots", () => {
    const slots = findFreeSlots(store, { ...base, duration_minutes: 45, earliest: "13:00", latest: "14:00" });
    // 13:00-14:00 is free for both, so 13:00 works (meeting ends 13:45)...
    expect(slots).toEqual([{ start: "13:00", end: "13:45" }]);
    // ...and a 45-minute meeting must NOT be offered in a single free 30-minute gap.
    const gap = findFreeSlots(store, { ...base, duration_minutes: 45, earliest: "15:00", latest: "15:30" });
    expect(gap).toEqual([]);
  });

  it("never offers a start before `earliest`", () => {
    const slots = findFreeSlots(store, { ...base, duration_minutes: 30, earliest: "13:10", latest: "14:00" });
    expect(slots).toEqual([{ start: "13:30", end: "14:00" }]);
  });

  it("never ends after `latest`", () => {
    const slots = findFreeSlots(store, { ...base, duration_minutes: 60, earliest: "13:00", latest: "14:15" });
    expect(slots).toEqual([{ start: "13:00", end: "14:00" }]);
  });

  it("offers the final slot of the day", () => {
    const slots = findFreeSlots(store, { ...base, duration_minutes: 30, earliest: "16:30" });
    expect(slots).toEqual([{ start: "16:30", end: "17:00" }]);
  });

  it("every offered slot is free for every attendee", () => {
    const all = ["priya", "sam", "dana", "luis", "mei", "arjun"];
    for (const date of ["2026-11-02", "2026-11-03", "2026-11-04"]) {
      for (const group of [["priya", "sam"], ["luis", "mei", "arjun"], all]) {
        for (const duration of [30, 45, 60, 90]) {
          const slots = findFreeSlots(store, { attendees: group, date, duration_minutes: duration });
          for (const slot of slots) {
            for (const person of group) {
              for (const b of store.calendars[person]?.[date] ?? []) {
                const overlaps = slot.start < b.end && b.start < slot.end;
                expect(overlaps, `${person} ${date} ${slot.start}-${slot.end} vs ${b.start}-${b.end}`).toBe(false);
              }
            }
          }
        }
      }
    }
  });
});

describe("tools: invalid input", () => {
  const store = loadStore();
  const ok = { attendees: ["priya"], date: "2026-11-03", duration_minutes: 30 };

  it("rejects unknown attendees and names them", () => {
    try {
      findFreeSlots(store, { ...ok, attendees: ["priya", "bob"] });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ToolError);
      expect((e as ToolError).unknownPeople).toEqual(["bob"]);
    }
  });

  it("does not treat an unknown person as free", () => {
    expect(() => getBusyTimes(store, { person: "bob", date: "2026-11-03" })).toThrow(ToolError);
  });

  it("accepts ids case-insensitively", () => {
    expect(findFreeSlots(store, { ...ok, attendees: [" Priya "] }).length).toBeGreaterThan(0);
  });

  it.each([
    ["empty attendees", { ...ok, attendees: [] }],
    ["non-array attendees", { ...ok, attendees: "priya" }],
    ["bad date format", { ...ok, date: "next tuesday" }],
    ["impossible date", { ...ok, date: "2026-02-30" }],
    ["weekend", { ...ok, date: "2026-11-07" }],
    ["zero duration", { ...ok, duration_minutes: 0 }],
    ["negative duration", { ...ok, duration_minutes: -30 }],
    ["string duration", { ...ok, duration_minutes: "30" }],
    ["fractional duration", { ...ok, duration_minutes: 22.5 }],
    ["huge duration", { ...ok, duration_minutes: 100000 }],
    ["bad earliest", { ...ok, earliest: "noon" }],
    ["bad latest", { ...ok, latest: "25:00" }],
    ["null args", null],
  ])("rejects %s", (_name, args) => {
    expect(() => findFreeSlots(store, args as never)).toThrow(ToolError);
  });
});

describe("tools: privacy", () => {
  const store = loadStore();

  it("does not expose meeting titles", () => {
    const busy = getBusyTimes(store, { person: "dana", date: "2026-11-03" });
    expect(busy).toEqual([{ start: "11:00", end: "12:00" }]);
  });

  it("does not expose contact details in the directory", () => {
    const text = JSON.stringify(listPeople(store));
    expect(text).not.toContain("@northwind");
    expect(text).not.toContain("555");
  });
});

describe("findFreeSlotsInRange", () => {
  const store = loadStore();

  it("returns chronological results across days and skips weekends", () => {
    const r = findFreeSlotsInRange(store, {
      attendees: ["priya", "sam"],
      start_date: "2026-11-06",
      end_date: "2026-11-09",
      duration_minutes: 60,
      max_results: 2,
    });
    expect(r).toEqual([
      { date: "2026-11-06", start: "09:00", end: "10:00" },
      { date: "2026-11-06", start: "09:30", end: "10:30" },
    ]);
    const weekend = findFreeSlotsInRange(store, {
      attendees: ["priya"],
      start_date: "2026-11-07",
      end_date: "2026-11-08",
      duration_minutes: 30,
    });
    expect(weekend).toEqual([]);
  });

  it("finds the first day that works", () => {
    const r = findFreeSlotsInRange(store, {
      attendees: ["priya", "sam", "dana"],
      start_date: "2026-11-02",
      end_date: "2026-11-04",
      duration_minutes: 120,
      max_results: 1,
    });
    expect(r).toEqual([{ date: "2026-11-04", start: "12:00", end: "14:00" }]);
  });

  it("validates input", () => {
    const ok = { attendees: ["priya"], start_date: "2026-11-02", end_date: "2026-11-03", duration_minutes: 30 };
    expect(() => findFreeSlotsInRange(store, { ...ok, end_date: "2026-11-01" })).toThrow(ToolError);
    expect(() => findFreeSlotsInRange(store, { ...ok, end_date: "2027-01-01" })).toThrow(ToolError);
    expect(() => findFreeSlotsInRange(store, { ...ok, attendees: ["nobody"] })).toThrow(ToolError);
    expect(() => findFreeSlotsInRange(store, { ...ok, max_results: 0 })).toThrow(ToolError);
  });
});
