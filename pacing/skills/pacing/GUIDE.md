# Model pacing: the intro guide

`/pacing version` shows the installed version.

Use better models and still save weekly usage at the same time by
delegating easier work to subagents with cheaper models. This skill
spends your weekly plan allowance on purpose. It uses tiers of models,
the top tier is used for the most difficult work; the lower tiers do
easier work through subagents. A day-by-day budget and the logged trend
decide how far down the tiers work goes, so the week never runs out
before the reset. That means it uses better models automatically when
you have more usage left. You can custom set how many tiers you want and
what model and effort should be on every tier.

The default ladder:

| tier | model | takes |
|---|---|---|
| 1 | Fable 5.2 high | the session: judgment work |
| 2 | Opus 5.5 medium | subagents: routine work |
| 3 | Sonnet 5.5 medium | subagents: bulky output (logs, test runs, many files) |

While Fable's own meter is full, **Opus 5.5 high** takes tier 1 in its
place, so judgment work keeps a strong model and routine work stays on
the cheaper Opus 5.5 medium (`/pacing fallback` changes or removes that).

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
> **Fable 5.2** and the effort to **high**. New sessions start there by
> themselves once the switch is on, but the app reads its preset file
> only at startup: a change the skill makes while the app runs shows in
> the model menu after the next app restart. Until then pick the model
> and effort in the menu once; the app then stores that as its preset
> itself. Every new session also shows
> the recommended model in a pacing line at start and says so in its first
> reply when it runs on something else: then **switch the model menu**
> before the first big task. A preset of your own (one named per project
> in the model menu) keeps its own model; the skill only sets the built-in
> one. While that start line is fresh, the session uses it instead of
> taking a new reading; the next reading comes after the first big task.

## What it watches

| meter | role |
|---|---|
| Weekly · all models | the paced meter: the budget line is drawn against it |
| Weekly · Fable (the plan's per-model meter; `/pacing premium` names the model, `none` if the plan has no such meter) | not paced; at 100 % every tier of that model leaves the ladder |
| 5-hour limit | shared by all models; the report shows the pace inside the window and when it would be full; at 85 % it says to hold heavy work until the reset |
| extra usage | when the plan allows charges past 100 %, the report shows what is spent of the monthly cap, and "stop" becomes "going on is charged" |

The report also gives a **spend rate**: the percent per hour that lands
at 100 % exactly at the reset, and how much of today's line is still
free. That is what "ahead by 36" is worth in practice.

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
| ahead | more than 5 points under the line | tier 1 | tier 1 | tier 1 | tier 1 |
| on pace | within 5 points under the line | tier 1 | tier 1 | tier 2 | tier 1 |
| over | up to 5 points over the line | tier 1 | tier 2 | tier 2 | tier 1 |
| throttle | more than 5 points over | tier 2, the session itself only for what tier 2 would get wrong | tier 2 | tier 2 | tier 2 |
| stop | all models at 95 % or more | wrap up | | | |
| Fable out (or whichever model the per-model meter belongs to) | that meter at 100 %, on top of any level | the model drops out of the ladder and the fallback tier (Opus 5.5 high) takes tier 1; the level above still decides the routing | | | |

At "over" the skill first suggests one step less effort on the session's
own model (Fable 5.2 high to medium with the default ladder): it saves on
every turn and keeps the work where it is. Only you can change it, in the
model menu or when the app asks you; the skill never lowers it unasked.

Trivial work (a grep, a rename, one file summarised) stays in the session
until throttle: a subagent costs tens of thousands of tokens before it
reads a file, so delegating a grep to a cheaper model costs more on the
meter than doing it in the session. The exception at every level is
**bulky** work, whatever its difficulty: log reading, test-suite runs, a
fan-out over many files go to the lowest tier, because what a subagent
reads stays out of the session's context, which is re-sent on every later
turn.

## The trend

Every reading is logged. From the oldest reading of the last two days the
skill computes the burn rate and projects the meter at the reset. A
projection past 100 % raises the level to at least "over"; past 115 % to
"throttle", and the report names the day the meter would hit 100 %. The
projection only counts once the sample spans 20 h or more, so that it
covers a night: a busy morning alone is shown as a trend but does not
move the level. `/pacing log` shows the readings.

The first reading after a reset sums up the week before in one line:
where the meter ended, how much of the time went at each level, and
whether it crossed the budget line. `/pacing week` shows the same for the
last two weeks.

## Automatic readings

On a Claude Code version with hooks modules, the plugin also takes a
reading by itself after a turn: when the weekly meter has moved a whole
point, or 30 minutes after the last reading. It keeps the start line
fresh for the next session and shows it in the status line, with one
notice when the level changes:

    77% of budget, 🟡Tier 1[80%] ⚪Tier 2[15%] 🟤Tier 4[5%], (36% Weekly, 40% Fable)

That is the weekly meter as a share of today's budget line (over 100 %
means over the line), how this session's own use splits over the tiers,
subagents included, and the two meters. The split is an estimate: each
model's tokens priced at its API rates, which is how the weekly meter
weighs the models too. The reader agent's model, when it is not on the
ladder, counts as the tier after the last (tier 4 with three tiers). The
circles are gold, silver, bronze and brown for tiers 1 to 4 (🟡 ⚪ 🟠 🟤),
then 🟣 🔴 🔵 🟢 for a longer ladder; ⚫ is a model the ladder does not
hold. Claude Code hands a plugin only the all-models and 5-hour meters,
so such a reading carries the per-model figure (Fable's by default) over
from the last full reading of the week, and it never changes the next session's model: that
stays with the readings the session takes. `/pacing log` marks them
`(auto)`. On an older Claude Code the plugin works as before, without
them.

## The session's own context

Every turn re-sends the whole conversation, so a long session makes each
later turn expensive whatever model runs it. While you keep working, the
history is read back cheaply; after a pause it has to be stored again in
full, so a long session costs most right after a break.

The skill goes by the session's size in tokens, not by its share of the
window, since a window can be large or small:

| size | what the skill advises |
|---|---|
| under 300 000 tokens | nothing |
| from 300 000 | a task that has nothing to do with this session's work starts in a new session; follow-ups stay, because a new session would have to learn it all again |
| from 500 000 | the skill says so before the next task |

Bulky reading (logs, test output, many files) goes to the reader agent
for the same reason: what the agent reads never enters the session's
context.

**Leaving a long session.** `/pacing handover` has the session write down
where the work stands: the goal, what is done and what is verified, the
decisions and their reasons, the open items in order, the files and
commands that matter, and what was ruled out. The next session you start
in the same project is told about that file in its start line and reads
it before its first task, so moving on no longer means starting from
nothing. The handover is the earlier session's account, not an order:
you decide what the new session does. `/pacing handover done` files it
away once the work is picked up; nothing is deleted.

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

## The role agents

The work that leaves the session goes to four agents the plugin brings,
each with its own instructions and tools:

| agent | does | may change files |
|---|---|---|
| reader | searches, logs, test output, unfamiliar code; reports conclusions, not dumps | no |
| verifier | runs tests, builds and checks; reports what passed and failed, never fixes | no |
| implementer | makes a change the session specified | yes |
| researcher | documentation and the web, with sources | no |

The budget still picks the model: each call gets the model and effort of
the tier that work routes to at the current level. The reader is the
exception: finding and summing up asks less than any other work, so it
reads on a model of its own, **Haiku 5.5 medium** by default, at every
level. `/pacing reader sonnet medium` gives it another model;
`/pacing reader ladder` makes it follow the lowest tier.

**They are kept, not thrown away.** The session starts a role the first
time it needs one and sends later tasks to the same agent, which still
knows what it read. That saves the start-up cost of a new agent every
time and gives better answers on the second task than on the first.
What it remembers can go stale, so a kept agent checks again any figure
it quotes from an earlier task before it reports it. An
agent is replaced when its work moves to another tier, when a task has
nothing to do with what it knows, or when it has grown long (five tasks
or 150 000 tokens), since its whole history is sent again with every
task. The session records each finished task with the agent's id, model
and tokens, so it can find its agents again after its own history was
summarised. `/pacing agents` shows them, and what each role has cost per
model, fresh against resumed: the figures that tell whether five tasks
is the right limit.

**What they learn outlasts the session.** An agent ends with its session,
so each role keeps a notes file per project: where things live, how the
tests run and how long they take, a trap to avoid. A new agent reads its
file first, adds a line when it learns something lasting, and replaces a
line that is no longer true. The files
are plain text in `~/.claude/pacing/notes/<project>/`, yours to read,
edit or delete; `/pacing notes` shows where they are for the project at
hand.

The agents carry the standing rules in their own instructions, so the
rules do not depend on the session remembering them: never touch another
folder, never commit unasked, never delete, report failures verbatim.
They also read your own additions and project blocks in
`~/.claude/pacing/BRIEF.local.md` (created empty on the first run, yours
to fill, untouched by updates) and the project's own CLAUDE.md rules.

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
| `/pacing weight 2` | how much the last day before the reset weighs against the others (1 to 3; 1.5 by default) |
| `/pacing log` | the last readings |
| `/pacing week` | the last two weeks in sum: where the meter ended, the share of the time at each level, and whether it crossed the line |
| `/pacing next on`, `/pacing next off` | lets the skill set, or stop setting, the default model of new sessions |
| `/pacing premium opus`, `/pacing premium none` | names the model the plan's per-model weekly meter belongs to (Fable by default), or says the plan has none |
| `/pacing fallback opus high`, `/pacing fallback none` | the tier that takes the top place while that meter is full (Opus 5.5 high by default); none lets the remaining tiers move up |
| `/pacing reader haiku medium`, `/pacing reader ladder` | the model the reader agent reads on (Haiku 5.5 medium by default), or the lowest tier |
| `/pacing notes` | where the role agents' notes for this project are, and how long each is |
| `/pacing agents` | the role agents this project's session keeps, and their tokens by role and model |
| `/pacing handover` | the session writes a handover for the next session of this project |
| `/pacing handover done` | files the waiting handover away once its work is picked up |
| `/pacing version` | the installed plugin version |

Your files live in `~/.claude/pacing`: the configuration in `config.json`,
the readings in `log.jsonl`, the last one in `state.json`, your subagent
rules in `BRIEF.local.md`. A plugin update replaces the plugin's own
folder and leaves that one alone. The first run creates the configuration
from the defaults (or takes over the files of an earlier standalone
install of this skill) and shows this guide once.
