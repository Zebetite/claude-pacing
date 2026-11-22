---
name: route
description: "Rules for delegating work under pacing: which work this session keeps and which goes to the role agents (reader, verifier, implementer, researcher) at which model and effort; what to do at over, throttle, held or out, and with a long session's next task. Load once per session, before the first delegation; it stays loaded."
---

# Pacing: routing work

The `pacing` skill reports and holds the settings. `config.mjs` below is
`node "${CLAUDE_SKILL_DIR}/../pacing/scripts/config.mjs"`.

**The routing lines.** `node "${CLAUDE_SKILL_DIR}/../pacing/scripts/budget.mjs" last --brief`
prints what the last reading decides: the level, `route:`, `do:`,
`effort:`, `upward:` and the context line when it advises. On a
`measure:` line the `pacing` skill takes a reading.

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

- **Role agents**, always with the routing lines' `model` and `effort`
  (left out, the implementer and the researcher run on this session's
  model):

  | agent type | takes | tier |
  |---|---|---|
  | `pacing:reader` | bulky reading: logs, many files, unfamiliar code | its own: the `reader` line |
  | `pacing:verifier` | test suites, builds, checks; never fixes | a plain run: its own, the `verifier` line; a check to judge: the lowest |
  | `pacing:implementer` | a specified change | the one its class routes to |
  | `pacing:researcher` | documentation and the web | the routine one; many pages: the lowest |

  A plain run asks only whether it passed and quotes what failed; a check
  judges a result against points the task names. Tier 1 work stays here.
  The roles fetch their rules and notes themselves: the prompt holds only
  the task, the project folder, the files, the goal and what was ruled
  out. Start independent agents in one message.
- **Retain them**: keep each agent's id and send the role's next task to
  it with SendMessage. A fresh one when the routing gives that work
  another tier (an agent keeps its model), when the task is unrelated to
  what it read, or when pacing says the role needs one (about five tasks
  or 150 000 tokens: its history is re-sent every task). Never start two
  of one role over the same files. Several small tasks for one role go to the kept agent in
  one message, never one start each (a start costs 11 000 to 15 000
  tokens, a follow-up 800 to 2 300); a task too small for a start waits
  for the next batch or stays in the session. `config.mjs agents` lists
  the kept ones when a summary lost the ids. Without the hooks module (no
  pacing status line), record each finished task: `config.mjs agent
  <role> <agent id> <model> <effort> <tokens>`, beside the next tool call, never alone.
- **Results come back here**, and the plan and decisions stay here. Check
  each result against the task, then give the user the whole outcome here: what changed, what was verified and how, what is open, any decision needed,
  and the important content itself, verbatim (texts the user will see,
  example lines, drafts, each choice and why). Pass on a part's update in
  a few lines when it arrives. Ask a decision an agent needs here and send it to the same agent with SendMessage. Never end a reply by pointing the user at another session or a transcript.
- **Input stays here**: a task that needs the user's input on the way (a
  question, a choice, a go-ahead) stays here. Anything else may go to an agent unless you judge it belongs here; a step that is outward-facing or hard to undo usually does.
- **Say what runs**, one line each and no more: on delegating, the agent, its model
  and effort, and its task; when the user writes while agents run, the
  reply starts with how many run and what each is doing.
- **No role fits, or no `pacing:` agent types listed**: a fresh
  general-purpose agent (`Explore` to only read) with what
  `config.mjs start --project "<folder>"` prints atop its prompt; never a
  `fork`, which ignores the model.
- Trivial work stays here until throttle (a start costs more than a
  grep); bulky work goes to the lowest tier at every level.
- **Context line**, in tokens. All work stays in this session. From
  300 000: suggest `/compact` at the next natural break, then go on here,
  whatever the next task is; an unrelated task is a reason to compact
  first, not to leave. From 500 000: compact first if not yet done; a
  next task with a clear outcome goes whole to one fresh agent, unasked,
  at the model the line names (`pacing:implementer` for a specified
  change, else general-purpose with the `start` brief), briefed with
  HANDOVER.md's headings, what done looks like, report what was verified
  and how, never commit, push or publish unasked. Never offer a new
  session: name one only when the session cannot be compacted or the
  user asks, with a handover.
- In doubt, take the higher tier: a wrong result costs more.
- **Over** (`effort:` line): one step less effort here saves most. Where
  the hooks module runs (a pacing status line shows), its Switch row
  offers it: say nothing. Without it (as in a terminal), say it once, in
  one line, before medium work leaves (`/effort <level>` or the model
  menu). Never ask: this session cannot change its own model or effort.
- **Throttle**: no manual change now: dispatch to tier 2 subagents and
  check results.
- **Other sessions**: at throttle, or with the per-model meter out or
  held, list them (`mcp__ccd_session_mgmt__list_sessions`) and offer to
  move those above the recommendation (`set_session_model` /
  `set_session_effort`; the app asks; other sessions only), never unasked.
- **`upward:` line**: one contained hard task with a clear deliverable may
  go to the subagent it names; an open debugging hunt may not.
- **5-hour window**: at 85 % or more, hold heavy work until the printed
  time; if the pace line says it fills before the reset, delegate bulky
  work or pause heavy runs.
- **Extra usage on**: at "stop", go on only with the user's word, saying
  what is spent of the cap.

**Handover**: writing one (`handover`, or a new session as the last
resort): read `${CLAUDE_SKILL_DIR}/../pacing/HANDOVER.md` and follow it.
