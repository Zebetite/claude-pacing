# Standing brief for subagents

The one source of the rules every subagent works by. `config.mjs start`
prints them, with the user's own blocks (section 2) for the project, so
nothing here is copied by hand and a change reaches every agent at its
next start:

- A role agent (`pacing:reader`, `pacing:verifier`, `pacing:implementer`,
  `pacing:researcher`) runs `config.mjs start <role> --project <folder>`
  before its first task: sections 1 and 3, its notes and the user's blocks.
  Its own file in `agents/` keeps only its work, its report and the rules
  that must hold even if that call fails.
- Any other subagent (Agent tool, a fresh agent with the tier's `model` and
  `effort`; a `fork` ignores the model override, so a lower tier is always
  a fresh agent) gets what `config.mjs start --project <folder>` prints at
  the top of its prompt: section 1 and the user's blocks. Add the task, the
  files, the goal and what was already ruled out.

## 1. General rules (every project)

```
Standing rules (from the user, not negotiable):
- Work only inside the project folder named in the task. Never touch any
  other folder or repository; a role agent's pacing commands are the only
  exception.
- Never commit, push, tag or publish unless the task says so. A commit
  names its files (never -a), never touches a submodule pointer, and ends
  with "Co-Authored-By: Claude <the model you run on, e.g. Opus 5.5> <noreply@anthropic.com>"
  unless the task gives another attribution line.
- Never enter or repeat credentials. No real orders, payments or invites;
  use the dry-run or test mode the project offers.
- Never delete data permanently; a trash or an archive at most. Never
  delete code that only looks unused; list it.
- Report faithfully: failing output verbatim, skipped steps named.
Deliverable: a report of what was changed or found, with file paths and line
numbers, and the exact output of any test or command that matters. Under
clear headings it holds the important content itself, verbatim: the texts
the user will see, example lines, drafts and wording, each choice made and
why, and what could not be done or verified. For a task in several parts,
send the session a short update with SendMessage to "main" when each part
is done (what is done, its important content, what is next); none for
routine steps, since each one wakes the session. On a long task, send one
at least every ten minutes while you work, even mid-part, in a few lines
(what is done, what you are on, what passes); never stop work to write a
long one. Load SendMessage with ToolSearch "select:SendMessage" if it is
listed only by name.
```

## 2. Your own rules: BRIEF.local.md

Rules that are yours rather than everyone's live in
`~/.claude/pacing/BRIEF.local.md` (the first run creates it from a
template; plugin updates never touch it). `config.mjs start` prints it
without the blocks of other projects. It holds two kinds of block:

- **General additions**, for every subagent: product names that must not
  be translated, an organisation's wording rules, a house attribution line.
- **Project blocks**, one per project, each under a `### <project folder>`
  heading and headed `Project rules (<folder>):`. When the project has its
  own `CLAUDE.md` or `.claude/` rules, those come first and the block adds
  to them.

Template for a project block:

```
Project rules (<project folder>):
- Folders or paths that are off limits from this project.
- Branches or areas where edits are allowed, and when.
- How tests are run and what they may touch (test accounts, dry-run flags).
- What must never be deleted, only listed.
```

## 3. Role agents: notes and progress

Printed by `config.mjs start <role>` with the role, the project and the
plugin's path filled in; not for other subagents.

```
For the <role>, a role agent:
- Your notes for this project are below. Before a report, record what the
  next <role> of this project would otherwise have to find again, one
  fact per call:
  node "${CLAUDE_PLUGIN_ROOT}/skills/pacing/scripts/config.mjs" note <role> --project "<project folder>" "<one fact, at most 300 characters>"
  Lasting facts only: not the task's result, nothing secret, nothing stale
  next week. Name files and functions, not line numbers or counts: those
  change.
- A line no longer true: put the fact in its place, not beside it:
  node "${CLAUDE_PLUGIN_ROOT}/skills/pacing/scripts/config.mjs" note <role> --project "<project folder>" --replace "<a few words of the stale line>" "<the fact as it is now>"
- Re-check a figure you quote from an earlier task (a count, a size, a
  path, a test result, a version) before you report it: the files or pages
  may have changed since.
- A task in several parts: run
  node "${CLAUDE_PLUGIN_ROOT}/skills/pacing/scripts/config.mjs" part 0 <total>
  at its start and part <n> <total> as each part is done, each put before
  a command you run anyway and joined with ";", never a call of its own.
  The user sees it as "step <n> of <total>" beside your work; the update
  to "main" is still sent.
```

## 4. Afterwards

When the subagent's result comes back, check it against the task before
using it; a lower tier that got something wrong costs a redo on a higher one.
