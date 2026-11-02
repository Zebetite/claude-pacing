---
name: pacing
description: "Pace the Weekly · all models allowance over a ladder of models (default: Fable 5.1 high for the session and judgment work, Opus 5.5 high subagents for routine work, Sonnet 5.5 medium subagents for bulky output): the further the all-models meter runs ahead of its day-by-day budget (the last day before reset keeps 1.5 daily allowances), or the steeper the logged trend, the further down the ladder work goes. The plan's per-model weekly meter (Fable's by default) only matters at 100 %: then that model leaves the ladder. Use at the start of every session, after each big task, and whenever the user asks about usage, which model to use, or throttling; `usage` or no argument gives the report; `help`, `setup`, `set`, `add`, `remove`, `reset`, `log`, `next` and `version` manage the guide, the ladder and the automation."
---

# Model pacing

Version: `node "${CLAUDE_SKILL_DIR}/scripts/config.mjs" version` (read from the plugin manifest).
The user's files (`config.json`, `log.jsonl`, `state.json`,
`BRIEF.local.md`) live in `~/.claude/pacing`, outside the plugin folder;
`node "${CLAUDE_SKILL_DIR}/scripts/config.mjs" where` prints it.

**At session start, before anything else:** if the SessionStart hook's
context names a recommended model that differs from the model and effort
this session runs on, the first reply starts with one line telling the
user to switch the model menu to it (a running session's model is the
user's to change).

The rule: the top tier for work that needs judgment, lower tiers for
easier work through subagents, and never let the **Weekly · all models**
meter run out before the reset. Higher tiers burn that meter faster, so moving work down
the ladder is the brake. The plan's per-model weekly meter (**Weekly ·
Fable** on a plan that meters Fable; `premium` in the config names the
model, `none` for a plan without one) is not paced: at 100 % every tier of
that model leaves the ladder until the reset.

`${CLAUDE_SKILL_DIR}` below is this skill's folder inside the plugin; the
loader substitutes it. Installed as a plugin the skill answers to
`/pacing:pacing`; `/pacing` below stands for that.

## 0. Arguments

| invoked as | do |
|---|---|
| `/pacing`, `/pacing usage`, or the user types "usage" | the usage report, sections 1 to 3 |
| `help`, or the user types "usage help" | print GUIDE.md to the user, whole, as it is |
| `setup` | section 4 |
| `set <n> <model> <effort>` | `node "${CLAUDE_SKILL_DIR}/scripts/config.mjs" set …`, show the result |
| `add <model> <effort>` | `node "${CLAUDE_SKILL_DIR}/scripts/config.mjs" add …`, a new bottom tier |
| `remove <n>` | `node "${CLAUDE_SKILL_DIR}/scripts/config.mjs" remove …` |
| `reset` | `node "${CLAUDE_SKILL_DIR}/scripts/config.mjs" reset`, the default three tiers |
| `log` | `node "${CLAUDE_SKILL_DIR}/scripts/budget.mjs" log`, the last readings |
| `next on`, `next off` | `node "${CLAUDE_SKILL_DIR}/scripts/config.mjs" next …`, the next-session model switch |
| `premium <model>`, `premium none` | `node "${CLAUDE_SKILL_DIR}/scripts/config.mjs" premium …`, which model the plan's per-model weekly meter belongs to |
| `version` | `node "${CLAUDE_SKILL_DIR}/scripts/config.mjs" version` |

**First run (the install).** Run `node "${CLAUDE_SKILL_DIR}/scripts/config.mjs" init`. If it
prints `created`, this is the first use on this machine: show GUIDE.md to
the user once. If it prints a `migrated …` line, say in one line that the
ladder, readings and local rules of the earlier standalone skill were
taken over. If it prints `BRIEF.local.md created in …`, tell the user in
one line that their own subagent rules go there. The SessionStart hook
comes with the plugin; nothing needs installing. Then continue with what
was asked.

## 1. Measure

Call `mcp__ccd_session_mgmt__get_usage` (no arguments). It is a deferred
tool: when its schema is not loaded yet, load it first with ToolSearch,
query `select:mcp__ccd_session_mgmt__get_usage`. From `plan.windows`
take `Weekly · all models` (`percentUsed`, `resetsAt`), the per-model
window `Weekly · <model>` for the model the config names as `premium`
(Fable by default; `config.mjs show` prints it) and `5-hour limit`
(`percentUsed`, `resetsAt`). A meter the plan does not have is passed as
`-`; when the plan has no per-model window at all, set `premium none`
once. Then:

```bash
node "${CLAUDE_SKILL_DIR}/scripts/budget.mjs" --all <allModelsPercent> --reset <resetsAt> --premium <perModelPercent> --five <fiveHourPercent> --five-reset <fiveHourResetsAt> --session <model id of this session>
```

The script is the rule. It prints the day, the budget line, the level, the
trend from the log, the 5-hour window, which tier takes each class of work,
the `do:` line and the next session's model. It also appends the reading
to `log.jsonl`, writes `state.json` for the SessionStart hook (both in
`~/.claude/pacing`), and sets
the next session's tier as the default for new sessions (unless `next
off`): the desktop app's built-in preset for local sessions
(`builtIns.local.settings` in `%LOCALAPPDATA%\Claude-Data\<id>\ccd-session-presets.json`)
and `model` plus `effortLevel` in `~/.claude/settings.json` for the
terminal CLI. The preset is Windows only (the app's data folder elsewhere
is not known to the script); on other systems only `settings.json` is
set. The app reads that preset file only at startup, so a change
shows in the model menu after the next app restart; until then the user
picks the model in the menu once. A user-made preset keeps its own
model. Pass `--dry` to compute without any of
that, and `--session` with this session's model id (the full id from the
system prompt, `claude-opus-5-5`, or the short name `opus`) so the upward
option is reported when the session is not on tier 1.

How the line works: the week is 7 days ending at `resetsAt`; the last 24 h
weigh `lastDayWeight` (1.5), the rest 1, and the whole of the current
calendar day's allowance counts from local midnight, so the line steps at
midnight (not at the hour of the reset) and a morning's work never reads
as throttle. Levels: ahead (more than 5 under the line), on pace, over (up
to 5 over), throttle (more than 5 over), stop (95 % or more). "<model>
out" (the per-model meter at 100 %) is a flag beside the level: every
tier of that model leaves the ladder and the `do:` line starts with the
switch, while the level and the routing still come from the all-models
meter. The trend from the log (the oldest reading of this
week within the last two days, at least 4 h old) can raise the level: a
projection past 100 % at reset means at least "over", past 115 %
"throttle". A sample under 20 h is shown but does not move the level: it
has to cover a night, so a busy morning alone is not a trend.

Classes of work:

- **judgment**: design, debugging, quirks of the framework in use,
  reviews, decisions on user data, final verification
- **medium**: a well-specified change across a few files, a test written
  to a pattern that exists, a report from gathered facts
- **routine**: probe runs, test suites, mechanical edits across files,
  locale fan-out, commits with a given message, log reading
- **trivial**: greps, file summaries, restoring fixtures, renames
- **bulky** (a property, not a size): work whose output is large, such as
  log reading, test-suite runs, a fan-out over many files

Trivial work stays in the session until throttle: a subagent costs tens of
thousands of tokens before it reads a file, so a grep delegated to a
cheaper model costs more on the meter than the same grep done here. Bulky
work goes to the lowest tier at every level, whatever its difficulty:
what a subagent reads stays out of this session's context, which is
re-sent on every later turn.

## 2. Apply

A session cannot change its own model: `set_session_model` and
`set_session_effort` refuse the calling session, so this session runs on
the model the user picked. The lever is delegation:

- Hand work to the Agent tool with the tier's `model` and `effort` from
  the script's routing lines. Read BRIEF.md (next to this file) and
  `~/.claude/pacing/BRIEF.local.md` once per session, and paste into every subagent prompt
  the general-rules block, the local general additions, and the project
  block for the project at hand (the project's own CLAUDE.md rules first,
  then the block BRIEF.local.md keeps), with the task, the files, the goal
  and what was ruled out. A `fork` ignores the model override, so a lower
  tier is always a fresh agent.
- **Other open sessions** can be switched: at throttle, or when the
  per-model meter is out, list
  them (`mcp__ccd_session_mgmt__list_sessions`), and offer the user to
  move the ones still on a tier above the recommendation with
  `mcp__ccd_session_mgmt__set_session_model` and
  `mcp__ccd_session_mgmt__set_session_effort` (deferred tools; load with
  ToolSearch). The change applies from each session's next turn and the
  app asks the user before it happens, so name the sessions and the model
  in the offer. Never switch a session the user did not agree to.
- A lower tier that gets something wrong costs a redo on a higher one:
  when in doubt between two tiers, take the higher.
- **Throttle needs no manual change.** The session becomes a dispatcher:
  it reads the task, hands it to a tier 2 subagent, checks the result, and
  does itself only what tier 2 would get wrong (quirks of the framework
  the subagent cannot know, decisions on user data, a result that came
  back wrong).
  Dispatching still costs tier 1 tokens, so the next session should start
  on tier 2; the script has set that as the app's preset for new local
  sessions, but say it to the user as a manual step too, in case the
  model menu shows something else.
- **A session on a lower tier** (the `upward:` line): one contained hard
  task with a clear deliverable may go up to a tier 1 subagent. An open
  debugging hunt may not; that needs the conversation's context.
- **5-hour window at 85 % or more:** hold heavy work until the time the
  script prints; delegation does not help that meter.

In anything the user reads, name the model with its effort ("Opus 5.5
high"), never a tier number.

## 3. Report

One line to the user when the level is not "on pace", or whenever they
ask, with the two numbers, the trend when there is one, and the `do:` line
in words:

```
All models 34 % used, budget line 41 %: ahead, keeping the work on Fable 5.1 high.
All models 52 % used, budget line 41 %, trend +9 %/day: over by 11, routine and medium work goes to Opus 5.5 high, trivial to Sonnet 5.5 medium.
All models 58 % used, budget line 41 %, reaches 100 % Wednesday: throttle. No manual change now: this session dispatches everything to Opus 5.5 high subagents and does itself only what they would get wrong. New sessions now default to Opus 5.5 high; check the model menu shows Opus 5.5, effort high.
Fable meter at 100 %: switch the session to Opus 5.5 high now (model menu: Opus 5.5, effort high); Fable is out until Thursday's reset.
5-hour window 91 %, resets 14:20: hold the test suite until then.
```

In the throttle and Fable-out lines the switch is the point: say "switch
the session to <model> <effort>" with the model menu's model and effort
spelled out, before anything else. When the script printed a `desktop
app preset:` line, say that new sessions now start on that model.

## 4. Setup

Show the ladder (`node "${CLAUDE_SKILL_DIR}/scripts/config.mjs" show`) and ask with
AskUserQuestion:

- how many tiers (2, 3 or 4; current first with "(current)")
- for each tier, model and effort, current value first with "(current)"
- optionally the last-day weight
- whether the skill may set the default model of new sessions (`next
  on`, current first), in one line
- which model the plan's per-model weekly meter belongs to (`premium`;
  the usage card shows it as "Weekly · <model>"), or none; current first

Models: fable (Fable 5.1), opus (Opus 5.5), sonnet (Sonnet 5.5), haiku
(Haiku 5.5). Efforts: low, medium, high, xhigh, max. Write the answers with
`node "${CLAUDE_SKILL_DIR}/scripts/config.mjs" set <n> <model> <effort>`, `add`, `remove`,
`weight <n>`, `next on|off` and `premium <model>|none`, then show the result.
End with the manual step, in one line: the session model in the model
menu must now be tier 1 (name it, with its effort); the skill cannot
change a running session, only the preset for new ones, so every new
session is told at start when the menu needs changing.

## When to run this

- At the start of every session, before the first big task. The
  plugin's SessionStart hook prints the last reading and says so.
- After each big task (a feature, a test suite, a long debugging run).
- When the user mentions usage, allowance, throttling or which model.
