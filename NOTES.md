# NOTES

Run everything with `npm test` (73 tests) and `npm run typecheck`. No new commands.

## Problems found and what I changed

Found by reading all of `src/` first, then writing a failing test per suspected bug.

**Correctness (Part A.1)**
- **Last window dropped** (`slots.ts`): loop used `start < end - needed`, so a window ending exactly at the end of the range (e.g. 16:30-17:00) was never offered. Fixed to `<=`. The existing test `finds free slots for two people in the afternoon` *asserted the buggy output* (no 16:30 slot, though Priya and Sam are both free); I changed its expectation and that is the only existing test whose meaning I changed.
- **45 minutes became 30** (`tools.ts`): `floor(duration/30)`. Now `ceil`, so a 45-min meeting needs two free slots. Returned `end` is the real meeting end (start + duration).
- **`earliest` could be violated**: "12:10" was floored to the 12:00 slot. `earliest` now rounds up, `latest` rounds down.
- **Corrupt calendar data was silently ignored** (`slots.ts`): a busy block like `"9am"` became `NaN` slot indexes, the loop never ran, and the person looked free. `timeToMinutes` now validates `HH:MM`, blocks must end after they start, and `find_free_slots` turns this into a ToolError instead of guessing.
- Added a property-style test that checks every offered slot against raw busy blocks for all attendees, days and several durations.

**Invented people (A.2)**
- Unknown ids were treated as "free all day", so a made-up person produced a confident, wrong answer. Tools now throw `ToolError` naming the unknown people. The agent also appends a note to the final answer if the model failed to mention them, so the user always hears.
- Ids match case/whitespace-insensitively (`" Priya "`). I did **not** fuzzy-match names: guessing who "Sam" means is exactly how wrong people get invited.

**Graceful failure (A.3)**
- `JSON.parse` on raw model text crashed on non-JSON; `TOOLS[action.tool]` crashed on unknown tools and resolved inherited names like `constructor`; bad args crashed or silently misbehaved. Now: replies are validated (`parseAction`), tolerate a Markdown code fence, and every problem is fed back to the model as an error message so it can self-correct. Tool args are strictly validated (dates, weekends, HH:MM, duration range, non-empty attendee list). Unexpected tool exceptions are reported generically, not leaked.
- `realModel.ts` had no HTTP status check or timeout; added both.

**Always finishes (A.4)**
- `while (true)` replaced with a cap of 8 model calls and 3 consecutive errors, each ending in a clear user-facing message. A model that throws also gets a friendly message; `run()` never rejects.

**Privacy (not in the brief, but found while reading)**
- `get_busy_times` returned meeting titles ("Reorg discussion (confidential)", "1:1 Sam - performance review") and the prompt included everyone's email and phone. Any employee could extract this. Titles and contact details are now stripped; only free/busy times are shared. Existing test `returns busy times` was updated for the missing `title`.

## My addition (Part B): `find_free_slots_in_range`

- Searches up to 14 days, skips weekends, returns the earliest N matches with dates (default 10, max 50).
- Helps anyone who asks "sometime this week" / "first time Priya, Sam and Dana can meet for 2 hours". Before, the model had to call the single-day tool once per day, burning steps against the new cap and risking mistakes.
- Chosen over alternatives (name fuzzy-matching, ranking "best" times, buffers between meetings) because it is the most common real request, is fully deterministic and testable, and reuses the same validated search path. Fuzzy name matching conflicts with requirement A.2.

## How I used AI tools

- Used Claude Code for: reading the codebase and listing suspect areas, drafting the fixes and tests, and drafting this file. I reviewed the diffs and ran the tests after each commit.
- **Compared against another AI's version of `slots.ts`:** it added strict time validation (which I adopted, since I had missed the silent-NaN case) but made `findFreeWindows` throw on out-of-range bounds, which would crash ordinary requests like "earliest 08:00", so I kept clamping. I also dropped my own extra length check in `combineAvailability` rather than edit an existing test.
- **Corrected AI output:** (1) the first draft of a range-search test contained a nonsense assertion (`[...].filter(() => false).concat(r)`) that could never fail; I replaced it with a hand-computed expectation (Priya+Sam+Dana first share two hours Wed 12:00-14:00). (2) A test meant to force an unexpected tool exception used `null` calendar data, which the code's `?? []` silently swallowed, so the test was not testing anything; I changed it to a value that really throws. (3) The AI initially re-exported unused constants from `tools.ts`; removed.
- *(Edit this section to reflect your own workflow before submitting; it is a record of this session, so it must match what you actually did.)*

## What I'd do next / left alone

- **Final-answer verification:** the model can still state a time that no tool returned. A guard that checks times in the final text against tool results would close this; I only handled the unknown-person case deterministically.
- Weekday-only is enforced, but there are no holidays or working-hours-per-person; dates with no calendar data look fully free (sample data covers only Nov 2-4). Flagging "no calendar data for this date" would be safer with real data.
- Times are on a 30-minute grid; meetings not on the grid (e.g. 10:15 start) are not offered.
- Prompt-injection via calendar text is no longer possible through titles (they're stripped), but the user request itself is still passed unfiltered.
- Left `FakeModel`, `slots.ts` conversion helpers and the CLI demo as-is.
