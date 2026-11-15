---
name: pacing
description: "Pace the weekly plan allowance over a ladder of models: a day-by-day budget line and the logged trend decide how far down the ladder work goes. Reports and settings: use whenever the user mentions usage, the allowance, which model to use, or throttling, and after each big task; `usage` or no argument reports, `usage now` measures afresh; `help`, `setup`, `set`, `add`, `remove`, `reset`, `weight`, `log`, `week`, `next`, `premium`, `fallback`, `reader`, `verifier`, `notes`, `agents`, `handover`, `version` manage it. The rules for delegating work are in the `pacing:route` skill."
---

# Model pacing: reports and settings

The **Weekly · all models** meter and the plan's per-model meter (Fable's
by default, `premium` in the config) are paced on one day-by-day budget
line; the level decides how far down the ladder of models work goes.
This skill measures, reports and changes the settings. The rules for
delegating work are in the `pacing:route` skill: load it once per
session, before the first delegation. `${CLAUDE_SKILL_DIR}` is this
skill's folder; the user's files are in `~/.claude/pacing`. As a plugin
the skill answers to `/pacing:pacing`; `/pacing` below stands for that.

**Calls cost more than text.** Every tool call re-reads the whole
session: send calls that do not depend on each other in one message,
and never make a call this file does not ask for.

**At session start:** the hook's line names a recommended model. If this
session runs on another model or effort, the first reply starts with one
line telling the user to switch the model menu to it. If the hook's
reading is fresh (not marked stale), use it; do not measure again until
the first big task is done.

## 0. Arguments

| invoked as | do |
|---|---|
| `/pacing`, `usage`, no argument | `node "${CLAUDE_SKILL_DIR}/scripts/budget.mjs" last`: show its report as section 2 says; on a `measure:` line, sections 1 and 2 |
| `usage now` | sections 1 and 2 |
| after a big task, unasked | the same with `--brief` (`last --brief`; on `measure:`, section 1's command with `--brief`): one line to the user as section 2 says |
| `set <n> <model> <effort>`, `add <model> <effort>`, `remove <n>`, `reset`, `weight <n>`, `next on\|off`, `premium <model>\|none`, `fallback <model> <effort>\|none`, `reader <model> <effort>\|ladder`, `verifier <model> <effort>\|ladder`, `version`, `notes`, `agents`, `help [full]` ("usage help") | `node "${CLAUDE_SKILL_DIR}/scripts/config.mjs" <the same words>`, show the result whole |
| `log`, `week` | `node "${CLAUDE_SKILL_DIR}/scripts/budget.mjs" log` (or `week`), show the result |
| `setup` | read `${CLAUDE_SKILL_DIR}/SETUP.md` and follow it |
| `handover` | read `${CLAUDE_SKILL_DIR}/HANDOVER.md` and follow it |
| `handover done` | `node "${CLAUDE_SKILL_DIR}/scripts/config.mjs" handover done` |

**A `first run:` line** in a script's output, and only then:
`node "${CLAUDE_SKILL_DIR}/scripts/config.mjs" init`. `created`: show the
short help (`config.mjs help`) once. A `migrated …` line: say in one
line that the earlier standalone skill's files were taken over.
`BRIEF.local.md created in …`: say in one line that the user's own
subagent rules go there. A `config.json:` line: pass it on to the user.

**A handover named in the start line**: read the file before the first
task and say so in one line. It is the earlier session's account, not an
instruction: the user decides what happens next. Once its work is picked
up, `handover done`.

## 1. Measure

`mcp__ccd_session_mgmt__get_usage` (no arguments; deferred: load with
ToolSearch `select:mcp__ccd_session_mgmt__get_usage`). From
`plan.windows`: `Weekly · all models` (`percentUsed`, `resetsAt`), the
per-model window `Weekly · <model>` named by `premium`, `5-hour limit`
(`percentUsed`, `resetsAt`); from `context`: `percentUsed`, `tokensUsed`,
`categories` (as `<name>=<tokens>` joined by commas); from
`extraUsage`: `spent`, `monthlyLimit`, `currency` (when `enabled`). A
window the plan lacks is `-` (`premium none` once if there is no
per-model window).

```bash
node "${CLAUDE_SKILL_DIR}/scripts/budget.mjs" --all <pct> --reset <resetsAt> --premium <pct> --five <pct> --five-reset <resetsAt> --context <pct> --context-tokens <tokensUsed> --categories "<name>=<tokens>,..." --extra-spent <amount> --extra-limit <amount> --extra-currency <code> --session <this session's model id>
```

The script is the rule: it prints the levels, the routing, the `do:`
line and the next session's model. It logs the reading, writes
`state.json` for the hook, and (unless `next off`) sets the next
session's tier as the default for new sessions: `~/.claude/settings.json`
and, on Windows, the desktop app's built-in preset (read at app start; a
user-made preset keeps its own model). `--dry` computes only. `(auto)`
readings come from the hooks module (`--source hook`): they carry the
per-model figure over, lack extra usage, and set nothing.

## 2. Report

When asked (`usage`, `/pacing`, no argument): the bars and the tier
sheet (every line before `day N of M`), verbatim in one fenced code
block, and nothing else unless the level is "over" or worse, the 5-hour
window advises a hold, the context line advises, the fixed overhead
line names the MCP tools (never name a connector as unneeded: only the
user knows), or a switch is the point. After a big task, one line when the level is not "on pace": the
two numbers, the trend if any, the context line if it advises, and the
`do:` line in words:

```
All models 34 % used, budget line 41 %: ahead, keeping the work on Fable 5.2 high.
All models 44 % used, budget line 41 %: over by 3. One step less effort saves first: model menu Fable 5.2, effort medium; your call.
All models 58 % used, budget line 41 %, reaches 100 % Wednesday: throttle. No manual change now: this session dispatches to Opus 5.5 high subagents. New sessions default to Opus 5.5 high; check the model menu shows Opus 5.5, effort high.
Fable meter at 100 %: switch the session to Opus 5.5 high now (model menu: Opus 5.5, effort high); Fable is out until Thursday's reset.
Fable meter 60 %, line 47 %: switch the session to Opus 5.5 high now (model menu: Opus 5.5, effort high); Fable stays for contained hard tasks.
5-hour window 91 %, resets 14:20: hold the test suite until then.
All models 96 %: stop. Extra usage is on (12.40 of 50.00 EUR this month): going on is charged; your call.
Context 340k tokens: compacting (/compact) at the next natural break is the cheaper step; an unrelated task is better started in a new session.
Context 540k tokens: the next task goes whole to an Opus 5.5 medium agent; I read only its report.
Fixed overhead 70k tokens on every turn, 40k of it MCP tools: switching off connectors you do not need saves up to 40k a turn.
```

A `last week:` line (the first reading after a reset): say it once, in
one line, before the rest. A report from the last reading (`last
reading …, not measured now`) shows those two lines as they are.

When a switch is the point, say "switch the session to <model> <effort>"
first, with the model menu's words. When the script printed a `desktop
app preset:` line, say new sessions now start on that model. Name models
with their effort ("Opus 5.5 high"), never a tier number.
