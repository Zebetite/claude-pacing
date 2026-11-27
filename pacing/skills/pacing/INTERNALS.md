# Model pacing: how it works inside

The details behind the guide (GUIDE.md), for those who want them. You do
not need any of this to use the plugin, and nothing loads this file
automatically: neither the skills nor the session read it.

## Automatic readings

On a Claude Code version with hooks modules, the plugin takes a reading
by itself after a turn: when the weekly meter has moved a whole point, or
10 minutes after the last reading. It also takes one when the plugin
loads (a session's start, a reload, a new version), so the status line
never shows old figures until the next turn. Each automatic reading also
keeps the next session's start line fresh, and a toast says when the
level gets worse, to far over budget or to stop.

**In the desktop app.** Claude Code hands a plugin only the weekly meter
and the 5-hour window. In the desktop app the plugin reads the rest
itself, through the app's own usage tool: the per-model meter (Fable's
by default), extra usage, and the session's context with what fills it.
That costs no model call and asks you nothing. Such a reading is a full
one: the per-model figure in the status line is the one just read, the
level rests on it, and the session is never asked to take a reading.
`/pacing log` marks it `(auto, full)`. It comes no more often than any
automatic reading (a whole point, 10 minutes, the plugin's load), and
once more when a subagent finishes, if the last reading is 5 minutes old,
since the agent's work moved the meters.

**Without the app** (a terminal session), or when the usage tool does not
answer, an automatic reading has the two meters Claude Code hands over
and carries the per-model figure over from the last full reading of the
week; `/pacing log` marks it `(auto)`. The figure can only have risen
since, so a carried level may be too mild, never too strict. Once the
figure is half an hour old it is never shown as current: `/pacing-status`
gives its age and, where the readings allow, an estimate of where the
meter is now (`71% Fable 15h ago, est. 90%`); the status line shows the
figure as read. The estimate is only shown; the level never rests on it.
Once the figure is an hour old, or the weekly meter has moved 2 points
since it was read, Claude is told beside your next prompt to take a full
reading. That happens once, and again an hour later if no reading came;
the next session's start line says so too. `/pacing log` marks such a
figure with its age.

An automatic reading of either kind never changes the next session's
model: that stays with the readings the session takes. On an older
Claude Code the plugin works without automatic readings.

## The budget in tokens

The `Budget tokens` figure is in full-price tokens of tier 1's model:
what is left, at that model's price for an input token. The plugin
learns what one point of the weekly meter costs from what its sessions
spend over the week, each model's tokens priced at its API rates. Until
this week's meter has risen 5 points, the week before's rate is used.
Because of this, cache reads, which a long session reads again on every
turn, count at their lower price, as they do on the meter, and the figure
holds steady as a session grows. Before any rate is learned, the plugin
estimates it from what this week's sessions on this computer cost, and
marks the figure `~`.

The meter moves in whole points. So each reading also takes off what the
sessions on this computer spent since the meter last moved (never more
than a point), and between readings each session takes off its own
turns: the figure falls with every turn rather than a point at a time.
Every session takes the newest reading any of them made within a minute,
so sessions side by side show one figure.

## A report without a new reading

Reading the meters costs a tool call whose answer is long. So
`/pacing usage` first looks at the last reading, often one the plugin
took by itself, and reports from it when it is at most 30 minutes old,
from the same week, and not at "stop". Within 30 minutes an automatic
reading is at most a point behind. That is because, where the hooks
module runs, the plugin takes one each time the meter moves a whole
point.

The per-model figure in it must be under 30 minutes old too, or under an
hour while it is 15 points or more under the budget line, because it
routes the work while Fable runs tier 1. The report then says when the
reading was taken and what it lacks (the session's context, extra
usage). Anything older, or `/pacing usage now`, reads the meters afresh.
`/pacing-usage` shows the same report without the model at all: when the
last reading is too old, the plugin first takes a full one itself, where
the app's usage tool answers.

## The split by model in /pacing-status

The split of this session's use over the ladder's models is an estimate:
each model's tokens priced at its API rates, which is how the weekly
meter weighs the models too. The tiers are those in force at the
reading: while Fable's meter is out or held, the fallback (Opus 5.5 high)
is tier 1. Claude Code names the model of each turn but not its effort,
so a model on two tiers counts at the higher one for the session's own
turns and at the lower one for its subagents. The reader agent's model,
when it is not on the ladder, counts as the tier after the last (tier 4
with three tiers).

The circles are gold, silver, bronze and brown for tiers 1 to 4
(🟡 ⚪ 🟠 🟤), then 🟣 🔴 🔵 🟢 for a longer ladder; ⚫ is a model the
ladder does not hold.

## A new version

On a Claude Code version with hooks modules, the plugin looks for a new
version when a turn ends and every 5 minutes. In a session you have typed
in, the new-version row then shows at once. The plugin runs nothing and
puts nothing in the prompt box: over a remote connection Claude Code does
not run `/reload-plugins` at all, and a new session loads the new version
either way. Reload in one session and the row goes from your other
sessions within five minutes; they keep the older version until you
reload there too.
