# Model pacing: the intro guide

`/pacing version` shows the installed version.

This skill spends your weekly plan allowance on purpose. It keeps a ladder
of models. The top tier is your session model and does the work that needs
judgment; the lower tiers do easier work through subagents. A day-by-day
budget and the logged trend decide how far down the ladder work goes, so
the week never runs out before the reset.

The default ladder:

| tier | model | takes |
|---|---|---|
| 1 | Fable 5.1 high | the session: judgment work |
| 2 | Opus 5.5 high | subagents: routine work |
| 3 | Sonnet 5.5 medium | subagents: trivial work |

## ⚠️ Setup, two steps

> **1. Run `/pacing setup`** once to confirm or change the ladder, and to
> decide on the next-session model switch (the skill writes the
> recommended model into the desktop app's preset for new local sessions,
> and into `~/.claude/settings.json` for the terminal CLI). The other
> automation, the SessionStart hook that shows every new session the last
> reading and the recommended model, comes with the plugin and needs no
> setup.
>
> **2. Pick tier 1 yourself in the model menu.** The skill cannot switch a
> running session's model. With the default ladder, set the session to
> **Fable 5.1** and the effort to **high**. New sessions start there by
> themselves once the switch is on, but the app reads its preset file
> only at startup: a change the skill makes while the app runs shows in
> the model menu after the next app restart. Until then pick the model
> and effort in the menu once; the app then stores that as its preset
> itself. Every new session also shows
> the recommended model in a pacing line at start and says so in its first
> reply when it runs on something else: then **switch the model menu**
> before the first big task. A preset of your own (one named per project
> in the model menu) keeps its own model; the skill only sets the built-in
> one.

## What it watches

| meter | role |
|---|---|
| Weekly · all models | the paced meter: the budget line is drawn against it |
| Weekly · Fable (the plan's per-model meter; `/pacing premium` names the model, `none` if the plan has no such meter) | not paced; at 100 % every tier of that model leaves the ladder |
| 5-hour limit | shared by all models; at 85 % the report says to hold heavy work until it resets |

## The budget line

The week has 7 days ending at the reset. The last 24 h weigh 1.5, the
rest 1, so a full day in the first six may use 13.3 % of the week and the
last day keeps 20 %. The whole of the current calendar day's allowance
counts from midnight, so the line is a step that rises at midnight (not
at the hour of the reset): with a reset at noon, 6.7 % for the half day
the week starts with, 20 % from the first midnight, 33.3 % from the next,
and so on. Each time the skill runs it compares the all-models meter with the
line and routes four classes of work (judgment, medium, routine, trivial)
onto the tiers:

| level | meaning | judgment | medium | routine | trivial |
|---|---|---|---|---|---|
| ahead | more than 5 points under the line | tier 1 | tier 1 | tier 1 | lowest |
| on pace | within 5 points under the line | tier 1 | tier 1 | tier 2 | lowest |
| over | up to 5 points over the line | tier 1 | tier 2 | tier 2 | lowest |
| throttle | more than 5 points over | tier 2, the session itself only for what tier 2 would get wrong | tier 2 | tier 2 | lowest |
| stop | all models at 95 % or more | wrap up | | | |
| Fable out (or whichever model the per-model meter belongs to) | that meter at 100 %, on top of any level | the model drops out of the ladder; the level above still decides the routing, on the tiers that remain | | | |

## The trend

Every reading is logged. From the oldest reading of the last two days the
skill computes the burn rate and projects the meter at the reset. A
projection past 100 % raises the level to at least "over"; past 115 % to
"throttle", and the report names the day the meter would hit 100 %. The
projection only counts once the sample spans 20 h or more, so that it
covers a night: a busy morning alone is shown as a trend but does not
move the level. `/pacing log` shows the readings.

## What the skill can and cannot do

A session cannot switch its own model, so tier 1 is always your choice in
the model menu (setup step 2). The skill steers by delegating work to
subagents on the lower tiers, by writing the recommended model into the
desktop app's built-in preset for new local sessions and into
settings.json for the terminal CLI, and by telling you at the start of
every session when to switch by hand. Your *other* open sessions it can
switch for you: at throttle or Fable out it offers to move them to the
recommended model, the app asks you to confirm, and the change applies
from each session's next turn. A session that runs on a lower tier may
hand one contained hard task to a tier 1 subagent; an open debugging hunt
stays in the conversation.

Subagents get the standing rules in every prompt, so the rules do not
depend on the session remembering them: the general block from BRIEF.md,
your own additions and project blocks from `~/.claude/pacing/BRIEF.local.md`
(created empty on the first run, yours to fill, untouched by updates), and
the project's own CLAUDE.md rules.

## Commands

Installed as a plugin, the skill answers to `/pacing:pacing` (plugin
name, colon, skill name); `/pacing` below stands for that. Typing "usage"
in plain words works too.

| command | what it does |
|---|---|
| `/pacing`, `/pacing usage`, or just typing "usage" | reads the meters, runs the budget line, reports the level, the trend and the routing |
| `/pacing help` | shows this guide (also on "usage help") |
| `/pacing setup` | asks how many tiers and which model and effort each one has, and about the next-session switch; writes config.json |
| `/pacing set 2 opus xhigh` | changes one tier (models fable, opus, sonnet, haiku; efforts low, medium, high, xhigh, max) |
| `/pacing add haiku low` | adds a tier at the bottom (up to six) |
| `/pacing remove 3` | drops a tier (two must remain) |
| `/pacing reset` | back to the default three tiers |
| `/pacing log` | the last readings |
| `/pacing next on`, `/pacing next off` | lets the skill set, or stop setting, the default model of new sessions |
| `/pacing premium opus`, `/pacing premium none` | names the model the plan's per-model weekly meter belongs to (Fable by default), or says the plan has none |
| `/pacing version` | the installed plugin version |

Your files live in `~/.claude/pacing`: the configuration in `config.json`,
the readings in `log.jsonl`, the last one in `state.json`, your subagent
rules in `BRIEF.local.md`. A plugin update replaces the plugin's own
folder and leaves that one alone. The first run creates the configuration
from the defaults (or takes over the files of an earlier standalone
install of this skill) and shows this guide once.
