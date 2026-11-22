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

While Fable's meter is full, **Opus 5.5 high** takes tier 1 in its
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

That is all. <!-- help -->You can see your weekly budget in the status line:
`Budget left` is what the days so far may still use of your allowance.
Below zero, work moves to lower tiers. `/pacing-status` shows how much
each model is used.<!-- /help -->

## What it watches

| meter | role |
|---|---|
| the weekly meter (Weekly · all models) | paced: the budget line is drawn against it |
| the per-model meter (Weekly · Fable; `/pacing premium` names the model, `none` if the plan has no such meter) | paced on the same line while Fable runs tier 1; at 100 % every tier of that model leaves the ladder |
| the 5-hour window (5-hour limit) | shared by all models; the report shows the pace inside the window and when it would be full; at 85 % it says to hold heavy work until the reset |
| fixed overhead | what every turn re-sends whatever the work: tool definitions, the system prompt, skills. The report gives it in tokens and as a share of the session; when MCP tools are a large part of it, it says that switching off connectors you do not need saves that many tokens on every turn. Which ones you need is yours to say |
| extra usage | when the plan allows charges past 100 %, the report shows what is spent of the monthly cap, and "stop" becomes "going on is charged" |

The report also gives a **spend rate**: the percent per hour that lands
at 100 % exactly at the reset, and how much of today's budget line is
still free. That is what "ahead by 36" is worth in practice.

## The budget line

The week has 7 days ending at the reset. The last 24 h weigh 1.5, the
rest 1, so a full day in the first six may use 13.3 % of the week and the
last day keeps 20 %. The whole of the current calendar day's allowance
counts from midnight, so the line is a step that rises at midnight (not
at the hour of the reset): with a reset at noon, 6.7 % for the half day
the week starts with, 20 % from the first midnight, 33.3 % from the next,
and so on. Each time the skill runs it compares the weekly meter with the
budget line and routes four classes of work (judgment, medium, routine, trivial)
onto the tiers:

| level | meaning | judgment | medium | routine | trivial |
|---|---|---|---|---|---|
| ahead | more than 5 points under the budget line | tier 1 | tier 1 | tier 1 | tier 1 |
| on pace | within 5 points under the budget line | tier 1 | tier 1 | tier 2 | tier 1 |
| over | up to 5 points over the budget line | tier 1 | tier 2 | tier 2 | tier 1 |
| throttle | more than 5 points over | tier 2, the session itself only for what tier 2 would get wrong | tier 2 | tier 2 | tier 2 |
| stop | the weekly meter at 95 % or more | wrap up | | | |
| Fable held (or whichever model the per-model meter belongs to) | that meter more than 5 points over the budget line, or its trend past 115 %, while Fable runs tier 1 | the fallback tier (Opus 5.5 high) takes tier 1 and Fable is kept for one contained hard task at a time; the weekly meter's level still decides the routing | | | |
| Fable out | that meter at 100 %, on top of any level | the model drops out of the ladder and the fallback tier takes tier 1; the weekly meter's level still decides the routing | | | |

**The per-model meter.** A session on Fable draws on two meters at once,
and a long one can drain Fable's meter while the weekly meter
still reads "ahead" (11 points in 46 minutes have been seen). So that
meter is paced too: the same budget line, the same thresholds and its own trend.
While Fable runs tier 1, the worse of the two levels decides the routing,
and the report says which meter set it. At Fable's own "over" the effort
step below applies; at its "throttle" the skill recommends switching the
session to the fallback tier, as when the meter is out, so what is left
of it goes to judgment work. With another model on tier 1 the meter is
shown, not acted on. `/pacing premium none` turns it off along with the
rest of the per-model handling, for a plan without such a meter.

At "over" the skill first suggests one step less effort on the session's
own model (Fable 5.2 high to medium with the default ladder): it saves on
every turn and keeps the work where it is. Only you can change it: a
session cannot change its own model or effort, so it never asks. The
Switch row above the prompt offers it (below); without the hooks module
the session says once, in one line, what to pick in the model menu.

Trivial work (a grep, a rename, one file summarised) stays in the session
until throttle: a subagent costs tens of thousands of tokens before it
reads a file, so delegating a grep to a cheaper model costs more on the
weekly meter than doing it in the session. The exception at every level is
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
point, or 30 minutes after the last reading, and once when the plugin
loads (a session's start, a reload, a new version), so the status line never
shows old facts until then. It keeps the start line
fresh for the next session and shows it in the status line, with one
toast when the level changes:

<!-- help -->
    Budget left: 850K · usage: Weekly 36% Fable 40%

That is what is left under today's budget line, in tokens (below zero
means over it; a toast says when the level changes), then the two
weekly meters' usage. `/pacing-status` shows the whole status line in
words, with how this session's own use splits over the ladder's models
(`🟡Fable 5.2 high 80%`), subagents included.<!-- /help --> The desktop app cuts a plugin's status at about
35 characters, so there the status line keeps within 34: what is left of the
budget always, the usage only where it fits whole (`Budget left:
850K`). The split is an estimate: each
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
desktop app) leads with `sub`, and shows the weekly meter only, not
Fable's, which the session that started it shows:

    sub · Budget left: 850K · usage: Weekly 36%

**Budget left in tokens.** The plugin learns how many tokens one point
of the weekly meter is from what its sessions spend, over the week (the
week before's rate until this one has risen 5 points). Until it has
one, the status line shows the points of the week that are left: `Budget left:
5%`. Use without the plugin (another device, the web) moves the meter
with no tokens counted, so the figure shows less left than there is.

**Every meter, without the model.** Claude Code hands a plugin only the
weekly meter and the 5-hour window. In the desktop app the plugin reads the
rest itself, through the app's own usage tool: the per-model meter
(Fable's by default), extra usage, and the session's context with what
fills it. That costs no model call and asks you nothing. Such a reading
is a full one, taken automatically: the per-model figure in the status
line is the one just read, the level rests on it, and the session is
never asked to take a reading. `/pacing log` marks it `(auto, full)`. It comes
no more often than any automatic reading (a whole point, 30 minutes, the
plugin's load), and once more when a subagent finishes, if the last
reading is 5 minutes old, since the agent's work moved the meters.

**Without the app** (a terminal session), or when that tool does not
answer, an automatic reading has the two meters Claude Code hands over
and carries the per-model figure over from the last full reading of the
week; `/pacing log` marks it `(auto)`. The figure can only have risen
since, so a carried level may be too mild, never too strict, and it is
never shown as current once it is half an hour old: `/pacing-status`
gives its age and, where the readings allow, an estimate of where the
meter is now (`71% Fable 15h ago, est. 90%`); the status line shows the
figure as read. The estimate is only
shown; the level never rests on it. Once the figure is an hour old, or
the weekly meter has moved 2 points since it was read, Claude is
told beside your next prompt to take a full reading, once, and again an
hour later if none came; the next session's start line says so too.
`/pacing log` marks such a figure with its age.

The status line leads with
what is left of the budget; Fable shows only as its week's usage among
the meters (`Fable 99%`), even when it sets the level or holds the
model. An automatic
reading of either kind never changes the next
session's model: that stays with the readings the session takes.
On an older Claude Code the plugin
works as before, without them.

**A report without a new reading.** Reading the meters costs a tool call
whose answer is long. So `/pacing usage` first looks at the last
reading, often one the plugin took by itself, and reports from it when
it is at most 30 minutes old, from the same week, and not at "stop".
Within 30 minutes an automatic reading is at most a point behind, since,
where the hooks module runs, the plugin takes one on every whole point the meter moves. The per-model
figure in it must be under 30 minutes old too, or under an hour while it
is 15 points or more under the line, because it routes the work while
Fable runs tier 1. The report then says when the reading was taken and
what it lacks (the session's context, extra usage); anything older, or
`/pacing usage now`, reads the meters afresh. `/pacing-usage` shows the
same report without the model at all: when the last reading is too old,
the plugin takes a full one itself first, where the app's usage tool
answers.

## The session's own context

**One session for everything.** You give every prompt in the main
session, and everything comes back to it: an agent's answer returns to
the session, which tells you the whole outcome there (what changed, what
was verified and how, what is open, any decision it needs), so you never
open an agent's transcript or another session to learn it. A decision an
agent needs is asked there and passed on to the same agent. The plugin
keeps that one session affordable: the offer to compact (below), whole
tasks to one agent from 500 000 tokens, and role agents it keeps and
re-uses, so their reading never enters the session's context. For work
in several parts, an agent sends the session a short update when each
part is done, and the session passes it on to you at once: the texts you
will see, example lines, drafts and the choices made, word for word, not
a summary of them.

Every turn re-sends the whole conversation, so a long session makes each
later turn expensive whatever model runs it. While you keep working, the
history is read back cheaply; after a pause it has to be stored again in
full, so a long session costs most right after a break.

The skill goes by the session's size in tokens, not by its share of the
window, since a window can be large or small:

| size | what the skill advises |
|---|---|
| under 300 000 tokens | nothing |
| from 300 000 | compact the conversation at the next natural break (`/compact`), then go on in this session, whatever the next task is: the work stays and every later turn re-sends less. A task unrelated to the session's work is a reason to compact first, not to leave |
| from 500 000 | compact first if that has not been done; a next task with a clear outcome goes whole to one fresh agent, without asking you, and its outcome comes back here. A new session is never offered: the session names one only when it cannot be compacted or you ask for one, and writes a handover then |

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
300 000 tokens or more, one toast says how large the session is, how
long it sat idle, and that compacting first is cheaper. It
comes once per pause and never holds or changes your prompt: Claude Code
lets no plugin compact while a prompt waits to be sent. So the plugin
warns earlier instead (below). An hour is assumed for the cache's
lifetime, since Claude Code does not tell a plugin.

**An offer to compact.** When a turn ends in a session of 300 000
tokens or more, a row above the prompt says how large it is, with
**Compact now** and **Not now**. From 500 000 tokens the row says what
each turn sends again, in the warning colour. It never interrupts, and
comes again only after the session has grown by another 100 000 tokens.
Left idle, the row turns to the warning colour 10 minutes before the
cache lapses, and again once it has: compacting then costs less than the
next turn storing it all again. Compact now keeps the goal, the
decisions and why, the open items, the files and commands that matter,
and what was ruled out; one line then gives the size before and after.
`/pacing compact off` turns the row off; the toast after a pause then
shows as before.

**An offer to switch.** When the session runs on another model or
effort than the reading recommends, the same place above the prompt
offers it, with **Switch** and **Not now**. When Fable's meter is out
or over its budget line, it says so in the warning colour: `🔴 Fable 5.2 is out
until the reset. Switch this session to Opus 5.5 high.` (`⚠️` when the
meter is over its budget line). Otherwise it is
calm: `🔁 This week's budget suggests Opus 5.5 medium for this session.`, or
at over budget `🔁 Over budget: one step less effort saves the most. Switch
to Fable 5.2 medium.` Switch runs `/model` and `/effort` for this session
only, and a toast says what the session now runs on (`🔁 this session now
runs on Opus 5.5 high; the model menu may still show Fable 5.2.`: the
app's model menu can lag behind the switch for a while); where that cannot
run, the box is filled with the command for you to send. The plugin
remembers the model and effort last set by `/model` and `/effort`,
pressed or typed, so a switch already made is not offered again. It never
switches without your press, comes once per suggestion, and Not now holds
until the recommendation changes. One row shows at a time: a switch away
from a model that is out or held first, then the offer to compact, then
a calm switch. `/pacing switch off` turns it off.

Bulky reading (logs, test output, many files) goes to the reader agent
for the same reason: what the agent reads never enters the session's
context.

**When a new session is the only way.** The plugin never offers one: a
session that cannot be compacted, or your own wish to start afresh, is
the only reason. `/pacing handover` then has the session write down
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
files. It is a warning, never a block. A mark counts for 45 minutes when
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
settings.json for the terminal CLI, and by offering a switch (the Switch
row above the prompt; without the hooks module, a line at the start of
the session). The app reads its preset only when
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

**Seeing them work.** While agents run, the status line leads with how
many, and still shows the budget: `⏳ 1 Subagent running · Budget left:
850K · usage: Weekly 36% Fable 40%`, `⏳ 2 Subagents running`. Side
sessions this session started count in (in the desktop app, which says
which sessions are working). Who they are, what each is doing, for how
long and how far it has come are in the toasts, the row above the prompt
and `/pacing-status`. The status line keeps within 75 characters in a terminal
and within 34 in the desktop app, which cuts it at about 35: the usage
figures make room first, then "running" goes, the budget always whole:
`⏳ 2 Subagents · Budget left: 850K`. A reload of the plugins keeps a
running agent as it was, its time counted from its start. An agent shows
the moment the session calls it, before Claude Code has started it. The
status line goes back to its plain form when the last one ends.
`/pacing-status` says which of the agents are side sessions. An agent that
works on in the background after the turn ends gets a row above the
prompt, under the offer to compact, with its assignment: `In the
background: ⏳ implementer: Auto-reload on plugin update, editing 2m
part 2 of 4`.
`/pacing-status` lists every running
agent with what it is doing. The session also says in one line which
agent it started, on which model and effort, and for what.

**Progress.** A role agent with a task in several parts says each part
it has finished, and its entry then ends with `part 2 of 4`. An agent
that says none has, once its kind has finished three runs, a percentage
such as `~60%` instead: a rough estimate
from how long that kind of agent usually takes, not a measure of the work
done, and it stays at 95 % or below until the agent ends. What the agent
is doing now comes from its latest tool call (`reading`, `searching`,
`editing`).

**Toasts.** A toast says when an agent starts (`▶️ implementer is
running "Auto-reload on plugin update" on Fable 5.2 high.`, and
`; reader is also running.` when others run), when it ends
(`✅ implementer is done with "Auto-reload on plugin update" after
3m, 41k tokens; nothing else is running.`), and every 5 minutes while
any runs (`⏳ still running: implementer "Auto-reload on plugin
update", editing 12m part 2 of 4, about 12m left.`). The time left is a
rough estimate: with parts said, the time so far per finished part times
the parts left; else how long that kind of agent usually takes (from
three finished runs on), less the time it has run. Without either, or
once the agent has run past the estimate, no figure is given. The start
toast names the usual length the same way (`…on Fable 5.2 high, about
20m.`). `/pacing notify off` turns these toasts
off; the status line and the row stay. Every toast of the plugin leads with one
icon for its kind, since a toast has no colour of its own:

| icon | says |
|---|---|
| ▶️ | an agent or a side session started |
| ✅ | one finished |
| ⏳ | still running, every 5 minutes |
| ⚠️ | the weekly meter is over budget or far over budget, or Fable's meter is over its budget line |
| 🔴 | the weekly meter is nearly used (stop), or Fable is out until the reset |
| 🟢 | on or under the budget line again |
| 🔁 | the session's model or effort was switched |
| ❌ | something did not happen: a switch that did not take, a compaction that did not run |
| 🔄 | a new version of the plugin was loaded |
| 📦 | a new version waits for `/reload-plugins` |
| 🗜️ | the session was compacted |
| 💤 | the session's cache lapsed in a pause |

A start, a 5-minute toast, a switch and a compaction stay 4 seconds; the
others stay 15, and the pointer over a toast holds it. The row above the
prompt for the same matter leads with the same icon.

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
task. Each finished task is recorded with the agent's id, model and
tokens (by the plugin itself where it has a hooks module, else by the
session), so the session can find its agents again after its own
history was summarised. `/pacing agents` shows them, and what each role has cost per
model, fresh against resumed: the figures that tell whether five tasks
is the right limit.

**What they learn outlasts the session.** An agent ends with its session,
so each role keeps a notes file per project: where things live, how the
tests run and how long they take, a trap to avoid. A new agent gets its
file with its first call, adds a line when it learns something lasting,
and replaces a line that is no longer true. The files
are plain text in `~/.claude/pacing/notes/<project>/`, yours to read,
edit or delete; `/pacing notes` shows where they are for the project at
hand.

Each agent starts with one call that prints its standing rules (never
touch another folder, never commit unasked, never delete, report
failures verbatim), its notes, and your own additions and the block for
the project from `~/.claude/pacing/BRIEF.local.md` (created empty on the
first run, yours to fill, untouched by updates), so the rules do not
depend on the session remembering them. The project's own CLAUDE.md
rules come first. The few rules that must hold even if that call fails
(never commit, push or publish unasked; the read-only agents change
nothing) are in each agent's own instructions. A task in parts shows its
progress as each part is done.

## Words used here

Each thing has one name in the guide and in everything the plugin shows:

| word | means |
|---|---|
| weekly meter | the plan's "Weekly · all models" meter; `Weekly` in the status line. The budget line is drawn against it |
| per-model meter | the plan's weekly meter for one model (`/pacing premium` names it, Fable by default), called by that model: `Fable` in the status line, "Fable's meter" in a sentence |
| 5-hour window | the plan's 5-hour limit, shared by all models |
| budget, budget line | the share of the week the days so far may use, drawn as a line that steps up at midnight; `Budget left` is what is still under it |
| level | where the weekly meter stands against the budget line: ahead, on pace, over, throttle, stop in the report; under budget, on budget, over budget, far over budget, stop in toasts. The per-model meter's model is "held" or "out" |
| reading | one look at the meters, logged; "full" when it has the per-model meter, "automatic" when the plugin took it. One is taken, never "measured" |
| tier, ladder | a tier is one model with its effort; the ladder is the tiers in order, tier 1 on top. A model is named with its effort, `Opus 5.5 high` |
| session's model | the model and effort this session runs on |
| Subagents | the count of what runs for this session: `⏳ 2 Subagents running`, `3 Subagents are still running` |
| agent | one of them by name, as the toasts give it: `implementer is running …` |
| role agent | one of the four the plugin brings: reader, verifier, implementer, researcher |
| side session | a session this one started in the desktop app; its status line leads with `sub`, and it counts among the Subagents |
| status line | the plugin's line in the footer |
| row | a line above the prompt with buttons, named by what it offers: the Switch row, the offer to compact, the Reload row; a button by its label, **Switch** |
| toast | a message that shows for a few seconds and goes |

## Commands

Installed as a plugin, the skill answers to `/pacing:pacing` (plugin
name, colon, skill name); `/pacing` below stands for that. Typing "usage"
in plain words works too. The rules for delegating work are a second,
smaller skill, `/pacing:route`, which Claude loads by itself before it
first hands work to a subagent; a plain report never loads them. Where
Claude Code has hooks modules, `/pacing-usage` (the report),
`/pacing-help` (the short help) and `/pacing-guide` (this guide) answer
at once, without using the model. `/pacing-usage` shows the report in a
code block; with no fresh reading and no usage tool to take one it says
so, as in `Pacing: no reading to show (the last reading is 45 min old).
/pacing usage now takes a new one.`

| command | what it does |
|---|---|
| `/pacing`, `/pacing usage`, or just typing "usage" | reports the level, the trend and the routing; from the last reading when it is fresh enough (see below), else from new readings of the meters |
| `/pacing usage now` | always reads the meters afresh |
| `/pacing help` | the short help: what it does, setup, the status line, the commands (also on "usage help") |
| `/pacing help full` | points to `/pacing-guide`, which shows this whole guide without using the model; where Claude Code lacks that command, the guide itself (also on "usage help full") |
| `/pacing setup` | asks how many tiers and which model and effort each one has, and about the next-session switch; writes config.json |
| `/pacing set 2 opus xhigh` | changes one tier (models fable, opus, sonnet, haiku; efforts low, medium, high, xhigh, max) |
| `/pacing add haiku low` | adds a tier at the bottom (up to six) |
| `/pacing remove 3` | drops a tier (two must remain) |
| `/pacing reset` | back to the default three tiers |
| `/pacing weight 2` | how much the last day before the reset weighs against the others (1 to 3; 1.5 by default) |
| `/pacing log` | the last readings |
| `/pacing week` | the last two weeks in sum: where the meter ended, the share of the time at each level, and whether it crossed the budget line |
| `/pacing next on`, `/pacing next off` | lets the skill set, or stop setting, the default model of new sessions |
| `/pacing switch on`, `/pacing switch off` | turns the offer to switch the session to the recommended model or effort on (the default) or off: a row above the prompt with Switch and Not now |
| `/pacing reload on`, `/pacing reload off` | turns the Reload row at a new version on (the default) or off: when the app has installed a new version of the plugin, a row above the prompt offers **Reload**; off, one toast per version says to type `/reload-plugins`. Nothing reloads by itself either way |
| `/pacing notify on`, `/pacing notify off` | turns the toasts about running subagents on (the default) or off: when one starts, when one ends, and every 5 minutes while any runs; the status line and the row above the prompt still show them |
| `/pacing compact on`, `/pacing compact off` | turns the offers to compact a large session on (the default) or off: a row above the prompt with Compact now from 300 000 tokens, plainer from 500 000, and a warning before the cache of an idle session lapses |
| `/pacing premium opus`, `/pacing premium none` | names the model the plan's per-model meter belongs to (Fable by default), or says the plan has none |
| `/pacing fallback opus high`, `/pacing fallback none` | the tier that takes the top place while that meter is full (Opus 5.5 high by default); none lets the remaining tiers move up |
| `/pacing reader haiku medium`, `/pacing reader ladder` | the model the reader agent reads on (Haiku 5.5 medium by default), or the lowest tier |
| `/pacing verifier haiku medium`, `/pacing verifier ladder` | the model the verifier runs plain test runs on (Haiku 5.5 medium by default), or the lowest tier |
| `/pacing notes` | where the role agents' notes for this project are, and how long each is |
| `/pacing agents` | the role agents this project's session keeps, and their tokens by role and model |
| `/pacing handover` | the session writes a handover for the next session of this project |
| `/pacing handover done` | files the waiting handover away once its work is picked up |
| `/pacing version` | the installed plugin version |
| `/pacing doctor` | checks that pacing works here, a line each: the version, the hooks module, the last reading, the per-model meter, the week, the settings, the token rate, the agent records, the folders; each problem with one step to fix it |
| `/pacing saved` | what delegating to agents on cheaper models saved this week, against the session's model; `saved detail` adds a table by role and model |

Your files live in `~/.claude/pacing`: the configuration in `config.json`,
the readings in `log.jsonl`, the last one in `state.json`, your subagent
rules in `BRIEF.local.md`. A plugin update replaces the plugin's own
folder and leaves that one alone. If `config.json` is edited by hand into
something the commands would not write, the value in question falls back
to its default and the report says which; a file that no longer parses
is set aside as `config.json.damaged`. The first run creates the configuration
from the defaults (or takes over the files of an earlier standalone
install of this skill) and shows the short help once.

**A new version.** The desktop app installs a new version of the plugin
in the background, and an open session used to keep the old one until
you typed `/reload-plugins`. On a Claude Code version with hooks modules
the plugin looks for a new version when a turn ends and every 5 minutes,
and in a session you have typed in, a row above the prompt says at once
`📦 Pacing 0.9.12 is installed.` with **Reload** and **Not now** (that
version only). Nothing reloads by itself. **Reload** runs
`/reload-plugins`, and the new version says so in one line,
`🔄 updated to 0.9.12 and reloaded.` Over a remote connection, where
Claude Code does not run that command, a toast says
`📦 Reload from the computer: /reload-plugins does not run over a remote connection.`
and the row stays. Where the command is refused otherwise or does not
answer within 3 seconds, the plugin puts `/reload-plugins` in the prompt
box and says `📦 Press Enter to reload.`; where even that fails,
`📦 Pacing 0.9.12 is installed: type /reload-plugins to load it.`
`/pacing reload off` turns the row off: then that last line comes once
per version as a toast instead.
