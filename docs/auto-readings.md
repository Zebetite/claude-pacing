# Automatic readings after each turn (open item 8)

Status: built, tested and released in 0.8.0-beta. This file sits outside
the plugin folder, so it is not published.

## Goal

A reading used to need the session to call `get_usage` and run
`budget.mjs`, "after each big task". A session that forgets runs on a
stale level. The hooks module takes a reading after a turn by itself,
keeps `state.json` fresh for the next session's start line, and shows the
level in the status line.

## What was built

- `hooks/readings.json` names the module and holds an empty `hooks`
  block; `plugin.json` names that file (`"hooks": "./hooks/readings.json"`).
  `hooks/hooks.json` keeps only the SessionStart command hook, unchanged:
  every version loads it by itself, and the manifest only adds files.
- `hooks/readings.mjs`: on `session.measure`, once the weekly window
  (`seven_day`) moved a whole point or 30 min passed, it runs
  `node <$.plugin.root>/skills/pacing/scripts/budget.mjs --all .. --reset ..
  --source hook --five .. --five-reset ..`, and shows one toast when the
  level changes. The status line shows
  `77% of budget, 🟡Tier 1[80%] ⚪Tier 2[15%] 🟤Tier 4[5%], (36% Weekly, 40% Fable)`:
  the meter as a share of the line; the session's own use by tier, from
  every turn's tokens (`turn.complete`, subagents included) priced per
  model, in shares that add up to 100; the two meters. The status line is
  plain text, so the tiers are marked by emoji circles with no space
  before "Tier": gold, silver, bronze, brown (🟡 ⚪ 🟠 🟤), then purple,
  red, blue, green (🟣 🔴 🔵 🟢), and ⚫ for a model the ladder does not
  hold. An earlier version drew the line as a row above the prompt
  (`ui.render` on `AbovePrompt`), where the marks could take theme
  colours (tier 1 in the app's green for added lines); it was tried live,
  and the user preferred the status line. Nothing goes into the system prompt (a section that changed
  every turn would break the prompt cache). Any failure is swallowed.
- `budget.mjs --source hook`: carries the per-model figure (and the time
  it was read) over from the last reading of the same week; logs with
  `source: 'hook'`; logs only when the last reading is 30 min old, the
  meter moved a whole point, or the level or the per-model flag changed;
  never touches `settings.json` or the desktop app's preset; prints one
  JSON line. `log` marks such readings `(auto)`; the start line says
  "automatic".

## Tests

- `tests/auto.test.mjs` (node --test): the JSON line, the log and state,
  no setting changed, the carried figure, the thin log, `(auto)`, the start
  line.
- `hooks/readings.test.ts` (`claude plugin test pacing`, the engine's own
  kit): the arguments from the plugin folder, the status line, no run
  without a weekly window or before it moved a point, one toast on a new
  level, a failed run changing nothing.

## Live results (2026-11-15)

1. **Claude Code 2.1.154** (from before the engine), started with
   `--plugin-dir` in a throwaway home: it reads both hooks files,
   registers and runs the SessionStart hook, and reports no plugin error.
   Its hooks-file schema requires `hooks` and drops unknown keys, which is
   why `readings.json` carries `"hooks": {}`; without it, that version
   would record a load error for the file (the start hook still ran).
2. **Claude Code 2.1.325**, same way: the module loads ("events:
   session.measure"), the SessionStart hook runs beside it, and
   `session.measure` fires after the turn.
3. **A real desktop session** (a probe mod in the session's mods folder,
   running `budget.mjs --source hook --dry`): `rateLimits` held
   `five_hour` and `seven_day`, each with `resetsAt`; no per-model kind
   and no extra usage, as the types said. `$.plugin.root` is the module's
   plugin folder. `node` resolves on the engine's PATH (v22.14.0). The
   reading came back `ahead, 36 % / line 46.7 %`, the Fable figure carried
   from the night's reading. The desktop app showed the module's
   `$.ui.status` line (confirmed by the user).

## Still open

- **Installed plugins:** 2.1.325's debug log says installed plugins'
  hooks modules are held for a rollout flag (`tengu_plugin_hooks_modules`).
  Until it is on for an account, the published plugin may not run the
  module; everything else works as before.
- **A day of use** (live test 6): the log grows by about two readings an
  hour at most, and the trend does not jump from the denser data. The
  trend takes the oldest reading of the last two days, so density should
  not move it; check with `/pacing log` and `/pacing week` after a day.
