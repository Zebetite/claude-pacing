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
  `Budget tokens: 850K · usage: Weekly 36% Fable 40%`
  (before 0.9.15: `Budget left: 850K · ...`; before 0.9.13: `Budget 77% · ...`; before 0.9.5: `77% of budget, 🟡Tier 1[80%] ⚪Tier 2[15%] 🟤Tier 4[5%], (36% Weekly, 40% Fable)`):
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
  leads with its own tier: `⚪T2 sub · under budget 77% · ...` (before 0.9.5:
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
  break, /compact first is cheaper." (before 0.9.9: "/compact or a handover first") The cache lifetime is
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
  100% · week 50% Fable 90%`: a side session's tier, then the level with
  the budget share of the meter that decides it (`over 103%`, `Fable held
  158%`, `stop 120% wrap up`), then the tier split, then the meters, a
  carried figure with its age (`Fable 71% (15h old est 90%)`). The lead
  stays within 32 characters for every level, three-digit shares and
  `⚫Other`; the tests hold it there.
- **The whole line.** `/pacing-status`, a command the hooks module
  registers (it runs mid-turn too), prints the long form and what to do
  now. The `usage` report has the meters, the level and the advice.

## The per-model meter in the status line (after 0.9.5-beta, not released)

- The lead is the weekly meter's level and share (`over 103%`); the
  per-model meter shows only as its week's usage among the meters
  (`Fable 99%`). "Fable held 158%" was a share of its line and read as
  usage over 100 %. When that meter set the level, the lead is the share
  alone, without the level's word. `/pacing-status` follows the same rule.
- A side session shows no per-model meter at all: its line reads as its
  own use, and the figure is the session's that started it. This
  replaces the lead described in the section above.

## An offer to compact (0.9.7)

- **Three levels, one surface.** The band above the prompt, with
  **Compact now** and **Not now**: from 300 000 tokens at the end of a
  turn, one calm dim line; from 500 000, plainer words with what every
  turn sends again, in the warning colour; and for a session of 300 000 or
  more left idle, a warning 10 minutes before the cache lapses and again
  once it has. The band never interrupts and stays until answered or the
  next prompt.
- **Why not ask when the prompt is sent.** The engine refuses
  `$.session.compact` from a `prompt.submit` hook: "it would compact under
  the turn this hook is holding". Holding the prompt would mean dropping it
  and sending it again, which loses what came with it. The question
  dialog was left out too: it interrupts, and one raised while nobody is
  there resolves itself when the person is away. So the warning comes
  before the lapse, from timers (`$.clock.after`) set when a turn ends;
  any prompt ends them. The notice after a pause still shows when the row
  was never drawn for that pause.
- **Not nagging.** Once per level; again after another 100 000 tokens, or
  after a new pause. Never while a turn runs (`isWorking`), never over a
  subagent's transcript, and only once a person has typed in the session.
  A compaction the user or the engine runs starts the offers over.
- **The compaction.** `$.session.compact` with instructions to keep the
  goal, the decisions and why, the open items in order, the files and
  commands that matter, and what was ruled out. A toast gives the size
  before and after.
- **Off.** `/pacing compact off` writes `compactAsk: false`; the module
  reads config.json when an offer is due, so it applies at once. An engine
  without the band, the timers or compaction keeps the notice as before.

## One session for everything, running agents in view (0.9.9)

- **One session.** The context rule no longer sends the user to a new
  session: from 300 000 tokens compact and go on here, whatever the next
  task is; from 500 000 compact first, a task with a clear outcome goes
  whole to one fresh agent, and a new session is named only when the
  session cannot be compacted or the user asks. An agent's outcome is
  given to the user in the session; a task that needs the user's input
  stays there.
- **Running agents.** `agent.spawn` starts one (type, model; effort from
  the Agent call), its loop's `turn.complete` ends it, `$.agent.list()`
  settles the count, the main turn's end ends the foreground ones, and a
  new or resumed session starts with none. While any run the status line
  leads with them, the whole line within 33 characters in steps that never
  drop the count or the level; toasts on start, end and every 5 minutes
  (`/pacing notify off` quiets them); a row above the prompt for
  background agents. The engine reports an agent's tokens only when its
  run ends.
- **Detached sessions.** A side session the user detached to the top
  level keeps `spawnedFrom` in the app's record and gains
  `lineageDetached: true`; it now reads as a session of its own.
- **An estimate of progress.** By time only, since an agent's tokens come
  when its run ends: how long it has run against the median of that agent
  type's last 20 finished runs, kept in the plugin's `$.store`
  (`agentRuns`). Shown from three runs on as `~60%`, at most 95 % while it
  runs; a type without history shows none. The estimate takes the time's
  place in the 33-character line before it goes, and goes before the count
  or the level. What an agent is doing comes from its own latest tool call
  (`tool.call` with its `agentId`), shown as a word or two in the 5-minute
  toast, the row and `/pacing-status`.
- **"Budget 77%".** The line names the weekly meter's share of today's
  budget line as `Budget 77%` at every level, with no level word and no
  advice (over 100 % is over); the toast on a change of level keeps the
  words and the do: line. The characters freed go to the agents.
  `/pacing-status` reads `Budget 105%` too, its "Now:" line beneath.

## A fresh line at load (0.9.10)

- **The case.** A session detached to the top level, 0.9.9 installed,
  `/reload-plugins`: the line still said "T1 sub". budget.mjs answered
  `spawned: false`, but the status line kept what the module drew before
  until the next automatic reading (a whole point, or 30 minutes).
- **At load** (session start and every reload; a reload runs `register` and
  `session.start` again): with the meters the last response reported
  (`$.session.usage().rateLimits`), a full reading at once, which counts as
  the last one; with none yet (a new session), a dry run on the figures
  state.json keeps, which logs nothing, and the first `session.measure`
  takes the full reading without the wait (`last` is empty after a load).
  Started, never awaited: the session's start does not wait on it; any
  failure draws nothing new. A reading taken at load is no change of level
  for the toast.
- **No tiers in the compact line.** `Budget 77% · usage: Weekly 36% Fable
  40%`: the budget share, then the usage, the per-model figure after a
  comma. A side session leads with a plain `sub` (no tier; no per-model
  meter, as before). The tier split lives in `/pacing-status`'s long form.
  With agents running the 33-character rule holds: the count and the budget
  share always show, the usage only when it fits whole, the per-model
  figure going before the weekly one.
- **No age or estimate in the compact line.** The per-model figure shows
  as last read, `Fable 28%`, however old: a figure read beats a guess in a
  line with no room to say which it is. Its age and the estimate stay in
  `/pacing-status`, and a stale figure still brings the note that asks the
  session for a full reading. The usage reads `usage: Weekly 36% Fable 28%`.

## Faster, and side sessions in view (0.9.10)

- **At once.** An agent shows when the model's Agent call comes, as a
  provisional entry the spawn takes over (keeping its start time); a call
  that spawns nothing drops it when it ends. The few seconds seen live
  before the line showed an agent were the engine resolving and starting
  the agent before `agent.spawn`.
- **Every 5 seconds** while anything runs, the line and the band redrawn
  from what the module knows (no cost); the agents settled from
  `$.agent.list()` every 30 seconds; the timer stops when nothing runs.
- **Side sessions.** The engine lists no other sessions; the desktop app's
  own `list_sessions` tool does, with `isRunning` and `startedBy`. The
  module calls it like a tool (`$.tool.call`, no dialog): once at load
  (what already works shows, no toast), at a turn's end when the session
  has side sessions, every 15 seconds while one works, and for a minute
  after one was started or messaged. Never otherwise. The session records'
  own fields (`lastTurnEdgeAt`, `lastActivityAt`, `latestUserFrameAt`)
  only hint at working or idle, so they are not used. This session's id
  comes from `CLAUDE_CODE_HOST_SESSION_ID`, else from budget.mjs's JSON
  (`hostSessionId`). Anything missing or unreadable is none.
- **One count of Agents.** In-process agents and working side sessions are
  one count, as a sentence: `⏳ 1 Agent is running · Budget 77%` (33
  characters), `⏳ 2 Agents are running`, shrinking to `⏳ 2 Agents` and
  then the bare count; a single in-process agent keeps its role, time and
  estimate (`⏳ reader 3m ~60%`). The row and the 5-minute toast start the
  same way ("1 Agent is running in the background: …", "2 Agents are still
  running: …"). `/pacing-status` marks the side sessions. Checked live: the
  module reads `CLAUDE_CODE_HOST_SESSION_ID`, and `$.tool.call` reaches
  `list_sessions`, answering `text` (the rows as JSON) and `result` (an
  array of `{ type, text }`).
- **Each agent in full, primarily.** The user's form: name, time, step,
  estimate, `⏳ reader 3m searching ~60%`, each agent in turn,
  `⏳ reader 3m searching ~60%, ⏳ researcher 1m on the web`. Without room,
  for all at each step and from the right: the estimate, the step, the time,
  leaving the names alone (`⏳ reader, ⏳ researcher`: "are running" there
  was always longer than the times it replaced, so it could never show);
  with more than one, the count, `⏳ 2 Agents are running`; last the bare
  count, `⏳ 2 Agents`. "Agent" only for more than one, or a lone side session
  whose title does not fit. While agents run the whole line keeps within
  43 characters, the normal line's own widest
  (`Budget 999% · usage: Weekly 100% Fable 100%`); the usage gives way
  first, whole. 33 was what one screenshot showed before the app's
  ellipsis during a turn; the footer's room varies. Toasts name who else
  runs ("; reader is running", "; nothing else is running"), a count only
  for three or more.

## A new version reloads by itself (0.9.11)

- **The case.** The desktop app syncs installed plugins about every 20
  minutes and replaces the plugin's files in place. An open session ran
  the old module until someone typed `/reload-plugins`, and the user had to
  ask whether the version had arrived.
- **The look.** The module reads `.claude-plugin/plugin.json` under
  `$.plugin.root` at load (`session.start`, once per copy: the version it
  was loaded as), 2 seconds after each main-thread turn ends, and every 5
  minutes: one `$.fs.read`, no process, no model call. A manifest that does
  not read or names no version (half-written during a sync) is no change,
  and is read again at the next look.
- **The reload.** Another version on disk, in a session a person has typed
  in, with no turn running (`turn.start` to `turn.complete`), no survey up
  (the band's last `hasSurvey`) and no in-process subagent at work:
  `$.command.run({ command: 'reload-plugins' })`, once per version, from a
  timer, since the engine refuses the call inside a hook the turn waits
  on. A side session nobody types in is left alone: it loads the new
  version at its next start. `/pacing reload off` (`autoReload: false`)
  turns it off.
- **Who says so.** The copy that asked may be unloaded before its call
  answers, so it leaves a mark in `$.store` under `reload:<session id>`,
  and the copy the reload brings finds it at its load: `Pacing: updated to
  0.9.11 and reloaded.` The mark is deleted once said. A load with no
  mark (a new session, a reload the person typed) says nothing.
- **A copy that stays.** The engine's types say a reload starts changed
  modules only, so a version that left `readings.mjs` as it was keeps the
  copy running. 10 seconds after the command ran, the copy that asked
  looks once more: its own file on disk as it was loaded, it is the new
  version's code, says "updated" and counts as that version; its file
  changed and it still runs, the reload did not take: `Pacing 0.9.11 is
  installed: type /reload-plugins to load it.` The same line when the
  engine rejects the call, and when the command neither ran nor was
  refused in 10 minutes. Once per version.
- **No loop.** A fresh copy takes the version on disk as its own, and a
  copy that stays remembers the version it asked for: one attempt per
  version, whatever the reload did.
- **`$` goes to top-level functions only.** The loader refuses a hooks
  module that passes `$` to a function declared inside `register`, so the
  look and the run are top-level (`look($, rl)`, `runReload`), with the
  copy's memory in an object, as `st` is for the refresh.
- **Not checked live:** whether the engine accepts `/reload-plugins` from a
  module, and that `session.start` then runs in the new copy.

## The assignment and "is running" in the line (0.9.11)

- **The case.** With one agent running the line read `⏳ implementer 2m`
  with room to spare, and the toasts named neither the task nor that the
  agent runs. "Task" is both: the assignment (the short `description` the
  agent was started with) and what it is doing now (the step).
- **The order,** per agent: name, assignment, step, time, estimate. With a
  step, `⏳ implementer: Auto-reload on plugin update, editing 2m ~60% ·
  Budget 77%`; before one is known, `⏳ implementer is running: Auto-reload
  on plugin update 2m`. An agent without a description has no assignment
  part (`⏳ reader searching 3m ~60%`, `⏳ reader is running 3m`); a side
  session's title is its name (`⏳ Task s1 is running 5s`).
- **Without room,** for all agents at each step and from the right: the
  estimate; the step (the form becomes `name is running: assignment
  time`); the assignment, cut with `…` one character at a time down to 8
  and then gone (`⏳ implementer is running 2m`); the time and "is
  running", leaving the names (`⏳ reader, ⏳ implementer`); with more than
  one, `⏳ 2 Agents are running`, then `⏳ 2 Agents`; last the bare count.
  An assignment is never longer than 60 characters anywhere.
- **75 characters** while agents run (43 before): a line of 75 was seen
  whole in the app's footer, and a module cannot learn the room it has.
  The order stays agents, `Budget x%`, usage, so a cut by the app takes the
  least important end; the usage gives way first, and shows where what is
  left has room for it. Two agents with their assignments pass 75, so two
  read `⏳ implementer is running 2m, ⏳ reader is running 3m · Budget 77%`.
- **Toasts,** one line each, within 120 characters (80 before):
  `Pacing: implementer is running "Auto-reload on plugin update" on Fable
  5.2 high.`, with `; reader is also running.` when others run (two by
  name, a count from three on) and no tail when none does;
  `Pacing: implementer is done with "Auto-reload on plugin update" after
  3m, 41k tokens; nothing else is running.` or `; reader is still
  running.`; every 5 minutes `Pacing: still running: implementer
  "Auto-reload on plugin update", editing 12m ~60%.`, several joined by
  "; " while an assignment shows. A side session: `Pacing: side session
  Task s1 is running.`, and `… ended its turn after 35s; nothing else is
  running.`
- **The row and `/pacing-status`** use the line's form: `In the
  background: ⏳ implementer: Auto-reload on plugin update, editing 2m
  ~60%`.

## Every meter, read by the module itself (0.9.12)

- **The case.** An automatic reading had the two windows the engine hands a
  plugin, carried the per-model figure, and asked the session beside a
  prompt to take a full reading: a tool call with a long answer, on the
  session's whole history.
- **The tool.** `await $.tool.call({ tool: 'mcp__ccd_session_mgmt__get_usage' })`
  from a module answers with no dialog (seen live), as `{ text, result }`:
  `text` is JSON, `result` the tool's content as `{ type, text }` items.
  In it `plan.windows[]` (`label`, `percentUsed`, `resetsAt`),
  `plan.extraUsage` and `context` with its `categories[]`. `usageOf` reads
  it; the per-model window is the weekly one that names config.json's
  `premium`.
- **A full automatic reading.** Where the tool answers, budget.mjs gets
  what the skill's section 1 hands it: `--premium` (`-` where the plan has
  no such window), `--five`, `--context`, `--context-tokens`,
  `--categories`, the extra usage and `--session`, with `--source hook`.
  The log entry carries `full: true`; `/pacing log` says `(auto, full)`,
  the report from the last reading `(automatic, full)`. It sets no setting,
  like any automatic reading. budget.mjs sends no `needFull` for it, so
  `fullReadingAsk` is not sent. The thin log counts the per-model meter
  too: a whole point there is logged.
- **The fallback.** The tool absent, failing, or reading as nothing (a
  terminal session): the plain reading from the engine's two windows, the
  carried figure and the note beside the prompt as before. Figures
  budget.mjs refuses: the plain reading in the same go.
- **How often.** As before (a whole point of the weekly window, 30 minutes,
  the load), and once when a subagent's run ends if the last reading is 5
  minutes old (`AGENT_GAP`). At a load with no windows from the engine yet,
  the tool gives a logged reading at once.
- **Not checked live:** that the call draws no row in the transcript, and
  the shape of `resetsAt` beyond an ISO string (seconds and milliseconds
  since the epoch are converted).

## The module records, reports and shows (0.9.12)

- **Records.** When a run of pacing:reader, implementer, verifier or
  researcher ends by itself, the module runs `config.mjs agent <role> <id>
  <model> <effort> <tokens>`. The tokens are the engine list's `tokenCount`
  (the latest request's input and all its output, the notification's
  figure), asked as the run ends, else the last figure the refresh saw;
  the run's own usage is every request summed and is not used. The effort
  is the Agent call's, else the list's, else the session's
  (`CLAUDE_EFFORT`); a kept agent's is remembered by its id. Without a
  known model, effort or token count, and for a stopped run, there is no
  record. When the command's answer names a fresh agent, the next prompt
  that is no slash command (a task notification too) carries one hidden
  line, once: `Pacing (automatic note, not from the user): the next
  implementer task goes to a fresh agent (5 tasks or 150k tokens reached).
  Start a new agent of that role for it, not the kept one.` A fresh agent
  of that role starting first drops it.
- **Reports.** `/pacing-usage` (`budget.mjs last`; too old a reading: the
  module measures first), `/pacing-help` and `/pacing-guide` (`config.mjs
  help [full]`). A command's text is drawn as markdown (the `CommandOutput`
  site's `text`), so the usage report goes in a fenced code block and the
  help and the guide as they are. Each answer is `isTextDisplayOnly`: the
  session never reads it. None is `immediate`: a text answered mid-turn
  stays in the requests.
- **The panel.** `$.ui.open({ id: 'pacing-agents', title: 'Agents' })`, a
  `ui.render` hook on `Pane`; `panelLines` is its text. Auto opens at an
  agent's or a side session's start; a person's close holds for the
  session (heard as `ui.close` with origin `person`, and where a panel
  this copy saw drawn is gone from `$.ui.panes()`), kept in `$.store` under
  `panelClosed` by the session's id so a reload does not forget.
  `{ isPlaced: false }`: nothing more, and the next start asks again. No
  Box has a width.
- **Parts.** `config.mjs part <done> <total>` anywhere in an agent's Bash
  command sets its parts; a TodoWrite list serves where the agent said
  none. TaskCreate and TaskUpdate are not read.
- **The kit cannot raise a person's close:** its `$.ui` has no `close`. The
  tests cover the `$.ui.panes()` way; the `ui.close` hook is untested.

## A toast by its kind, a shorter line, the time left (0.9.12)

- **Icons.** `ToastOptions` is `timeoutMs` alone, so each toast leads with
  an emoji where "Pacing: " stood (the box is drawn under the plugin's
  name): ▶️ started, ✅ finished, ⏳ still running, ⚠️ over the line, 🔴
  stop or the model out, 🟢 within the line, 🔁 switched, ❌ did not
  happen, 🔄 updated, 📦 a version waiting, 🗜️ compacted, 💤 the pause.
  15 seconds (`TOAST_LONG`) for finished, a change of level, ❌, 📦, 🔄, 💤
  and "press Enter to switch"; the engine's 4 for the rest. The rows above
  the prompt lead with the same icons and keep their colours.
- **The line without the assignment.** The user: "the status line dont
  need task from agents, its to long. just keep it in toasts". Per agent:
  name, step, time, progress, `⏳ implementer editing 2m part 2 of 4`, or
  `⏳ implementer is running 2m`. What gives way: the progress, the step,
  the time, then the names, the count as a sentence, the bare count. Two
  agents fit whole in 75 characters. The toasts, the row above the prompt,
  the panel and `/pacing-status` keep the assignment.
- **The time left.** In the 5-minute toast and the panel's row: with parts
  said, the time so far per part done times the parts left; else the
  median of that kind's finished runs (three or more) less the time run.
  `about 8m left`, `under 1m left`; nothing without a basis or past the
  estimate. The start toast says the usual length, `, about 20m`. Each is
  the first thing to go at 120 characters.
- **Not checked live:** how the emoji draw in the app's toast box and in
  the band, and whether the terminal's notification bar names the plugin
  beside a toast.

## Budget left in tokens (0.9.13)

- **The text.** The user asked for `Budget left: 850K` (tokens, without the word)
  in place of `Budget 77%`, negative past the line (`Budget left: -120K`). From
  a million, M with one decimal (`1.2M`); under a thousand, `0K`. One
  helper (`budgetText`) for the status line and
  `/pacing-status`. Until a rate is learned, the points of the week:
  `Budget left: 5%`; `Budget left: -` only with no figure at all.
- **The rate.** Left in points is the line less the weekly meter; tokens
  are points times the tokens per point. The module sums every token of
  the session and its subagents (input, output, cache read and write) and
  hands budget.mjs what was spent since the last reading that ran
  (`--spent`). budget.mjs keeps `rate.json` beside the log:
  `{ reset, from, to, tokens, carried }`. A new week starts the baseline
  at its first reading (that reading's `--spent` dropped) and carries the
  week before's rate when its meter rose 5 points or more. The rate now:
  this week's from 5 points, else the carried one, else this week's from
  2 points. `--dry` writes nothing; a damaged file is an empty one.
- **It errs low.** Use by sessions without the plugin (another device,
  the web) raises the meter with no tokens counted, so the rate is too
  low and the figure shows less left than there is.
- **The width.** The budget part is longer (17 characters against 10), so
  while agents run the usage gives way sooner, and two agents with their
  progress no longer fit: `⏳ implementer editing 2m, ⏳ reader searching
  3m · Budget left: 850K`. `ofBudget` stays in the JSON for the
  levels and other code.

## A Reload button for a new version (0.9.13)

- **The row.** The user wanted a button instead of typing. Where the
  reload by itself did not replace this copy (refused, given up after 10
  minutes, or this copy still runs after it), the band above the prompt
  shows `📦 Pacing 0.9.13 is installed.` with `Reload` and `Not now`, in
  the calm Switch row's style, after the urgent switch, the offer to
  compact and the calm switch (one action row at a time). The toast "type
  /reload-plugins" is gone from those cases.
- **Reload.** The same run as by itself (`$.command.run`, the mark in the
  store, the look RELOAD_SETTLE later). Refused: `/reload-plugins` goes
  into the prompt box (`$.prompt.fill`) and a toast says
  `📦 Press Enter to reload.`; where the box cannot be filled, the old line
  to type it.
- **Not now** hides the row for that version (this copy's memory, like the
  Switch row's suggestions seen); the next version shows it again.
- **`/pacing reload off`**: nothing runs by itself, and the row shows at
  the first look that finds the new version.
- **Not checked live:** whether the app lets a button's press run
  `/reload-plugins` where it refuses the same call from a timer, and
  whether `$.prompt.fill` reaches the box in the desktop app and the
  terminal. The kit tests cover the row, both buttons, the fallback and
  the setting.

## The agents panel removed (0.9.13)

- **The user's decision:** the panel (the side bar) goes. Gone from the
  module: the `Pane` render hook, `$.ui.open` for `pacing-agents`,
  `panelLines`, `autoPanel` and the `pn` memory, the close note in the
  store (`panelClosed`), the `/pacing-agents` command, and the list of
  finished runs (`done`, `outcomeOf`), which only the panel showed.
- **The setting:** `/pacing panel auto|off` is no command any more. An
  older `config.json` that still holds `agentsPanel` loads without a word:
  checkConfig no longer looks at the key (models.mjs lists it in
  `RETIRED`).
- **What stays as it was:** the toasts, the status line, the row above the
  prompt and `/pacing-status`, which carry every detail the panel showed
  for running agents (the assignment, the step, the time, the progress,
  the time left, the model and effort).

## Running agents across a reload (0.9.13)

- **Seen live:** after `/reload-plugins` (0.9.11 to 0.9.12) during an
  implementer's run, the line and the toasts lost its role, step, time and
  task: the module's `agents` map starts over at a reload.
- **Kept:** what the line, the toasts and the row above the prompt need
  of each running subagent (type, assignment, model, effort, background,
  the time it started, step, parts, tokens) in `$.store` under
  `agents:<session id>`. This plugin has no types file, so the store is
  used the way the module already uses it (the reload mark, `agentRuns`).
  Written when an agent starts, takes a new step or part, or ends, and
  when the settle drops one; never on the 5-second refresh. The key goes
  when none runs.
- **Read back** at `session.start`: only the agents `$.agent.list()` still
  runs (none without the list), with their first start time, so the time
  and the estimate go on; the history for the estimate from `agentRuns`.
  The next progress toast comes 5 minutes after the reload. Side sessions
  are not kept: the poll at load finds them again.
- **Not checked live:** that a real reload keeps `$.store` and the
  session's id as the kit does, and that `$.agent.list()` answers at the
  new copy's `session.start`.

## The count alone in the line, the desktop app's width (0.9.13)

- **Seen live:** the desktop app cut the plugin's status at about 35
  visible characters (`⏳ implementer editing 5m, ⏳ impl…`): the 75 the
  line was kept within never showed there.
- **Decided:** the line shows only how many agents run, `⏳ 1 Subagent
  running`, `⏳ 2 Subagents running`, side sessions counted in; who they
  are, their step, time and progress stay in the toasts, the row above the
  prompt and `/pacing-status`. Where it does not fit, "running" goes
  (`⏳ 2 Subagents`), and with no room even for that the bare count
  (`⏳2`, beside a budget as long as `-12.3M`).
- **The room:** `$.session.surfaces()` (the engine has no
  `$.ui.surface()`): 34 when `desktop` or `mobile` is among the surfaces,
  75 for a terminal alone or where the engine does not say. Asked once and
  kept, asked again on `session.attach` and `session.detach`; an empty
  answer is asked again at the next measure. The order holds: the agents,
  the budget whole, then the usage only as far as it fits whole, the
  per-model figure first to go. With nothing running in the desktop app
  the line is `Budget left: 850K`.

## The Switch that read as a failure (0.9.13)

- **Seen live:** Switch ran `/model claude-opus-5-5` and `/effort high`
  and the session did switch, but the app's model menu still showed
  "Fable 5.2 High", and the module reads effort from `CLAUDE_EFFORT`,
  fixed at the session's start: the row would have offered the switch
  again.
- **Noted:** the module observes `command.run` for `model` and `effort`
  (the button's and the person's), lets them through, and keeps what one
  set that answered without an error in `$.store` under `switch:<session
  id>`. The effort stands for the session; the model until the next
  turn's usage names one. An alias (`/model opus`) is kept as the id the
  session reports, where that agrees.
- **After a press:** a read-back of `$.session.model()` that disagrees is
  read again after 2 s; a `/model` that answered without an error is
  trusted over it. The toast: `🔁 this session now runs on Opus 5.5 high;
  the model menu may still show Fable 5.2.` (the second clause only when
  the model changed).
- **Not checked live:** whether the module's own `$.command.run` passes
  through its own `command.run` hooks (the press notes what it set
  itself either way), and what an error from `/model` looks like
  (`exitCode` not 0 or `isError` is taken as one).

## The self-check and the savings as commands, what a task spent (0.9.13)

- **`/pacing-doctor`** runs `doctor.mjs` by `$.process.run` (it exits 1
  on a failed check, where `scriptOut` gives nothing) and shows its lines
  in a code block, for the person alone.
- **`/pacing-saved`** runs `saved.mjs --session <the session's model>`
  (`--detail` for `/pacing-saved detail`, its table in a code block);
  `saved.mjs` counts every project's records by default, as the weekly
  meter does, and `--project` narrows to one.
- **What a task spent:** the module passes the run's own usage, its
  requests summed, as `config.mjs agent ... --spent <in>,<out>,<read>,<write>`;
  the record keeps `spent`, which `saved.mjs` prices exactly. The record's
  `tokens` stays the agent's size at its last request.
- **`/pacing-status`** is for the person alone too (`isTextDisplayOnly`).

## The Reload row at once, nothing by itself (0.9.14)

- **Seen live:** the reload by itself never worked (0.9.11 to 0.9.12 and
  0.9.12 to 0.9.13): `$.command.run({ command: 'reload-plugins' })` from a
  timer neither resolved nor rejected, so nothing showed for the 10
  minutes RELOAD_GIVE_UP waited. Typed over a remote connection, the
  command answered `/reload-plugins isn't available over a remote
  connection in this session.`
- **The row at once.** The first look that sees another version (after a
  turn ends or on the 5-minute timer), in a session a person has typed in,
  shows `📦 Pacing <version> is installed.` with Reload and Not now. The
  attempt by itself is gone, and with it RELOAD_GIVE_UP and what only it
  read: the turn flag (and its `turn.start` hook), the survey flag and
  `rl.free`. The band still hides the row during a turn and under a survey.
- **Reload** races the command against RELOAD_WAIT (3 s). `/remote/i` in
  the answer's text or the error's message: `📦 Reload from the computer:
  /reload-plugins does not run over a remote connection.`, and the row
  again. Any other error (thrown, or `exitCode` not 0) or no answer:
  `/reload-plugins` in the prompt box and `📦 Press Enter to reload.`, the
  store mark kept for the reload that Enter runs. Ran: the settle look as
  before. One attempt at a time (`rl.pressed`).
- **`/pacing reload off`** (`autoReload: false`): no row; one toast per
  version, `📦 Pacing <version> is installed: type /reload-plugins to load
  it.`
- **The kit:** a `command.run` answer keeps only `text`, `exitCode` and
  `isTextDisplayOnly`, and a hook that throws reaches the module as "no
  implementation for command.run" with its message lost. So the remote
  refusal is tested in the answer (with and without `exitCode`), and as a
  thrown error only through `remoteRefused`.
- **Not checked live:** whether a button's press gets an answer from the
  command where the timer got none, the form the remote refusal takes for
  a module (an answer or an error), and whether `$.prompt.fill` reaches the
  box over a remote connection.

## Budget tokens, the usage always whole (0.9.15)

- **Seen live:** in the desktop app (0.9.13) the status line read only
  `Budget left: 850K`: LINE_MAX_NARROW (34) left no room for the usage.
  The user's screenshot showed the footer of a normal window has room for
  about 65 to 70 characters; the cut seen at about 35 was a narrow window.
- **The words.** `Budget left:` becomes `Budget tokens:` wherever the
  token figure shows (`Budget tokens: 850K`, `1.2M`, `-120K`, `0K`), in
  the status line and `/pacing-status`. Before a rate is learned the figure
  is points and reads `Budget: 5%`; with no figure `Budget: -`.
- **The width.** LINE_MAX_NARROW is 70 (LINE_MAX stays 75). The budget and
  the usage (`usage: Weekly 33% Fable 53%`, no per-model figure in a side
  session) always show whole and are never dropped. The agents' part takes
  what is left: `⏳ 2 Subagents running`, `⏳ 2 Subagents`, `⏳2`; where even
  `⏳2` does not fit it shows all the same and the line runs past the
  limit. A side session's `sub` still goes first only where it costs the
  agents' part no word.
- **Desktop, as drawn:** `Budget tokens: 850K · usage: Weekly 33% Fable
  53%`; `⏳ 1 Subagent · Budget tokens: 850K · usage: Weekly 33% Fable 53%`;
  `⏳ 2 Subagents · Budget tokens: -120K · usage: Weekly 33% Fable 53%`.

## Budget tokens in full-price tokens, a new version as words only, progress before time (0.9.16)

- **Seen live:** the status line's `Budget tokens` swung from 16.8M to
  125.1M within an hour. The module summed raw tokens (input, output,
  cache read, cache write) and budget.mjs learned raw tokens per point of
  the weekly meter. Most raw tokens are cache reads, which cost about a
  tenth of an input token, and a long session re-reads about 400K of them
  each turn, so the raw count tracked the meter (which weighs cost) poorly.
- **The rate in dollars.** readings.mjs `spentUsd` prices every usage it
  counts (the session's turns and its subagents', per model id) at the
  prices budget.mjs's JSON carries: input, output, cache read and cache
  write each at its own rate. A model the prices do not know counts at the
  session model's prices; with neither priced it is left out. The whole
  session is priced again at each turn, so a turn before the first reading
  (no prices yet) goes with the next one. The difference since the last
  reading that ran goes as `--spent-usd`, marked sent only on success.
- **rate.json v2.** `{ v: 2, reset, from, to, usd, carried }`; a file
  without `v: 2` (raw tokens per point, 0.9.15 and before) is an empty one,
  and `--spent` from an older module copy is taken and ignored. The rule is
  the same: this week's rate from a 5-point rise, else the carried one,
  else this week's from 2 points, now in dollars per point. The JSON says
  `usdPerPoint` (4 decimals) in place of `tokensPerPoint`.
- **Full-price tokens.** `left.tokens` = points left × dollars per point ÷
  the session model's input price per token (`--session`, else tier 1 of
  the ladder). Example, one turn on Opus 5.5 with 400K cache read, 5K input
  and 2K output: 407K raw tokens; $0.08 + $0.02 + $0.04 = $0.14; at $4 per
  million input that is 35K full-price tokens. The status line keeps its
  words (`Budget tokens: 850K`, `Budget: 5%` before a rate).
- **saved.mjs and the self-check** read the v2 file: points saved are the
  dollars saved ÷ dollars per point; doctor says `learned, $0.0123 per
  point, from 6 points this week` (two decimals from $1 up), and an older
  file `not learned yet (an older rate was dropped)`.
- **A new version, as words only.** Live, a Reload press filled the prompt
  and the typed `/reload-plugins` answered "/reload-plugins isn't available
  over a remote connection in this session." every time. So the row has no
  Reload button: `📦 Pacing 0.9.16 is installed: type /reload-plugins to
  load it, or open a new session.` and Not now. The plugin runs no command
  and fills no prompt; the press path (RELOAD_WAIT, the remote toast,
  `fillReload`, the settle look) and the store mark with its "🔄 updated to
  … and reloaded." toast are gone. `/pacing reload off`: no row, one toast
  per version with the same words. Doctor's fix for a newer copy: `type
  /reload-plugins or open a new session`.
- **Progress before time.** In the toasts, the row above the prompt and
  `/pacing-status` an agent reads `implementer "task", editing step 2 of
  4, 12m, about 5m left` (with an estimate, `editing ~60%, 12m`); without
  progress, `editing 12m` as before. What gives way first is unchanged.
  The user-visible `part 2 of 4` is now `step 2 of 4`; the command stays
  `config.mjs part <done> <total>`.
