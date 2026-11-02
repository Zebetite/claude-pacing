# pacing — a Claude Code plugin that paces the weekly allowance

This skill spends your weekly plan allowance on purpose. It keeps a ladder
of models (by default Fable 5.1 high for the session, Opus 5.5 high and
Sonnet 5.5 medium for subagents). The top tier is your session model and
does the work that needs judgment; the lower tiers do easier work through
subagents. A day-by-day budget line against the **Weekly · all models**
meter and the logged trend decide how far down the ladder work goes, so
the week never runs out before the reset. `skills/pacing/GUIDE.md`
explains the rules; `skills/pacing/SKILL.md` is what Claude follows.

## What is in the plugin

| path | what |
|---|---|
| `.claude-plugin/plugin.json` | the manifest: name `pacing`, the version |
| `skills/pacing/SKILL.md` | the skill, invoked as `/pacing:pacing` (or by typing "usage") |
| `skills/pacing/GUIDE.md`, `BRIEF.md` | the user guide and the standing brief pasted into subagent prompts |
| `skills/pacing/scripts/*.mjs` | `budget.mjs` (the rule), `config.mjs` (the ladder), `hook.mjs` (session start), `models.mjs` (the model table) |
| `hooks/hooks.json` | a SessionStart hook that shows the last reading and the recommended model |

The scripts run with `node` (Node.js 18 or later), which must be on the
PATH of the shell Claude Code uses.

## Install

From the marketplace this plugin is published in:

```
/plugin marketplace add <owner>/claude-pacing
/plugin install pacing@claude-pacing
```

From an organisation's plugin library on claude.ai: Claude Code sessions
signed in with the claude.ai account pick the plugin up at start (it shows
as `pacing@synced` under `/plugin` → Installed); new versions arrive the
same way, followed by `/reload-plugins`. To try a local copy for one
session: `claude --plugin-dir <this folder>`.

Then, in a session, type `/pacing:pacing`. The first run creates the data
folder, shows the guide once, and takes over the files of an earlier
standalone install of this skill (`~/.claude/skills/pacing`) if there is
one. Run `/pacing:pacing setup` to confirm or change the ladder, then pick
the top tier in the session's model menu (the skill cannot switch a
running session's model). On a plan whose usage card has no per-model
weekly meter (no "Weekly · Fable" or similar line), run `/pacing:pacing
premium none` once; on a plan that meters another model, name it
(`premium opus`).

## What is written where

Everything the user owns lives in `~/.claude/pacing`, outside the plugin
folder, which an update replaces:

| file | what |
|---|---|
| `config.json` | the ladder, the last-day weight, the per-model meter, the next-session switch |
| `log.jsonl`, `state.json` | the readings, and the last one for the hook |
| `BRIEF.local.md` | the user's own rules for subagents (never part of the plugin) |

With the next-session switch on, the skill also writes the recommended
model into `~/.claude/settings.json` (`model`, `effortLevel`) and, on
Windows, into the desktop app's built-in preset for new local sessions.
On macOS and Linux the preset is not touched; the session start line says
when to change the model menu by hand.

## Coming from the standalone skill

If `~/.claude/skills/pacing` is still installed next to the plugin, both
load (`/pacing` and `/pacing:pacing`) and two session-start hooks fire.
Once the plugin works: `node ~/.claude/skills/pacing/scripts/config.mjs
hook off` removes the old hook line from `settings.json`, then delete that
folder.

## Remove

Remove the plugin in `/plugin`; delete `~/.claude/pacing` if the readings
and the local brief are not wanted either.

## Licence

MIT, see [LICENSE](LICENSE).
