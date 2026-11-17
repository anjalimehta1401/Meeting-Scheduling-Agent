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
