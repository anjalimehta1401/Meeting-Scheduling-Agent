/** Loads the people directory and calendars from JSON files. */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { BusyBlock } from "./slots.js";

export interface Person {
  id: string;
  name: string;
  email: string;
  phone: string;
  title: string;
  manager: string | null;
  home_city: string;
}

export type Calendars = Record<string, Record<string, BusyBlock[]>>;

export interface Store {
  people: Person[];
  calendars: Calendars;
}

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");

export function loadStore(dataDir: string = DATA_DIR): Store {
  const people = JSON.parse(readFileSync(path.join(dataDir, "people.json"), "utf8"));
  const calendars = JSON.parse(readFileSync(path.join(dataDir, "calendars.json"), "utf8"));
  return { people, calendars };
}
