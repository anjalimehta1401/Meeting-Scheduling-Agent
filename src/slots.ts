/**
 * Time-slot utilities for the scheduling assistant.
 *
 * The working day is divided into fixed-size slots. Slot 0 starts at
 * DAY_START. A person's availability for one day is an array of booleans,
 * one entry per slot, where true means the person is free.
 */

export const DAY_START = "09:00";
export const DAY_END = "17:00";
export const SLOT_MINUTES = 30;
export const SLOTS_PER_DAY = 16; // 09:00 to 17:00

export interface BusyBlock {
  start: string;
  end: string;
  title?: string;
}

/** Convert "HH:MM" to minutes since midnight. Throws on anything malformed. */
export function timeToMinutes(clock: string): number {
  if (typeof clock !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(clock)) {
    throw new Error(`Invalid time: ${clock}`);
  }
  const [hours, minutes] = clock.split(":").map(Number);
  return hours * 60 + minutes;
}

/** Convert minutes since midnight to "HH:MM". */
export function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60).toString().padStart(2, "0");
  const m = (minutes % 60).toString().padStart(2, "0");
  return `${h}:${m}`;
}

const DAY_START_MINUTES = timeToMinutes(DAY_START);

/** Convert a clock time to the index of the slot containing it. */
export function timeToSlot(clock: string): number {
  return Math.floor((timeToMinutes(clock) - DAY_START_MINUTES) / SLOT_MINUTES);
}

/** Convert a clock time to a slot index, rounding up to the next boundary. */
export function timeToSlotCeil(clock: string): number {
  return Math.ceil((timeToMinutes(clock) - DAY_START_MINUTES) / SLOT_MINUTES);
}

/** Convert a slot index to the clock time at which that slot starts. */
export function slotToTime(index: number): string {
  if (!Number.isInteger(index) || index < 0 || index > SLOTS_PER_DAY) {
    throw new Error(`Invalid slot index: ${index}`);
  }
  return minutesToTime(DAY_START_MINUTES + index * SLOT_MINUTES);
}

/**
 * Build a free/busy array for one day from a person's busy blocks.
 * Any slot that overlaps a busy block, even partially, is marked busy.
 * Malformed times, or a block that ends at/before its start, throw rather than
 * being skipped: silently ignoring a block would make someone look free.
 */
export function availabilityFromBusy(busyBlocks: BusyBlock[]): boolean[] {
  const free = new Array<boolean>(SLOTS_PER_DAY).fill(true);
  for (const block of busyBlocks) {
    if (timeToMinutes(block.start) >= timeToMinutes(block.end)) {
      throw new Error(`Busy block must end after it starts: ${block.start}-${block.end}`);
    }
    const start = Math.max(0, timeToSlot(block.start));
    const end = Math.min(SLOTS_PER_DAY, timeToSlotCeil(block.end));
    for (let i = start; i < end; i++) {
      free[i] = false;
    }
  }
  return free;
}

/** Intersect several free/busy arrays: a slot is free only if free for everyone. */
export function combineAvailability(calendars: boolean[][]): boolean[] {
  let combined = new Array<boolean>(SLOTS_PER_DAY).fill(true);
  for (const free of calendars) {
    combined = combined.map((value, i) => value && free[i]);
  }
  return combined;
}

/**
 * Return the starting slot index of every run of `slotsNeeded` free slots.
 * Only windows that begin at or after `startSlot` and finish by `endSlot`
 * are considered.
 */
export function findFreeWindows(
  free: boolean[],
  slotsNeeded: number,
  startSlot = 0,
  endSlot: number = SLOTS_PER_DAY,
): number[] {
  const results: number[] = [];
  if (!Number.isInteger(slotsNeeded) || slotsNeeded < 1) return results;
  const from = Math.max(0, Math.ceil(startSlot));
  const to = Math.min(free.length, Math.floor(endSlot));
  // A window [start, start + slotsNeeded) must fit inside [from, to), so the
  // last valid start is `to - slotsNeeded` (inclusive).
  for (let start = from; start <= to - slotsNeeded; start++) {
    if (free.slice(start, start + slotsNeeded).every(Boolean)) {
      results.push(start);
    }
  }
  return results;
}
