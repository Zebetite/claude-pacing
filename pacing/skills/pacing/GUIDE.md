# Model pacing: the intro guide

`/pacing version` shows the installed version.

<!-- help -->Use better models and still save weekly usage at the same time by
delegating easier work to subagents with cheaper models.<!-- /help --> This skill
spends your weekly plan allowance on purpose. It uses tiers of models,
the top tier is used for the most difficult work; the lower tiers do
easier work through subagents. <!-- help -->A day-by-day budget and the logged trend
decide how far down the tiers work goes, so the week doesn't run out
of tokens as easily before the reset.<!-- /help --> That means it uses better models automatically when
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

<!-- help -->
## ⚠️ Setup, two steps

> **1.** Type `/pacing setup` and answer the questions. Unsure? Keep the
> defaults.
>
> **2.** In the model menu, pick the tier 1 model and effort (the default
> is **Fable 5.2** with effort **high**).
<!-- /help -->

That is all. <!-- help -->You can see your weekly budget in the status bar: it shows
the percentage of your allowance for the days passed. If it goes over
100 %, it uses lower tiers. It also shows how much each tier is used.<!-- /help -->

## What it watches

| meter | role |
|---|---|
| Weekly · all models | paced: the budget line is drawn against it |
| Weekly · Fable (the plan's per-model meter; `/pacing premium` names the model, `none` if the plan has no such meter) | paced on the same line while Fable runs tier 1; at 100 % every tier of that model leaves the ladder |
| 5-hour limit | shared by all models; the report shows the pace inside the window and when it would be full; at 85 % it says to hold heavy work until the reset |
| fixed overhead | what every turn re-sends whatever the work: tool definitions, the system prompt, skills. The report gives it in tokens and as a share of the session; when MCP tools are a large part of it, it says that switching off connectors you do not need saves that many tokens on every turn. Which ones you need is yours to say |
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
| Fable held (or whichever model the per-model meter belongs to) | that meter more than 5 points over the line, or its trend past 115 %, while Fable runs tier 1 | the fallback tier (Opus 5.5 high) takes tier 1 and Fable is kept for one contained hard task at a time; the all-models level still decides the routing | | | |
| Fable out | that meter at 100 %, on top of any level | the model drops out of the ladder and the fallback tier takes tier 1; the all-models level still decides the routing | | | |

**The per-model meter.** A session on Fable draws on two meters at once,
and a long one can drain Fable's own meter while the all-models meter
still reads "ahead" (11 points in 46 minutes have been seen). So that
meter is paced too: the same line, the same thresholds and its own trend.
While Fable runs tier 1, the worse of the two levels decides the routing,
and the report says which meter set it. At Fable's own "over" the effort
step below applies; at its "throttle" the skill recommends switching the
session to the fallback tier, as when the meter is out, so what is left
of it goes to judgment work. With another model on tier 1 the meter is
shown, not acted on. `/pacing premium none` turns it off along with the
rest of the per-model handling, for a plan without such a meter.

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
move the level. The per-model meter gets a trend of its own the same way,
from the readings that read it in full. `/pacing log` shows the readings.

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

<!-- help -->
    ahead 77% · 🟡T1 80% ⚪T2 15% 🟤T4 5% · wk 36% Fable 40%

That is the level and the weekly meter as a share of today's budget
line (over 100 % means over the line), how this session's own use
splits over the tiers (T1 is tier 1), subagents included, and the two
meters. The desktop app may cut the end of the line; `/pacing-status`
shows it whole, in words.<!-- /help --> The split is an estimate: each
model's tokens priced at its API rates, which is how the weekly meter
weighs the models too. The tiers are those in force at the reading:
while Fable's meter is out or held, the fallback (Opus 5.5 high) is tier
1. Claude Code names the model of each turn but not its effort, so a
model on two tiers counts at the higher one for the session's own turns
and the lower one for its subagents. The reader agent's model, when it
is not on the ladder, counts as the tier after the last (tier 4 with
three tiers). The
circles are gold, silver, bronze and brown for tiers 1 to 4 (🟡 ⚪ 🟠 🟤),
then 🟣 🔴 🔵 🟢 for a longer ladder; ⚫ is a model the ladder does not
hold. A session that another session started (a side session in the
desktop app) leads with the tier of the model it runs on:

    ⚪T2 sub · ahead 77% · ⚪T2 90% 🟤T4 10% · wk 36% Fable 40%

Claude Code hands a plugin only the all-models and 5-hour meters,
so such a reading carries the per-model figure (Fable's by default) over
from the last full reading of the week. The figure can only have risen
since, so a carried level may be too mild, never too strict, and it is
never shown as current once it is half an hour old: the status line
gives its age and, where the readings allow, an estimate of where the
meter is now (`Fable 71% (15h old est 90%)`). The estimate is only
shown; the level never rests on it. Once the figure is an hour old, or
the all-models meter has moved 2 points since it was read, Claude is
told beside your next prompt to take a full reading, once, and again an
hour later if none came; the next session's start line says so too.
`/pacing log` marks such a figure with its age. When Fable's meter
sets the level, holds the model or is out, the line leads with its
share of the line instead (`Fable over 110%`, `Fable held 158%`). An automatic reading never changes the next
session's model: that stays with the readings the session takes.
`/pacing log` marks them `(auto)`. On an older Claude Code the plugin
works as before, without them.

**A report without measuring.** Reading the meters costs a tool call
whose answer is long. So `/pacing usage` first looks at the last
reading, often one the plugin took by itself, and reports from it when
it is at most 30 minutes old, from the same week, and not at "stop".
Within 30 minutes an automatic reading is at most a point behind, since,
where the hooks module runs, the plugin takes one on every whole point the meter moves. The per-model
figure in it must be under 30 minutes old too, or under an hour while it
is 15 points or more under the line, because it routes the work while
Fable runs tier 1. The report then says when the reading was taken and
what it lacks (the session's context, extra usage); anything older, or
`/pacing usage now`, reads the meters afresh.

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
| from 300 000 | for work that continues, compact the conversation at a natural break (`/compact`): the cheaper step, since the work stays and every later turn re-sends less; a task that has nothing to do with this session's work starts in a new session |
| from 500 000 | a next task with a clear outcome goes whole to one fresh agent, without asking you; a new session, with a handover, only for a task you will want to steer, one with many rounds of questions, or one unrelated to the session's work |

**A whole task to one agent.** From 500 000 tokens every step the
session takes itself costs a turn of its full size. So the session
writes a brief like a handover (the goal, where things stand, the
decisions, the files and commands, what was ruled out, and what done
looks like), starts one fresh agent with it and reads only its report:
two turns of the large session, not one per step. The agent runs on the
model the task's class routes to, never below tier 2, and on the
fallback tier (Opus 5.5 high) for judgment work; it is the implementer
for a specified change. It reports what it verified and how, and never
commits, pushes or publishes unless the brief says so. The limits: you
cannot steer it midway, it reports once, each question you ask about
its work afterwards is still a full-size turn of the large session, and
it works alone, starting no agents of its own.

**After a pause.** On a Claude Code version with hooks modules, the
plugin also watches for the expensive moment itself. When you send a
prompt after an hour or more without a turn, and the session holds
300 000 tokens or more, one notice says how large the session is, how
long it sat idle, and that compacting or a handover first is cheaper. It
comes once per pause and never holds or changes your prompt, so the turn
you just sent still pays to store the session again; the notice is for
the breaks after it. An hour is assumed for the cache's lifetime, since
Claude Code does not tell a plugin.

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

**Two sessions in one folder.** Two sessions editing the same project
folder overwrite each other's work. So each session leaves a mark for
the project when it starts and at each reading, and a new session's
start line says when another one has been at work there, how long ago
and for how long, and tells Claude to check with you before editing
files. It is a notice, never a block. A mark counts for 45 minutes when
the plugin's automatic readings keep it fresh (they come at least every
30 minutes while a session works), and for 2 hours otherwise; a session
that ends takes its mark with it. A session is told from another by the
session id Claude Code gives it; where that is not known, no mark is
left and nothing is said. The plugin does not lock or track your source
files: Claude's edit tool already refuses a file that changed since it
was read, and parallel work on code belongs in separate git worktrees.

The plugin's own files (the settings, the last reading, the agents'
notes) can be written by several sessions at once without one losing
the other's change.

## What the skill can and cannot do

A session cannot switch its own model, so tier 1 is always your choice in
the model menu (setup step 2). The skill steers by delegating work to
subagents on the lower tiers, by writing the recommended model into the
desktop app's built-in preset for new local sessions and into
settings.json for the terminal CLI, and by telling you at the start of
every session when to switch by hand. The app reads its preset only when
it starts, so a model the skill sets while the app runs shows in the
model menu after the next restart; until then, pick it in the menu once.
A preset of your own (one named per project in the model menu) keeps its
own model: the skill sets only the built-in one. Your *other* open sessions it can
switch for you: at throttle, Fable held or Fable out it offers to move them to the
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
`/pacing reader ladder` makes it follow the lowest tier. The verifier
has the same for a plain run (run the suite, quote what failed): Haiku
5.5 medium by default, `/pacing verifier ...` to change it. A check that
judges a result against points the task names (does the change do what
was asked, is the case covered) stays on the lowest tier.

**Small tasks go in batches.** A fresh agent cost 11 000 to 15 000
tokens before doing anything in live tests; a follow-up to a kept one
800 to 2 300. So several small tasks for one role go to the kept agent
in one message, and a task too small to be worth a start waits for the
next batch or stays in the session.

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
in plain words works too. The rules for delegating work are a second,
smaller skill, `/pacing:route`, which Claude loads by itself before it
first hands work to a subagent; a plain report never loads them.

| command | what it does |
|---|---|
| `/pacing`, `/pacing usage`, or just typing "usage" | reports the level, the trend and the routing; from the last reading when it is fresh enough (see below), else from new readings of the meters |
| `/pacing usage now` | always reads the meters afresh |
| `/pacing help` | the short help: what it does, setup, the status line, the commands (also on "usage help") |
| `/pacing help full` | this whole guide (also on "usage help full") |
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
| `/pacing verifier haiku medium`, `/pacing verifier ladder` | the model the verifier runs plain test runs on (Haiku 5.5 medium by default), or the lowest tier |
| `/pacing notes` | where the role agents' notes for this project are, and how long each is |
| `/pacing agents` | the role agents this project's session keeps, and their tokens by role and model |
| `/pacing handover` | the session writes a handover for the next session of this project |
| `/pacing handover done` | files the waiting handover away once its work is picked up |
| `/pacing version` | the installed plugin version |

Your files live in `~/.claude/pacing`: the configuration in `config.json`,
the readings in `log.jsonl`, the last one in `state.json`, your subagent
rules in `BRIEF.local.md`. A plugin update replaces the plugin's own
folder and leaves that one alone. If `config.json` is edited by hand into
something the commands would not write, the value in question falls back
to its default and the report says which; a file that no longer parses
is set aside as `config.json.damaged`. The first run creates the configuration
from the defaults (or takes over the files of an earlier standalone
install of this skill) and shows this guide once.
