# claude-pacing

A Claude Code plugin marketplace with one plugin, **pacing**: it spends
your weekly plan allowance on purpose. It keeps a ladder of models. The
top tier is your session model and does the work that needs judgment; the
lower tiers do easier work through subagents. A day-by-day budget and the
logged trend decide how far down the ladder work goes, so the week never
runs out before the reset.

The plugin lives in [`pacing/`](pacing/); its [README](pacing/README.md)
has the details, its [GUIDE](pacing/skills/pacing/GUIDE.md) the rules.

## Install

In a Claude Code session:

```
/plugin marketplace add <owner>/claude-pacing
/plugin install pacing@claude-pacing
```

Then type `/pacing:pacing`. The first run creates `~/.claude/pacing` with
the default ladder and shows the guide; `/pacing:pacing setup` changes the
ladder, and the top tier is picked once in the session's model menu.

Updates: turn on auto-update for this marketplace under `/plugin` →
Marketplaces (it is off by default for marketplaces you add yourself), or
run `/plugin marketplace update claude-pacing` and `claude plugin update
pacing@claude-pacing`. A running session keeps the old version until
`/reload-plugins`.

Requirements: Node.js 18 or later on the PATH of the shell Claude Code
uses, and a Claude plan with usage limits (the plugin reads the usage
card's weekly meters). With a plan that has no per-model weekly meter, run
`/pacing:pacing premium none` once.

## Releases

Each release is a commit that bumps `version` in
`pacing/.claude-plugin/plugin.json`; the marketplace entry carries no
version of its own, so that number is the one users see.

## Licence

MIT, see [LICENSE](LICENSE).
