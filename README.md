# Northwind Scheduling Assistant (TypeScript)

A small agentic assistant that helps employees find meeting times. A user
types a request in plain English ("find 45 minutes with Priya and Sam next
Tuesday afternoon"); a language model turns it into tool calls; the tools
look up calendars and compute when everyone is free.

This codebase was written quickly by an AI coding agent. Treat it the way you
would treat code you inherited from a teammate: it runs, and the tests pass,
but nobody has reviewed it carefully.

## Layout

```
data/                 Sample directory (people.json) and calendars (calendars.json)
src/
  slots.ts            Working-day slot model and free-window search
  tools.ts            Tools the agent can call (validated; includes multi-day search)
  agent.ts            The tool-calling loop
  prompts.ts          System prompt construction
  model.ts            Model interface + FakeModel for tests
  realModel.ts        Optional adapter for OpenAI-compatible endpoints
  store.ts            Loads the JSON data
  main.ts             CLI entry point
tests/                vitest suite
```

## Running

Requires Node.js 20+.

```bash
npm install
npm test
npm run typecheck
npm start -- "Find an hour for Priya and Sam on Tuesday afternoon"
```

Sample calendar data covers Monday 2 November to Wednesday 4 November 2026.
"Today" is Monday 2 November 2026.

## Models

`FakeModel` returns scripted responses, so you can test the agent without any
API access. Script responses are raw strings, which lets you simulate
malformed or unexpected model output as well as well-formed JSON. The helpers
`toolCall(...)` and `final(...)` build well-formed responses.

You do not need a real model for this assignment, and using one earns no extra
credit. If you want to try one anyway, `realModel.ts` works with any
OpenAI-compatible endpoint, including a local server such as Ollama:

```bash
export LLM_BASE_URL=http://localhost:11434/v1
export LLM_MODEL=llama3.1
npm start -- "Find 30 minutes with Mei and Luis on Tuesday"
```
