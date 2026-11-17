/**
 * Tools the agent can call. Each tool takes the Store plus an arguments
 * object and returns JSON-serialisable data.
 */

import {
  availabilityFromBusy,
  combineAvailability,
  findFreeWindows,
  slotToTime,
  timeToSlot,
  type BusyBlock,
} from "./slots.js";
import type { Person, Store } from "./store.js";

/** Return everyone in the directory. */
export function listPeople(store: Store): Person[] {
  return store.people;
}

/** Return a person's busy blocks on a date (YYYY-MM-DD). */
export function getBusyTimes(
  store: Store,
  args: { person: string; date: string },
): BusyBlock[] {
  return store.calendars[args.person]?.[args.date] ?? [];
}

export interface FindFreeSlotsArgs {
  attendees: string[];
  date: string;
  duration_minutes: number;
  earliest?: string;
  latest?: string;
}

/**
 * Find every time on `date` when all attendees are free for `duration_minutes`.
 * `earliest` and `latest` optionally narrow the search to part of the day
 * (e.g. earliest: "12:00" for "afternoon").
 */
export function findFreeSlots(
  store: Store,
  args: FindFreeSlotsArgs,
): { start: string; end: string }[] {
  const calendars = args.attendees.map((person) => {
    const busy = store.calendars[person]?.[args.date] ?? [];
    return availabilityFromBusy(busy);
  });

  const free = combineAvailability(calendars);
  const slotsNeeded = Math.floor(args.duration_minutes / 30);
  const startSlot = args.earliest ? timeToSlot(args.earliest) : 0;
  const endSlot = args.latest ? timeToSlot(args.latest) : undefined;

  const starts = findFreeWindows(free, slotsNeeded, startSlot, endSlot);
  return starts.map((s) => ({ start: slotToTime(s), end: slotToTime(s + slotsNeeded) }));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const TOOLS: Record<string, (store: Store, args: any) => unknown> = {
  list_people: listPeople,
  get_busy_times: getBusyTimes,
  find_free_slots: findFreeSlots,
};
