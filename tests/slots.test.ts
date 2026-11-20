import { describe, expect, it } from "vitest";
import {
  availabilityFromBusy,
  combineAvailability,
  findFreeWindows,
  slotToTime,
  timeToSlot,
} from "../src/slots.js";

describe("slots", () => {
  it("converts slot indexes to times", () => {
    expect(slotToTime(0)).toBe("09:00");
    expect(slotToTime(3)).toBe("10:30");
  });

  it("converts times to slot indexes", () => {
    expect(timeToSlot("09:00")).toBe(0);
    expect(timeToSlot("10:45")).toBe(3);
  });

  it("marks partially overlapping slots as busy", () => {
    const free = availabilityFromBusy([{ start: "10:00", end: "10:45" }]);
    expect(free[2]).toBe(false); // 10:00-10:30
    expect(free[3]).toBe(false); // 10:30-11:00, partially busy
    expect(free[4]).toBe(true);
  });

  it("combines availability", () => {
    const a = [true, true, false, true];
    const b = [true, false, true, true];
    expect(combineAvailability([a, b]).slice(0, 4)).toEqual([true, false, false, true]);
  });

  it("finds free windows", () => {
    const free = [false, true, true, true, false, true, ...new Array(10).fill(false)];
    expect(findFreeWindows(free, 2)).toEqual([1, 2]);
  });
});

describe("slots: edge cases", () => {
  it("includes a window that ends exactly at the end of the day", () => {
    const free = new Array(16).fill(false);
    free[14] = true;
    free[15] = true; // 16:00-17:00
    expect(findFreeWindows(free, 2)).toEqual([14]);
    expect(findFreeWindows(free, 1)).toEqual([14, 15]);
  });

  it("includes a window that ends exactly at endSlot", () => {
    const free = new Array(16).fill(true);
    expect(findFreeWindows(free, 2, 0, 4)).toEqual([0, 1, 2]);
  });

  it("clamps out-of-range bounds and rejects non-positive sizes", () => {
    const free = new Array(16).fill(true);
    expect(findFreeWindows(free, 1, -5, 99)).toHaveLength(16);
    expect(findFreeWindows(free, 0)).toEqual([]);
    expect(findFreeWindows(free, 20)).toEqual([]);
  });
});

describe("slots: bad calendar data fails loudly", () => {
  it("rejects malformed times instead of ignoring the block", () => {
    expect(() => availabilityFromBusy([{ start: "9am", end: "10:00" }])).toThrow();
    expect(() => availabilityFromBusy([{ start: "09:00", end: "25:00" }])).toThrow();
  });

  it("rejects blocks that end at or before they start", () => {
    expect(() => availabilityFromBusy([{ start: "10:00", end: "10:00" }])).toThrow();
    expect(() => availabilityFromBusy([{ start: "11:00", end: "10:00" }])).toThrow();
  });

  it("rejects invalid slot indexes", () => {
    expect(() => slotToTime(-1)).toThrow();
    expect(() => slotToTime(17)).toThrow();
    expect(() => slotToTime(1.5)).toThrow();
  });
});
