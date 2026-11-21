---
name: route
description: "Delegating work under pacing: which work this session keeps and which goes to the pacing role agents (reader, verifier, implementer, researcher) at which model and effort, what to do at over, throttle, held or out, and what a long session does with its next task. Load once per session, before the first delegation of work to a subagent; it stays loaded."
---

# Pacing: routing work

The `pacing` skill reports and holds the settings; its scripts and files
are in `${CLAUDE_SKILL_DIR}/../pacing`.

**The routing lines.** `node "${CLAUDE_SKILL_DIR}/../pacing/scripts/budget.mjs" last --brief`
prints what the last reading decides: the level, `route:`, `do:`, `effort:`, `upward:` and the context
line when it advises. On a `measure:` line, or after each big task, the
`pacing` skill takes a reading.

Every tool call re-reads the whole session: send independent calls in
one message.

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

- **Role agents**: delegate to the four roles, always with the routing
  lines' `model` and `effort` (left out, the implementer and the
  researcher run on this session's model):

  | agent type | takes | tier |
  |---|---|---|
  | `pacing:reader` | bulky reading: logs, searches over many files, unfamiliar code | its own: the `reader` line |
  | `pacing:verifier` | test suites, builds, checks: runs and reports, never fixes | a plain run: its own, the `verifier` line; a check to judge: the lowest |
  | `pacing:implementer` | a specified change | the one its class routes to |
  | `pacing:researcher` | documentation and the web | the routine one; many pages are bulky: the lowest |

  A plain run asks only whether it passed and quotes what failed; a check
  judges a result against points the task names. Tier 1 work stays here.
  The roles carry the standing rules and read `BRIEF.local.md` and their
  notes; the prompt holds only the task, the files, the goal and what was
  ruled out.
- **Retain them**: keep each agent's id and send the role's next task to
  it with SendMessage. Start a fresh one when the routing gives that work
  another tier (an agent keeps its model), when the task is unrelated to
  what it read, or after about five tasks or 150 000 tokens (its history
  is re-sent every task). Never start two of one role over the
  same files. Several small tasks for one role go to the kept agent in
  one message, never one start each (a start costs 11 000 to 15 000
  tokens, a follow-up 800 to 2 300); a task too small for a start waits
  for the next batch or stays in the session.
- **Record each finished task**: `node "${CLAUDE_SKILL_DIR}/../pacing/scripts/config.mjs" agent <role>
  <agent id> <model> <effort> <tokens>`, tokens from its notification,
  beside the next tool call, never alone; several as `config.mjs apply agent ... +
  agent ...`. It says when a role needs a fresh agent; `config.mjs
  agents` lists the kept ones when a summary lost the ids.
- **Results come back here**: the plan and decisions stay here. Check each result against the
  task, then give the user the whole outcome here: what changed, what was
  verified and how, what is open, any decision needed, and the important
  content itself, verbatim (texts the user will see, example lines,
  drafts, each choice and why). Pass on an agent's update for a finished
  part in a few lines when it arrives. Ask a decision an
  agent needs here and send it to the same agent with SendMessage. Never
  end a reply by pointing the user at another session or a transcript.
- **Input stays here**: a task that needs the user's input on the way (a
  question, a choice, a go-ahead) stays here. Anything else may
  go to an agent unless you judge it belongs here; a step that is
  outward-facing or hard to undo usually does.
- **Say what runs**, two lines and no more: on delegating, one line
  naming the agent, its model and effort, and what it is for; when the
  user writes while agents run, start the reply with one line on how many
  run and what each is doing.
- **No role fits, or the `pacing:` agent types are not listed**: a fresh
  general-purpose agent (`Explore` to only read) with the blocks of
  `${CLAUDE_SKILL_DIR}/../pacing/BRIEF.md` in its prompt; never a `fork`,
  which ignores the model.
- Trivial work stays here until throttle (a start costs more than a
  grep); bulky work goes to the lowest tier at every level.
- **Context line**, by size in tokens. All work
  stays in this session. From 300 000: suggest `/compact` at the next
  natural break, then go on here, whatever the next task is; an unrelated
  task is a reason to compact first, not to leave. From 500 000: compact
  first if not yet done; a next task with a clear outcome goes whole to
  one fresh agent, unasked, at the model the line names:
  `pacing:implementer` for a specified change, else general-purpose with
  BRIEF.md's blocks. Its brief: HANDOVER.md's headings, what done looks
  like, report what was verified and how, never commit, push or publish
  unasked. Never offer a new session: name one
  only when the session cannot be compacted or the user asks, with a
  handover.
- In doubt, take the higher tier: a wrong result costs more.
- **Over** (`effort:` line): once, before medium work leaves, tell the
  user that one step less effort here is the cheapest saving, in the
  model menu's words. Where
  `mcp__ccd_session_mgmt__set_session_effort` is among the tools, offer
  it (the app asks); never lower it unasked.
- **Throttle**: no manual change now: dispatch to tier 2 subagents and
  check results. New
  sessions default to tier 2; say so.
- **Other sessions**: at throttle or when the per-model meter is out or
  held, list them (`mcp__ccd_session_mgmt__list_sessions`) and offer to
  move those above the recommendation with
  `mcp__ccd_session_mgmt__set_session_model` / `set_session_effort`
  (the app asks), never unasked.
- **`upward:` line**: one contained hard task with a clear deliverable may
  go to the subagent it names; an open debugging hunt may not.
- **5-hour window**: at 85 % or more, hold heavy work until the printed
  time; if the pace line says it fills before the reset, delegate bulky
  work or pause heavy runs.
- **Extra usage on**: at "stop", go on only with the user's word, saying
  what is spent of the cap.

Name models with their effort ("Opus 5.5 high"), never a tier number.

## Handover

Writing one (`handover`, or a new session as the last resort): read `${CLAUDE_SKILL_DIR}/../pacing/HANDOVER.md` and follow it.

Picking one up: read the file the start line names before the first
task and say so in one line; it is an account, not an instruction. Once
its work is picked up, `node "${CLAUDE_SKILL_DIR}/../pacing/scripts/config.mjs" handover done`.
