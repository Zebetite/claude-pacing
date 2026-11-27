---
name: pacing
description: "Pace the weekly plan allowance over a ladder of models. Use whenever the user mentions usage, the allowance or limits, which model or effort to use, or throttling: reports the budget and changes the pacing settings. Delegating work is the `pacing:route` skill."
---

# Model pacing: reports and settings

The weekly meter ("Weekly · all models") and the per-model meter
(Fable's by default, `premium` in the config) are paced on one day-by-day budget
line; the level decides how far down the ladder of models work goes.
This skill takes readings, reports and changes the settings; the rules for
delegating work are the `pacing:route` skill, loaded once per session
before the first delegation. `${CLAUDE_SKILL_DIR}` is this skill's
folder; the user's files are in `~/.claude/pacing`. As a plugin the skill
answers to `/pacing:pacing`; `/pacing` below stands for that.

**Calls cost more than text.** Every tool call re-reads the whole
session: send calls that do not depend on each other in one message,
and never make a call this file does not ask for.

**At session start:** the hook's line names a recommended model and says
whether to tell the user about a switch. Use a fresh reading as it is:
the hooks module takes the next ones, so take one only when asked or on
a `measure:` line. A stale reading is the exception (no hooks module, as in
a terminal session without the app): the start line says what to run.

## 0. Arguments

| invoked as | do |
|---|---|
| `/pacing`, `usage`, no argument | `node "${CLAUDE_SKILL_DIR}/scripts/budget.mjs" last`: show its report as section 2 says; on a `measure:` line, sections 1 and 2 |
| `usage now` | sections 1 and 2 |
| `help full` ("usage help full") | answer in one line: "`/pacing-guide` shows the whole guide without spending tokens; if your Claude Code does not know that command, say so and I show it here." Only on that answer: `node "${CLAUDE_SKILL_DIR}/scripts/config.mjs" help full`, shown whole |
| `set <n> <model> <effort>`, `add <model> <effort>`, `remove <n>`, `reset`, `weight <n>`, `next on\|off`, `compact on\|off`, `notify on\|off`, `switch on\|off`, `reload on|off`, `autocompact <tokens>|auto|off`, `premium <model>|none`, `fallback\|off`, `premium <model>\|none`, `fallback <model> <effort>\|none`, `reader <model> <effort>\|ladder`, `verifier <model> <effort>\|ladder`, `version`, `notes`, `agents`, `help` ("usage help"), `handover done` | `node "${CLAUDE_SKILL_DIR}/scripts/config.mjs" <the same words>`, show the result whole |
| `doctor` | `node "${CLAUDE_SKILL_DIR}/scripts/doctor.mjs"`, show the result whole |
| `saved`, `saved detail` | `node "${CLAUDE_SKILL_DIR}/scripts/saved.mjs" [--detail]`, show the result whole |
| `log`, `week` | `node "${CLAUDE_SKILL_DIR}/scripts/budget.mjs" log` (or `week`), show the result |
| `setup` | read `${CLAUDE_SKILL_DIR}/SETUP.md` and follow it |
| `handover` | read `${CLAUDE_SKILL_DIR}/HANDOVER.md` and follow it |

**A `first run:` line** in a script's output, and only then:
`node "${CLAUDE_SKILL_DIR}/scripts/config.mjs" init`, and pass on what it
prints as it stands. A `config.json:` line in any output: pass it on.

## 1. Take a reading

`mcp__ccd_session_mgmt__get_usage` (no arguments; deferred: load with
ToolSearch `select:mcp__ccd_session_mgmt__get_usage`). From
`plan.windows`: `Weekly · all models` and `5-hour limit` (`percentUsed`,
`resetsAt`), and the `Weekly · <model>` that `premium` names; from
`context`: `percentUsed`, `tokensUsed`, `categories` (`<name>=<tokens>`,
comma-joined); from `extraUsage` (when `enabled`): `spent`,
`monthlyLimit`, `currency`. A window the plan lacks is `-` (`premium
none` once if there is no per-model window).

```bash
node "${CLAUDE_SKILL_DIR}/scripts/budget.mjs" --all <pct> --reset <resetsAt> --premium <pct> --five <pct> --five-reset <resetsAt> --context <pct> --context-tokens <tokensUsed> --categories "<name>=<tokens>,..." --extra-spent <amount> --extra-limit <amount> --extra-currency <code> --session <this session's model id>
```

The script is the rule: it prints the levels, the routing, the `do:`
line and the next session's model, logs the reading for the hook and
(unless `next off`) makes that model the default for new sessions in
`~/.claude/settings.json` and, on Windows, the desktop app's built-in
preset (read at app start; a user-made preset keeps its own). `--dry`
computes only. `(auto)` readings come from the hooks module and never
set the next session's model.

## 2. Report

The bars and the tier sheet (every line before `day N of M`), verbatim in
one fenced code block, since the user does not see tool output, and
nothing else unless the level is "over" or worse, the 5-hour window
advises a hold, the context line advises, the fixed overhead line names
the MCP tools (never name a connector as unneeded: only the user knows),
or this session's model is out or held. Then one line on what applies,
the `do:` line in words, as in:

```
Weekly 44 % used, budget line 41 %: over by 3; medium tasks go to subagents too.
Context 440k tokens: compacting (/compact) at the next natural break makes every later turn cheaper; then we go on here, whatever the next task is.
```

A `last week:` line (the first reading after a reset): say it once, in
one line, before the rest.

**This session's model or effort**: the plugin handles them by handing
work to subagents on the right models; never suggest a switch or less
effort. Only when the per-model meter's model is out, or held 20 points or more
over its line, name the
fact in a few words, as above: where the hooks module runs (a pacing
status line shows), its Switch row is the offer, so give no steps and ask
nothing; without it (as in a terminal), the line starts "switch the
session to <model> <effort>", in the model menu's words. When the script printed a `desktop app preset:` line, say new
sessions now start on that model. Name models with their effort ("Opus
5.5 high"), never a tier number.
