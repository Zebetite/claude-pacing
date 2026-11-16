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
  `ahead 77% · 🟡T1 80% ⚪T2 15% 🟤T4 5% · wk 36% Fable 40%`
  (before 0.9.5: `77% of budget, 🟡Tier 1[80%] ⚪Tier 2[15%] 🟤Tier 4[5%], (36% Weekly, 40% Fable)`):
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

## The per-model meter and the pause warning (after 0.8.5-beta, not released)

- **A side session's status line.** A session another session started
  leads with its own tier: `⚪T2 sub · ahead 77% · ...` (before 0.9.5:
  `⚪Tier 2 Sub Agent - 77% of budget, ...`).
  The tier is that of the model its main thread's last turn ran on
  (`⚫Other` off the ladder); before its first turn the line is the plain
  one. `budget.mjs --source hook` tells the module (`spawned` in its JSON
  line) from the desktop app's own record of the session:
  `<LOCALAPPDATA>/Claude-Data/<app>/claude-code-sessions/<a>/<b>/<id>.json`
  carries `spawnedFrom` on a session another one started, and the id is
  `CLAUDE_CODE_HOST_SESSION_ID` in the engine's environment. Checked
  against real records on 2026-11-15: two side sessions true, the top
  session false. It is the app's own file, not a documented interface,
  and seen on Windows only: anything missing reads as "not known" and the
  line stays the plain one.
  0.9.0-beta and 0.9.1-beta told a side session by
  `CLAUDE_CODE_CHILD_SESSION=1`, which was wrong: the engine sets that
  variable for every command it runs, in every session, and never in its
  own environment, so the label never showed.

- **The per-model meter, paced.** `budget.mjs` now draws the same line
  against the per-model meter and gives it a level by the same
  thresholds and its own trend (from readings that read it in full; a
  carried figure is left out of the slope). While tier 1 is that model,
  the worse level decides; at its "throttle" the session is told to move
  to the fallback tier ("held"). An automatic reading carries the figure
  over, as before: it is a lower bound, since a meter only rises, so its
  level can be too mild but never too strict. The JSON line adds
  `premiumLevel`, `premiumHeld`, `levelBy` and `premiumOfBudget`; the
  status line names the time of a carried figure (`40% Fable at 09:40`)
  and, when that meter decides, starts with its share
  (`110% of Fable budget`). A toast also marks a change of the held flag.
- **A warning after a pause.** `prompt.submit` fires before the turn
  starts. When the main thread's last turn (`turn.complete` without an
  `agentId`) ended an hour or more ago on `$.clock`, the last
  `session.measure` showed 300 000 tokens or more, and the prompt was
  typed (no `turnId`, not meta, not a slash command, not from a
  notification, schedule, peer or a plugin's own prompt), one
  `$.ui.toast` says the size, the idle time and that compacting or a
  handover first is cheaper. Once per pause: the pause is keyed by the
  end time of the last turn. The hook always returns `next(e)` with the
  prompt unchanged, and any error is swallowed.
- **What the API allows.** The toast shows before the request goes out,
  but nothing short of holding the prompt (`{ drop }`, which the task
  ruled out) keeps that turn from storing the session again. So the
  notice is honest about it: "this turn stores it all again. After a
  break, /compact or a handover first is cheaper." The cache lifetime is
  not told to a module (`cache_ttl` reaches only model-switch hooks, and
  `prompt_cache_likely_expired` only a resumed session's SessionStart), so
  one hour is assumed. After a module reload or a resume the module has
  no last turn, so the first prompt is not warned.
- **Tests.** `readings.test.ts` under the kit's mocked clock: the toast
  before the turn and the prompt unchanged, once per pause, a new pause
  warned again, none under an hour or 300 000 tokens or before any turn,
  a subagent's turn not ending the pause, `/compact` not warned, a
  failing toast not stopping the prompt; the origin filter and the line
  as plain functions, since the kit raises a test's prompt with no
  origin. Not run live in a real session.

## Still open

- **Installed plugins:** 2.1.325's debug log says installed plugins'
  hooks modules are held for a rollout flag (`tengu_plugin_hooks_modules`).
  Until it is on for an account, the published plugin may not run the
  module; everything else works as before.
- **A day of use** (live test 6): the log grows by about two readings an
  hour at most, and the trend does not jump from the denser data. The
  trend takes the oldest reading of the last two days, so density should
  not move it; check with `/pacing log` and `/pacing week` after a day.

## Safe writes and the shared-checkout notice (after 0.9.1-beta, not released)

- **Safe writes** (`scripts/safe.mjs`). `config.json`, `state.json`, the
  notes files, the marks below, and the user's `settings.json` and the
  app's preset file are changed with `updateFile`: read, change, and
  write back only if the file is still what was read, the check and the
  rename under a lock file made with the exclusive flag (taken over
  after 10 s, waited for up to 5 s), the write itself to a temporary
  file renamed over the target (retried while Windows reports the target
  busy). A writer that loses the first, optimistic try makes the next
  ones holding the lock from read to write, so many writers queue up.
  The hooks module writes no file itself: it runs `budget.mjs`.
  `log.jsonl` and the agents log only grow by one appended line and are
  left as they were. `handover new` reserves its name with an exclusive
  marker; `handover done` tolerates a file another session moved.
- **Marks per project** (`paths.mjs`): `<data>/sessions/<project>.json`,
  an entry per session id (`since`, `t`, `live`). Written by `hook.mjs`
  at SessionStart, by every reading that is not `--dry` (`live` when the
  hooks module took it), removed by `hook.mjs end` at SessionEnd. The id
  is `CLAUDE_CODE_SESSION_ID` from the environment of the commands the
  engine runs, else `session_id` from the hook's input, read for 250 ms
  at most. Unknown id: no mark, no notice.
- **Not run live:** the SessionEnd hook in a real session, and whether
  the engine hands a SessionStart command hook `CLAUDE_CODE_SESSION_ID`
  in its environment (the hook's input is the fallback either way).

## A carried per-model figure (after 0.9.1-beta, not released)

- **The bug.** An automatic reading carries the per-model figure of the
  last full reading. On 2026-11-15 it read 71 % for about 15 hours while
  the real meter went to 90 %: the status line showed it as current
  (`71% Fable`), the level rested on it, and nothing asked for a new one.
- **Its age.** Past 30 min the status line says how old the figure is
  (`71% Fable 15h ago`); `log` marks it (`71 % (15 h old)`), the start
  line says it from an hour.
- **An estimate,** shown only: the figure plus what all models moved since
  it was read, times how the two meters moved against each other between
  this week's full readings (`est. 90%`; in the reported case the slope
  of 4.75 gave exactly the 90 % a full reading then found). Never used
  for a level, so it can neither raise nor lower one.
- **A full reading asked for** (`needFull` in the JSON line) while tier 1
  is the per-model model: no figure this week, the figure an hour old, or
  all models 2 points on since it was read; three hours while the model
  is held off tier 1. The module adds one block of context beside the
  user's next typed prompt (`prompt.submit`, `next({ ...e, context })`),
  marked as an automatic note, the prompt's own text untouched: once per
  stale figure, again after an hour if no full reading came. No tool call
  on any turn; the session takes the reading with the skill.
- **Not run live:** the context block in a real session. It rests on the
  engine attaching `context` after the prompt as its types document.

## A status line that fits the footer (0.9.5-beta)

- **The case.** A side session's line read `Tier 1 Sub Agent - 158% of
  Fable ...`: the desktop app draws the plugin's status in the composer's
  footer, beside the model and mode pickers and the turn's spinner, and
  cuts what does not fit with an ellipsis. About 32 characters were drawn
  there; a line of about 75 had fitted another time. `$.ui.status` takes
  text alone (its first 2 000 characters): it neither says the width nor
  takes a tooltip, so the line cannot choose a form by the room it gets.
- **Essentials first, short labels.** `🟡T1 sub · Fable held 158% · 🟡T1
  100% · wk 50% Fable 90%`: a side session's tier, then the level with
  the budget share of the meter that decides it (`over 103%`, `Fable held
  158%`, `stop 120% wrap up`), then the tier split, then the meters, a
  carried figure with its age (`Fable 71% (15h old est 90%)`). The lead
  stays within 32 characters for every level, three-digit shares and
  `⚫Other`; the tests hold it there.
- **The whole line.** `/pacing-status`, a command the hooks module
  registers (it runs mid-turn too), prints the long form and what to do
  now. The `usage` report has the meters, the level and the advice.
