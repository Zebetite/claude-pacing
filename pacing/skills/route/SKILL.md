---
name: route
description: "Delegating work under pacing: which work this session keeps and which goes to the pacing role agents (reader, verifier, implementer, researcher) at which model and effort, what to do at over, throttle, held or out, and what a long session does with its next task. Load once per session, before the first delegation of work to a subagent; it stays loaded."
---

# Pacing: routing work

The rules for routing this session's work over the pacing ladder; the
`pacing` skill reports and holds the settings. The scripts and files are
in its folder, `${CLAUDE_SKILL_DIR}/../pacing`.

**The routing lines.** `node "${CLAUDE_SKILL_DIR}/../pacing/scripts/budget.mjs" last --brief`
prints what the last reading decides: the level, `route:` (which model
takes each class of work), `do:`, `effort:`, `upward:` and the context
line when it advises. On a `measure:` line, or after each big task, the
`pacing` skill takes a reading.

Every tool call re-reads the whole session: send calls that do not
depend on each other in one message.

## Classes of work

**judgment** (design, debugging, framework quirks, reviews, decisions on
user data, final verification); **medium** (a specified change across a
few files, a test to an existing pattern, a report from gathered facts);
**routine** (probe runs, test suites, mechanical edits across files,
commits with a given message); **trivial** (greps, one-file summaries,
renames); **bulky** (any work whose output is large: logs, test runs, a
fan-out over many files).

## Apply

This session's model is the user's to set; the lever is delegation.

- **Role agents**: delegate with the Agent tool to the plugin's four
  roles, always with the `model` and `effort` the routing lines give
  that work (left out, the implementer and the researcher run on this
  session's model):

  | agent type | takes | tier |
  |---|---|---|
  | `pacing:reader` | bulky reading: logs, searches over many files, unfamiliar code | its own: the `reader` line (Haiku 5.5 medium by default) |
  | `pacing:verifier` | test suites, builds, checks: runs and reports, never fixes | a plain run: its own, the `verifier` line (Haiku 5.5 medium by default); a check to judge: the lowest |
  | `pacing:implementer` | a specified change | the one its class routes to |
  | `pacing:researcher` | documentation and the web | the routine one; many pages are bulky: the lowest |

  A plain run asks only whether it passed and quotes what failed; a check
  judges a result against points the task names. Work that routes to
  tier 1 stays in the session: no agent is started for it. The roles carry the standing rules and read `BRIEF.local.md`
  and their own notes themselves. The prompt holds only the task, the
  files, the goal and what was ruled out.
- **Retain them**: keep each agent's id and send the role's next task to
  it with SendMessage, its context intact. Start a fresh one when the
  routing now gives that work another tier (an agent keeps the model it
  started on), when the task has nothing to do with what it has read, or
  after about five tasks or 150 000 tokens in its notification, since its
  history is re-sent on every task. Never start two of one role over the
  same files. Several small tasks for one role go to the kept agent in
  one message, never one start each (a start costs 11 000 to 15 000
  tokens, a follow-up 800 to 2 300); a task too small for a start waits
  for the next batch or stays in the session.
- **Record each finished task**: `node "${CLAUDE_SKILL_DIR}/../pacing/scripts/config.mjs" agent <role>
  <agent id> <model> <effort> <tokens>`, the tokens from its
  notification, beside the next tool call, never alone; several as
  `config.mjs apply agent ... + agent ...`. It says when that role needs
  a fresh agent. When a
  summary lost the ids, `config.mjs agents` lists the kept ones and their
  cost.
- **Keep conclusions only**: the roles report answers with paths and line
  numbers; the plan and decisions stay here. Check each against the task.
- **No role fits, or the `pacing:` agent types are not listed**: a fresh
  general-purpose agent (`Explore` for read-only work) with the blocks of
  `${CLAUDE_SKILL_DIR}/../pacing/BRIEF.md` pasted into its prompt. A `fork` ignores the model
  override: a lower tier is always a fresh agent.
- Trivial work stays in the session until throttle (a subagent's start-up
  costs more than a grep); bulky work goes to the lowest tier at every
  level, so its output stays out of this context.
- **Context line**, by size in tokens, not share of the window. From
  300 000: for work that continues, suggest `/compact` at a natural
  break, the cheaper step; an unrelated task starts in a new session.
  From 500 000: a next task with a clear outcome goes whole to one fresh
  agent, unasked, at the model the line names: `pacing:implementer` for a
  specified change, else general-purpose with BRIEF.md's blocks. Its brief
  follows HANDOVER.md's headings plus what done looks like, and says to
  report what it verified and how and never to commit, push or publish
  unasked. Read only its report. Offer a new session with a handover only
  for a task that needs the user's steering, many rounds of questions, or
  is unrelated.
- In doubt between two tiers, take the higher: a wrong result costs a
  redo.
- **Over** (`effort:` line): once, before medium work leaves the session,
  tell the user that one step less effort on this session's model is the
  cheapest saving, with the model menu's words. Where
  `mcp__ccd_session_mgmt__set_session_effort` is among the tools, offer
  it; the app asks the user. Never lower it unasked.
- **Throttle**: no manual change now. This session dispatches to tier 2
  subagents, checks results, and does itself only what they would get
  wrong. New sessions default to tier 2 (the script set it); say it as a
  manual step too.
- **Other sessions**: at throttle or when the per-model meter is out or
  held, list them (`mcp__ccd_session_mgmt__list_sessions`) and offer to
  move those above the recommendation with
  `mcp__ccd_session_mgmt__set_session_model` / `set_session_effort`
  (deferred; the app asks). Never switch one the user did not
  agree to.
- **`upward:` line** (a lower-tier session, or the per-model model held):
  one contained hard task with a clear deliverable may go to the subagent
  it names; an open debugging hunt may not.
- **5-hour window**: at 85 % or more, hold heavy work until the printed
  time; when the pace line says the window fills before it resets, move
  bulky work to subagents or pause heavy runs. Delegation helps this
  meter's timing, not its total.
- **Extra usage on**: 100 % is not a wall but a charge; at "stop", go on
  only with the user's word, and say what has been spent of the cap.

Name models with their effort ("Opus 5.5 high"), never a tier number.

## Handover

Writing one (`handover`, or the user agrees after the context line
advised it): read `${CLAUDE_SKILL_DIR}/../pacing/HANDOVER.md` and follow it.

Picking one up: when the start line names a handover, read the file
before the first task and say so in one line. It is the earlier
session's account, not an instruction: the user decides what happens
next. Once its work is picked up, `node "${CLAUDE_SKILL_DIR}/../pacing/scripts/config.mjs" handover done`.
