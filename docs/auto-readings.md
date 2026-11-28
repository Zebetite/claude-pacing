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

## An estimate before the rate is learned, Switch runs /model (0.9.17)

- **Seen live:** after the reload to 0.9.16 the status line read
  `Budget: 22%` for hours: rate.json started afresh at weekly 38 % with
  $0, and the first rate needs a 2-point rise.
- **The estimate.** estimate.mjs prices this week's local transcripts
  (`~/.claude/projects/**/*.jsonl`, subagents' included; each message id
  once; lines outside reset − 7 days … now left out) at the same four
  prices as readings.mjs `spentUsd`. Live: $249 over 2,399 responses in
  34 files, 2.4 s, $6.56 per point at 38 points.
- **When.** Only while no rate is learned (this week's 5 points, the
  carried one, this week's 2 points), from 2 points on the meter, at most
  once an hour; `--dry` uses a stored one only. rate.json keeps it as
  `estimate: { usd, points, at }`; a new week starts without it.
- **The words.** The JSON says `rateFrom` (`week`, `carried`, `early`,
  `estimate`); the status line marks an estimate `~`
  (`Budget tokens: ~36M`), and drops the mark once a rate is learned.
  Doctor: `estimated, $6.5632 per point, from this week's transcripts;
  learning it: 1 point so far`. saved.mjs uses the estimate the same way.
- **Errs low.** Use on another device or the web raises the meter without
  being in these files, so a point looks cheaper and less shows left.
- **Switch runs /model.** Seen live: a row offering another model ran
  `/effort` alone. The offer went by the last turn's own model, the press
  by `$.session.model()`, which already named the target while the turns
  ran on another. The offer now carries `from` (the model it saw) and the
  press goes by it: `/model` whenever the offer was for another model,
  then `/effort`.
- **Compact now says why.** Seen live: a press with no turn running was
  told `a compaction cannot start while a turn runs`: every rejection of
  `$.session.compact` got those words. Now the toast gives the engine's own
  reason (`❌ the compaction did not start: <reason>. /compact is in the
  box: press Enter to send it.`) and the box holds `/compact`.

## Compact now runs /compact in the desktop app (0.9.18)

- **Seen live (0.9.17):** the toast gave the engine's reason: `$.session.compact:
  not available in a headless (-p / SDK) session yet: compaction here runs
  inside a turn`. The desktop app runs Claude Code as an SDK session, so the
  direct call never works there, while a typed `/compact` does.
- **Now:** a refused `$.session.compact` is followed by `/compact` run as if
  typed (`$.command.run`, with the compaction instructions), toast
  `🗜️ compacting: /compact runs as soon as the session is free.` Only where
  that fails too does the toast give the reason and the box hold
  `/compact`. A reason that starts with the plugin's name loses it.

## One budget figure in every session (0.9.19)

- **Seen live:** two sessions side by side showed `Budget tokens: 28.9M`
  and `10.4M`. Three causes: each priced the dollars left at its own
  model's input price (a session on Fable 5.2 at $8 a million shows half
  the tokens of one on Opus 5.5 at $4); each kept the figure of its own
  last reading; and the rate learned from a 2-point rise swung while the
  sessions' spending caught up after a reload.
- **One unit.** `left.tokens` = points left × dollars per point ÷ the
  input price of tier 1 on the configured ladder (of the ladder in force
  when none is configured), whatever model the session runs.
- **The newest shared reading.** budget.mjs writes a reading's
  account-wide part to `line.json` (`t`, `all`, `line`, `ofBudget`,
  `usdPerPoint`, `rateFrom`, `left`, `premium`, `premiumAt`,
  `premiumOut`); an older reading never replaces a newer one and a dry one
  writes none. The JSON carries `t` too. Every minute (`SHARED_EVERY`)
  each session takes it in where it is newer than the reading it holds
  and redraws its status line; one without the per-model figure leaves
  the one held. The level, its toasts and the switch offers stay with the
  session's own readings.
- **A steadier rate.** The order is now this week's from 5 points, the
  carried one, the transcript estimate, and only then this week's from
  2 points (where no estimate can be had). doctor.mjs and saved.mjs follow
  the same order.

## Switch always runs /model, then /effort (0.9.20)

- **Seen live (0.9.19):** a press of Switch ran `/effort medium` alone; the
  turns went on running on Fable 5.2. The press ran `/model` only where the
  model the offer saw differed from the target, and the module's idea of
  the session's model (the last set, else the last turn's usage) had
  named the target.
- **Now:** every press runs `/model <target>` and then `/effort <target>`,
  whatever the module takes the session to run on. `/model` to the model
  the session already runs on does no harm, and `/effort` runs after it
  in case `/model` reset the effort. A failed run still fills the box with
  `/model <target>`.

## Budget tokens follows the spending (0.9.21)

- **Seen live:** "Budget tokens rarely change." The weekly meter moves in
  whole points, about $6.50 of use each (some 800K tokens at Fable 5.2's
  price), and the figure was points left × the rate: it stood still
  between two points, and readings came only on a point or every 30 min.
- **budget.mjs** takes off what every local session spent since the meter
  last moved, from their transcripts (`weekSpend` from the first logged
  reading at today's figure after one below it; a move is always logged),
  never more than one point's dollars, and not on a dry reading. It is in
  `left.sinceUsd` where above nothing; the reading and line.json carry
  `tokenUsd`, the dollars of one full-price token.
- **The status line**, between readings, takes off what this session spent
  since its reading came in (own or shared), at `tokenUsd` (`liveLeft`):
  the figure falls with each turn. The next reading starts over from
  budget.mjs's figure, which counts those turns too.
- **Readings every 10 minutes** while turns run (`MIN_GAP`, was 30), so the
  other sessions follow within minutes through line.json. The log still
  grows only on a move, a change of level or flag, or 30 minutes.

## Budget in time, room left over, a switch that knows its cost (0.9.21)

- **Budget in time.** A token count priced at tier 1's rate says little;
  the status line now shows the time what is left lasts: `Budget: 2h 10m
  left`, past the line `Budget: 40m over`, `~` before an estimated rate.
  budget.mjs learns the pace in the pass that counts the spending since
  the meter moved (`weekSpend`'s `marks`): the last hour's dollars over
  the time since the first response in it, where that is $0.50 over 15
  minutes or more, half and half with the pace held when that is under 6
  hours old. It is kept in rate.json's `pace` ({ usd, at }), into a new
  week too, and sent as `paceUsd` (in line.json as well). The module turns
  `left.tokens` into hours (`tokens × tokenUsd ÷ paceUsd`), after the
  session's own turns came off (`liveLeft`); `timeText` rounds to 5
  minutes under an hour, 10 from there, whole hours from 10, `24h+` past
  a day. No pace: `Budget tokens: 850K` as before. `/pacing-status`:
  `Budget: 2h 10m left (850K tokens, at $3.40 an hour)`.
- **Room left over.** At "ahead", where the trend (20 h or more of it)
  projects 10 points or more under 100 % at the reset, budget.mjs says
  `unused: at this pace about 18 % of the week goes unused at the reset,
  and it does not carry over: ...` (in `last --brief` too, for the route
  skill) and sends `unused` and `reset`. The module shows one toast per
  week and step of 10 points, `💡 at this pace about 18% of the week goes
  unused at the reset, ...`, across sessions by `$.store`'s `unused`, and
  a line in `/pacing-status`.
- **A switch that knows its cost.** Each model has its own cache: after a
  switch the next turn stores the whole session again at the new model's
  cache-write price (400K tokens to Opus 5.5: $2, a third of a point),
  and with cache reads at the same price on Fable 5.2 and Opus 5.5 that
  is paid back by output alone. From `SWITCH_LARGE` (200 000 tokens at the
  last measure) an offer that changes the model adds `A switch stores
  this session's 400k tokens again (about 20m of the budget): compact
  first.` (`costText`: time with a pace, else tokens, else nothing) and
  the row gains **Compact, then switch** (`pacing-compact-switch`): the
  compaction as Compact now runs it ($.session.compact, else `/compact`
  as if typed), then `/model` and `/effort`; a compaction that does not
  start fills `/compact` and leaves the model alone. Not where the model
  is out, nor for an effort alone.

## A press never waits for its command (0.9.22)

Live, in the desktop app: Compact now ran `/compact` (71 s for 310 000
tokens), Switch was pressed while it ran, and all that came was `pacing:
ui.press hook skipped: ran past its 10s budget`; no `/model` ever ran.
A press hook that has waited 10 s is dropped, and the command it queued
goes with it. `$.command.run` resolves when the command has run, not when
it is queued: `/compact` takes a minute by itself, and a `/model` queued
behind a turn or a compaction waits as long.

- **The press returns at once.** Compact now, Switch and Compact, then
  switch hide their row and hand their work to `later($, work)`: a
  `$.clock.after(0, ...)` timer, which no dispatch waits on (run directly
  where the engine has no timers). The work is what it was: `/model`, then
  `/effort`, the read-back and its toast; `$.session.compact`, else
  `/compact` as if typed (`typedCompact`), else `/compact` in the box.
- **A toast while it waits.** A queued command that has not run after
  `RUN_WAIT` (1.5 s) means the session is busy: `🔁 the switch to Opus 5.5
  high runs as soon as the session is free.` (`switchWaitText`), `🗜️
  compacting: /compact runs as soon as the session is free.`
  (`COMPACT_WAIT_TEXT`, before 0.9.22 shown only after the compaction had
  ended). A command that runs at once says nothing of waiting.
- **When it has run.** The switch toasts as before; a typed compaction
  ends with `🗜️ compacted.` (the sizes are known only to the direct call).

## Large results, a compaction pacing did not hear (0.9.23)

- **Large results flagged.** A tool result in the main thread of
  `BULKY_TOKENS` (10 000) tokens or more, estimated from the text the
  model reads at 4 characters a token, stays in the session: every later
  turn sends it again, and the compaction comes nearer. One toast per
  `BULKY_EVERY` (15 minutes) names the tool and the size, `🧱 that Read
  result was about 12k tokens; every later turn sends it again. Bulky
  reads cost less in the reader agent.`, and `/pacing-status` adds `Large
  results: 3 this session, about 62k tokens ...`. Subagents' results and
  an Agent call's answer are left out: the first never reach the session,
  the second is the delegation itself.
- **A compaction pacing did not hear.** Live, another plugin's
  `session.compact` hook runs first and skips pacing's, so a `/compact`
  the person types went unseen and the compaction row stood at the old
  size. Now a measure whose context is half or less of the last one, and
  50 000 tokens or more smaller (`compactedBetween`, `COMPACT_DROP`),
  starts the offers over as a heard compaction does: the row and the idle
  timers go, and a switch row that said "compact first" is offered again
  at the next turn's end at the new size. A `/clear` counts the same.
- **Releases in one command.** `scripts/release.mjs`: `test` runs the
  node tests, the kit tests and the strict validation at once and
  remembers the files they passed on; `release <version> --message <f>
  --notes <f>` bumps plugin.json, skips the checks when they passed on the
  same files, refuses CRLF in a file that was LF, commits, rebases on
  GitHub if it moved, pushes, tags and creates the GitHub release with the
  earlier changelog; `--dry` stops before the commit.

## What fills the context, and a pane (0.9.24)

- **The breakdown.** `$.session.usage({ breakdown: 'summary' })` gives
  the window by category as /context does, estimated locally (no
  request). Its Messages row does not say what in the conversation is
  large, so the module counts the main thread's tool results itself
  (`noteResult`: by tool, and the `RESULTS_TOP` five largest with
  `whatOf`: a file's name, a command's start), from the last compaction,
  heard or seen (`forget`), or the last load. The module's own calls
  (the usage tool, the sessions list) are left out. `contextLines`
  joins the two: the total against the window and the compaction point,
  Messages split into tool results and the rest, the fixed parts largest
  first (told apart by `kind`; Messages is found by its name, the only
  mark the engine gives it), the largest results. `/pacing-status` ends
  with them.
- **The pane.** `/pacing-pane` opens `PANE_ID` (`pacing`) with
  `$.ui.open`; a `ui.render` hook on `{ component: 'Pane', requestId:
  'pacing' }` draws /pacing-status's long form a row each (the first in
  bold with the level's icon), what to do, what goes unused, then the
  context lines and the large-results count, and a **Refresh** button
  (`later`, as every press). It redraws with the band (`redraw`), and
  the main thread's turn end measures the context again when
  `$.ui.panes()` has it open. A pane the engine does not place:
  `Pacing pane: not shown (<reason>).`

## A switch runs only what differs (0.9.25)

The user found a switch too many commands. Switch ran `/model` and
`/effort` on every press (0.9.20), because what the module took for the
session's model had been wrong. Now it keeps `here`, what the session runs
on by the latest of two facts: the model and effort the main thread's last
request carried (a `turn.step` hook, an async generator that only reads
`e.model` and `e.effort` and forwards the stream), and a `/model` or
`/effort` that ran since, pressed or typed. A press runs `/model` only
where the model differs and `/effort` only where the effort does; with
neither known to differ (nothing recorded yet), `/model` all the same. A
typed `/model` keeps the session's effort: in the engine the command sets
`mainLoopModel` alone (only the model picker sets `sessionEffort` too).
So a change of effort alone is one `/effort`, a change of model at the
same effort one `/model`, and Compact, then switch is two commands where
it was three. Before the session's first request, both run as before.

## The row says what the session runs on (0.9.26)

The user saw the row offer Fable 5.2 high while the app's model menu said
Fable 5.2 High, and took it for an offer of what was already set. The
session ran on Opus 5.5: a Switch had run `/model claude-opus-5-5`, which
changes the session but not the menu, and every request since carried
Opus 5.5. The offer was right; it only did not say what it saw. Now a
model offer names it first: `🔁 This session runs on Opus 5.5 high; this
week's budget suggests Fable 5.2 high.` (the model alone where the effort
is not known). The model and effort it names, and goes by, are the main
thread's last request's (`here`) before what was noted from a command or
`CLAUDE_EFFORT`, which stays at the effort the session started with.

## The pane redrawn as a console, and open by itself (0.9.27)

The user found the pane's rows of text bad to read and asked for graphics
in the manner of a film's head-up display, then of a ship's console.

- **Where it is drawn.** `pane.mjs`, a pure file `readings.mjs` imports:
  `paneView(table, model, { surface, placement, onRefresh })` returns the
  tree, and `readings.mjs` builds the model (`paneModel`). The drawings are
  `Svg` elements, which the desktop app, VS Code and mobile have; the
  terminal has none (its table may carry an `Svg` that draws nothing, so
  the view goes by `surface`) and gets the same figures as block
  characters. A minimized pane (`placement: 'widget'`) is the budget and
  the week's bar. An Svg cannot see the theme: its colours are fixed and
  every figure the person must read is a `Text` beside it, save the
  percentage inside the dial.
- **What the user chose, in order.** The reactor of four dials offered
  (`DIALS`; ring, gauge, reactor, level), redrawn flat and thin-lined, no
  glow. No "Now" box, no largest results, the context as one figure (all
  three stay in `/pacing-status`). The budget as time left today in plain
  words, never tokens or dollars. A colour run along the bars (`SWEEPS`)
  and an accent a section (`ACCENTS`). A drawn edge above and below the
  pane (`edgeSvg`) and, for each section, a frame of its own above and
  below with a light tint behind (`frameSvg`): the user disliked plain
  boxes. Agents as small animated robots (`robotSvg`). The order: week,
  agents, context, models.
- **Open by itself.** At `session.start` the module opens the pane unless
  `$.store` holds `paneClosed`, set when a person closes it (`ui.close`,
  origin `person`) and cleared by `/pacing-pane`. The agents panel of
  before it was removed in 0.9.13 at the user's word (see above); this one is
  the user's own ask.
- **Refresh** takes a reading of every meter as well as the context, so the
  per-model meter need not wait for a turn's end.
- **Not seen by the tests.** How the app spaces an Svg against a tinted
  Box, and whether SMIL animation runs in the pane: the user looked at a
  preview mod with sample figures while it was drawn.

## With the pane on show, fewer agent toasts (0.9.28)

The user's word: with the pane open the toasts are not needed. Asked which,
they chose the agent toasts. While the pacing pane is on show in full
(`paneShown`: listed by `$.ui.panes()` as shown and placed, and not drawn
as a widget), the started toast (an agent's and a side session's) and the
5-minute still-running toast are not raised: "Agents at work" says both.
The done toast stays, as the pane only lists what runs, and so do the
toasts about the level. Behind another tab, waiting undrawn or minimized,
the pane lists nothing and the toasts are as before.

## A hold on the per-model meter stays for the day (0.9.28)

The user's word: the Switch row sent the session off Fable and back too
often. The log of one day showed the hold (`premiumHeld`) come and go
seven times with the meter's figure barely moving: the meter's level
follows its trend, which swings between readings, and a session that has
left the model lets the trend fall, so the hold released and the session
was offered Fable again, used it, and was held again. Now `budget.mjs`
keeps a hold: a model held at the last logged reading stays held for the
rest of the day the hold began (`premiumHeldLine`, that day's budget
line, carried in the log) and after the line steps until its meter is
`HOLD_RELEASE` (5) points or more under the line by its figure alone.
That is two switches a day at most. The reading says so: "Fable 5.2 stays
held for now". Not changed: the calm offer of one step less effort at
"over", which still follows the level.

## Offers to compact come rarer (0.9.29)

The user's word: compacting comes up very often and is annoying. A
session of 300 000 tokens or more got the row at 300 000 and at every
further 100 000, and a warning row or toast at every pause of 50 minutes
or more, and a working day has several of those. Now `OFFER_STEP` is
250 000: between two compactions the size is offered at 300 000, 500 000
and 750 000. A pause is told once per such step too (`pauseDue`): the
row before the lapse and after it in one pause count as one, the notice
at the next prompt is the same telling, and the next pause is told only
when the session has grown by 250 000 tokens since. A compaction starts
all of it over, as before. Not changed: the sizes the levels start at,
the words, `/pacing compact off`, and what the session itself says of
its context in a reading.

## The pane opens with fresh figures, and a hold is not called "over" (0.9.30)

The user's word: when the pane opens it could refresh its data. Its first
draw since it opened (`paneDrawn`, reset when it closes) does what
Refresh does: the context at once, then a reading of every meter. A
reading under `PANE_FRESH` (a minute) old stands, so a session's start
does not take two. Later draws take nothing.

The user asked why the pane said "Over the budget line" with the week at
55 % of a 73 % line: Fable's own meter was at 83 % and Fable was held,
and the pane drew a hold as "over" without naming the meter. With the
week within its line and the model held by its own meter, the words are
now "Week within budget; Fable 5.2 held, its meter 10 points over the
line". The budget's words are "left to use today to stay on budget"
(were "and stay on budget"), the user's wording.

The user's word, next: do not mix the weekly meter and Fable's in the top
area. The top area (the dial, the time left, the level's words and
colour) is now the week alone: `budget.mjs` hands the module `weekLevel`,
the weekly meter's level before the per-model meter's, and the "held"
words above are gone from it. The per-model meter shows its state under
its own bar instead: its budget line is drawn loud (a thick amber line
with a `BUDGET 73%` tag and an arrow under it), and past the line the line and tag turn red and
pulse, the tag says `OVER +10`, the cells over the line turn red on a red
band, and the words under the bar say "10 points over its budget line
73%: held, kept for hard tasks" in bold red. A terminal draws the line as
┃. On the dial the week's budget line is white with a dark edge (the
user's word: a colour of its own, not the ring's), and on the bars the
line's tick is now a rect: a glow filter on a zero-wide line drew
nothing, so the weekly bar's tick had been missing. Both bars' arrows are larger, edged dark.

## Reloaded in one session, the row goes in the others (0.9.31)

The user's word: a reload in one window left the new-version row open in
the other sessions. `/reload-plugins` loads the new version in the
session it is typed in alone, and a reload tells a module nothing of
itself. So each copy notes the version it loaded as under its session id
in the store (`version:<id>`); a copy that finds an older version there
was loaded by a reload, and writes the version to `reloadedTo`
(`RELOADED`). Every other copy, at its next look (5 minutes, or 2
seconds after a turn), drops the row for that version, or does not raise
it. A new session notes its version and tells nothing. The other sessions
still run the older code until their own reload or a new session.

## The pane after a reload: the reading, not "No reading yet" (0.9.32)

The user's word: after a reload the pane said "No reading yet" and they do
not want it without data. A reload starts the module over with no
reading; the pane, still open, was drawn at once, and the reading the
module takes at load came in after it without a redraw, while the pane's
own first-draw refresh gave up because that reading was running. Now
every reading taken in redraws the pane (at load, a measure's, the shared
one, `/pacing-usage`'s), and the load's ends with a redraw whatever it
found. While the load's reading is on its way (`loading`, or `running`)
the pane says "Reading the meters…" instead of "No reading yet".

The OVER tag on the per-model bar no longer pulses: the user's word, it
drew too much. It stays red.

## Pictures of the pane (0.9.33)

The user's word: demo pictures on GitHub, and on the organization's
plugin page. `scripts/pane-images.mjs` draws the pane with its own code
(`paneView`) and sample figures, laid out as HTML standing in for the
app's Box, Text, Button and Svg, shot with a headless Chrome or Edge and
cut to the pane's height: `docs/images/pane-agents.png` (Fable over its
line, three agents), `pane-within.png` and `pane-week-over.png`. The
library page shows only the manifest's description on its overview and
renders the plugin's README under Innehåll (Contents), so the plugin's
README has a section with the three pictures, linked from GitHub
(raw.githubusercontent.com) rather than shipped, so every install stays
as small as before.

## The pictures shipped in the plugin (0.9.34)

On the library page the README's pictures from raw.githubusercontent.com
showed as "Visa bild" boxes, and a click only offered to open the link in
a new tab: claude.ai loads no images from other sites there. The user
chose to ship them: `pacing/images/pane-*.png` (about 770 KB), linked
relatively from the plugin's README, and `scripts/pane-images.mjs` copies
them there. Whether the page draws images from the plugin's own files is
what this release tries.

## A reactor's glow in the dial, and fewer toasts (0.9.35)

The user's words, in turn: more colour in the meter at the top; less
gradient and more contrast; the gradient only on the bar for the
percentage; the colours round the core not changing with the figure, and
never the bar's own; the figure white with some small marks; and, of the
sketches, the reactor's glow. So in `reactorSvg` the data ring runs the
level's colour run (`SWEEPS`) from the top to the figure, with a glow;
the brackets, the inner ring and the core are in `FRAME`, greens that no
run takes, the same at every level; the figure and the inner ring's
square nodes are white (`FIGURE`); the core is a white heart fading out
through green, ten angled cells and a thin white rim, with a strip of
twelve cells under the figure lit by the week. `pacing/images` and
`docs/images` are drawn again with it.

The user's word, too: too many boxes popping up. While the pacing pane is
on show the toasts that an agent or a side session is done stay away, as
those that one started or still runs already did: the pane lists them,
and an agent's answer comes in the chat. With the pane hidden they come
as before.

## Fable's line like the week's while under it (0.9.36)

The user's words, in turn: Fable's budget line need not be orange while
under it, grey or white; then, make it like the weekly one. So `barSvg`
draws a `loud` bar loudly only past its line: under it the bar is the
week's own, a white tick with an arrow and no tag, and the words under it
are plain like the week's. Past the line nothing changed: the thick red
line, the `OVER +N` tag, the red cells and band, the red words.

## No "runs as soon as" toast for a compaction that starts at once (0.9.37)

The user's word: the message that the compaction soon runs need not show
when it starts right away. Compact now runs `/compact` as if typed
(`$.command.run`), which answers only once the compaction is over, a
minute on; the toast for a queued command came after `RUN_WAIT` (1.5 s)
without an answer, so it came every time. Now the module's hook on
`session.compact` calls the toast off as the session's compaction starts
(`compactWaited`), and the toast waits `COMPACT_RUN_WAIT` (4 s): it shows
only while the session is busy and the command really waits. The switch's
toast is as it was. Not tried live.

## The review's defects, and quieter offers (0.9.38)

Three readers went over the plugin (the hooks module, the scripts, what a
person reads) and their findings were checked against the code. What was
fixed:

**One reading at a time, in one place.** "Take a reading and apply it" was
written out five times in `readings.mjs` (the load, a measure, an agent's
end, the pane's Refresh, `/pacing-usage`), each setting and clearing the
`running` flag by hand; the copies had drifted, and a measure's `finally`
cleared a flag another reading had set, so two could run at once and hand
`budget.mjs` the same dollars twice. Now `takeReading($, rd, …)` sets and
clears `rd.running` alone, and the four plain copies call it. The load
keeps its own way (a dry run where nothing can be logged) and a measure
that comes while it is in flight waits for it (`rd.loadFlight`), then
decides.

**Readings that fail are said.** A failed run of `budget.mjs` left the
status line as it was, with no sign. `rd.health` counts failures in a row
(an exit code, a timeout, an answer that does not parse); at `FAIL_SAY`
(3) the line leads with `⚠️ old figures`, the pane's first note says so,
and one toast names `/pacing-doctor` with the script's last line. A
reading that comes clears it. A reset that has passed (below) is not
counted: the engine holds the last response's windows, so that is what it
names between the weekly reset and the next response.

**A /clear or a resume starts over.** No `session.start` fires for one;
the process goes on under a new session id. The module now hooks
`session.end`: for `clear` and `resume` the conversation's memory (its
size, the pause, the offers, the switch seen, each model's tokens) starts
over, and what is kept in the store under the session's id is written
again at the next prompt. For every ending the session's own keys
(`version:`, `switch:`, `agents:`) are deleted, and once a day at a load
the `version:` keys other sessions left under older versions go too
(`pruneKeys`): the store had gained one per session for good.

**Smaller ones in the module.** Someone having typed stays so
(`attended`): a notification's prompt turned it off, and the row before
the cache lapses never came for the hour away it was made for. A
compaction keeps the side sessions in the line (they are not in the
engine's list, and the next poll announced each again). The "done"
toast's count is the agent's size where the refresh saw one, not the
run's usage summed. The side sessions' first poll is asked again once the
load's reading has named the session.

**The scripts** (an implementer agent; 21 new node tests). `withLock`
checks its wait and sleeps on every round, and a folder that refuses the
lock file is an error after ten tries (it spun at full CPU for good);
a stale lock is taken over by a rename, and the wait (15 s) outlasts the
stale age (10 s). The `state.json` write is in a try like the others. A
reading whose `--reset` has passed or lies over 7 days ahead is refused
before anything is drawn, logged or set (it drew a 100 % or a 0 % line
and moved the settings by it). The pass over the transcripts at every
automatic reading goes on from a checkpoint per file (`scan.json`)
instead of reading each whole: about a second down to 45 ms here.
`apply` keeps `--project` and `--replace`; `init` copies a legacy file
only where none is; `config.mjs` no longer writes a repaired config back
from commands that only read or record; `log -5`, `week -1` and an
unknown command are answered in words.

**The user's words, too.** The offers to compact start at 400 000 tokens
and urge from 650 000 (they were 300 000 and 500 000: "seems early and
will message people very fast"), in the module, `budget.mjs`'s context
line, the route skill and the guide; the notice after a pause stays at
300 000. The toast after a large tool result is gone ("don't need
messages about tokens used"); `/pacing-status` still counts them.

Not done: the model price table (its cache-read prices are 2.5 %, 5 % and
10 % of input by model, not checked against the price list),
`CLAUDE_CONFIG_DIR` and the app's preset per account, splitting
`budget.mjs`, the docs' first screen. Not tried live: a /clear, a failing
reading, and the notification case.

## The docs' first screen (0.9.39)

From the review: a newcomer could not tell in a minute what the plugin is
for, whom it is for, or what happens after install; the opening stood in
four places in odd English ("custom set"), and the write to
`~/.claude/settings.json` sat in a table further down. Now one opening
paragraph stands on the GitHub front page, in the plugin's README and at
the top of the guide (the short help takes its first three sentences);
under it, who it is for, that it needs Node.js 18, and what shows after
installing, with the two settings written and `/pacing next off`. The
pane's pictures lead the front page, the guide has a short word table
near its top, and the plugin's description is new (the same in the
marketplace entry, which `release.mjs` now commits: `.claude-plugin` was
not in its `git add`). "Meter is full" reads "used up": a newcomer took
"full" for room left. Still as it was: the rest of the guide's order, the
rules said twice across the skill and agent files, the other front-page
bullets.

## Colours by how far over, and the 5-hour window in the pane (0.9.40)

The user's word: a figure a point or two over its line need not shout.
A text (the time left today, the level's words, a meter's figure, the
per-model meter's words) keeps its normal colour up to 5 points over its
budget line; from there it runs yellow, orange, red, red by 30 points
over (`pane.mjs` OVER_CALM, OVER_RED, overShade). The week nearly used
(95 % or more) stays red. A bar keeps its normal colours up to its line;
each cell past it runs yellow, orange, red by how far past the line it
stands, and the dial's ring and strip do the same. The per-model meter's
`OVER +N` tag, its line and band take the shade of how far over it is,
no longer red at one point over.

Under the per-model meter the pane now has the 5-hour window, a bar with
no line: when it resets, when it would be full first at this pace, and
from 85 % that heavy work waits for the reset. `budget.mjs` gives the
hooks module `five`, `fiveReset` and `fiveFull` for it.

The same release has the rest of the review's items: the pane's
background tasks, a click on an agent opening its transcript, the dial
that no longer jumps at a redraw, the Compact button in the Context
section from 300 000 tokens, `CLAUDE_CONFIG_DIR` followed, and the
guide's account of agents running in parallel.

Pacing now sets where Claude Code compacts a session by itself. The user
wants 750 000 tokens. `config.json` keeps it as `autoCompact`: a token
count from 100k to 1M, `auto` (Claude Code's own) or `off` (left alone);
`/pacing autocompact` sets it. At a session's start, after a `/model`
and at a main turn's end when the model or the setting changed, the
hooks module reads the context breakdown (`autocompactSource`,
`rawMaxTokens`) and runs `/autocompact` only where Claude Code has
another value. Claude Code keeps the value per model, which is why a
model change checks again. A window set by
`CLAUDE_CODE_AUTO_COMPACT_WINDOW` wins over the settings, so it is left
as it is. A success says nothing; a failure is one toast per load. The
pane's Context section shows the value, with − and + (50k a step) and
Auto; a press saves it through `config.mjs` and runs `/autocompact`.

Fewer messages, and no switch steps but rarely (the user's words: do not
suggest lowering the effort for being a little over; bother the user as
little as possible; model and effort are the plugin's to handle through
subagents, a switch only sometimes). The effort step is gone: no
`effort:` line, no `effortStep`, no Switch row for less effort, and none
for another model or effort than recommended. The Switch row now comes
only while the session runs on Fable and Fable is out, or held 20 points
or more over its line (`HELD_SWITCH_AT`). A level toast comes only when
the level gets worse, to far over budget or to stop, and not where that
row says it already; going just over, coming back under, Fable held or
let back bring none. The toast is short: the change and one step
(`levelToastText`), where it held the whole `do:` line and was cut off.
The room-left-over toast is gone (the pane and `/pacing-status` keep the
note). The session's start line asks for a switch only when Fable is out.

## The tests on GitHub, and handover done on Windows (0.9.41)

The first GitHub run of the tests (0.9.40) failed in three ways. A Node
22 that strips types took the hooks module's kit tests
(`readings.test.ts`), which need Claude Code's test kit; the workflow,
`npm test` and `release.mjs` now run `tests/*.test.mjs` only. On Node 18
`readFileSync` goes through `fs.readSync`, so the estimate test counted
the read of `scan.json` as transcript bytes; it now counts reads on the
transcripts' own file descriptors. And on Windows three sessions filing
the same handover away at once all said "picked up": a rename did not
refuse the later two. `handover done` now claims the file with a hard
link into `done/` (made once, EEXIST for the rest), with a rename where
links are not supported.

## Tidy-ups (0.9.42)

A Switch press after a reload sent a `/effort` the session already had:
the press compared the target with the effort in the module's memory,
which a reload empties. It now goes by that effort or else the one kept
in `$.store` (`ss.effort`), as `effortNow` does. The texts no toast can
show any longer are gone: the level steps for ahead, on pace and over
(a level toast comes only on a rise to throttle or stop) and the unused
toast's `UNUSED_STEP` and `unusedText`, which nothing called. And for a
model whose context window is smaller than the auto-compact setting
(200k against 750k), Claude Code keeps the value set but measures against
the window, so the breakdown never showed the setting and `/autocompact`
ran again at every start. The check now compares with the smaller of the
setting and the model's window (`context.window` of `$.session.usage`),
so once set it finds nothing to do.

## Subagents above the session (0.9.42)

The user wants subagents on a higher model or effort than the session
where the budget has room and the work gains from it. Until now the
`upward:` line came only while Fable was held, or for a session below
tier 1, and never named an effort above the ladder's. Now, while the
weekly meter is ahead or on pace and the per-model meter is too (neither
out nor held), `budget.mjs` names a subagent above the session: the tier
1 model one effort step above the higher of the session's effort (its
tier's) and tier 1's, two steps where the `unused:` line says allowance
would go unused, at most max; none where the session runs there already.
The held line stays as it was. Without room the line for a session below
tier 1 comes only while the week is ahead or on pace; over, at throttle
or at stop nothing goes up. The route skill sends work a stronger model
or more effort does better to the subagent named, with its model and
effort on the Agent call; routine, trivial and bulky work and open-ended
debugging stay down, and the session's own effort is never raised.

## The agents' rows: step bars, model tags, output (0.9.42)

Each agent's row in "Agents at work" now has its model as a small tag,
with ↑ or ↓ where it is stronger or weaker than the session's model (by
the reading's prices; none where they are the same or a price is not
known), and under it a bar: a segment for each step the agent reported
(the ones done lit, the one at work half lit, the rest dark), or with no
steps one thin bar of the time it has run against its estimate
(`leftOf`), or none. The model left the row's words for the tag.

Under the bar, a small dim box shows what the agent is doing or has just
produced (the user's word: show a subagent's output where the pane has
room): its last three lines, each cut at the pane's width. The engine
hands the module what it needs and nothing is read from a transcript:
each step's visible text (the `turn.step` response's `answer`, for a
subagent's loop by `agentId`), each tool call with its result
(`tool.call`, a line such as "Bash npm test → # pass 448", "Read
pane.mjs → 737 lines", "Edit readings.mjs → saved"; the call that says a
step is left out, the bar shows it), and at the end the report it handed
back (`turn.complete`'s `answer`). A finished subagent's row stays
`TASK_DONE_FOR` (a minute) with ✓ done, ✗ failed or ■ stopped and the
first three lines of its report, its markdown marks left out. To keep the
pane calm only the two agents with the newest output show the box. A
press on a row still opens the agent's transcript; it does not fold the
box, since a Button's press gets no `$` to redraw with and the row's
press is taken. The lines live in the module's memory: a reload starts
them empty.

The words beside the dial follow the weekly meter's own points over its
budget line, not the level. Live, the week stood at 23 % against a line
of 20 % at throttle (the trend projected 144 % at the reset, and Fable was
18 over), and the pane said "Far over the budget line" (the user's word:
it is only over by 3). Now on or under the line it says "Within budget",
over by up to 5 points "Over the budget line · +3", past that "Far over
the budget line · +8", and the week nearly used "The week is nearly
used". Their colour keeps its rule (normal up to 5 over); the level, the
routing and the toasts are as they were.

The large-results texts are gone (the user's word: not needed; the plugin
offers compacting when the session is large). `/pacing-status` no longer
says "Large results: ..." or "Largest results: ...", and its Messages row
gives the plain total without the split into tool results by tool. The
counting that fed them (`BULKY_TOKENS`, `tokensOfText`, `toolLabel`,
`bulkyStatus`, `newResults`, `noteResult`, `whatOf`, `RESULTS_TOP`, and
its part of the `tool.call` hook) went with them. The offers to compact at
400k and 650k, the pane's Compact button from 300k and the auto-compact
setting are as they were.

The pane's auto-compact row has a toggle for Claude Code's own
auto-compact in place of its Auto button (the user's word: an enable
button makes it clearer): "☐ Let Claude Code decide" beside the value and
its − and +; pressed, the setting is `auto`, and the row shows only
"☑ Let Claude Code decide" and the dim note "It compacts near the end of
the window." Pressed again, it returns to the last token count the
setting held (kept in `$.store` as `autoCompactLast`, else 750k), saves
it and runs `/autocompact` with it. With `/pacing autocompact off` the
row stays hidden, as before.

A press on an agent's row opens its transcript in the terminal only: live
in the desktop app it gave "the agent's transcript did not open: no main
view here.", so the desktop draws the row as text, and after an engine
deny that says it draws no main view the terminal's rows are text too
until the module loads again.

## Auto-compact off in the pane (0.9.43)

With `/pacing autocompact off` the pane's Context section no longer drops
the auto-compact row: it shows one dim caption line, "Auto-compact: pacing
leaves it alone (/pacing autocompact 750k or auto turns it back on)", with no buttons,
on the desktop and the terminal alike (the user's word: show a dim line
when autocompact is off). The `auto` and token-count rows are as they
were.

## Background tasks wrap (0.9.44)

A background task's description in the pane was cut at the pane's edge
("Wait for pacing 0.9.42 to be insta…", seen live): it now wraps onto
further lines, as the agents' rows do since 0.9.42.

## The auto-compact switch (0.9.44)

The pane's auto-compact rows were too cramped (the user's word, from a
screenshot: "Auto-compact at 750k [−] [+]" with "☐ Let Claude Code
decide" as a button under it). The Context section now shows a row "Use
Claude Auto Compact" with an iPhone-style switch at its right end: a plain
Button holding a Text track, grey (#9ca3af) with the knob left when off,
green (#22c55e) with the knob right when on; the terminal draws it as
"○ off" or "◉ on". While off, "Compact at 750k" with − and + follows on a
row of its own; while on, the dim note "It compacts near the end of the
window." stays under the switch. The rows keep a line of space between
them and above them. The key and the press are as before.

## The agents' rows: a call's description, a kept agent's next task (0.9.44)

Seen live: an implementer's row read its first task ("Dim line for
auto-c…") while it worked on its third, and its output box held three
lines like `Bash cd /x/pacing; F="C:/User…`, cut before any outcome.
A shell call's line now names the call's `description` ("Bash Run all
checks → ok validation, 3 s"), else the command without its leading
`cd <dir> &&`, `cd <dir>;` and `VAR=...;` (`commandWhat`). And a
SendMessage from the main thread with a `summary`, to an agent the module
knows (by the id its spawn answered, or the `name` its Agent call gave),
makes that summary the row's task: at once for a running agent, and for
an idle one when the resumed run's spawn comes. An unknown recipient
changes nothing.

## The switch drawn, at the section's bottom (0.9.44)

The user's words: move the Claude switch to the bottom of the Context
section, and make it look better (a picture of an iPhone switch). The
limit row with − and + now comes first and the switch last. Where Svg
draws, the switch is a picture (`switchSvg`): a pill, blue `#3b82f6` with
the white knob right when on, grey `#4b5563` with it left when off, and a
plain Button with blank text laid over it (`position: 'absolute'`, the
picture's 46 × 26) takes the press, since a Button holds only text. The
terminal keeps `◉ on` / `○ off`; a surface without Svg the text track.

## Fable's own colours (0.9.44)

The user's words: Fable is used more freely than the week, so the pane
should not alert to too much use with strong signs; Fable gets another
gradient, normal to 20% over, then yellow to 40% over, orange to 60% and
red at 80%.

- **A second scale.** `pane.mjs` keeps OVER_CALM 5 and OVER_RED 30
  (`overShade`, `overText`) for the weekly meter, the dial and the level
  words, and adds PREM_CALM 20, PREM_YELLOW 40 and PREM_RED 80
  (`premShade`, `premText`) for the per-model meter, the one with
  `loud`. Both run along OVER_RUN through one helper (`runAt`).
- **The stops.** Up to 20 points over: no colour of the run (`premText`
  is null). Over 20 to 40: YELLOW. 40 to 60: yellow to ORANGE, orange at
  60. 60 to 80: orange to red, `#f43f5e` from 80.
- **Calm means normal.** Up to 20 over the loud bar's cells past the line
  keep the bar's own sweep; the line, its arrow, the `OVER +N` tag and
  the band are drawn in HUD; the figure keeps its sweep colour and the
  note is the plain dim caption without the ▲. From 20 over each takes
  `premText`, the cells by how far past the line each stands, the rest by
  the meter's own points over.
- **Colour only.** Levels, holding, routing, toasts and the Switch row
  are unchanged.

**Agents at work, inside the pane, main tasks, bold bars.** The user's
words: test the agents window so it does not break outside the pane,
the messages show the main point and not all detailed calls; then: not
much text under agents, just main tasks; and progress bars matter more
than text, so make them more visible.

- **Nothing past the pane.** Every Box in the section has `minWidth: 0`
  (the panel, the row, the words' column, the output box, which is also
  `overflow: 'hidden'`). The words wrap, and `breakable(s)` puts a
  zero-width space after / \ . _ ? & = - and every `BREAK_AT` (24)
  letters in a run of more than 24 without a space, so a path, a URL or
  a long word wraps too; the Button's label keeps the plain text and the
  terminal gets none. The model tag and the output lines are cut with an
  ellipsis. Background tasks' text is made breakable as well.
- **A stress picture.** `node scripts/pane-images.mjs --stress <file>`
  draws a 360 px pane of agents with long tasks, tags, paths, URLs and a
  200-letter word on a red ground, so anything that spills shows; the
  README pictures are not touched. The script's HTML Box no longer sets
  `min-width: 0` on every box: it maps `minWidth` and `overflow`, so a
  box that would not give way in the app does not in the picture.
- **Main tasks only.** The box (`meaningOf` in readings.mjs, from
  tool.call) holds at most `OUT_MAIN` (2) lines of at most
  `OUT_MAIN_CHARS` (60), newest first, one per kind: the files changed
  (`changedLine`: "Changing readings.mjs and pane.mjs", the newest two by
  name, "and N more") and the last test, check, build or lint run
  (`runKind` by the call's description, else its command; plain reads
  and listings such as grep, ls, git diff are none; `runLine`: "Tests:
  455 pass", the largest pass count in the output, or "Checks failed: 2
  fail"). Step texts, reads, searches and other commands are not shown;
  with no main task there is no box. A finished run keeps `finishedOut`:
  "Done: " with its report's first clause (a leading "Done." left out),
  then its newest main task ("Changed …"). outLine, actionLine and
  noteOut are no longer drawn (kept, tested).
- **Bold step bars.** `stepsSvg` is twice as tall (`STEPS_H` 24): the
  steps done in the agent's colour, the one at work at 0.55, the rest a
  track in the colour at 0.14 with an edge at 0.45; the time bar is 15
  high on the same track. It stands right under the words, above the
  model tag and the box. The terminal draws it in full blocks in the
  agent's colour (two cells a step up to 12 steps: `████▓▓░░`; the time
  as 24 cells). The step count stays in the row's words.

## Compact at the figure shown (0.9.44)

The pane's "Compact at 750k" was a little high: Claude Code compacts a
buffer short of the window `/autocompact` gives it (a 400k window
compacted at 92 %, near 368k). The user wants the pane's numbers kept as
the point the session compacts at, so pacing now gives `/autocompact` the
figure plus that buffer: 750k runs `/autocompact 783000`. The buffer is
the breakdown's own "Autocompact buffer" row (`autoCompactBuffer`), else
33 000 (`AUTO_COMPACT_BUFFER`); the window is no more than 1M
(`autoCompactWindow`), so 1M and anything within the buffer of it compact
a little sooner. `autoCompactHas` compares the window with the figure
plus the buffer. config.json, `/pacing autocompact` and the pane's − and +
keep the figure itself; a refused run's toast names the command that ran.

## The switch as text, the context against the compact point (0.9.45)

Live in 0.9.44 the switch drew wrong: the desktop draws a Button's label
over its children, so "Use Claude Auto Compact: off" ran past the pane,
and the Svg laid under the Button stretched the row. The switch is now a
Button with no label holding one Text, a track in blue (on) or grey (off)
with its knob, and no Svg or absolute Box. Its caption wraps.

The Context section's figure reads against the point the session
compacts at where a window was set (`autocompactSource` 'settings':
"167k of 400k" under "Compact at 400k"), since pacing now sets the window
a buffer above the figure; with Claude Code's own window it reads
against the window as before.

## The switch drawn again, a blank Button over it (0.9.46)

Live in 0.9.45 the desktop dropped the Text's backgroundColor inside the
Button, so the switch was a white dot. It is the drawn pill again (an Svg,
blue with the knob right when on, grey with it left when off), with a
Button laid over it that has no label (the desktop draws a label over its
children) and six blank characters as its text, both clipped to the pill
(`overflow: 'hidden'`). The text pill stays for a surface without Svg.

The Context section's bar measures against the model's own window again
(the user's word: 1M stays 1M), not the point it compacts at as 0.9.45
had it: `breakdownNow` adds the usage's `context.window` as
`modelWindow`, and the figure reads "198k of 1M" with the auto-compact
window set at 433k. Without it, the breakdown's window as before.

## Tidy-ups (0.9.47)

- **Old output helpers gone.** `actionLine`, `callWhat` and `noteOut`
  (a line per call, the last three) were no longer drawn since the box
  shows main tasks; they and their tests are removed. `outLine`,
  `reportLines`, `commandWhat` and `resultLine` stay: the main tasks use
  them.
- **No guessed ok.** A test, check, build or lint run that did not fail
  says ok only where its output says so (a pass count, "fail 0", ok,
  success, ✓) or is empty, as a linter's success is; output that says
  neither reads "Tests: finished".
- **Zero-width breaks kept.** Long words in the pane's wrapping texts
  carry invisible break points so they wrap; text copied from the pane
  carries them too. Without them a long path or URL runs past the pane,
  so they stay.

## Calm up to 5 over, on the bars and the dial too (0.9.48)

The user's word: keep the weekly colours for the bars and the texts while
the week is up to 5 points over budget, then start yellow. The texts did
so already (`overText`, OVER_CALM 5); the bar's and the dial's cells ran
yellow from the line itself. Now:

- **Cells.** `barSvg` (the week's, not the loud per-model bar, which has
  PREM_CALM) and the reactor's ring and strip shade a cell past the line
  with `overText`, so up to OVER_CALM points past it keeps its own
  colour, and the run starts at yellow after that. A cell is judged by
  where its lit part ends (the figure, for the last, partly lit cell), so
  a week 5 over shows no yellow even where the last cell's middle stands
  past 65 on a line at 60.
- **The dial's colour run.** The ring, gauge and level dials took the
  level's colour, yellow at 'over' from the first point over. They take
  the week's own colour up to 5 points over and the level's past that
  (`dialColor`); 'stop' stays red. The reactor, the default, kept its own
  colour already.
