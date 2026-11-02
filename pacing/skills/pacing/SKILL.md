---
name: pacing
description: "Pace the Weekly · all models allowance over a ladder of models (default Fable 5.1 high for the session, Opus 5.5 medium and Sonnet 5.5 medium subagents, Opus 5.5 high at the top while Fable's meter is full): a day-by-day budget line and the logged trend decide how far down the ladder work goes. Use at session start, after each big task, and whenever the user mentions usage, which model to use, or throttling; `usage` or no argument reports; `help`, `setup`, `set`, `add`, `remove`, `reset`, `log`, `next`, `premium`, `fallback`, `version` manage it."
---

# Model pacing

The rule: the top tier for work that needs judgment, lower tiers for easier
work through subagents, and the **Weekly · all models** meter never runs
out before the reset. The plan's per-model meter (Fable's by default,
`premium` in the config) is not paced: at 100 % that model leaves the
ladder and the `fallback` tier (Opus 5.5 high by default) takes the top
place until the reset. `${CLAUDE_SKILL_DIR}` is this skill's folder; the user's files are
in `~/.claude/pacing`. As a plugin the skill answers to `/pacing:pacing`;
`/pacing` below stands for that. GUIDE.md explains the rules; this file is
the procedure.

**At session start:** the hook's line names a recommended model. If this
session runs on another model or effort, the first reply starts with one
line telling the user to switch the model menu to it. If the hook's
reading is fresh (not marked stale), use it; do not measure again until
the first big task is done.

## 0. Arguments

| invoked as | do |
|---|---|
| `/pacing`, `usage`, no argument | sections 1 to 3 |
| `help`, "usage help" | print GUIDE.md to the user, whole |
| `setup` | section 4 |
| `set <n> <model> <effort>`, `add <model> <effort>`, `remove <n>`, `reset`, `weight <n>`, `next on\|off`, `premium <model>\|none`, `fallback <model> <effort>\|none`, `version` | `node "${CLAUDE_SKILL_DIR}/scripts/config.mjs" <the same words>`, show the result |
| `log` | `node "${CLAUDE_SKILL_DIR}/scripts/budget.mjs" log` |

**First run.** `node "${CLAUDE_SKILL_DIR}/scripts/config.mjs" init`.
`created`: show GUIDE.md once. A `migrated …` line: say in one line that
the earlier standalone skill's files were taken over. `BRIEF.local.md
created in …`: say in one line that the user's own subagent rules go
there. Then continue.

## 1. Measure

`mcp__ccd_session_mgmt__get_usage` (no arguments; deferred: load with
ToolSearch `select:mcp__ccd_session_mgmt__get_usage`). From
`plan.windows`: `Weekly · all models` (`percentUsed`, `resetsAt`), the
per-model window `Weekly · <model>` named by `premium`, `5-hour limit`
(`percentUsed`, `resetsAt`); from `context`: `percentUsed`; from
`extraUsage`: `spent`, `monthlyLimit`, `currency` (when `enabled`). A
window the plan lacks is `-` (`premium none` once if there is no
per-model window).

```bash
node "${CLAUDE_SKILL_DIR}/scripts/budget.mjs" --all <pct> --reset <resetsAt> --premium <pct> --five <pct> --five-reset <resetsAt> --context <pct> --extra-spent <amount> --extra-limit <amount> --extra-currency <code> --session <this session's model id>
```

The script is the rule: it prints the level, the trend, the 5-hour
window with its pace, the spend rate to the reset, extra usage, the
context line, which tier takes each class of work, the `do:` line and
the next session's model. It logs the reading, writes
`state.json` for the hook, and (unless `next off`) sets the next
session's tier as the default for new sessions: `~/.claude/settings.json`
and, on Windows, the desktop app's built-in preset (read at app start; a
user-made preset keeps its own model). `--dry` computes only.

Classes of work: **judgment** (design, debugging, framework quirks,
reviews, decisions on user data, final verification); **medium** (a
specified change across a few files, a test to an existing pattern, a
report from gathered facts); **routine** (probe runs, test suites,
mechanical edits across files, commits with a given message); **trivial**
(greps, one-file summaries, renames); **bulky** (any work whose output is
large: logs, test runs, a fan-out over many files).

## 2. Apply

This session's model is the user's to set; the lever is delegation.

- Delegate with the Agent tool at the tier's `model` and `effort` from
  the routing lines. Read BRIEF.md and `~/.claude/pacing/BRIEF.local.md`
  once per session; every subagent prompt gets the general block, the
  local additions, the project block (the project's CLAUDE.md rules
  first), the task, the files, the goal and what was ruled out. A `fork`
  ignores the model override: a lower tier is always a fresh agent.
- **Agent type**: bulky *reading* (logs, test output, searching many
  files) goes to the `Explore` type, which is read-only with a smaller
  tool set; work that edits goes to a general-purpose agent.
- Trivial work stays in the session until throttle (a subagent's start-up
  costs more than a grep); bulky work goes to the lowest tier at every
  level, so its output stays out of this context.
- **Context line** at 30 % or more: start new tasks in a new session; at
  50 % or more say so to the user before the next task, since this
  transcript is re-sent on every turn.
- When in doubt between two tiers, take the higher: a wrong result costs
  a redo above.
- **Throttle**: no manual change now. This session dispatches to tier 2
  subagents, checks results, and does itself only what they would get
  wrong. New sessions default to tier 2 (the script set it); say it as a
  manual step too.
- **Other sessions**: at throttle or when the per-model meter is out,
  list them (`mcp__ccd_session_mgmt__list_sessions`) and offer to move
  those above the recommendation with
  `mcp__ccd_session_mgmt__set_session_model` /
  `set_session_effort` (deferred; the app asks the user first). Never
  switch one the user did not agree to.
- **Lower-tier session** (`upward:` line): one contained hard task with a
  clear deliverable may go to a tier 1 subagent; an open debugging hunt
  may not.
- **5-hour window**: at 85 % or more, hold heavy work until the printed
  time; when the pace line says the window fills before it resets, move
  bulky work to subagents or pause heavy runs. Delegation does not help
  this meter's total, only its timing.
- **Spend rate**: the `%/h` figure is what the headroom buys until the
  reset; mention it when the user asks what a task may cost.
- **Extra usage on**: 100 % is not a wall but a charge; at "stop", go on
  only with the user's word, and say what has been spent of the cap.

Name models with their effort ("Opus 5.5 high"), never a tier number.

## 3. Report

When asked (`usage`, `/pacing`, no argument): the script's first two
blocks, the bars and the tier sheet (every line before the `day N of M`
line), verbatim inside one fenced code block so the columns keep their
alignment, and nothing else
unless the level is "over" or worse, the 5-hour window advises a hold,
the context line advises, or a switch is the point. At every other run,
one line when the level is not "on pace": the two numbers, the trend if
any, the context line if it advises, and the `do:` line in words:

```
All models 34 % used, budget line 41 %: ahead, keeping the work on Fable 5.1 high.
All models 52 % used, budget line 41 %, trend +9 %/day: over by 11, routine and medium work goes to Opus 5.5 high.
All models 58 % used, budget line 41 %, reaches 100 % Wednesday: throttle. No manual change now: this session dispatches to Opus 5.5 high subagents. New sessions default to Opus 5.5 high; check the model menu shows Opus 5.5, effort high.
Fable meter at 100 %: switch the session to Opus 5.5 high now (model menu: Opus 5.5, effort high); Fable is out until Thursday's reset.
5-hour window 91 %, resets 14:20: hold the test suite until then.
5-hour window 62 %, +14 %/h: full at 15:50, before the 16:40 reset; move the test runs to a Sonnet 5.5 medium subagent.
Ahead by 36: up to 1.1 %/h until Thursday's reset; today's line leaves 36 %.
All models 96 %: stop. Extra usage is on (12.40 of 50.00 EUR this month): going on is charged; your call.
Context 54 %: this session is the expensive part now; start the next task in a new session.
```

When a switch is the point, say "switch the session to <model> <effort>"
first, with the model menu's words. When the script printed a `desktop
app preset:` line, say new sessions now start on that model.

## 4. Setup

`node "${CLAUDE_SKILL_DIR}/scripts/config.mjs" show`, then
AskUserQuestion: tiers (2 to 4), each tier's model and effort, optionally
the last-day weight, the next-session switch, the per-model meter's model
or none, and the fallback tier that takes the top place while that meter
is full; current values first with "(current)". Models: fable, opus,
sonnet, haiku; efforts: low, medium, high, xhigh, max. Write with `set`,
`add`, `remove`, `weight`, `next`, `premium`, `fallback`; show the result; end with
the manual step: the model menu must now show tier 1 (name it with its
effort).

## When to run this

Before the first big task when the hook's reading is stale or missing;
after each big task; whenever the user mentions usage, allowance,
throttling or which model.
