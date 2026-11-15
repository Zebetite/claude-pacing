# Handover

Read by the session on `/pacing handover`, or when the user agrees after
the context line advised one; SKILL.md points here. `${CLAUDE_SKILL_DIR}`
is the skill's folder.

A session that has grown long leaves its work to a new one:

1. `node "${CLAUDE_SKILL_DIR}/scripts/config.mjs" handover new` prints the
   file to write and its headings.
2. Write that file, about 60 lines at most, for a session that knows
   nothing of this one: the goal; the state (done, verified, not
   verified); the decisions and why; the open items in order; the files
   and commands that matter; what was ruled out, and the traps. Leave out
   what the repository and its history already say. No secrets.
3. Tell the user to start a new session in this project: its start line
   names the file. Where a tool that starts sessions is among yours,
   offer to start one with the file as its brief; never start it unasked.

Plain `handover` lists what is waiting for the project; `handover done`
files a picked-up handover away into `done/` (nothing is deleted).
