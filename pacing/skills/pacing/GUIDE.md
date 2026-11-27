# Model pacing: the intro guide

`/pacing version` shows the installed version.

<!-- help -->Claude plans have a weekly usage limit. Pacing lets you use better
models and still make the week last: your best model does the hard work,
and easier work goes to subagents on cheaper models. A day-by-day budget
decides how much moves down.<!-- /help --> While you are under it, nearly everything
stays on the best model; the further over it you go, the more goes to the
cheaper ones, so the week doesn't run out before the reset. You
choose how many tiers there are, and the model and effort of each.

The default ladder (a tier is one model with its effort; tier 1 runs the
session, the lower ones run as subagents):

| tier | model | takes |
|---|---|---|
| 1 | Fable 5.2 high | the session: judgment work |
| 2 | Opus 5.5 medium | subagents: routine work |
| 3 | Sonnet 5.5 medium | subagents: bulky output (logs, test runs, many files) |

While Fable's own meter is used up (at 100 %), **Opus 5.5 high** takes
tier 1 in its place, so judgment work keeps a strong model and routine
work stays on the cheaper Opus 5.5 medium (`/pacing fallback` changes or
removes that).

<!-- help -->
## ⚠️ Setup, two steps

> **1.** Type `/pacing setup` and answer the questions. Unsure? Keep the
> defaults.
>
> **2.** In the model menu, pick the tier 1 model and effort (the default
> is **Fable 5.2** with effort **high**).
<!-- /help -->

That is all. <!-- help -->You can see your weekly budget in the status line:
`Budget` is how long what today's budget still allows will last at your
pace. Once it reads `over`, work moves to
lower tiers. `/pacing-status` shows how much each model is used.<!-- /help -->

**What you will see.** A status line under the prompt after every turn;
in the desktop app, a pane beside the chat with the week as a dial, the
meters and the agents at work; a toast when the budget gets far over its
line or the week is nearly used; now and then a row above the prompt that
offers to compact a large session or, when Fable is out or far over its
line, to switch model (nothing is compacted or switched without your click);
and one line from Claude when it hands work to a subagent. Work that
splits into independent parts goes to several agents at once, so it is
done sooner. After a reading you ask for, the recommended model and
effort for *new* sessions are written into `~/.claude/settings.json` (on
Windows also into the desktop app's default for new local sessions);
`/pacing next off` turns that off.

**A few words first** (the whole list is under "Words used here"):

| word | means |
|---|---|
| budget line | how much of the week may be used by now; it steps up at midnight |
| ahead, on pace | the weekly meter is under the budget line: tier 1 does nearly everything |
| over | up to 5 points past the line: some work moves down a tier |
| throttle | more than 5 points past it: nearly all work goes to cheaper models |
| stop | the weekly meter is at 95 % or more: wrap up |
| Fable held | Fable's own meter is well past its budget line: Opus 5.5 high takes tier 1 and Fable is kept for the hardest tasks |
| Fable out | Fable's own meter is at 100 %: used up until the weekly reset |

## The budget line and the levels

### What it watches

| meter | role |
|---|---|
| the weekly meter ("Weekly · all models") | paced: the budget line is drawn against it |
| the per-model meter ("Weekly · Fable"; `/pacing premium` names the model, `none` if the plan has no such meter) | paced on the same budget line while Fable runs tier 1; at 100 % every tier of that model leaves the ladder |
| the 5-hour window ("5-hour limit") | shared by all models; the report shows the pace inside the window and when it would be full; at 85 % it says to hold heavy work until the window resets |
| fixed overhead | what every turn sends again, whatever the work: tool definitions, the system prompt, skills. The report gives it in tokens and as a share of the session. When MCP tools are a large part of it, the report says that switching off the connectors you do not need saves that many tokens on every turn. Only you know which ones you need |
| extra usage | when the plan allows charges past 100 %, the report shows how much of the monthly cap is spent, and "stop" becomes "going on is charged" |

The report also gives a **spend rate**: the percent per hour that would
reach 100 % exactly at the reset, and how much of today's budget is still
free. That is what "ahead by 36" is worth in practice.

### The budget line

The week has 7 days and ends at the reset. The last 24 hours weigh 1.5,
the other days 1, so a full day in the first six may use 13.3 % of the
week and the last day keeps 20 %. A calendar day's whole allowance counts
from midnight, so the budget line is a step that rises at midnight, not
at the hour of the reset. With a reset at noon it reads 6.7 % for the
half day the week starts with, 20 % from the first midnight, 33.3 % from
the next, and so on.

Each reading compares the weekly meter with the budget line. The level
that comes out decides where four classes of work (judgment, medium,
routine, trivial) go:

| level | meaning | judgment | medium | routine | trivial |
|---|---|---|---|---|---|
| ahead | more than 5 points under the budget line | tier 1 | tier 1 | tier 1 | tier 1 |
| on pace | within 5 points under the budget line | tier 1 | tier 1 | tier 2 | tier 1 |
| over | up to 5 points over the budget line | tier 1 | tier 2 | tier 2 | tier 1 |
| throttle | more than 5 points over | tier 2, the session itself only for what tier 2 would get wrong | tier 2 | tier 2 | tier 2 |
| stop | the weekly meter at 95 % or more | wrap up | | | |
| Fable held (or whichever model the per-model meter belongs to) | that meter more than 5 points over the budget line, or its trend past 115 %, while Fable runs tier 1 | the fallback tier (Opus 5.5 high) takes tier 1 and Fable is kept for one contained hard task at a time; the weekly meter's level still decides the routing | | | |
| Fable out | that meter at 100 %, on top of any level | the model drops out of the ladder and the fallback tier takes tier 1; the weekly meter's level still decides the routing | | | |

**The per-model meter.** A session on Fable draws on two meters at once.
Fable's meter can drain fast while the weekly meter still reads "ahead":
one long session drained 11 points of it in under an hour. So that meter
is paced too, with the same budget line, the same thresholds and its own
trend. While Fable runs tier 1, the worse of the two levels decides the
routing, and the report says which meter set it. At Fable's own "over",
medium tasks go to subagents, as at the weekly meter's. At its "throttle"
Fable is held: the fallback tier takes tier 1, and what is left of Fable
goes to judgment work. The plugin does this through the subagents it
starts. Only when the session itself runs on Fable, and Fable is out or
held 20 points or more over its budget line, does it offer to switch the
session (see "The Switch row"). With another model on tier 1 the meter is
shown but not acted on. `/pacing premium none` turns it off, with the
rest of the per-model handling, for a plan without such a meter.

**At "over"** medium tasks go to subagents too. Nothing more changes: the
session keeps its model and effort, and the plugin never suggests less
effort for being a little over.

**Room to spare.** While the weekly meter and Fable's own are ahead or on
pace, work that a stronger model or more effort does better (design, a
hard bug with a clear case, a review, the final check of a large change)
may go to a subagent above the session: the tier 1 model one effort step
higher, two where allowance would go unused at the reset, up to max.
Routine and bulky work never goes up, and the session's own effort stays
as you set it.

**Small work and bulky work.** Trivial work (a grep, a rename, one file
summarised) stays in the session until throttle: starting a subagent
costs more on the weekly meter than doing a grep in the session. Bulky
work is the exception at every level, however easy it is: log reading,
test-suite runs and a pass over many files go to the lowest tier. What a
subagent reads stays out of the session's context, which is sent again
on every later turn.

### The trend

Every reading is logged. From the oldest reading of the last two days the
skill computes the burn rate and projects the meter at the reset. A
projection past 100 % raises the level to at least "over"; past 115 %, to
"throttle", and the report names the day the meter would hit 100 %. The
projection only counts once the readings span 20 hours or more, so that
they cover a night: a busy morning alone is shown as a trend but does not
move the level. The per-model meter gets a trend of its own in the same
way, from the readings that include it. `/pacing log` shows the readings.

The first reading after a reset sums up the week before in one line:
where the meter ended, how much of the time went at each level, and
whether it crossed the budget line. `/pacing week` shows the same for the
last two weeks.

### What the plugin can and cannot change

A session cannot switch its own model, so tier 1 is always your choice in
the model menu (setup step 2). The plugin steers in three ways. It
delegates work to subagents on the lower tiers. It writes the recommended
model into settings.json for the terminal CLI and into the desktop app's
built-in preset for new local sessions. And when Fable is out, or held
far over its line, it offers to switch this session: the Switch row
above the prompt, or without the hooks module one line from the session.
Otherwise you switch nothing: changes of model and effort go to the
subagents.

The app reads its preset only when it starts, so a model the plugin sets
while the app runs shows in the model menu after the next restart; until
then, pick it in the menu once. A preset of your own (one named per
project in the model menu) keeps its own model: the plugin sets only the
built-in one. The preset written is the one of the account this session
runs under; another account's on the same computer is left alone. On
macOS and Linux only `settings.json` is written, and `/pacing doctor`
says so.

Where `CLAUDE_CONFIG_DIR` moves Claude Code's folder, pacing follows it:
`settings.json` and the `pacing` folder are taken from there instead of
`~/.claude`.

Your *other* open sessions it can switch for you. At throttle, Fable held
or Fable out it offers to move them to the recommended model; the app
asks you to confirm, and the change applies from each session's next
turn. A session that runs on a lower tier may hand one contained hard
task to a tier 1 subagent; open-ended debugging stays in the
conversation.

## The status line and the pane

### The status line

The plugin takes readings by itself (see "Automatic readings" below) and
shows the newest in the status line:

<!-- help -->
    Budget: 2h 10m left · usage: Weekly 36% Fable 40%

That is what is left under today's budget line, as the time it lasts at
the last hour's pace (`Budget: 40m over` past the line; a toast says when
it gets far over), then the two weekly meters' usage. `/pacing-status` shows the whole
status line in words, with how this session's own use splits over the ladder's models
(`🟡Fable 5.2 high 80%`), subagents included.<!-- /help -->

The budget and the usage always show whole, in the desktop app too,
whose footer has room for about 70 characters in a normal window (a
narrow window cuts the line sooner). Fable shows only as its usage among
the meters (`Fable 99%`), even when it sets the level. A session that
another session started (a side session in the desktop app) leads with
`sub` and shows only the weekly meter; the session that started it shows
Fable's:

    sub · Budget: 2h 10m left · usage: Weekly 36%

**Old figures.** When three readings in a row fail (a damaged file in the
data folder, Node missing), the line leads with `⚠️ old figures`, the
pane says so, and one toast names `/pacing-doctor`. The figures shown are
then the last ones that came in.

**Budget in time.** What is left is counted in dollars and shown as the
time it lasts at your pace. Your pace is what the sessions on this
computer spent in the last hour, divided by the time since the first
response in that hour. An hour with under $0.50 spent or under 15
minutes of work says nothing, and the pace before it is kept, into the
next week too. Under an hour the time is rounded to 5 minutes, from
there to 10, and past a day it reads `24h+`.

**Budget in tokens.** Before any pace is known the line shows tokens
instead, `Budget tokens: 850K`: what is left, in full-price tokens of
tier 1's model, the same in every session whatever model it runs. Until
the plugin has learned what a point of the weekly meter costs, the
figure is an estimate marked `~`. With neither a pace nor a cost per
point, the line shows the points of the week that are left: `Budget: 5%`.
`/pacing-status` shows the time and the tokens together, with the pace:
`Budget: 2h 10m left (850K tokens, at $3.40 an hour)`. How the cost per
point is learned, and how the figure falls between readings, is in
INTERNALS.md (`skills/pacing/INTERNALS.md` in the plugin, next to this
guide).

**`/pacing-status`** gives the status line in words, then this session's
use split over the ladder's models, subagents included, with a circle
for each tier: 🟡 ⚪ 🟠 🟤 for tiers 1 to 4, and ⚫ for a model the ladder
does not hold. It also lists the agents at work, counts the large tool
results, and ends with what fills the context. The split is an estimate;
how each model is counted is in INTERNALS.md.

### Automatic readings

Where Claude Code has hooks modules, the plugin takes a reading by itself
after a turn: when the weekly meter has moved a whole point, or 10
minutes after the last reading, and once when the plugin loads. In the
desktop app such a reading covers every meter, through the app's own
usage tool; it costs no model call and asks you nothing. In a terminal
session it has only the weekly meter and the 5-hour window, and carries
Fable's figure over from the last full reading; once that figure is old,
Claude is asked, once, to take a full reading. An automatic reading never
changes the default model of new sessions: only a reading the session
takes does that. On an older Claude Code the plugin works without them.
The details (when a carried figure counts as old, the marks in
`/pacing log`) are in INTERNALS.md.

**A report without a new reading.** `/pacing usage` reports from the
last reading when it is fresh enough: at most 30 minutes old, from this
week, and not at "stop". It then says when the reading was taken and
what it lacks. `/pacing usage now` always reads the meters afresh, and
`/pacing-usage` shows the same report without using the model. The exact
rules are in INTERNALS.md.

### The pane

A pane beside the chat, drawn as a ship's console. It opens by itself
when a session starts. Close it and it stays closed, in later sessions
too, until you type `/pacing-pane`. From the top:

- **The reactor**: how much of the week is used, with a white pointer at
  the budget line and a word, NOMINAL or OVER LINE, for which side of it
  you are on. Beside it, the time you have left to use today and stay on
  budget ("9h 30m left to use today to stay on budget"; past the line,
  "40m over today's budget"), never in tokens or dollars.
- **This week**: the weekly meter with its budget line, the per-model
  meter with its own, and the 5-hour window: when it resets, and when it
  would be full first at your pace.
- **Agents at work**: each running agent as a small robot with its task;
  in the terminal a click on one opens its transcript (the desktop app has no view to open it in). Right under the words a bold bar in
  the agent's colour: a segment per step it reports, or the time it has
  run against its estimate. Then its model (↑ or ↓ when stronger or
  weaker than the session's). For the two agents with the newest output,
  a small box shows at most two main tasks, newest first: the files it
  is changing ("Changing readings.mjs and pane.mjs") and its last test,
  check, build or lint run ("Tests: 455 pass"). Reads, searches and its
  own narration are left out; with no main task yet there is no box. A
  finished agent stays a minute with ✓ done and its report's first
  clause ("Done: …"). Long words, paths and links wrap inside the pane.
- **Context**: how full the session's context is, one figure, and from
  300 000 tokens a **Compact** button. Under it, where Claude Code
  compacts by itself ("Auto-compact at 750k"), with **−** and **+** (50k a
  step) and **Auto**. A press saves the setting and sets it in Claude
  Code at once. The terminal shows the words and the command instead.
- **Models this session**: the share each model took.
- **Background tasks**: shells, monitors and workflows running in the
  background, how long each has run, and for a minute after one ends,
  how it ended.

The colours say how far over a budget line you are. A bar keeps its
colours up to its line; the cells past it run yellow, orange, red the
further over they stand. The words and figures keep their colours up to
5 points over, then run yellow, orange, red, red by 30 points over.
Fable's meter is used more freely than the week, so it has a calmer
scale: its bar, line, `OVER` tag, figure and words keep their normal
colours up to 20 points over, are yellow up to 40, turn orange by 60 and
red by 80.

While the pane is on show, the toasts that an agent started, is still
running or is done stay away, since the pane lists the agents.

The pane measures the context again after each of your turns.
**Refresh** does that at once and takes a new reading of every meter
too. In a terminal the pane has the same figures as rows of blocks,
without the drawings.

### Toasts and rows

Every toast of the plugin leads with one icon for its kind, since a toast
has no colour of its own:

| icon | says |
|---|---|
| ▶️ | an agent or a side session started |
| ✅ | one finished |
| ⏳ | still running, every 5 minutes |
| ⚠️ | the weekly meter, or Fable's, got far over its budget line |
| 🔴 | the weekly meter is nearly used (stop), or Fable is out until the reset |
| 🔁 | the session's model or effort was switched |
| ❌ | something did not happen: a switch that did not take, a compaction that did not run |
| 📦 | a new version waits for `/reload-plugins` |
| 🗜️ | the session was compacted |
| 💤 | the session's cache lapsed in a pause |

A start, a 5-minute toast, a switch and a compaction stay 4 seconds; the
others stay 15, and holding the pointer over a toast keeps it. A row
above the prompt leads with the same icon as the toast for the same
matter. One row shows at a time: a switch away from a model that is out
or held first, then the offer to compact, then the new-version row.

A level toast comes only when the level gets worse, to far over budget
or to stop. Going just over, coming back under, and Fable held or let
back bring no toast: the status line and the pane show them. Where the
session runs on Fable while the Switch row shows, that row says it
instead. What goes unused at the reset shows in the pane and in
`/pacing-status` only.

### The Switch row

The plugin moves work to subagents on the right models by itself, so you
seldom switch anything. A row above the prompt offers a switch only when
the session runs on Fable and Fable is out, or held 20 points or more
over its budget line. It has **Switch** and **Not now**, in the warning
colour, as in `🔴 Fable 5.2 is out until the reset. Switch this session
to Opus 5.5 high.` (`⚠️` when Fable is held). A session on another
model or effort than the reading recommends gets no row. The row goes by
what the session's last request ran on, which the model menu can lag
behind after a `/model`.

Switch runs `/model`, `/effort` or both, for this session only, and only
what differs. A toast then says what the session runs on; the model menu
may still show the old model for a while. Where the command cannot run,
the prompt box is filled with it for you to send. The plugin remembers
the model and effort last set by `/model` and `/effort`, pressed or
typed, so a switch already made is not offered again. It never switches
without your press, it offers each suggestion once, and Not now holds
until the recommendation changes.

In a session of 200 000 tokens or more, a change of model is expensive:
each model keeps its own cache, so the next turn stores the whole session
again at the new model's price. The row then says so, with what it costs
of the budget (`A switch stores this session's 400k tokens again (about
20m of the budget): compact first.`), and has **Compact, then switch**
before Switch, so that the switch stores only the summary. Pressed while
the session is busy, a switch or a compaction runs as soon as the session
is free, and a toast says so. `/pacing switch off` turns the row off.

## The role agents and delegation

**One session for everything.** You give every prompt in the main
session, and everything comes back to it. An agent's answer returns to
the session, which tells you the whole outcome there: what changed, what
was verified and how, what is open, and any decision it needs. You never
open an agent's transcript or another session to learn it. A decision an
agent needs is asked there and passed on to the same agent. For work in
several parts, an agent sends the session a short update when each part
is done, and the session passes it on to you at once, with the texts you
will see, example lines, drafts and the choices made, word for word.

The work that leaves the session goes to four agents the plugin brings,
each with its own instructions and tools:

| agent | does | may change files |
|---|---|---|
| reader | searches, logs, test output, unfamiliar code; reports conclusions, not dumps | no |
| verifier | runs tests, builds and checks; reports what passed and failed, never fixes | no |
| implementer | makes a change the session specified | yes |
| researcher | documentation and the web, with sources | no |

**Several at once.** Independent parts of a task go to different agents
at the same time: the reader searches while the verifier runs the tests,
or two parts of a change in different files are made side by side. Work
that splits this way is done sooner. Two agents never work on the same
files. The session keeps the plan, checks each result, and gives you the
combined outcome.

**Which model each runs on.** Each call gets the model and effort of the
tier its work routes to at the current level. The reader is the
exception: finding and summing up asks less than any other work, so it
reads on a model of its own, **Haiku 5.5 medium** by default, at every
level. `/pacing reader sonnet medium` gives it another model; `/pacing
reader ladder` makes it follow the lowest tier. The verifier has the
same for a plain run (run the suite, quote what failed): Haiku 5.5 medium
by default, `/pacing verifier ...` to change it. A check that judges a
result against points the task names (does the change do what was asked,
is the case covered) stays on the lowest tier.

**Seeing them work.** While agents run, the status line leads with how
many, and still shows the budget and the usage: `⏳ 2 Subagents running ·
Budget: 2h 10m left · usage: Weekly 36% Fable 40%`. Side sessions that
this session started are counted too (in the desktop app, which says
which sessions are working). The line keeps within 75 characters in a terminal and 70
in the desktop app: only the agents' part makes room, down to the bare
count (`⏳2 · …`), which shows even if the line then runs longer. Who the
agents are, what each is doing, for how long and how far it has come are
in the toasts, the row above the prompt, the pane and `/pacing-status`.
An agent shows the moment the session calls it, and a reload of the
plugins keeps a running agent as it was. An agent that works on in the
background after the turn ends gets a row above the prompt, under the
offer to compact: `In the background: ⏳ implementer: Auto-reload on
plugin update, editing step 2 of 4, 2m`. The session also says in one
line which agent it started, on which model and effort, and for what.

**Progress.** A role agent with a task in several parts says each part it
has finished, and its entry then shows `step 2 of 4` before its time. For
an agent that does not, once its kind has finished three runs, a rough
percentage such as `~60%` shows instead. It comes from how long that kind
of agent usually takes, not from the work done, and stays at 95 % or
below until the agent ends. What the agent is doing now comes from its
latest tool call (`reading`, `searching`, `editing`).

**Toasts about agents.** One when an agent starts (`▶️ implementer is
running "Auto-reload on plugin update" on Fable 5.2 high.`), one when it
ends (`✅ implementer is done with "Auto-reload on plugin update" after
3m, 41k tokens; nothing else is running.`), and one every 5 minutes while
any runs (`⏳ still running: implementer "Auto-reload on plugin update",
editing step 2 of 4, 12m, about 12m left.`). The time left is a rough
estimate, from the time per finished part or from how long that kind of
agent usually takes; without either, or once the agent has run past the
estimate, no figure is given. While the pane is on show these toasts stay
away. `/pacing notify off` turns them off; the status line and the row
stay.

**Small tasks go in batches.** Starting a fresh agent costs many times
more than a follow-up to one that is kept. So several small tasks for one
role go to the kept agent in one message, and a task too small to be
worth a start waits for the next batch or stays in the session.

**They are kept, not thrown away.** The session starts a role the first
time it needs one and sends later tasks to the same agent, which still
knows what it read. That saves the cost of a new start every time and
gives better answers on the second task than on the first. What an agent
remembers can go stale, so a kept agent checks any figure it quotes from
an earlier task again before it reports it. An agent is replaced when
its work moves to another tier, when a task has nothing to do with what
it knows, or when it has grown long (five tasks or 150 000 tokens), since
its whole history is sent again with every task. Each finished task is
recorded with the agent's id, model and tokens, so the session can find
its agents again after its own history was summarised. `/pacing agents`
shows them, and what each role has cost per model, fresh against
resumed: the figures that tell whether five tasks is the right limit.

**What they learn outlasts the session.** An agent ends with its session,
so each role keeps a notes file per project: where things live, how the
tests run and how long they take, a trap to avoid. A new agent gets its
file with its first call, adds a line when it learns something lasting,
and replaces a line that is no longer true. The files are plain text in
`~/.claude/pacing/notes/<project>/`, yours to read, edit or delete;
`/pacing notes` shows where they are for the project at hand.

**Their rules.** Each agent starts with one call that prints its standing
rules (never touch another folder, never commit unasked, never delete,
report failures word for word), its notes, and your own additions and
the block for the project from `~/.claude/pacing/BRIEF.local.md`. That
file is created empty on the first run; it is yours to fill, and updates
never touch it. So the rules do not depend on the session remembering
them. The project's own CLAUDE.md rules come first. The few rules that
must hold even if that call fails (never commit, push or publish unasked;
the read-only agents change nothing) are in each agent's own
instructions.

## The session's own context

Every turn sends the whole conversation again, so a long session makes
each later turn expensive, whatever model runs it. While you keep
working, the history is read back cheaply; after a pause it has to be
stored again in full, so a long session costs most right after a break.

The skill goes by the session's size in tokens, not by its share of the
window, since a window can be large or small:

| size | what the skill advises |
|---|---|
| under 400 000 tokens | nothing |
| from 400 000 | compact the conversation at the next natural break (`/compact`), then go on in this session, whatever the next task is: the work stays and every later turn sends less. A task unrelated to the session's work is a reason to compact first, not to leave |
| from 650 000 | compact first if that has not been done; a next task with a clear outcome goes whole to one fresh agent, without asking you, and its outcome comes back here. A new session is never offered: the session names one only when it cannot be compacted or you ask for one, and writes a handover then |

**An offer to compact.** When a turn ends in a session of 400 000 tokens
or more, a row above the prompt says how large it is, with **Compact
now** and **Not now**. From 650 000 tokens the row is in the warning
colour and says what each turn sends again. It never interrupts, and it
comes again only after the session has grown by another 250 000 tokens:
at 400 000, 650 000 and 900 000 between two compactions. Left idle, the
row turns to the warning colour 10 minutes before the cache lapses, and
again once it has: compacting then costs less than the next turn storing
it all again. Each size gets one warning about a pause: the next pause at
about the same size brings no row and no toast. Compact now keeps the goal, the
decisions and why, the open items, the files and commands that matter,
and what was ruled out; one line then gives the size before and after.
`/pacing compact off` turns the row off. A compaction you type yourself,
or a `/clear`, ends the row too: the plugin sees the session's size fall
by half or more. A `/clear` or a resume also starts the plugin's memory
of the conversation over: its size, the pause, the offers made.

**After a pause.** When you send a prompt after an hour or more without a
turn, in a session of 300 000 tokens or more, one toast says how large
the session is, how long it sat idle, and that compacting first is
cheaper. It comes once, and again only after the session has grown by
another 250 000 tokens. It never holds or changes your prompt: Claude
Code lets no plugin compact while a prompt waits to be sent, which is why
the offer to compact warns before the cache lapses.

**A whole task to one agent.** From 650 000 tokens every step the session
takes itself costs a turn of its full size. So the session writes a brief
like a handover (the goal, where things stand, the decisions, the files
and commands, what was ruled out, and what done looks like), starts one
fresh agent with it and reads only its report: two turns of the large
session, not one per step. The agent runs on the model the task's class
routes to, never below tier 2, and on the fallback tier (Opus 5.5 high)
for judgment work; for a specified change it is the implementer. It
reports what it verified and how, and never commits, pushes or publishes
unless the brief says so. The limits: you cannot steer it midway, it
reports once, each question you ask about its work afterwards is still a
full-size turn of the large session, and it works alone, starting no
agents of its own.

**Bulky reading.** Bulky reading (logs, test output, many files) goes to
the reader agent for the same reason: what the agent reads never enters
the session's context. When the session grows large anyway, the plugin
offers to compact it (the offer to compact above, the pane's Compact
button).

**What fills the context.** `/pacing-status` ends with the session's
context: the total against the window and the point where it compacts by
itself; the conversation's total; and the fixed parts (system prompt,
tools, memory files, skills), as in

    Context: 183k of 1M (18%); it compacts by itself at 967k
      Messages 160k
      System tools 15k · Memory files 4k · System prompt 3k

The categories are Claude Code's own estimate, as `/context` shows them.

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
folder overwrite each other's work. So each session leaves a mark for the
project when it starts and at each reading, and a new session's start
line says when another one has been at work there, how long ago and for
how long, and tells Claude to check with you before editing files. It is
a warning, never a block. A mark counts for 45 minutes when the plugin's
automatic readings keep it fresh (they come at least every 10 minutes
while a session works), and for 2 hours otherwise; a session that ends
takes its mark with it. Where Claude Code does not give the session an
id, no mark is left and nothing is said. The plugin does not lock or
track your source files: Claude's edit tool already refuses a file that
changed since it was read, and parallel work on code belongs in separate
git worktrees.

The plugin's own files (the settings, the last reading, the agents'
notes) can be written by several sessions at once without one losing the
other's change.

## Limits

- Claude Code does not tell a plugin how long the cache lives: an hour is
  assumed, for the notice after a pause and the warning before the cache
  lapses.
- In a terminal session the plugin cannot read the per-model meter by
  itself: it carries Fable's figure over from the last full reading. That
  figure can only have risen since, so a level that rests on it may be
  too mild until the next full reading.
- Use the plugin does not see (another device, the web) moves the meters
  with nothing counted, so the budget shows less left than there is.
- Claude Code names each turn's model but not its effort, so the split by
  model in `/pacing-status` is an estimate.
- The time left for an agent and its percentage are rough estimates from
  earlier runs, not a measure of the work.

## Commands

Installed as a plugin, the skill answers to `/pacing:pacing` (plugin
name, colon, skill name); `/pacing` below stands for that. Typing "usage"
in plain words works too. The rules for delegating work are a second,
smaller skill, `/pacing:route`, which Claude loads by itself before it
first hands work to a subagent; a plain report never loads them. Where
Claude Code has hooks modules, `/pacing-pane` (the pane), `/pacing-usage` (the report),
`/pacing-help` (the short help) and `/pacing-guide` (this guide) answer
at once, without using the model. `/pacing-usage` shows the report in a
code block; with no fresh reading and no usage tool to take one, it says
so, as in `Pacing: no reading to show (the last reading is 45 min old).
/pacing usage now takes a new one.`

| command | what it does |
|---|---|
| `/pacing`, `/pacing usage`, or just typing "usage" | reports the level, the trend and the routing; from the last reading when it is fresh enough (see "A report without a new reading"), else from new readings of the meters |
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
| `/pacing switch on`, `/pacing switch off` | turns the Switch row on (the default) or off |
| `/pacing reload on`, `/pacing reload off` | turns the new-version row on (the default) or off; off, one toast per version says the same. The plugin runs nothing itself either way |
| `/pacing notify on`, `/pacing notify off` | turns the toasts about running subagents on (the default) or off: when one starts, when one ends, and every 5 minutes while any runs; the status line and the row above the prompt still show them |
| `/pacing compact on`, `/pacing compact off` | turns the offer to compact on (the default) or off: a row above the prompt with Compact now from 400 000 tokens, in the warning colour from 650 000, and a warning before the cache of an idle session lapses |
| `/pacing autocompact 750k`, `/pacing autocompact auto`, `/pacing autocompact off` | where Claude Code compacts a session by itself: pacing sets its `/autocompact` at each session start and when the model changes, so the session compacts at this figure (Claude Code compacts a buffer of about 33k short of the window it is given, so pacing gives it that much more; 750k by default; 100k to 1M, as 750000, 750k or 0.75M). auto: Claude Code's own default (the pane's Use Claude Auto Compact switch; switched off again it returns to your last value). off: pacing leaves `/autocompact` alone, and the pane shows one dim line saying so |
| `/pacing premium opus`, `/pacing premium none` | names the model the plan's per-model meter belongs to (Fable by default), or says the plan has none |
| `/pacing fallback opus high`, `/pacing fallback none` | the tier that takes the top place while that meter is used up (Opus 5.5 high by default); none lets the remaining tiers move up |
| `/pacing reader haiku medium`, `/pacing reader ladder` | the model the reader agent reads on (Haiku 5.5 medium by default), or the lowest tier |
| `/pacing verifier haiku medium`, `/pacing verifier ladder` | the model the verifier runs plain test runs on (Haiku 5.5 medium by default), or the lowest tier |
| `/pacing notes` | where the role agents' notes for this project are, and how long each is |
| `/pacing agents` | the role agents this project's session keeps, and their tokens by role and model |
| `/pacing handover` | the session writes a handover for the next session of this project |
| `/pacing handover done` | files the waiting handover away once its work is picked up |
| `/pacing version` | the installed plugin version |
| `/pacing doctor` | checks that pacing works here, a line each: the version, the hooks module, the last reading, the per-model meter, the week, the settings, the token rate, the agent records, the folders, and what new sessions start on; each problem with one step to fix it |
| `/pacing saved` | what delegating to agents on cheaper models saved this week, against the session's model; `saved detail` adds a table by role and model |

Your files live in `~/.claude/pacing`: the configuration in `config.json`,
the readings in `log.jsonl`, the last one in `state.json`, your subagent
rules in `BRIEF.local.md`. A plugin update replaces the plugin's own
folder and leaves that one alone. If `config.json` is edited by hand into
something the commands would not write, the value in question falls back
to its default and the report says which; a file that no longer parses
is set aside as `config.json.damaged`. The first run creates the
configuration from the defaults (or takes over the files of an earlier
standalone install of this skill) and shows the short help once.

**A new version.** The desktop app installs a new version of the plugin
in the background, and an open session keeps the old one until you type
`/reload-plugins` or open a new session. A row above the prompt then says
`📦 Pacing 0.9.16 is installed: type /reload-plugins to load it, or open a new session.`
with **Not now** (for that version only). The plugin runs nothing and
puts nothing in the prompt box. `/pacing reload off` turns the row off:
then the same line comes once per version as a toast instead. How the
plugin looks for a new version is in INTERNALS.md.

## Words used here

Each thing has one name in the guide and in everything the plugin shows:

| word | means |
|---|---|
| weekly meter | the plan's "Weekly · all models" meter; `Weekly` in the status line. The budget line is drawn against it |
| per-model meter | the plan's weekly meter for one model (`/pacing premium` names it, Fable by default), called by that model: `Fable` in the status line, "Fable's meter" in a sentence |
| 5-hour window | the plan's "5-hour limit", shared by all models |
| budget, budget line | the share of the week the days so far may use, drawn as a line that steps up at midnight. `Budget` is how long what is still under it lasts at the last hour's pace (`Budget: 2h 10m left`); `Budget tokens`, shown until a pace is known, is the same in full-price tokens of tier 1's model (`~` while it is estimated); `Budget: 5%` is the same in points |
| level | where the weekly meter stands against the budget line: ahead, on pace, over, throttle, stop in the report; under budget, on budget, over budget, far over budget, stop in toasts. The per-model meter's model is "held" or "out" |
| reading | one look at the meters, logged; "full" when it has the per-model meter, "automatic" when the plugin took it. One is taken, never "measured" |
| tier, ladder | a tier is one model with its effort; the ladder is the tiers in order, tier 1 on top. A model is named with its effort, `Opus 5.5 high` |
| session's model | the model and effort this session runs on |
| Subagents | the count of what runs for this session: `⏳ 2 Subagents running`, `3 Subagents are still running` |
| agent | one of them by name, as the toasts give it: `implementer is running …` |
| role agent | one of the four the plugin brings: reader, verifier, implementer, researcher |
| side session | a session this one started in the desktop app; its status line leads with `sub`, and it counts among the Subagents |
| status line | the plugin's line in the footer |
| row | a line above the prompt with buttons, named by what it offers: the Switch row, the offer to compact, the new-version row; a button by its label, **Switch** |
| toast | a message that shows for a few seconds and goes |
