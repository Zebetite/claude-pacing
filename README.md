# claude-pacing

A Claude Code plugin marketplace with one plugin, **pacing**.

The plugin makes use of better AI models and saves tokens at the same time by
delegating easier tasks to subagents with cheaper models. This skill
spends your weekly plan allowance on purpose. It uses tiers of models,
the top tier is used for the most difficult work; the lower tiers do
easier work through subagents. A day-by-day budget and the logged trend
decide how far down the tiers work goes, so the week doesn't run out
of tokens as easily before the reset. That means it uses better models automatically when
you have more usage left. You can custom set how many tiers you want and
set exactly what model and effort each tier should use.

4 role agents (reader, verifier, implementer and researcher) each
stay with the session and keep notes per project, and a long
session hands its work over to a new one. A status line shows what is left
of the budget and the usage.

The plugin lives in [`pacing/`](pacing/); its [README](pacing/README.md)
has the details, its [GUIDE](pacing/skills/pacing/GUIDE.md) the rules.

## What it does

- **Tiers of models.** By default Fable 5.2 high runs the session, and
  Opus 5.5 medium and Sonnet 5.5 medium take work as subagents. While
  Fable's meter is full, Opus 5.5 high takes the top place.
  The number of tiers and each tier's model and effort are yours to set.
- **A budget line for every day.** The weekly meter is compared with a
  budget line that steps up at midnight. Ahead of it, the top model does nearly
  everything; past it, more work moves down the tiers. The logged trend
  can raise the level before the meter gets there. Fable's meter is
  paced on the same budget line while Fable runs the session, so a long session
  cannot drain it unseen.
- **A status line after every turn** (new in 0.8):

  ```
  Budget tokens: 850K · usage: Weekly 36% Fable 40%
  ```

  What is left under today's budget line, in full-price tokens of tier
  1's model, the same in every session (learned from what the spending cost, so cache reads
  count at their lower price; until then estimated from this week's
  transcripts and marked `~`, as in `Budget tokens: ~36M`), then the usage of the weekly meters; while subagents run, how many first (`⏳ 2 Subagents
  running`). The budget and the usage always show whole; where room is
  short (70 characters in the desktop app, 75 in a terminal) only the
  agents' part shrinks (`⏳ 2 Subagents · Budget tokens: 850K · usage:
  Weekly 36% Fable 40%`). `/pacing-status` shows the whole status line in words, with
  how this session's own use splits over the ladder's models
  (subagents included).
  It comes from readings the plugin takes by itself after a turn, on a
  Claude Code version with hooks modules; older versions run the rest of
  the plugin as before.
- **Role agents the session keeps.** A reader (Haiku 5.5 by default) for
  logs, searches and unfamiliar code, a verifier for tests and checks, an
  implementer for specified edits, and a researcher for documentation.
  Each leaves notes per project for the next agent of its role.
- **Handover between sessions.** A session that has grown long writes
  what the next one needs; the next session's start line names the file.
  From 300 000 tokens the skill suggests compacting at a natural break,
  and a prompt sent after an hour's pause in such a session gets one
  toast that the cache has lapsed.
- **A start line in every new session** with the last reading and the
  recommended model, which can also become the default for new sessions.
- **Weekly summaries** (`/pacing week`), and at "over" a suggestion to
  lower the session's effort one step before work moves down a tier.

## Install

In a Claude Code session:

```
/plugin marketplace add Zebetite/claude-pacing
/plugin install pacing@claude-pacing
```

Then type `/pacing:pacing`. The first run creates `~/.claude/pacing` with
the default ladder and shows the guide; `/pacing:pacing setup` changes the
ladder, and the top tier is picked once in the session's model menu.

Updates: turn on auto-update for this marketplace under `/plugin` →
Marketplaces (it is off by default for marketplaces you add yourself), or
run `/plugin marketplace update claude-pacing` and `claude plugin update
pacing@claude-pacing`. A running session then shows a row above the prompt
that says to type `/reload-plugins` or open a new session, with **Not now**
(`/pacing reload off` puts a one-line toast in its place).

Requirements: Node.js 18 or later on the PATH of the shell Claude Code
uses, and a Claude plan with usage limits (the plugin reads the usage
card's weekly meters). With a plan that has no per-model meter, run
`/pacing:pacing premium none` once.

## Tests

`npm test` (or `node --test`) in this folder runs the tests in `tests/`.
They need nothing installed. Each script runs in a child process whose
home folder is a new temp folder, so the tests never read or change your
own `~/.claude`. The `tests/` folder is outside the plugin and is not
published with it.

The hooks module for automatic readings has its own test, which runs
under Claude Code's test kit: `claude plugin test pacing`.

## Releases

Each release is a commit that bumps `version` in
`pacing/.claude-plugin/plugin.json`; the marketplace entry carries no
version of its own, so that number is the one users see.

## Licence

MIT, see [LICENSE](LICENSE).
