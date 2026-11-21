# Standing brief for subagents

The plugin's role agents (`pacing:reader`, `pacing:verifier`,
`pacing:implementer`, `pacing:researcher`) carry section 1 in their own
prompts and read section 2's file themselves: nothing is pasted for them.
A change to section 1 goes into the four files in `agents/` as well.

For any other subagent, paste the blocks below into the prompt (Agent
tool, a fresh agent with the tier's `model` and `effort`; a `fork` ignores
the model override, so a lower tier is always a fresh agent). Add the
task, the files, the goal and what was already ruled out above them.

## 1. General rules (every project)

```
Standing rules (from the user, not negotiable):
- Work only inside the project folder named in the task. Never touch any
  other folder or repository.
- Never commit or push unless the task says so. A commit names its files
  (never -a), never touches a submodule pointer, and ends with
  "Co-Authored-By: Claude <the model you run on, e.g. Opus 5.5> <noreply@anthropic.com>"
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
routine steps.
```

## 2. Your own rules: BRIEF.local.md

Rules that are yours rather than everyone's live in
`~/.claude/pacing/BRIEF.local.md` (the first run creates it from a
template; plugin updates never touch it). It holds two kinds of block:

- **General additions**, pasted after the block above in every prompt:
  product names that must not be translated, an organisation's wording
  rules, a house attribution line.
- **Project blocks**, one per project, headed `Project rules (<folder>):`.
  Paste the block for the project at hand. When the project has its own
  `CLAUDE.md` or `.claude/` rules, those come first and the block adds to
  them; when neither exists, say so to the user once and go on with the
  general rules alone.

Template for a project block:

```
Project rules (<project folder>):
- Folders or paths that are off limits from this project.
- Branches or areas where edits are allowed, and when.
- How tests are run and what they may touch (test accounts, dry-run flags).
- What must never be deleted, only listed.
```

## 3. Afterwards

When the subagent's result comes back, check it against the task before
using it; a lower tier that got something wrong costs a redo on a higher one.
