/**
 * Tools the agent can call. Each tool takes the Store plus an arguments
 * object and returns JSON-serialisable data.
 *
 * Tool arguments come from a language model, so they are untrusted: every
 * tool validates its input and throws a ToolError with a message the model
 * can act on. The agent loop feeds those messages back to the model.
 */

import {
  SLOT_MINUTES,
  availabilityFromBusy,
  combineAvailability,
  findFreeWindows,
  minutesToTime,
  slotToTime,
  timeToMinutes,
  timeToSlot,
  timeToSlotCeil,
} from "./slots.js";
import type { Person, Store } from "./store.js";

/** An error caused by bad tool input. The message is safe to show the model. */
export class ToolError extends Error {
  constructor(
    message: string,
    /** Attendee names the directory did not contain, if that was the problem. */
    readonly unknownPeople: string[] = [],
  ) {
    super(message);
    this.name = "ToolError";
  }
}

/** The directory fields the assistant needs. Phone, email etc. stay private. */
export type PublicPerson = Pick<Person, "id" | "name" | "title">;

export function toPublicPerson(p: Person): PublicPerson {
  return { id: p.id, name: p.name, title: p.title };
}

/** A busy period. Meeting titles are deliberately omitted (they can be sensitive). */
export interface BusyPeriod {
  start: string;
  end: string;
}

export interface Slot {
  start: string;
  end: string;
}

const MAX_DURATION_MINUTES = 8 * 60;
const MAX_RANGE_DAYS = 14;
const DEFAULT_MAX_RESULTS = 10;

// ---------------------------------------------------------------- validation

function requireObject(args: unknown): Record<string, unknown> {
  if (typeof args !== "object" || args === null || Array.isArray(args)) {
    throw new ToolError("Tool arguments must be a JSON object.");
  }
  return args as Record<string, unknown>;
}

/** Parse a strict YYYY-MM-DD calendar date; returns epoch-ms at UTC midnight. */
function parseDate(value: unknown, field: string): number {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ToolError(`${field} must be a date in YYYY-MM-DD format.`);
  }
  const [y, m, d] = value.split("-").map(Number);
  const ms = Date.UTC(y, m - 1, d);
  const roundTrip = new Date(ms).toISOString().slice(0, 10);
  if (roundTrip !== value) {
    throw new ToolError(`${field} "${value}" is not a real calendar date.`);
  }
  return ms;
}

function formatDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function isWeekend(ms: number): boolean {
  const day = new Date(ms).getUTCDay();
  return day === 0 || day === 6;
}

/** Validate a clock time like "13:30" (24-hour). */
function parseClock(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    throw new ToolError(`${field} must be a time in 24-hour HH:MM format.`);
  }
  return value;
}

function parseDuration(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) {
    throw new ToolError("duration_minutes must be a whole number of minutes.");
  }
  if (value < 1 || value > MAX_DURATION_MINUTES) {
    throw new ToolError(`duration_minutes must be between 1 and ${MAX_DURATION_MINUTES}.`);
  }
  return value;
}

/**
 * Resolve attendee ids against the directory. Matching is on id only (case-
 * and whitespace-insensitive). Anyone not found raises a ToolError that names
 * them, so the model cannot quietly schedule a person who does not exist.
 */
function resolveAttendees(store: Store, value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ToolError("attendees must be a non-empty list of person ids.");
  }
  if (value.some((v) => typeof v !== "string")) {
    throw new ToolError("attendees must be a list of person id strings.");
  }
  const known = new Map(store.people.map((p) => [p.id.toLowerCase(), p.id]));
  const ids: string[] = [];
  const unknown: string[] = [];
  for (const raw of value as string[]) {
    const id = known.get(raw.trim().toLowerCase());
    if (id === undefined) unknown.push(raw);
    else if (!ids.includes(id)) ids.push(id);
  }
  if (unknown.length > 0) {
    const valid = store.people.map((p) => p.id).join(", ");
    throw new ToolError(
      `Unknown attendee(s): ${unknown.join(", ")}. They are not in the directory. ` +
        `Valid ids: ${valid}. Tell the user you could not find them; do not guess.`,
      unknown,
    );
  }
  return ids;
}

function requireWorkday(ms: number, label: string): void {
  if (isWeekend(ms)) {
    throw new ToolError(`${label} is a weekend; meetings are only scheduled on weekdays.`);
  }
}

// --------------------------------------------------------------------- tools

/** Return everyone in the directory (public fields only). */
export function listPeople(store: Store): PublicPerson[] {
  return store.people.map(toPublicPerson);
}

/** Return a person's busy periods on a date (YYYY-MM-DD), without titles. */
export function getBusyTimes(
  store: Store,
  args: { person: string; date: string },
): BusyPeriod[] {
  const a = requireObject(args);
  const [id] = resolveAttendees(store, [a.person]);
  const dateMs = parseDate(a.date, "date");
  const date = formatDate(dateMs);
  return (store.calendars[id]?.[date] ?? []).map((b) => ({ start: b.start, end: b.end }));
}

export interface FindFreeSlotsArgs {
  attendees: string[];
  date: string;
  duration_minutes: number;
  earliest?: string;
  latest?: string;
}

/** Shared search for one already-validated day. */
function searchDay(
  store: Store,
  ids: string[],
  date: string,
  duration: number,
  earliest: string | undefined,
  latest: string | undefined,
): Slot[] {
  const free = combineAvailability(
    ids.map((id) => availabilityFromBusy(store.calendars[id]?.[date] ?? [])),
  );
  // A 45-minute meeting occupies two 30-minute slots, so round the slot count up.
  const slotsNeeded = Math.ceil(duration / SLOT_MINUTES);
  // `earliest` rounds up (never start before it); `latest` rounds down (must finish by it).
  const startSlot = earliest ? timeToSlotCeil(earliest) : 0;
  const endSlot = latest ? timeToSlot(latest) : undefined;

  return findFreeWindows(free, slotsNeeded, startSlot, endSlot).map((s) => {
    const startMinutes = timeToMinutes(slotToTime(s));
    return { start: minutesToTime(startMinutes), end: minutesToTime(startMinutes + duration) };
  });
}

/**
 * Find every time on `date` when all attendees are free for `duration_minutes`.
 * Start times fall on the 30-minute grid. `earliest` and `latest` optionally
 * narrow the search (e.g. earliest: "12:00" for "afternoon"); the meeting must
 * start at or after `earliest` and end by `latest`.
 */
export function findFreeSlots(store: Store, args: FindFreeSlotsArgs): Slot[] {
  const a = requireObject(args);
  const ids = resolveAttendees(store, a.attendees);
  const dateMs = parseDate(a.date, "date");
  requireWorkday(dateMs, `date ${formatDate(dateMs)}`);
  const duration = parseDuration(a.duration_minutes);
  const earliest = a.earliest === undefined ? undefined : parseClock(a.earliest, "earliest");
  const latest = a.latest === undefined ? undefined : parseClock(a.latest, "latest");
  return searchDay(store, ids, formatDate(dateMs), duration, earliest, latest);
}

export interface FindFreeSlotsInRangeArgs {
  attendees: string[];
  start_date: string;
  end_date: string;
  duration_minutes: number;
  earliest?: string;
  latest?: string;
  max_results?: number;
}

/**
 * Find the earliest times across a range of dates (inclusive) when all
 * attendees are free. Weekends are skipped. Results are in chronological
 * order and capped at `max_results` (default 10).
 */
export function findFreeSlotsInRange(
  store: Store,
  args: FindFreeSlotsInRangeArgs,
): { date: string; start: string; end: string }[] {
  const a = requireObject(args);
  const ids = resolveAttendees(store, a.attendees);
  const startMs = parseDate(a.start_date, "start_date");
  const endMs = parseDate(a.end_date, "end_date");
  if (endMs < startMs) throw new ToolError("end_date must not be before start_date.");
  const days = Math.round((endMs - startMs) / 86_400_000) + 1;
  if (days > MAX_RANGE_DAYS) {
    throw new ToolError(`The date range may span at most ${MAX_RANGE_DAYS} days.`);
  }
  const duration = parseDuration(a.duration_minutes);
  const earliest = a.earliest === undefined ? undefined : parseClock(a.earliest, "earliest");
  const latest = a.latest === undefined ? undefined : parseClock(a.latest, "latest");
  let limit = DEFAULT_MAX_RESULTS;
  if (a.max_results !== undefined) {
    if (typeof a.max_results !== "number" || !Number.isInteger(a.max_results) || a.max_results < 1) {
      throw new ToolError("max_results must be a positive whole number.");
    }
    limit = Math.min(a.max_results, 50);
  }

  const results: { date: string; start: string; end: string }[] = [];
  for (let i = 0; i < days && results.length < limit; i++) {
    const ms = startMs + i * 86_400_000;
    if (isWeekend(ms)) continue;
    const date = formatDate(ms);
    for (const slot of searchDay(store, ids, date, duration, earliest, latest)) {
      if (results.length >= limit) break;
      results.push({ date, ...slot });
    }
  }
  return results;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const TOOLS: Record<string, (store: Store, args: any) => unknown> = {
  list_people: listPeople,
  get_busy_times: getBusyTimes,
  find_free_slots: findFreeSlots,
  find_free_slots_in_range: findFreeSlotsInRange,
};

