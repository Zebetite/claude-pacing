# Design: automatic readings after each turn (open item 8, not built)

Status: designed, not built. It cannot be tested live from the session
that wrote it, and the rule for this item is "test live or leave unbuilt".
This file sits outside the plugin folder, so it is not published.

## Goal

Today a reading needs the session to call `get_usage` and run
`budget.mjs`, "after each big task". A session that forgets runs on a
stale level. A hooks module could take a reading after every turn by
itself, keep `state.json` fresh for the next session's start line, and
log denser data for the trend.

## What the engine offers (Claude Code 2.1.325, from its own types file)

- A plugin's function hooks live in one module, named in a hooks file
  under `modules`: `{ "modules": ["./readings.mjs"] }`. The module exports
  `register(on, options)`. It has no Node APIs: everything goes through
  `$`. A `.mjs` file works; no TypeScript or build step is needed.
- `session.measure` fires "after each main-thread turn, and when a
  rate-limit window moves a whole point". Its input carries the usage
  figures, pushed rather than polled:
  - `rateLimits`: `{ kind, percentUsed, resetsAt }` for `five_hour`,
    `seven_day` and a gateway's `spend_limit`. `seven_day` is the
    Weekly · all models meter.
  - `context`: `{ tokens, window, percent }`.
  - `cost`.
- `$.session.usage()` returns the same figures on demand.
- `$.process.run(argv)` runs a program, such as `node budget.mjs ...`.
- `$.ui.status(text)` sets a status line entry; `$.ui.toast(text)` shows a
  toast.

## What it does not offer

- **No per-model weekly meter.** The rate-limit kinds are only the three
  above. "Weekly · Fable" (the `premium` meter) is in the desktop app's
  usage card (`get_usage`), not in what the engine hands a plugin. A
  reading from the hook cannot tell that Fable is out.
- **No extra-usage figures** (spent, monthly limit).
- **Not documented: the plugin's own folder from inside a module.** The
  module needs the path to `budget.mjs` for `$.process.run`. The types
  say nothing about `CLAUDE_PLUGIN_ROOT` or `import.meta.url` in a module.
  This has to be found out live.
- **Not documented: what an older Claude Code does with a `modules`
  declaration.** It may ignore the key, or it may reject the whole hooks
  file and with it the SessionStart command hook the plugin has today.

## Design

1. **Two hooks files, never one.** `hooks/hooks.json` keeps only the
   classic SessionStart command hook, unchanged. The module goes in a
   second file, `hooks/readings.json` (`{ "modules": ["./readings.mjs"] }`),
   named in `plugin.json` beside the default. That way an engine that
   rejects the module's file can at worst lose the automatic readings,
   not the start line. Whether an older version accepts a second hooks
   file with no `hooks` key is exactly what live test 4 checks.
2. **The module** (`hooks/readings.mjs`, about 40 lines):
   - `on('session.measure', ...)`: return `next(e)` at once (observe
     only; never hold the turn). Then, without awaiting in the turn's
     path, take `seven_day` and `five_hour` from `e.rateLimits` and
     `context.tokens` / `context.percent`.
   - Skip when there is no `seven_day` reading (an API key, not a
     subscription), when the last automatic reading is under 30 minutes
     old and `seven_day` moved less than a whole point, or while one run
     is still going.
   - Run `node <plugin>/skills/pacing/scripts/budget.mjs --all <pct>
     --reset <resetsAt> --five ... --five-reset ... --context ...
     --context-tokens ... --source hook` through `$.process.run`.
   - Show the level in the status line: `$.ui.status('pacing: ahead,
     36 % / line 47 %')`. On a change of level, one toast.
   - Nothing goes into the system prompt: a `prompt.compose` section
     that changes with the level would break the prompt cache on every
     change, which costs more than the reading saves.
3. **`budget.mjs --source hook`** (testable now, in `tests/`):
   - The premium meter is not in the input, so the script takes the
     `premium` and `premiumOut` of the last reading of the same week from
     the log, and says so in the entry (`premiumFrom: 'last reading'`).
     A week with no earlier reading has no premium figure.
   - It logs the entry with `source: 'hook'` and writes `state.json`, as
     a reading by the skill does.
   - It does not touch `settings.json` or the desktop app's preset: only a
     reading the session takes on purpose changes what new sessions
     start on. This keeps a background run from changing a setting.
   - It prints one line (the level and the `do:` words), since no one
     reads the full report.
4. **The skill**: SKILL.md's "after each big task" reading stays for the
   per-model meter and extra usage, which only `get_usage` has. When the
   start line's reading came from the hook and is fresh, the session uses
   it, as it does today.

## What a live test needs

1. A session that loads the plugin from this folder with the module: the
   desktop app's "Turn them on" answer for a copy in the session's mods
   folder, or `claude --plugin-dir X:\pacing\pacing` (the CLI on this
   machine is not logged in, so that needs a login first).
2. After one turn on the user's subscription: does `session.measure`
   fire, and does `rateLimits` hold `seven_day` with a `resetsAt`? Does a
   per-model window appear under another `kind`? Record the kinds seen.
3. Can the module find its plugin folder and run `node` with
   `$.process.run`? Does `node` resolve on the PATH the engine gives it?
4. **Compatibility**: install the plugin, with the second hooks file, in
   a Claude Code version from before the engine (any version that does
   not know `modules`). The SessionStart start line must still show, and
   `/pacing:pacing` must still work. If that version rejects the plugin,
   the module has to ship as a separate optional plugin instead.
5. `claude plugin validate X:/pacing/pacing --profile directory --strict`
   passes, and `claude plugin test` passes a test for the module that
   feeds it a `session.measure` event.
6. A day of use: the log grows by no more than about two readings an
   hour, and the trend line does not jump from the denser data.

## Order of work, once the live tests can run

`--source hook` in `budget.mjs` with its tests first (it changes nothing
for today's users), then the module in a mods-folder copy for tests 1 to
3, then test 4 on an older version, and only then into the plugin.
