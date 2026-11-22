// The hooks module under the engine's own test kit: `claude plugin test` on
// the plugin folder. The hooks here stand for the engine: they answer the
// module's $.process.run with what budget.mjs --source hook prints, and catch
// the status line it sets. budget.mjs itself is tested under tests/ with
// node --test.
import { expect, mock, test } from 'claude-code/testing'
import { pauseNote, unattended, statusText, fullText, HEAD_MAX, levelPhrase, offerText, nowText, COMPACT_INSTRUCTIONS, LINE_MAX, MSG_MAX, TASK_MAX, agentPart, roleOf, startedText, doneText, progressText, backgroundText, estimateOf, median, keepRuns, RUNS_KEPT, stepOf, switchOffer, switchedText, countText, sessionRows, workingSessions, versionOf, reloadedText, reloadAskText, RELOAD_CHECK_EVERY, RELOAD_AFTER_TURN, RELOAD_SETTLE, RELOAD_GIVE_UP, usageOf, USAGE_TOOL, roleFor, shortModel, freshOf, freshNote, usageText, measureWhy, partOf, partText, PANEL, panelLines, outcomeOf, DONE_SHOWN, ICON, TOAST_LONG, levelIcon, sessionStartedText, sessionDoneText, compactedText, leftOf, leftText, usualText } from './readings.mjs'

const RESET = '2026-11-19T12:00:00.000Z'
const PRICES = {
  'claude-fable-5-2': [8, 40, 0.2, 10],
  'claude-opus-5-5': [4, 20, 0.2, 5],
  'claude-sonnet-5-5': [2, 10, 0.1, 2.5],
  'claude-haiku-5-5': [0.1, 0.5, 0.01, 0.125],
}
// the default ladder: Fable, Opus, Sonnet; the reader on Haiku after it
const TIER_OF = { 'claude-fable-5-2': 1, 'claude-opus-5-5': 2, 'claude-sonnet-5-5': 3, 'claude-haiku-5-5': 4 }

const measure = (pct: number, more: { kind: string; percentUsed: number; resetsAt?: string }[] = [], tokens = 50000) => ({
  context: { window: 1000000, tokens, percent: Math.round(tokens / 10000) },
  rateLimits: [{ kind: 'seven_day', percentUsed: pct, resetsAt: RESET }, ...more],
  changed: ['rateLimits' as const],
})
const answer = (level: string, all: number, extra: Record<string, unknown> = {}) => ({
  exitCode: 0,
  stdout: JSON.stringify({ level, all, line: 20, ofBudget: Math.round(100 * all / 20), tierOf: TIER_OF, prices: PRICES, premium: 40,
    premiumOut: false, premiumLabel: 'Fable 5.2', premiumAt: null, logged: true, do: 'the default split', ...extra }) + '\n',
  stderr: '',
  isStdoutTruncated: false,
  isStderrTruncated: false,
})
// a turn that spent `usd` on `model`, all of it as output tokens
const turn = (model: string, usd: number, agentId?: string) => ({
  answer: '', durationMs: 1, isAborted: false, turnId: 't' + Math.random(), reason: 'answer' as const,
  ...(agentId ? { agentId } : {}),
  usage: { model, input_tokens: 0, output_tokens: (usd * 1e6) / PRICES[model as keyof typeof PRICES][1], cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
})
// what stands for the engine beneath the module in every test; the status
// lines the module set, in order
const engine = (on: any) => {
  const status: (string | undefined)[] = []
  on('session.measure', (_: unknown, e: any) => ({ changed: e.changed }))
  on('turn.complete', (_: unknown, e: any) => ({ text: e.answer }))
  on('ui.status', (_: unknown, e: any) => (status.push(e.text), { value: undefined }))
  return status
}

test('a reading runs budget.mjs from the plugin folder', async ($, on) => {
  engine(on)
  const runs: (readonly string[])[] = []
  on('process.run', (_, e) => (runs.push(e.argv), { value: answer('ahead', 10) }))

  await $.session.measure(measure(10, [{ kind: 'five_hour', percentUsed: 4, resetsAt: '2026-11-13T15:00:00.000Z' }]))

  expect(runs.length).toBe(1)
  const argv = runs[0]
  expect(argv[0]).toBe('node')
  expect(argv[1].endsWith('/skills/pacing/scripts/budget.mjs')).toBe(true)
  expect(argv.slice(2)).toEqual(['--all', '10', '--reset', RESET, '--source', 'hook', '--five', '4', '--five-reset', '2026-11-13T15:00:00.000Z'])
})

// the tier split, now only in /pacing-status's long form
const split = async ($: any) => ((await $.command.run({ command: 'pacing-status', args: '' } as any)).text.split('\n')[0].match(/(?:[🟡⚪🟠🟤🟣🔴🔵🟢⚫](?:Tier \d+|Other)\[\d+%\] ?)+/u) || [''])[0].trim()

test('the status line: the budget share and the usage, no tiers; the tier split in /pacing-status', async ($, on) => {
  const status = engine(on)
  on('process.run', () => ({ value: answer('ahead', 15.4) }))

  await $.session.measure(measure(15.4))
  expect(status.at(-1)).toBe('Budget 77% · usage: Weekly 15% Fable 40%')

  await $.turn.complete(turn('claude-fable-5-2', 8))
  await $.turn.complete(turn('claude-opus-5-5', 1.5, 'a1'))
  await $.turn.complete(turn('claude-haiku-5-5', 0.5, 'a2'))
  // no new reading is due (the meter did not move): the line is redrawn all the same
  await $.session.measure(measure(15.4))
  expect(status.at(-1)).toBe('Budget 77% · usage: Weekly 15% Fable 40%')
  expect(status.at(-1)).not.toMatch(/T\d|Tier/)
  expect(await split($)).toBe('🟡Tier 1[80%] ⚪Tier 2[15%] 🟤Tier 4[5%]')
})

test('a priced model off the ladder is Other, one with no price is left out; a long ladder takes more colours', async ($, on) => {
  const status = engine(on)
  on('process.run', () => ({ value: answer('on pace', 18, { tierOf: { 'claude-fable-5-2': 1, 'claude-sonnet-5-5': 3, 'claude-haiku-5-5': 5 }, premium: null }) }))

  await $.turn.complete(turn('claude-sonnet-5-5', 3))
  await $.turn.complete(turn('claude-haiku-5-5', 0.5))
  await $.turn.complete(turn('claude-opus-5-5', 0.5))
  await $.turn.complete({ ...turn('claude-sonnet-5-5', 1), usage: { model: 'claude-opus-4-8', input_tokens: 0, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } })
  await $.session.measure(measure(18))
  expect(status.at(-1)).toBe('Budget 90% · usage: Weekly 18%')
  expect(await split($)).toBe('🟠Tier 3[75%] 🟣Tier 5[13%] ⚫Other[12%]')
})

test('the shares always add up to 100, however the spend divides', async ($, on) => {
  const status = engine(on)
  on('process.run', () => ({ value: answer('ahead', 10) }))

  // 2:2:2:1 is 28.6, 28.6, 28.6, 14.3 %: three points short when rounded down
  await $.turn.complete(turn('claude-fable-5-2', 2))
  await $.turn.complete(turn('claude-opus-5-5', 2))
  await $.turn.complete(turn('claude-sonnet-5-5', 2))
  await $.turn.complete(turn('claude-haiku-5-5', 1))
  await $.session.measure(measure(10))
  const line = await split($)
  const shares = [...line.matchAll(/\[(\d+)%\]/g)].map(m => Number(m[1]))
  expect(shares).toEqual([29, 29, 28, 14])
  expect(shares.reduce((a, b) => a + b, 0)).toBe(100)
})

test('an event with no rate limits at all is let through', async ($, on) => {
  const status = engine(on)
  let runs = 0
  on('process.run', () => (runs++, { value: answer('ahead', 10) }))

  const r = await $.session.measure({ context: { window: 1000000 }, changed: ['context'] } as any)
  expect(r.changed).toEqual(['context'])
  expect(runs).toBe(0)
  expect(status).toEqual([])
})

test('no run without a weekly window, nor again before it moves a point', async ($, on) => {
  const status = engine(on)
  let runs = 0
  on('process.run', () => (runs++, { value: answer('ahead', 10) }))

  await $.session.measure({ context: { window: 1000000 }, rateLimits: [], changed: ['context'] })
  expect(runs).toBe(0)
  expect(status).toEqual([])
  await $.session.measure(measure(10))
  await $.session.measure(measure(10.5))
  expect(runs).toBe(1)
  await $.session.measure(measure(11))
  expect(runs).toBe(2)
})

test('a change of level is one toast with the level words; the line says the budget share alone', async ($, on) => {
  const status = engine(on)
  const toasts: string[] = []
  let next = answer('on pace', 18)
  on('process.run', () => ({ value: next }))
  on('ui.toast', (_, e) => (toasts.push(e.text), { value: undefined }))

  await $.session.measure(measure(18))
  expect(toasts).toEqual([])
  next = answer('over', 21, { do: 'medium tasks leave the session model too' })
  await $.session.measure(measure(21))
  expect(toasts).toEqual(['⚠️ on budget -> over budget. medium tasks leave the session model too'])
  next = answer('stop', 96)
  await $.session.measure(measure(96))
  expect(status.at(-1)).toBe('Budget 480% · usage: Weekly 96% Fable 40%')
})

test('a failed run changes nothing and never throws into the session', async ($, on) => {
  const status = engine(on)
  on('process.run', () => ({ value: { ...answer('ahead', 10), exitCode: 1, stdout: 'usage: ...' } }))

  const r = await $.session.measure(measure(10))
  expect(r.changed).toEqual(['rateLimits'])
  expect(status).toEqual([])
})

// ---- the per-model meter in the status line ----

test('a carried per-model figure is current for half an hour; when that meter set the level, the head is the weekly share alone', async ($, on) => {
  const status = engine(on)
  const toasts: string[] = []
  const NOW = Date.parse('2026-11-13T10:00:00.000Z')
  mock.clock(on, { now: NOW })
  // read 20 min ago: still shown as it is
  let next = answer('ahead', 10, { premium: 18, premiumAt: '2026-11-13T09:40:00.000Z', premiumLevel: 'on pace', levelBy: 'all', premiumOfBudget: 90 })
  on('process.run', () => ({ value: next }))
  on('ui.toast', (_, e) => (toasts.push(e.text), { value: undefined }))

  await $.session.measure(measure(10))
  expect(status.at(-1)).toBe('Budget 50% · usage: Weekly 10% Fable 18%')
  next = answer('over', 11, { premium: 22, premiumAt: null, premiumLevel: 'over', levelBy: 'premium', premiumOfBudget: 110, do: 'medium tasks leave the session model too' })
  await $.session.measure(measure(11))
  // no "Fable over 110%": the per-model meter shows as its usage only
  expect(status.at(-1)).toBe('Budget 55% · usage: Weekly 11% Fable 22%')
  expect(toasts).toEqual(['⚠️ under budget -> over budget (Fable meter). medium tasks leave the session model too'])
})

test('the session moved off the per-model meter\'s model is one toast, though the level stays', async ($, on) => {
  engine(on)
  const toasts: string[] = []
  let next = answer('ahead', 10)
  on('process.run', () => ({ value: next }))
  on('ui.toast', (_, e) => (toasts.push(e.text), { value: undefined }))

  await $.session.measure(measure(10))
  next = answer('ahead', 11, { premium: 30, premiumHeld: true, premiumLevel: 'throttle', premiumOfBudget: 150, do: 'Fable 5.2\'s own meter is at throttle: this session belongs on Opus 5.5 high now, and Fable 5.2 is kept for judgment work; the Switch row offers it. the session model does nearly everything' })
  await $.session.measure(measure(11))
  expect(toasts).toEqual(['⚠️ Fable 5.2\'s own meter is at throttle: this session belongs on Opus 5.5 high now, and Fable 5.2 is kept for judgment work; the Switch row offers it. the session model does nearly everything'])
})

// ---- the warning after a pause ----

const T0 = Date.parse('2026-11-15T10:00:00.000Z')
// the engine beneath, for a prompt: what entered, and the order things happened in
const prompts = (on: any, order: string[]) => {
  const entered: string[] = []
  on('prompt.submit', (_: unknown, e: any) => (order.push('turn'), entered.push(e.text), { text: e.text }))
  on('ui.toast', (_: unknown, e: any) => (order.push('toast: ' + e.text), { value: undefined }))
  return entered
}
const big = (on: any) => on('process.run', () => ({ value: answer('ahead', 10) }))

test('after an hour idle, a large session is told once, before the turn, and the prompt goes on unchanged', async ($, on) => {
  engine(on)
  big(on)
  const clock = mock.clock(on, { now: T0 })
  const order: string[] = []
  const entered = prompts(on, order)

  await $.turn.complete(turn('claude-fable-5-2', 1))
  await $.session.measure(measure(10, [], 420000))
  await clock.advance(85 * 60000)
  const r = await $.prompt.submit({ text: 'go on with the tests', asUser: true })
  expect(r.text).toBe('go on with the tests')
  expect(entered).toEqual(['go on with the tests'])
  expect(order).toEqual([
    'toast: 💤 this session is 420k tokens and sat idle 1 h 25 min, so its cache has lapsed and this turn stores it all again. After a break, /compact first is cheaper.',
    'turn',
  ])
  // a second prompt in the same pause: no second warning
  await $.prompt.submit({ text: 'and the docs', asUser: true })
  expect(order.filter(o => o.startsWith('toast')).length).toBe(1)
  // the next pause is a new one
  await $.turn.complete(turn('claude-fable-5-2', 1))
  await clock.advance(61 * 60000)
  await $.prompt.submit({ text: 'next', asUser: true })
  expect(order.filter(o => o.startsWith('toast')).length).toBe(2)
  expect(order.at(-2)).toContain('sat idle 1 h 1 min')
})

test('no warning under an hour, under 300 000 tokens, or before any turn', async ($, on) => {
  engine(on)
  big(on)
  const clock = mock.clock(on, { now: T0 })
  const order: string[] = []
  prompts(on, order)

  // no turn yet: nothing to measure the pause from
  await $.session.measure(measure(10, [], 420000))
  await clock.advance(3 * 3600000)
  await $.prompt.submit({ text: 'a', asUser: true })
  await $.turn.complete(turn('claude-fable-5-2', 1))
  await clock.advance(59 * 60000)
  await $.prompt.submit({ text: 'b', asUser: true })
  await $.turn.complete(turn('claude-fable-5-2', 1))
  await $.session.measure(measure(10, [], 299999))
  await clock.advance(2 * 3600000)
  await $.prompt.submit({ text: 'c', asUser: true })
  expect(order).toEqual(['turn', 'turn', 'turn'])
})

test('a subagent\'s turn does not end the pause; a slash command is not warned and does not use the warning up', async ($, on) => {
  engine(on)
  big(on)
  const clock = mock.clock(on, { now: T0 })
  const order: string[] = []
  prompts(on, order)

  await $.turn.complete(turn('claude-fable-5-2', 1))
  await $.session.measure(measure(10, [], 600000))
  await clock.advance(50 * 60000)
  await $.turn.complete(turn('claude-opus-5-5', 1, 'a1'))
  await clock.advance(20 * 60000)
  await $.prompt.submit({ text: '/compact' , asUser: true })
  expect(order).toEqual(['turn'])
  await $.prompt.submit({ text: 'go on', asUser: true })
  expect(order.filter(o => o.startsWith('toast'))).toEqual([
    'toast: 💤 this session is 600k tokens and sat idle 1 h 10 min, so its cache has lapsed and this turn stores it all again. After a break, /compact first is cheaper.',
  ])
})

test('a failing toast never stops the prompt', async ($, on) => {
  engine(on)
  big(on)
  const clock = mock.clock(on, { now: T0 })
  const entered: string[] = []
  on('prompt.submit', (_: unknown, e: any) => (entered.push(e.text), { text: e.text }))
  on('ui.toast', () => { throw new Error('no toasts here') })

  await $.turn.complete(turn('claude-fable-5-2', 1))
  await $.session.measure(measure(10, [], 420000))
  await clock.advance(2 * 3600000)
  const r = await $.prompt.submit({ text: 'still goes', asUser: true })
  expect(r.text).toBe('still goes')
  expect(entered).toEqual(['still goes'])
})

// the kit raises a test's prompt with no origin, so the prompts nobody typed
// are checked here, on the module's own filter
test('prompts nobody typed are not warned: notifications, schedules, peers, a plugin\'s own', () => {
  for (const kind of ['task-notification', 'scheduled-trigger', 'auto-continuation', 'peer', 'coordinator', 'plugin']) expect(unattended({ kind })).toBe(true)
  for (const o of [undefined, { kind: 'composer' }, { kind: 'bridge' }, { kind: 'sdk' }, { kind: 'plugin', asUser: true }]) expect(unattended(o)).toBe(false)
})

test('the line: from 300 000 tokens and an hour idle, in whole minutes', () => {
  expect(pauseNote(300000, 3600000)).toContain('300k tokens and sat idle 1 h,')
  expect(pauseNote(299999, 7200000)).toBe(null)
  expect(pauseNote(500000, 3599999)).toBe(null)
  expect(pauseNote(null as any, 7200000)).toBe(null)
  expect(pauseNote(1200000, 26 * 3600000 + 5 * 60000)).toContain('1200k tokens and sat idle 26 h 5 min,')
})

// ---- a session another session started ----

test('a side session leads with its own tier: Tier X Sub Agent - X% of budget', async ($, on) => {
  const status = engine(on)
  on('process.run', () => ({ value: answer('ahead', 10, { spawned: true }) }))

  await $.turn.complete(turn('claude-opus-5-5', 9))
  await $.turn.complete(turn('claude-haiku-5-5', 1, 'a1'))
  await $.session.measure(measure(10))
  expect(status.at(-1)).toBe('sub · Budget 50% · usage: Weekly 10%')
})

test('a side session shows no per-model meter, even when it set the level; a model off the ladder is Other', async ($, on) => {
  const status = engine(on)
  let next = answer('over', 11, { premium: 22, levelBy: 'premium', premiumOfBudget: 110, spawned: true })
  on('process.run', () => ({ value: next }))

  await $.turn.complete(turn('claude-fable-5-2', 1))
  await $.session.measure(measure(11))
  // no per-model meter in a side session: the weekly share alone, without the
  // level's word, since that meter set the level
  expect(status.at(-1)).toBe('sub · Budget 55% · usage: Weekly 11%')
  next = answer('ahead', 12, { spawned: true })
  await $.turn.complete({ ...turn('claude-fable-5-2', 1), usage: { model: 'claude-opus-4-8', input_tokens: 0, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } })
  await $.session.measure(measure(12))
  expect(status.at(-1)).toBe('sub · Budget 60% · usage: Weekly 12%')
})

test('a session of its own, or one whose start is not known, keeps the plain line', async ($, on) => {
  // CLAUDE_CODE_CHILD_SESSION is set for every command the engine runs, in
  // every session: it must not make a side session of this one
  mock.env(on, { CLAUDE_CODE_CHILD_SESSION: '1' })
  const status = engine(on)
  let next = answer('ahead', 10, { spawned: false })
  on('process.run', () => ({ value: next }))

  await $.turn.complete(turn('claude-opus-5-5', 1))
  await $.session.measure(measure(10))
  expect(status.at(-1)).toBe('Budget 50% · usage: Weekly 10% Fable 40%')
  next = answer('ahead', 11, { spawned: null })
  await $.session.measure(measure(11))
  expect(status.at(-1)).toBe('Budget 55% · usage: Weekly 11% Fable 40%')
  // an older budget.mjs says nothing of it
  next = answer('ahead', 12)
  await $.session.measure(measure(12))
  expect(status.at(-1)).toBe('Budget 60% · usage: Weekly 12% Fable 40%')
})

test('a side session before its first turn ends takes the model it is set to', async ($, on) => {
  // the case reported: after a reload the session.measure calls of a turn
  // came before its end, and the line went out without Sub Agent
  const status = engine(on)
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('process.run', () => ({ value: answer('ahead', 10, { spawned: true }) }))

  await $.turn.complete(turn('claude-haiku-5-5', 1, 'a1'))
  await $.session.measure(measure(10))
  expect(status.at(-1)).toBe('sub · Budget 50% · usage: Weekly 10%')
})

test('a side session whose model is not known yet is marked sub at once, and shows no per-model meter', async ($, on) => {
  const status = engine(on)
  on('session.model', () => ({ value: 'opus' }))
  on('process.run', () => ({ value: answer('ahead', 10, { spawned: true }) }))

  await $.turn.complete(turn('claude-opus-5-5', 1, 'a1'))
  await $.session.measure(measure(10))
  expect(status.at(-1)).toBe('sub · Budget 50% · usage: Weekly 10%')
})

test('the line is redrawn when the main thread\'s turn ends', async ($, on) => {
  const status = engine(on)
  on('process.run', () => ({ value: answer('ahead', 10, { spawned: true }) }))

  await $.session.measure(measure(10))
  const before = status.length
  await $.turn.complete(turn('claude-opus-5-5', 1))
  expect(status.length).toBe(before + 1)
  expect(status.at(-1)).toBe('sub · Budget 50% · usage: Weekly 10%')
  // a subagent's turn waits for the next measure
  await $.turn.complete(turn('claude-haiku-5-5', 1, 'a1'))
  expect(status.length).toBe(before + 1)
})

// ---- a carried per-model figure is not a current one ----

// the case reported: Fable read at 71 %, then unread for 15 hours while all
// models went from 45 to 49 %; the real meter stood at 90 %
const STALE = { premium: 71, premiumAt: '2026-11-15T01:00:00.000Z', premiumEstimate: 90, premiumLevel: 'throttle', premiumHeld: true, premiumOfBudget: 152,
  needFull: 'the Fable 5.2 figure is 15 h old', do: 'Fable 5.2\'s own meter is at throttle: this session belongs on Opus 5.5 high now, and Fable 5.2 is kept for judgment work; the Switch row offers it. medium tasks leave the session model too' }
const AT_16 = Date.parse('2026-11-15T16:00:00.000Z')

test('a 15-hour-old carried figure: the line shows it plainly; /pacing-status gives its age and the estimate', async ($, on) => {
  const status = engine(on)
  const clock = mock.clock(on, { now: AT_16 })
  let next = answer('over', 49, STALE)
  on('process.run', () => ({ value: next }))
  const full = async () => (await $.command.run({ command: 'pacing-status', args: '' } as any)).text.split('\n')[0]

  await $.session.measure(measure(49))
  expect(status.at(-1)).toBe('Budget 245% · usage: Weekly 49% Fable 71%')
  expect(status.at(-1)).not.toMatch(/old|est|\(/)
  expect(await full()).toContain('71% Fable 15h ago, est. 90%')
  await clock.advance(20 * 60000)
  await $.session.measure(measure(49))
  expect(status.at(-1)).toBe('Budget 245% · usage: Weekly 49% Fable 71%')
  // no estimate to give: the age alone, in /pacing-status; under an hour in minutes, past two days in days
  next = answer('over', 50, { ...STALE, premiumEstimate: null, premiumAt: '2026-11-15T15:35:00.000Z' })
  await $.session.measure(measure(50))
  expect(status.at(-1)).toBe('Budget 250% · usage: Weekly 50% Fable 71%')
  expect(await full()).toContain('71% Fable 45m ago)')
  next = answer('over', 51, { ...STALE, premiumEstimate: 71, premiumAt: '2026-11-12T16:20:00.000Z' })
  await $.session.measure(measure(51))
  expect(await full()).toContain('71% Fable 3d ago)')
})

test('a full reading is asked for beside the next prompt: once per stale figure, again after an hour, never in the prompt\'s own text', async ($, on) => {
  engine(on)
  const clock = mock.clock(on, { now: AT_16 })
  let next = answer('over', 49, STALE)
  on('process.run', () => ({ value: next }))
  const entered: { text: string; context?: readonly string[] }[] = []
  on('prompt.submit', (_: unknown, e: any) => (entered.push({ text: e.text, context: e.context }), { text: e.text, context: e.context }))

  // before any reading there is nothing to ask
  await $.prompt.submit({ text: 'first', asUser: true })
  expect(entered.at(-1)).toEqual({ text: 'first', context: undefined })
  await $.session.measure(measure(49))
  const r = await $.prompt.submit({ text: 'go on with the tests', asUser: true })
  expect(r.text).toBe('go on with the tests')
  expect(entered.at(-1)!.text).toBe('go on with the tests')
  expect(entered.at(-1)!.context).toEqual([
    'Pacing (automatic note, not from the user): the Fable 5.2 figure is 15 h old; it read 71 % then and is about 90 % by estimate. The automatic readings cannot read that meter. Before the next piece of work, take a full reading: run the `pacing` skill with `usage now`, and follow its do: line.',
  ])
  // not again for the same figure
  await $.prompt.submit({ text: 'and the docs', asUser: true })
  expect(entered.at(-1)!.context).toBeUndefined()
  // a slash command is never given it, and does not use it up
  await clock.advance(61 * 60000)
  await $.prompt.submit({ text: '/compact', asUser: true })
  expect(entered.at(-1)!.context).toBeUndefined()
  // nothing came of it in an hour: once more
  await $.prompt.submit({ text: 'next', asUser: true })
  expect(entered.at(-1)!.context?.length).toBe(1)
  // a full reading arrived: the automatic one carries a new figure and asks nothing
  next = answer('over', 50, { premium: 90, premiumAt: '2026-11-15T17:05:00.000Z', premiumHeld: true, needFull: null })
  await $.session.measure(measure(50))
  await $.prompt.submit({ text: 'after the reading', asUser: true })
  expect(entered.at(-1)!.context).toBeUndefined()
  // and when that one goes stale in its turn, it is asked for anew
  next = answer('over', 53, { premium: 90, premiumAt: '2026-11-15T17:05:00.000Z', premiumHeld: true, needFull: 'the Fable 5.2 figure is 3 h old' })
  await $.session.measure(measure(53))
  await $.prompt.submit({ text: 'later', asUser: true })
  expect(entered.at(-1)!.context?.[0]).toContain('the Fable 5.2 figure is 3 h old; it read 90 % then.')
})

test('the note is one block beside the prompt, marked as automatic', async ($, on) => {
  engine(on)
  mock.clock(on, { now: AT_16 })
  on('process.run', () => ({ value: answer('over', 49, STALE) }))
  let got: readonly string[] | undefined
  on('prompt.submit', (_: unknown, e: any) => (got = e.context, { text: e.text, context: e.context }))
  await $.session.measure(measure(49))
  await $.prompt.submit({ text: 'go', asUser: true })
  expect(got?.length).toBe(1)
  expect(got?.[0].startsWith('Pacing (automatic note, not from the user): ')).toBe(true)
})

// ---- one model on two tiers ----

// Fable held: Opus 5.5 high (the fallback) on top, Opus 5.5 medium at tier 2,
// as budget.mjs maps them for the ladder in force
const HELD_MAP = { tierOf: { 'claude-opus-5-5': 1, 'claude-sonnet-5-5': 3, 'claude-fable-5-2': 1, 'claude-haiku-5-5': 4 },
  agentTierOf: { 'claude-opus-5-5': 2, 'claude-sonnet-5-5': 3, 'claude-fable-5-2': 1, 'claude-haiku-5-5': 4 } }

test('the session on the fallback is tier 1; its subagents on the same model are tier 2', async ($, on) => {
  const status = engine(on)
  on('process.run', () => ({ value: answer('ahead', 10, { ...HELD_MAP, spawned: true }) }))

  await $.turn.complete(turn('claude-opus-5-5', 6))
  await $.turn.complete(turn('claude-opus-5-5', 3, 'a1'))
  await $.turn.complete(turn('claude-haiku-5-5', 1, 'a2'))
  await $.session.measure(measure(10))
  expect(status.at(-1)).toBe('sub · Budget 50% · usage: Weekly 10%')
  expect(await split($)).toBe('🟡Tier 1[60%] ⚪Tier 2[30%] 🟤Tier 4[10%]')
})

test('an older budget.mjs without agentTierOf: every turn counts by tierOf, as before', async ($, on) => {
  const status = engine(on)
  on('process.run', () => ({ value: answer('ahead', 10) }))

  await $.turn.complete(turn('claude-fable-5-2', 8))
  await $.turn.complete(turn('claude-opus-5-5', 2, 'a1'))
  await $.session.measure(measure(10))
  expect(status.at(-1)).toBe('Budget 50% · usage: Weekly 10% Fable 40%')
  expect(await split($)).toBe('🟡Tier 1[80%] ⚪Tier 2[20%]')
})

// ---- the line fits the footer the desktop app gives it ----

// The app draws the line in the composer's footer, beside the model and mode
// pickers, and cuts the rest with an ellipsis: about 32 characters while a
// turn runs (the case reported: `🟤Tier 1 Sub Agent - 158% of Fable ...`).
// So the line leads with what matters, and that lead fits the narrow case.
const chars = (s: string) => [...s].length
const head = (s: string) => { const p = s.split(' · '); return p.slice(0, /sub$/.test(p[0]) ? 2 : 1).join(' · ') }
const LONG_MIX = [1, 2, 3, 4, 5, 6, 7, 8].map(tier => ({ tier, share: 12 })).concat([{ tier: 'Other' as any, share: 4 }])
const BASE = { all: 100, line: 46.7, ofBudget: 214, premium: 100, premiumLabel: 'Fable 5.2', premiumAt: null as string | null }
const WORST = [
  // a side session off the ladder, the per-model meter held, three digits
  { j: { ...BASE, level: 'throttle', premiumHeld: true, premiumOfBudget: 999 }, self: 'Other' },
  // the per-model meter out
  { j: { ...BASE, level: 'over', premiumOut: true, premiumOfBudget: 214 }, self: 8 },
  // the per-model meter set the level
  { j: { ...BASE, level: 'throttle', levelBy: 'premium', premiumOfBudget: 999 }, self: 'Other' },
  // stop, which says wrap up
  { j: { ...BASE, level: 'stop', ofBudget: 999 }, self: 'Other' },
  // on pace, the longest level word
  { j: { ...BASE, level: 'on pace', ofBudget: 999 }, self: 'Other' },
]

test('the lead, a side session\'s tier and the level with its budget share, fits the narrowest footer', async () => {
  const now = Date.parse('2026-11-16T12:00:00.000Z')
  for (const { j, self } of WORST) {
    const s = statusText({ ...j, premiumAt: '2026-11-13T12:00:00.000Z', premiumEstimate: 140 }, LONG_MIX, self, now)
    expect(chars(head(s))).toBeLessThanOrEqual(HEAD_MAX)
  }
  // the case reported, now: the lead within the narrow room, the split after it
  const reported = statusText({ ...BASE, all: 50, premium: 90, level: 'over', ofBudget: 107, premiumHeld: true, premiumOfBudget: 158 }, [{ tier: 1, share: 100 }], 1, now)
  // a side session shows no per-model meter
  expect(reported).toBe('sub · Budget 107% · usage: Weekly 50%')
  expect(chars(head(reported))).toBeLessThanOrEqual(HEAD_MAX)
  // a realistic main session's whole line is shorter than the old form's
  const realistic = statusText({ ...BASE, all: 48, premium: 71, ofBudget: 103, level: 'over' }, [{ tier: 1, share: 45 }, { tier: 2, share: 55 }], null, now)
  expect(realistic).toBe('Budget 103% · usage: Weekly 48% Fable 71%')
  expect(chars(realistic)).toBeLessThan(chars(fullText({ ...BASE, all: 48, premium: 71, ofBudget: 103, level: 'over' }, [{ tier: 1, share: 45 }, { tier: 2, share: 55 }], null, now)))
})

test('the order: sub, the budget share, then the usage; no tiers; a cut takes the tail', async () => {
  const now = Date.parse('2026-11-16T12:00:00.000Z')
  const s = statusText({ ...BASE, level: 'throttle', premiumHeld: true, premiumOfBudget: 158, premiumAt: '2026-11-16T09:00:00.000Z', premiumEstimate: 104 },
    [{ tier: 1, share: 60 }, { tier: 2, share: 40 }], null, now)
  const parts = s.split(' · ')
  // the weekly level and share; the per-model meter only as its usage, last
  expect(parts[0]).toBe('Budget 214%')
  expect(parts.join(' · ')).not.toContain('held')
  expect(parts[1]).toBe('usage: Weekly 100% Fable 100%')
  expect(parts.length).toBe(2)
  // a side session: sub first, then the weekly share, no per-model meter
  const side = statusText({ ...BASE, level: 'throttle', premiumHeld: true, premiumOfBudget: 158, premiumAt: '2026-11-16T09:00:00.000Z', premiumEstimate: 104 },
    [{ tier: 1, share: 60 }, { tier: 2, share: 40 }], 2, now).split(' · ')
  expect(side).toEqual(['sub', 'Budget 214%', 'usage: Weekly 100%'])
  // no newline: a footer shows one line
  for (const { j, self } of WORST) expect(statusText(j, LONG_MIX, self, now)).not.toContain('\n')
})

test('/pacing-status shows the whole line in the long form, and what to do now', async ($, on) => {
  engine(on)
  on('process.run', () => ({ value: answer('over', 21, { premium: 90, premiumHeld: true, premiumOfBudget: 158, spawned: true, do: 'Fable 5.2 held: Opus 5.5 high' }) }))
  const none = await $.command.run({ command: 'pacing-status', args: '' } as any)
  expect(none.text).toContain('no automatic reading yet')

  await $.turn.complete(turn('claude-opus-5-5', 1))
  await $.session.measure(measure(21))
  const r = await $.command.run({ command: 'pacing-status', args: '' } as any)
  // a side session's long form shows no per-model meter either
  expect(r.text).toBe('Pacing: ⚪Tier 2 Sub Agent - Budget 105%, ⚪Tier 2[100%], (21% Weekly)\nNow: Fable 5.2 held: Opus 5.5 high')
})

// ---- the offer to compact ----

const BAND = {
  plugin: 'pacing', component: 'AbovePrompt', requestId: 'pacing', surface: 'desktop',
  props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const
// the engine beneath for the offers: what compacted and with which
// instructions, the toasts, the order of it all, and
// the config file the module reads (never the real one)
const offers = (on: any, opts: { config?: string; compacted?: { tokensBefore?: number; tokensAfter?: number } } = {}) => {
  const seen = { compacts: [] as string[], toasts: [] as string[], order: [] as string[], entered: [] as string[] }
  on('env.get', (_: unknown, e: any) => ({ value: e.name === 'USERPROFILE' ? '/home/test' : undefined }))
  // the path as the engine hands it on (it may resolve it); no config: '{}'
  on('fs.read', (_: unknown, e: any) => ({ value: opts.config !== undefined && /[\\/]\.claude[\\/]pacing[\\/]config\.json$/.test(String(e.path)) ? opts.config : '{}' }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.toast', (_: unknown, e: any) => (seen.toasts.push(e.text), seen.order.push('toast'), { value: undefined }))
  on('session.compact', (_: unknown, e: any) => (seen.compacts.push(e.instructions), seen.order.push('compact'),
    { messages: [{ role: 'assistant', text: 'the summary', toolUses: [] }], tokensBefore: opts.compacted?.tokensBefore, tokensAfter: opts.compacted?.tokensAfter ?? 40000 }))
  on('prompt.submit', (_: unknown, e: any) => (seen.order.push('turn'), seen.entered.push(e.text), { text: e.text }))
  return seen
}
// the band's text as drawn now, or undefined; mounted and unmounted again
const bandText = async ($: any) => {
  const ui = await $.ui.mount(BAND)
  const t = await ui.find({ type: 'Text', text: /session is/ })
  await ui.unmount()
  return { text: t?.text as string | undefined }
}

test('suggest: from 300 000 tokens, a calm row with Compact now; it compacts with the instructions and says the sizes', async ($, on) => {
  engine(on)
  big(on)
  const seen = offers(on, { compacted: { tokensBefore: 320000, tokensAfter: 38000 } })

  await $.prompt.submit({ text: 'work on', asUser: true })
  await $.session.measure(measure(10, [], 320000))
  await $.turn.complete(turn('claude-fable-5-2', 1))
  const ui = await $.ui.mount(BAND)
  const text = (await ui.find({ type: 'Text', text: /session is/ }))?.text
  expect(text).toBe('🗜️ This session is 320k tokens. Compacting now makes every later turn cheaper.')
  expect(text).toBe('🗜️ ' + offerText('suggest', 320000))
  await ui.press({ key: 'pacing-compact' })
  expect(seen.compacts).toEqual([COMPACT_INSTRUCTIONS])
  expect(COMPACT_INSTRUCTIONS).toContain('the goal; the decisions made and why; the open items, in order; the files and commands that matter; what was tried and ruled out')
  expect(seen.toasts).toEqual(['🗜️ compacted from 320k to 38k tokens.'])
  await ui.unmount()
  // the row is gone after the press
  expect((await bandText($)).text).toBe(undefined)
})

test('urge: from 500 000 tokens, plainer words with what each turn sends again', async ($, on) => {
  engine(on)
  big(on)
  offers(on)
  await $.prompt.submit({ text: 'work on', asUser: true })
  await $.session.measure(measure(10, [], 540000))
  await $.turn.complete(turn('claude-fable-5-2', 1))
  const { text } = await bandText($)
  expect(text).toBe('🗜️ This session is 540k tokens, and every turn sends all 540k again. Compact now to cut that.')
})

test('once per level: Not now holds until the session grows by 100 000 more; a new level comes at once', async ($, on) => {
  engine(on)
  big(on)
  const seen = offers(on)
  await $.prompt.submit({ text: 'work on', asUser: true })
  await $.session.measure(measure(10, [], 320000))
  await $.turn.complete(turn('claude-fable-5-2', 1))
  const first = await $.ui.mount(BAND)
  expect((await first.find({ type: 'Text', text: /session is/ }))?.text).toContain('320k')
  await first.press({ key: 'pacing-not-now' })
  await first.unmount()
  expect(seen.compacts).toEqual([])

  for (const size of [330000, 410000]) {
    await $.session.measure(measure(10, [], size))
    await $.turn.complete(turn('claude-fable-5-2', 1))
    expect((await bandText($)).text).toBe(undefined)
  }
  await $.session.measure(measure(10, [], 425000))
  await $.turn.complete(turn('claude-fable-5-2', 1))
  expect((await bandText($)).text).toContain('425k')
  // the user's next prompt answers it: gone, and not back at once
  await $.prompt.submit({ text: 'go on', asUser: true })
  expect((await bandText($)).text).toBe(undefined)
  await $.session.measure(measure(10, [], 505000))
  await $.turn.complete(turn('claude-fable-5-2', 1))
  expect((await bandText($)).text).toContain('every turn sends all 505k again')
})

test('never while a turn runs, never before a person has typed, gone after the user\'s own /compact', async ($, on) => {
  engine(on)
  big(on)
  offers(on)
  // a side session another session drives: its prompt is a peer's
  await $.prompt.submit({ text: 'do the task', origin: { kind: 'peer' } } as any)
  await $.session.measure(measure(10, [], 350000))
  await $.turn.complete(turn('claude-fable-5-2', 1))
  expect((await bandText($)).text).toBe(undefined)
  // a subagent's turn is no break of the session's
  await $.prompt.submit({ text: 'now me', asUser: true })
  await $.turn.complete(turn('claude-haiku-5-5', 1, 'a1'))
  expect((await bandText($)).text).toBe(undefined)
  await $.turn.complete(turn('claude-fable-5-2', 1))
  const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, isWorking: true } })
  expect(await ui.find({ type: 'Text', text: /session is/ })).toBeFalsy()
  await ui.unmount()
  expect((await bandText($)).text).toContain('350k')
  // the user compacts by hand: the row goes, and the offers start over
  await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'all of it', toolUses: [] }] } as any)
  expect((await bandText($)).text).toBe(undefined)
})

test('now: left idle, the row warns 10 minutes before the cache lapses and again once it has; Compact now works between turns', async ($, on) => {
  engine(on)
  big(on)
  const clock = mock.clock(on, { now: T0 })
  const seen = offers(on, { compacted: { tokensBefore: 420000, tokensAfter: 41000 } })

  await $.prompt.submit({ text: 'work on', asUser: true })
  await $.session.measure(measure(10, [], 420000))
  await $.turn.complete(turn('claude-fable-5-2', 1))
  // the suggest row first; the user lets it be
  expect((await bandText($)).text).toContain('Compacting now makes every later turn cheaper')
  await clock.advance(49 * 60000)
  expect((await bandText($)).text).toContain('Compacting now makes every later turn cheaper')
  await clock.advance(1 * 60000)
  expect((await bandText($)).text).toBe('💤 This session is 420k tokens, and its cache lapses in about 10 minutes. Then the next turn stores all of it again. Compacting now is cheaper.')
  expect((await bandText($)).text).toBe('💤 ' + nowText(420000, false))
  await clock.advance(10 * 60000)
  const ui = await $.ui.mount(BAND)
  expect((await ui.find({ type: 'Text', text: /session is/ }))?.text).toBe('💤 This session is 420k tokens and its cache has lapsed, so the next turn stores all of it again. Compacting first is cheaper.')
  await ui.press({ key: 'pacing-compact' })
  await ui.unmount()
  expect(seen.compacts).toEqual([COMPACT_INSTRUCTIONS])
  expect(seen.toasts).toEqual(['🗜️ compacted from 420k to 41k tokens.'])
  // the prompt after it: no second notice of the pause
  const r = await $.prompt.submit({ text: 'back again', asUser: true })
  expect(r.text).toBe('back again')
  expect(seen.toasts.length).toBe(1)
})

test('now, Not now: the row goes and the lapse does not bring it back; the notice after the pause is not repeated', async ($, on) => {
  engine(on)
  big(on)
  const clock = mock.clock(on, { now: T0 })
  const seen = offers(on)
  await $.prompt.submit({ text: 'work on', asUser: true })
  await $.session.measure(measure(10, [], 420000))
  await $.turn.complete(turn('claude-fable-5-2', 1))
  await clock.advance(50 * 60000)
  const ui = await $.ui.mount(BAND)
  expect((await ui.find({ type: 'Text', text: /session is/ }))?.text).toContain('lapses in about 10 minutes')
  await ui.press({ key: 'pacing-not-now' })
  await ui.unmount()
  await clock.advance(20 * 60000)
  expect((await bandText($)).text).toBe(undefined)
  const r = await $.prompt.submit({ text: 'as I typed it', asUser: true })
  expect(r.text).toBe('as I typed it')
  expect(seen.compacts).toEqual([])
  expect(seen.toasts).toEqual([])
})

test('now: a prompt before the lapse ends the timers; a small session sets none', async ($, on) => {
  engine(on)
  big(on)
  const clock = mock.clock(on, { now: T0 })
  offers(on)
  await $.prompt.submit({ text: 'work on', asUser: true })
  await $.session.measure(measure(10, [], 420000))
  await $.turn.complete(turn('claude-fable-5-2', 1))
  await clock.advance(20 * 60000)
  await $.prompt.submit({ text: 'quick one', asUser: true })
  await clock.advance(50 * 60000)
  expect((await bandText($)).text).toBe(undefined)

  await $.session.measure(measure(10, [], 120000))
  await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'all of it', toolUses: [] }] } as any)
  await $.turn.complete(turn('claude-fable-5-2', 1))
  await clock.advance(70 * 60000)
  expect((await bandText($)).text).toBe(undefined)
})

test('off: no row, no timers; the notice after a pause shows as before', async ($, on) => {
  engine(on)
  big(on)
  const clock = mock.clock(on, { now: T0 })
  const seen = offers(on, { config: JSON.stringify({ compactAsk: false }) })
  await $.prompt.submit({ text: 'work on', asUser: true })
  await $.session.measure(measure(10, [], 540000))
  await $.turn.complete(turn('claude-fable-5-2', 1))
  expect((await bandText($)).text).toBe(undefined)
  await clock.advance(70 * 60000)
  expect((await bandText($)).text).toBe(undefined)
  const r = await $.prompt.submit({ text: 'after lunch', asUser: true })
  expect(seen.compacts).toEqual([])
  expect(seen.toasts).toEqual([pauseNote(540000, 70 * 60000)])
  expect(r.text).toBe('after lunch')
})

test('an older engine without the band, the timers or compaction: the notice as before, the prompt unchanged', async ($, on) => {
  engine(on)
  big(on)
  const clock = mock.clock(on, { now: T0 })
  const order: string[] = []
  const entered = prompts(on, order)
  await $.prompt.submit({ text: 'work on', asUser: true })
  await $.session.measure(measure(10, [], 540000))
  // no ui.invalidate and no session.compact beneath: nothing throws
  await $.turn.complete(turn('claude-fable-5-2', 1))
  await clock.advance(70 * 60000)
  const r = await $.prompt.submit({ text: 'later', asUser: true })
  expect(r.text).toBe('later')
  expect(entered.at(-1)).toBe('later')
  expect(order.filter(o => o.startsWith('toast')).length).toBe(1)
})

test('each level in words that say which side of the budget line the week is', async () => {
  expect(['ahead', 'on pace', 'over', 'throttle', 'stop'].map(levelPhrase)).toEqual(['under budget', 'on budget', 'over budget', 'far over budget', 'stop'])
  // a level the module does not know yet is shown as it comes
  expect(levelPhrase('hold')).toBe('hold')
})

// ---- subagents at work ----

// the engine beneath for agents: each spawn answered with the model and an
// id, the engine's list of agents (null: an engine without one), the toasts
const agentEngine = (on: any, opts: { list?: () => { id: string; status: string }[] | null; config?: string } = {}) => {
  const seen = { toasts: [] as string[], n: 0 }
  on('agent.spawn', (_: unknown, e: any) => ({ model: e.model === 'haiku' ? 'claude-haiku-5-5' : e.model === 'opus' ? 'claude-opus-5-5' : 'claude-sonnet-5-5', agentId: 'ag' + (++seen.n) }))
  on('agent.list', () => {
    const l = opts.list ? opts.list() : []
    if (l === null) throw new Error('no list')
    return { value: l.map(a => ({ description: '', type: 'x', ...a })) }
  })
  on('env.get', (_: unknown, e: any) => ({ value: e.name === 'USERPROFILE' ? '/home/test' : undefined }))
  on('fs.read', (_: unknown, e: any) => ({ value: opts.config !== undefined && /[\\/]\.claude[\\/]pacing[\\/]config\.json$/.test(String(e.path)) ? opts.config : '{}' }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.toast', (_: unknown, e: any) => (seen.toasts.push(e.text), { value: undefined }))
  return seen
}
const spawn = ($: any, type: string, model = 'haiku', background = false, description = 'a task') =>
  $.agent.spawn({ prompt: 'p', description, subagentType: type, model, background } as any)

test('one agent: a toast when it starts, the line leads with it and its time, the assignment in the toasts, a toast when it ends, then the plain line', async ($, on) => {
  const status = engine(on)
  big(on)
  const clock = mock.clock(on, { now: T0 })
  const seen = agentEngine(on, { list: () => [{ id: 'ag1', status: 'running' }] })

  await $.session.measure(measure(10))
  expect(status.at(-1)).toBe('Budget 50% · usage: Weekly 10% Fable 40%')
  await spawn($, 'pacing:reader')
  expect(seen.toasts).toEqual(['▶️ reader is running "a task" on Haiku 5.5.'])
  expect(status.at(-1)).toBe('⏳ reader is running 0s · Budget 50% · usage: Weekly 10% Fable 40%')
  // it refreshes while it runs
  await clock.advance(3 * 60000)
  expect(status.at(-1)).toBe('⏳ reader is running 3m · Budget 50% · usage: Weekly 10% Fable 40%')
  await $.turn.complete(turn('claude-haiku-5-5', 1, 'ag1'))
  expect(seen.toasts.at(-1)).toMatch(/^✅ reader is done with "a task" after 3m, \d+k tokens; nothing else is running\.$/)
  // the plain line again, the agent's spend in its tier split
  expect(status.at(-1)).toBe('Budget 50% · usage: Weekly 10% Fable 40%')
})

test('several agents: each in the line; a progress toast every 5 minutes and no more often; the line follows as each ends', async ($, on) => {
  const status = engine(on)
  big(on)
  const clock = mock.clock(on, { now: T0 })
  const live = new Set(['ag1', 'ag2'])
  const seen = agentEngine(on, { list: () => [...live].map(id => ({ id, status: 'running' })) })

  await $.session.measure(measure(10))
  await spawn($, 'pacing:reader')
  await clock.advance(40 * 1000)
  await spawn($, 'pacing:implementer', 'opus')
  expect(seen.toasts.at(-1)).toBe('▶️ implementer is running "a task" on Opus 5.5; reader is also running.')
  // two that "are running" with their times, beside the budget: the usage has no room
  expect(status.at(-1)).toBe('⏳ reader is running 40s, ⏳ implementer is running 0s · Budget 50%')

  await clock.advance(4 * 60000)
  expect(seen.toasts.filter(t => t.includes('still running:'))).toEqual([])
  await clock.advance(30 * 1000)
  expect(seen.toasts.filter(t => t.includes('still running:'))).toEqual(['⏳ still running: reader "a task" 5m; implementer "a task" 4m.'])
  // not again before another 5 minutes
  await clock.advance(4 * 60000)
  expect(seen.toasts.filter(t => t.includes('still running:')).length).toBe(1)
  await clock.advance(60 * 1000)
  expect(seen.toasts.filter(t => t.includes('still running:')).length).toBe(2)

  live.delete('ag1')
  await $.turn.complete(turn('claude-haiku-5-5', 1, 'ag1'))
  expect(seen.toasts.at(-1)).toMatch(/^✅ reader is done with "a task" after 10m, \d+k tokens; implementer is still running\.$/)
  expect(status.at(-1)).toBe('⏳ implementer is running 10m · Budget 50% · usage: Weekly 10% Fable 40%')
})

test('the count never sticks: the main turn ends its foreground agents, the engine\'s list ends the rest, a new session starts with none', async ($, on) => {
  const status = engine(on)
  big(on)
  const clock = mock.clock(on, { now: T0 })
  const live = new Set(['ag1', 'ag2'])
  agentEngine(on, { list: () => [...live].map(id => ({ id, status: 'running' })) })
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'pacing-status' } }))

  await $.session.measure(measure(10))
  await spawn($, 'pacing:reader')
  await spawn($, 'general-purpose', 'sonnet', true)
  // the main turn ends: the foreground reader with it, though no end was heard
  await $.turn.complete(turn('claude-fable-5-2', 1))
  expect(status.at(-1)).toMatch(/^⏳ general is running 0s · Budget 50%/)
  // the engine lists the background one as done: gone at the next refresh
  live.clear()
  await clock.advance(30 * 1000)
  expect(status.at(-1)).toMatch(/^Budget 50% · usage: Weekly 10% Fable 40%$/)

  live.add('ag3')
  await spawn($, 'pacing:verifier')
  expect(status.at(-1)).toMatch(/^⏳ verifier/)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true } as any)
  await $.session.measure(measure(11))
  expect(status.at(-1)).not.toContain('⏳')
})

test('a background agent after the turn ended: a row above the prompt, under the offer to compact, never over it', async ($, on) => {
  engine(on)
  big(on)
  const clock = mock.clock(on, { now: T0 })
  const live = new Set(['ag1'])
  agentEngine(on, { list: () => [...live].map(id => ({ id, status: 'running' })) })
  on('session.compact', () => ({ messages: [{ role: 'assistant', text: 's', toolUses: [] }], tokensAfter: 40000 }))
  on('prompt.submit', (_: unknown, e: any) => ({ text: e.text }))

  await $.prompt.submit({ text: 'work on', asUser: true })
  await $.session.measure(measure(10, [], 320000))
  await spawn($, 'pacing:researcher', 'sonnet', true)
  await clock.advance(2 * 60000)
  await $.turn.complete(turn('claude-fable-5-2', 1))
  const ui = await $.ui.mount(BAND)
  const texts = (await ui.findAll({ type: 'Text' })).map((t: any) => t.text)
  await ui.unmount()
  expect(texts).toEqual(['🗜️ This session is 320k tokens. Compacting now makes every later turn cheaper.', 'In the background: ⏳ researcher is running: a task 2m'])
  // while a turn runs, neither shows
  const busy = await $.ui.mount({ ...BAND, props: { ...BAND.props, isWorking: true } })
  expect(await busy.find({ type: 'Text' })).toBeFalsy()
  await busy.unmount()
})

test('notify off: no toasts; the line still shows the agents', async ($, on) => {
  const status = engine(on)
  big(on)
  mock.clock(on, { now: T0 })
  const seen = agentEngine(on, { config: JSON.stringify({ agentNotices: false }), list: () => [{ id: 'ag1', status: 'running' }] })
  await $.session.measure(measure(10))
  await spawn($, 'pacing:reader')
  expect(status.at(-1)).toBe('⏳ reader is running 0s · Budget 50% · usage: Weekly 10% Fable 40%')
  await $.turn.complete(turn('claude-haiku-5-5', 1, 'ag1'))
  expect(seen.toasts).toEqual([])
})

test('an older engine without the agents list or timers: the line still counts, and a background agent is let go after two hours', async ($, on) => {
  const status = engine(on)
  big(on)
  const clock = mock.clock(on, { now: T0 })
  agentEngine(on, { list: () => null })
  await $.session.measure(measure(10))
  await spawn($, 'general-purpose', 'sonnet', true)
  await $.turn.complete(turn('claude-fable-5-2', 1))
  expect(status.at(-1)).toMatch(/^⏳ general/)
  await clock.advance(121 * 60000)
  await $.turn.complete(turn('claude-fable-5-2', 1))
  expect(status.at(-1)).toMatch(/^Budget 50% · usage: Weekly 10% Fable 40%$/)
})

// the whole line within LINE_MAX while agents run, at every level and length
const A = (type: string, mins: number, model = 'claude-haiku-5-5', effort?: string, description?: string) => ({ id: type + mins, type, model, effort, description, startedAt: T0 - mins * 60000, background: false })
const LONGEST_MIX = [1, 2, 3, 4, 5, 6, 7, 8].map(tier => ({ tier, share: 12 })).concat([{ tier: 'Other' as any, share: 4 }])
const FAR = { all: 100, line: 46.7, ofBudget: 214, level: 'throttle', premium: 100, premiumLabel: 'Fable 5.2', premiumAt: null }
const SETS = {
  one: [A('pacing:reader', 3, 'claude-haiku-5-5', 'medium')],
  two: [A('pacing:reader', 3), A('pacing:implementer', 1, 'claude-opus-5-5', 'high')],
  six: [A('general-purpose', 12), A('someplugin:very-long-agent-name', 9), A('pacing:implementer', 7), A('pacing:verifier', 5), A('Explore', 3), A('pacing:researcher', 1)],
}
// the same agents, each with an assignment, a step and a history
const LONG_TASK = 'Auto-reload on plugin update when the desktop app has installed a new version of the plugin'
const described = (list: any[], description = LONG_TASK) => list.map(a => ({ ...a, description, step: 'on the web', runs: [4 * 60000, 5 * 60000, 6 * 60000] }))

test('with 1, 2, 3 and 6 agents, long names and assignments, far over budget: the line keeps within 75 and holds every agent or their count, and the budget', async () => {
  let longest = ''
  const three = [...SETS.two, A('pacing:verifier', 0.5)]
  for (const plain of [SETS.one, SETS.two, three, SETS.six]) {
    for (const list of [plain, described(plain), described(plain, 'Read the logs')]) {
      for (const [j, self] of [[FAR, null], [FAR, 'Other'], [{ ...FAR, level: 'stop', ofBudget: 999 }, 'Other'], [{ ...FAR, level: 'ahead', ofBudget: 77 }, 1]] as const) {
        const s = statusText(j as any, LONGEST_MIX, self as any, T0, list as any)
        if (chars(s) > chars(longest)) longest = s
        expect(chars(s)).toBeLessThanOrEqual(LINE_MAX)
        expect(s.startsWith('⏳') || s.includes(' · ⏳')).toBe(true)
        // every agent by name, or their count: never less
        expect(list.every(a => s.includes('⏳ ' + roleOf(a.type))) || s.includes('⏳ ' + list.length + ' Agents') || s.includes('⏳' + list.length)).toBe(true)
        expect(s).toContain('Budget ' + j.ofBudget + '%')
        // the agents, then the budget share, then the usage: a cut by the app takes the least important end
        expect(s.indexOf('⏳')).toBeLessThan(s.indexOf('Budget'))
        if (s.includes('usage:')) expect(s.indexOf('Budget')).toBeLessThan(s.indexOf('usage:'))
      }
    }
  }
  // the width: a line of 75 characters was seen whole in the app's footer
  expect(LINE_MAX).toBe(75)
  // the longest line there is uses the width to the last character
  expect(chars(longest)).toBe(LINE_MAX)
  expect(longest).toBe('⏳ reader on the web 3m ~60%, ⏳ implementer on the web 1m ~20% · Budget 214%')
  // the line never shows an assignment, whatever the room; where one shows (the toasts, the row) it is never longer than TASK_MAX
  expect(TASK_MAX).toBe(60)
  expect(agentPart(described(SETS.one as any), T0, 500)).toBe('⏳ reader on the web 3m ~60%')
  expect(backgroundText(described(SETS.one as any), T0, 500)).toBe('In the background: ⏳ reader: Auto-reload on plugin update when the desktop app has insta…, on the web 3m ~60%')
  expect(roleOf('general-purpose')).toBe('general')
  expect(roleOf('someplugin:very-long-agent-name')).toBe('very-long-a…')
})
test('the toasts and the row are one line each, within 120, however many run and however long the assignment; Agent only for more than one', async () => {
  const six = SETS.six as any
  const twelve = [...six, ...six.map((a: any) => ({ ...a, id: a.id + 'b' }))]
  expect(MSG_MAX).toBe(120)
  for (const list of [six, described(six), twelve, described(twelve)]) {
    const msgs = [startedText(list[1], list), doneText(list[1], 9 * 60000, 123456, list.slice(2)), progressText(list, T0), backgroundText(list, T0), backgroundText(list, T0, 40)]
    for (const m of msgs) {
      expect(chars(m)).toBeLessThanOrEqual(MSG_MAX)
      expect(m).not.toContain('\n')
    }
  }
  // the 5-minute toast: by name while they fit, then the count
  expect(progressText(six, T0)).toBe('⏳ still running: general 12m, very-long-a… 9m, implementer 7m, verifier 5m, explore 3m, researcher 1m.')
  expect(progressText(twelve, T0)).toBe('⏳ 12 Agents are still running, the longest for 12m.')
  expect(progressText(SETS.two as any, T0)).toBe('⏳ still running: reader 3m, implementer 1m.')
  // an agent without a description has no assignment part
  expect(startedText(SETS.one[0] as any, SETS.one as any)).toBe('▶️ reader is running on Haiku 5.5 medium.')
  expect(startedText(SETS.two[1] as any, SETS.two as any)).toBe('▶️ implementer is running on Opus 5.5 high; reader is also running.')
  expect(doneText(six[1], 9 * 60000, 123456, six.slice(2))).toBe('✅ very-long-a… is done after 9m, 123k tokens; 4 Agents are still running.')
  expect(doneText(SETS.two[0] as any, 60000, 1000, [SETS.two[1]] as any)).toBe('✅ reader is done after 1m, 1k tokens; implementer is still running.')
  expect(backgroundText(six, T0, 40)).toBe('⏳ 6 Agents are running in the background')
  // a long assignment: who else runs goes first, then the assignment's end
  const long = described(SETS.two as any)
  expect(startedText(long[1], long)).toBe('▶️ implementer is running "Auto-reload on plugin update when the desktop app has insta…" on Opus 5.5 high.')
  expect(doneText(long[1], 3 * 60000, 41000, [long[0]])).toBe('✅ implementer is done with "Auto-reload on plugin update when the desktop app has insta…" after 3m.')
})
// ---- an estimate of a running agent's progress ----

test('the estimate: none under three runs, the median of the rest, never above 95 % while it runs', async () => {
  const m = 60000
  expect(estimateOf([], 3 * m)).toBe(null)
  expect(estimateOf([5 * m, 5 * m], 3 * m)).toBe(null)
  expect(estimateOf([4 * m, 5 * m, 6 * m], 3 * m)).toBe(60)
  // the median, not the mean: one long run does not drag it
  expect(estimateOf([4 * m, 5 * m, 6 * m, 60 * m], 3 * m)).toBe(55)
  expect(median([1, 9, 2])).toBe(2)
  expect(median([1, 2, 3, 10])).toBe(2.5)
  expect(estimateOf([4 * m, 5 * m, 6 * m], 5 * m)).toBe(95)
  expect(estimateOf([4 * m, 5 * m, 6 * m], 50 * m)).toBe(95)
})

test('the log keeps only the recent runs of each type', async () => {
  let runs: number[] = []
  for (let i = 1; i <= 25; i++) runs = keepRuns(runs, i)
  expect(runs.length).toBe(RUNS_KEPT)
  expect(runs[0]).toBe(6)
  expect(runs.at(-1)).toBe(25)
})

// three earlier reader runs of 4, 5 and 6 minutes
const HISTORY = { 'pacing:reader': [4 * 60000, 5 * 60000, 6 * 60000] }

// an implementer two minutes into "Auto-reload on plugin update", editing,
// 60 % by its type's history; a reader and a verifier beside it
const IMPL = { id: 'i', type: 'pacing:implementer', model: 'claude-fable-5-2', effort: 'high', description: 'Auto-reload on plugin update', startedAt: T0 - 2 * 60000, background: false, runs: [3 * 60000, 200000, 4 * 60000], step: 'editing' } as any
const READER = { id: 'r', type: 'pacing:reader', model: 'claude-haiku-5-5', effort: 'medium', description: 'Read the test logs', startedAt: T0 - 3 * 60000, background: false, runs: HISTORY['pacing:reader'], step: 'searching' } as any
const VERIFIER = { id: 'v', type: 'pacing:verifier', model: 'claude-haiku-5-5', effort: 'medium', description: 'Run the suite', startedAt: T0 - 30000, background: false, runs: [], step: null } as any
const J77 = { ...FAR, level: 'ahead', ofBudget: 77 } as any
// the same implementer where its kind has no finished runs yet: no usual length, no time left
const FIRST = { ...IMPL, runs: [] } as any

test('the forms the user approved: the line without the assignment (0.9.12), the toasts with it, word for word after the icon', async () => {
  // the status line: the name, the step, the time, the progress; "is running" before a step is known
  expect(statusText(J77, [], null, T0, [IMPL])).toBe('⏳ implementer editing 2m ~60% · Budget 77% · usage: Weekly 100% Fable 100%')
  expect(agentPart([{ ...IMPL, step: null, runs: [] }], T0, 80)).toBe('⏳ implementer is running 2m')
  expect(agentPart([{ ...IMPL, part: { done: 2, total: 4, said: true } }], T0, 80)).toBe('⏳ implementer editing 2m part 2 of 4')
  // the toasts keep the assignment
  expect(startedText(FIRST, [FIRST])).toBe('▶️ implementer is running "Auto-reload on plugin update" on Fable 5.2 high.')
  // and the others of the same shape
  expect(startedText(FIRST, [FIRST, READER])).toBe('▶️ implementer is running "Auto-reload on plugin update" on Fable 5.2 high; reader is also running.')
  expect(startedText(FIRST, [FIRST, READER, VERIFIER])).toBe('▶️ implementer is running "Auto-reload on plugin update" on Fable 5.2 high; reader and verifier are also running.')
  expect(startedText(FIRST, [FIRST, READER, VERIFIER, { ...VERIFIER, id: 'w' }])).toBe('▶️ implementer is running "Auto-reload on plugin update" on Fable 5.2 high; 3 Agents are also running.')
  expect(doneText(IMPL, 3 * 60000, 41000, [])).toBe('✅ implementer is done with "Auto-reload on plugin update" after 3m, 41k tokens; nothing else is running.')
  expect(doneText(IMPL, 3 * 60000, 41000, [READER])).toBe('✅ implementer is done with "Auto-reload on plugin update" after 3m, 41k tokens; reader is still running.')
  expect(doneText(IMPL, 3 * 60000, 41000, [READER, VERIFIER, { ...VERIFIER, id: 'w' }])).toBe('✅ implementer is done with "Auto-reload on plugin update" after 3m, 41k tokens; 3 Agents are still running.')
  expect(progressText([{ ...IMPL, startedAt: T0 - 12 * 60000, runs: [20 * 60000, 20 * 60000, 20 * 60000] }], T0)).toBe('⏳ still running: implementer "Auto-reload on plugin update", editing 12m ~60%, about 8m left.')
})

test('one agent, step by step as the room shrinks: the progress goes, then the step, then the time and "is running"; never the assignment', async () => {
  const one = [IMPL]
  expect(agentPart(one, T0, 200)).toBe('⏳ implementer editing 2m ~60%')
  expect(agentPart(one, T0, 29)).toBe('⏳ implementer editing 2m ~60%')
  expect(agentPart(one, T0, 28)).toBe('⏳ implementer editing 2m')
  expect(agentPart(one, T0, 24)).toBe('⏳ implementer editing 2m')
  // without the step the agent "is running", which is no shorter here: the name alone
  expect(agentPart(one, T0, 23)).toBe('⏳ implementer')
  expect(agentPart(one, T0, 13)).toBe('⏳ implementer')
  // a lone named agent never becomes "1 Agent": the bare count
  expect(agentPart(one, T0, 12)).toBe('⏳1')
  // a step longer than "is running" gives way to it before the time goes
  const wordy = [{ ...IMPL, step: 'exitplanmode' }]
  expect(agentPart(wordy, T0, 29)).toBe('⏳ implementer exitplanmode 2m')
  expect(agentPart(wordy, T0, 28)).toBe('⏳ implementer is running 2m')
  // no step known: "is running", and the progress last as ever
  const idle = [{ ...IMPL, step: null }]
  expect(agentPart(idle, T0, 32)).toBe('⏳ implementer is running 2m ~60%')
  expect(agentPart(idle, T0, 31)).toBe('⏳ implementer is running 2m')
  expect(agentPart(idle, T0, 26)).toBe('⏳ implementer')
  // in the line: the usage gives way before any of the agent does, the per-model figure first
  expect(statusText(J77, [], null, T0, idle)).toBe('⏳ implementer is running 2m ~60% · Budget 77% · usage: Weekly 100%')
  expect(statusText({ ...J77, premium: null }, [], null, T0, one)).toBe('⏳ implementer editing 2m ~60% · Budget 77% · usage: Weekly 100%')
})

test('two and three agents: the same steps, for all of them at each step; then the names, the count as a sentence, the bare count', async () => {
  const two = [IMPL, READER], three = [IMPL, READER, VERIFIER]
  expect(agentPart(two, T0, 57)).toBe('⏳ implementer editing 2m ~60%, ⏳ reader searching 3m ~60%')
  expect(agentPart(two, T0, 56)).toBe('⏳ implementer editing 2m, ⏳ reader searching 3m')
  expect(agentPart(two, T0, 47)).toBe('⏳ implementer editing 2m, ⏳ reader searching 3m')
  expect(agentPart(two, T0, 46)).toBe('⏳ implementer, ⏳ reader')
  expect(agentPart(two, T0, 23)).toBe('⏳ implementer, ⏳ reader')
  expect(agentPart(two, T0, 22)).toBe('⏳ 2 Agents are running')
  expect(agentPart(two, T0, 21)).toBe('⏳ 2 Agents')
  expect(agentPart(two, T0, 9)).toBe('⏳2')
  // in the line of 75: two fit whole, with their steps, times and progress
  expect(statusText(J77, [], null, T0, two)).toBe('⏳ implementer editing 2m ~60%, ⏳ reader searching 3m ~60% · Budget 77%')
  expect(statusText(J77, [], null, T0, [{ ...IMPL, part: { done: 2, total: 4, said: true } }, { ...READER, part: { done: 1, total: 3 } }])).toBe('⏳ implementer editing 2m, ⏳ reader searching 3m · Budget 77%')
  // three: the one without a step "is running" beside the two that have one
  expect(agentPart(three, T0, 84)).toBe('⏳ implementer editing 2m ~60%, ⏳ reader searching 3m ~60%, ⏳ verifier is running 30s')
  expect(agentPart(three, T0, 83)).toBe('⏳ implementer editing 2m, ⏳ reader searching 3m, ⏳ verifier is running 30s')
  expect(agentPart(three, T0, 74)).toBe('⏳ implementer editing 2m, ⏳ reader searching 3m, ⏳ verifier is running 30s')
  expect(agentPart(three, T0, 73)).toBe('⏳ implementer, ⏳ reader, ⏳ verifier')
  expect(agentPart(three, T0, 35)).toBe('⏳ implementer, ⏳ reader, ⏳ verifier')
  expect(agentPart(three, T0, 34)).toBe('⏳ 3 Agents are running')
  expect(agentPart(three, T0, 21)).toBe('⏳ 3 Agents')
  expect(agentPart(three, T0, 9)).toBe('⏳3')
  // three with their times pass 75 beside the budget: the names; the usage shows where what is left has room for it
  expect(statusText(J77, [], null, T0, three)).toBe('⏳ implementer, ⏳ reader, ⏳ verifier · Budget 77% · usage: Weekly 100%')
  // the order holds at every width: no progress without the step, no step without the time, and nothing of an assignment
  for (let room = 2; room <= 160; room++) {
    for (const list of [[IMPL], two, three]) {
      const p = agentPart(list, T0, room)
      expect(chars(p)).toBeLessThanOrEqual(Math.max(room, 2))
      if (p.includes('~')) expect(p).toContain(' editing')
      if (p.includes(' editing')) expect(p).toMatch(/ \d+[smh]/)
      expect(p).not.toContain('Auto-reload')
      expect(p).not.toContain(':')
      expect(p).not.toContain('…')
    }
  }
})

test('an agent without a description has no assignment part, in the line, the row or the toasts', async () => {
  const bare = [{ ...READER, description: undefined }]
  expect(agentPart(bare, T0, 80)).toBe('⏳ reader searching 3m ~60%')
  expect(agentPart(bare, T0, 25)).toBe('⏳ reader searching 3m')
  expect(agentPart(bare, T0, 20)).toBe('⏳ reader')
  expect(agentPart([{ ...READER, description: '  ', step: null }], T0, 80)).toBe('⏳ reader is running 3m ~60%')
  expect(agentPart([{ ...READER, description: undefined, step: null, runs: [] }], T0, 80)).toBe('⏳ reader is running 3m')
  expect(statusText(J77, [], null, T0, bare)).toBe('⏳ reader searching 3m ~60% · Budget 77% · usage: Weekly 100% Fable 100%')
  expect(startedText(bare[0], bare)).toBe('▶️ reader is running on Haiku 5.5 medium, about 5m.')
  expect(doneText(bare[0], 3 * 60000, 41000, [])).toBe('✅ reader is done after 3m, 41k tokens; nothing else is running.')
  expect(progressText(bare, T0)).toBe('⏳ still running: reader searching 3m ~60%, about 2m left.')
  expect(backgroundText(bare, T0)).toBe('In the background: ⏳ reader searching 3m ~60%')
  // a description over several lines is one line, where it shows
  expect(backgroundText([{ ...READER, description: 'Read\n  the logs', step: null, runs: [] }], T0)).toBe('In the background: ⏳ reader is running: Read the logs 3m')
  expect(agentPart([{ ...READER, description: 'Read\n  the logs', step: null, runs: [] }], T0, 80)).toBe('⏳ reader is running 3m')
})

test('the 5-minute toast and the row follow the same order and shrink the same way, each one line within 120', async () => {
  const two = [IMPL, READER], three = [IMPL, READER, VERIFIER]
  // the toast: the assignment quoted, several joined by "; "
  expect(progressText([IMPL], T0)).toBe('⏳ still running: implementer "Auto-reload on plugin update", editing 2m ~60%, about 1m left.')
  expect(progressText(two, T0)).toBe('⏳ still running: implementer "Auto-reload on plugin update", editing 2m; reader "Read the test logs", searching 3m.')
  expect(progressText(three, T0)).toBe('⏳ still running: implementer "Auto-reload on plugin …" 2m; reader "Read the test logs" 3m; verifier "Run the suite" 30s.')
  const short = [{ ...IMPL, description: 'Fix it' }, { ...READER, description: 'Logs' }]
  expect(progressText(short, T0)).toBe('⏳ still running: implementer "Fix it", editing 2m ~60%, about 1m left; reader "Logs", searching 3m ~60%, about 2m left.')
  // the row above the prompt keeps the assignment: it has more room than the status line
  expect(backgroundText([IMPL], T0)).toBe('In the background: ⏳ implementer: Auto-reload on plugin update, editing 2m ~60%')
  expect(backgroundText([{ ...IMPL, step: null, runs: [] }], T0)).toBe('In the background: ⏳ implementer is running: Auto-reload on plugin update 2m')
  expect(backgroundText(two, T0)).toBe('In the background: ⏳ implementer: Auto-reload on plugin update, editing 2m, ⏳ reader: Read the test logs, searching 3m')
  expect(backgroundText(two, T0, 117)).toBe('In the background: ⏳ implementer is running: Auto-reload on plugin up… 2m, ⏳ reader is running: Read the test logs 3m')
  expect(backgroundText(two, T0, 75)).toBe('In the background: ⏳ implementer is running 2m, ⏳ reader is running 3m')
  expect(backgroundText(two, T0, 60)).toBe('In the background: ⏳ implementer, ⏳ reader')
  expect(backgroundText(two, T0, 41)).toBe('⏳ 2 Agents are running in the background')
  expect(backgroundText(two, T0, 30)).toBe('⏳ 2 Agents are running')
  for (const m of [progressText(three, T0), backgroundText(three, T0), backgroundText(two, T0, 50)]) {
    expect(chars(m)).toBeLessThanOrEqual(MSG_MAX)
    expect(m).not.toContain('\n')
  }
  expect(stepOf('Grep')).toBe('searching')
  expect(stepOf('Bash')).toBe('running')
  expect(stepOf('mcp__x__y')).toBe('a tool')
})
test('in a session: the history from the store gives the estimate, the agent\'s own tool call its step, its end the next history', async ($, on) => {
  const status = engine(on)
  big(on)
  const clock = mock.clock(on, { now: T0 })
  const seen = agentEngine(on, { list: () => [{ id: 'ag1', status: 'running' }] })
  let store: any = JSON.parse(JSON.stringify(HISTORY))
  on('store.get', (_: unknown, e: any) => ({ value: e.key === 'agentRuns' ? JSON.parse(JSON.stringify(store)) : undefined }))
  on('store.set', (_: unknown, e: any) => { if (e.key === 'agentRuns') store = e.value; return { value: undefined } })
  on('tool.call', () => ({ result: {} }))

  await $.session.measure(measure(10))
  await spawn($, 'pacing:reader')
  await clock.advance(3 * 60000)
  expect(status.at(-1)).toBe('⏳ reader is running 3m ~60% · Budget 50% · usage: Weekly 10% Fable 40%')
  await $.tool.call({ tool: 'Grep', pattern: 'x', agentId: 'ag1' } as any)
  await clock.advance(2 * 60000)
  // capped at 95 % at the median and past it, the step in the toast
  expect(seen.toasts.at(-1)).toBe('⏳ still running: reader "a task", searching 5m ~95%.')
  expect(status.at(-1)).toBe('⏳ reader searching 5m ~95% · Budget 50% · usage: Weekly 10% Fable 40%')
  // /pacing-status: the same order, and the model the agent runs on
  expect((await $.command.run({ command: 'pacing-status', args: '' } as any)).text.split('\n')[1]).toBe('Running: reader: a task, searching 5m ~95% (Haiku 5.5)')
  await $.turn.complete(turn('claude-haiku-5-5', 1, 'ag1'))
  expect(store['pacing:reader']).toEqual([4 * 60000, 5 * 60000, 6 * 60000, 5 * 60000])
})

test('an engine without a store: no estimate, the time as before', async ($, on) => {
  const status = engine(on)
  big(on)
  const clock = mock.clock(on, { now: T0 })
  agentEngine(on, { list: () => [{ id: 'ag1', status: 'running' }] })
  await $.session.measure(measure(10))
  await spawn($, 'pacing:reader')
  await clock.advance(3 * 60000)
  expect(status.at(-1)).toBe('⏳ reader is running 3m · Budget 50% · usage: Weekly 10% Fable 40%')
})

// ---- an offer to switch the session's model or effort ----

const REC_OPUS_HIGH = { model: 'claude-opus-5-5', label: 'Opus 5.5', effort: 'high' }
const switchReading = (extra: Record<string, unknown> = {}) => answer('ahead', 10, { premiumModelId: 'claude-fable-5-2', recommend: { model: 'claude-fable-5-2', label: 'Fable 5.2', effort: 'high' }, ...extra })
// the engine beneath for a switch: the commands run, what the session runs
// on (it follows /model and /effort), the box filled, the toasts, the config
const switchEngine = (on: any, opts: { model?: string; effort?: string; config?: string; failRun?: boolean; sticky?: boolean } = {}) => {
  const seen = { runs: [] as string[], fills: [] as string[], toasts: [] as string[], model: opts.model ?? 'claude-fable-5-2', effort: opts.effort ?? 'high' }
  on('command.run', (_: unknown, e: any) => {
    if (opts.failRun) throw new Error('no such command here')
    seen.runs.push('/' + e.command + ' ' + e.args)
    if (!opts.sticky && e.command === 'model') seen.model = e.args
    if (!opts.sticky && e.command === 'effort') seen.effort = e.args
    return { text: 'ok' }
  })
  on('session.model', () => ({ value: seen.model }))
  on('env.get', (_: unknown, e: any) => ({ value: e.name === 'CLAUDE_EFFORT' ? seen.effort : e.name === 'USERPROFILE' ? '/home/test' : undefined }))
  on('fs.read', (_: unknown, e: any) => ({ value: opts.config !== undefined && /[\\/]\.claude[\\/]pacing[\\/]config\.json$/.test(String(e.path)) ? opts.config : '{}' }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.toast', (_: unknown, e: any) => (seen.toasts.push(e.text), { value: undefined }))
  on('prompt.fill', (_: unknown, e: any) => (seen.fills.push(e.text), { isFilled: true }))
  on('prompt.submit', (_: unknown, e: any) => ({ text: e.text }))
  return seen
}
const switchText = async ($: any) => {
  const ui = await $.ui.mount(BAND)
  const t = await ui.find({ type: 'Text' })
  await ui.unmount()
  return t?.text as string | undefined
}

test('the switch: wording by case, the urgent ones first', async () => {
  const base = { premiumModelId: 'claude-fable-5-2', premiumLabel: 'Fable 5.2', recommend: REC_OPUS_HIGH }
  expect(switchOffer({ ...base, premiumOut: true }, 'claude-fable-5-2', 'high')).toMatchObject({ kind: 'out', urgent: true, text: 'Fable 5.2 is out until the reset. Switch this session to Opus 5.5 high.' })
  expect(switchOffer({ ...base, premiumHeld: true }, 'claude-fable-5-2', 'high')).toMatchObject({ kind: 'held', urgent: true, text: 'Fable 5.2\'s own meter is over its line. Switch to Opus 5.5 high; Fable stays for hard tasks.' })
  expect(switchOffer({ ...base, recommend: { model: 'claude-opus-5-5', label: 'Opus 5.5', effort: 'medium' } }, 'claude-fable-5-2', 'high')).toMatchObject({ kind: 'model', urgent: false, text: 'This week\'s budget suggests Opus 5.5 medium for this session.' })
  // the right model, another effort
  expect(switchOffer({ ...base, recommend: { model: 'claude-opus-5-5', label: 'Opus 5.5', effort: 'medium' } }, 'claude-opus-5-5', 'high')).toMatchObject({ kind: 'model' })
  const step = { ...base, recommend: { model: 'claude-fable-5-2', label: 'Fable 5.2', effort: 'high' }, effortStep: { model: 'claude-fable-5-2', label: 'Fable 5.2', effort: 'medium' } }
  expect(switchOffer(step, 'claude-fable-5-2', 'high')).toMatchObject({ kind: 'effort', urgent: false, text: 'Over budget: one step less effort saves the most. Switch to Fable 5.2 medium.' })
  // already there: nothing to offer
  expect(switchOffer(step, 'claude-fable-5-2', 'medium')).toBe(null)
  expect(switchOffer({ ...base, recommend: REC_OPUS_HIGH }, 'claude-opus-5-5', 'high')).toBe(null)
  expect(switchOffer(base, null as any, 'high')).toBe(null)
})

test('Fable out: the row in the warning colour; Switch runs /model and /effort and a toast reads back what the session runs on', async ($, on) => {
  engine(on)
  on('process.run', () => ({ value: switchReading({ premiumOut: true, recommend: REC_OPUS_HIGH }) }))
  const seen = switchEngine(on, { effort: 'medium' })
  await $.prompt.submit({ text: 'work on', asUser: true })
  await $.session.measure(measure(10))
  await $.turn.complete(turn('claude-fable-5-2', 1))
  const ui = await $.ui.mount(BAND)
  expect((await ui.find({ type: 'Text' }))?.text).toBe('🔴 Fable 5.2 is out until the reset. Switch this session to Opus 5.5 high.')
  await ui.press({ key: 'pacing-switch' })
  await ui.unmount()
  expect(seen.runs).toEqual(['/model claude-opus-5-5', '/effort high'])
  expect(seen.toasts.at(-1)).toBe('🔁 this session now runs on Opus 5.5 high.')
  expect(await switchText($)).toBe(undefined)
})

test('once per suggestion: Not now holds until the recommendation changes', async ($, on) => {
  engine(on)
  let next = switchReading({ recommend: { model: 'claude-opus-5-5', label: 'Opus 5.5', effort: 'medium' } })
  on('process.run', () => ({ value: next }))
  const clock = mock.clock(on, { now: T0 })
  const seen = switchEngine(on)
  await $.prompt.submit({ text: 'work on', asUser: true })
  await $.session.measure(measure(10))
  await $.turn.complete(turn('claude-fable-5-2', 1))
  const ui = await $.ui.mount(BAND)
  expect((await ui.find({ type: 'Text' }))?.text).toBe('🔁 This week\'s budget suggests Opus 5.5 medium for this session.')
  await ui.press({ key: 'pacing-switch-not-now' })
  await ui.unmount()
  await $.turn.complete(turn('claude-fable-5-2', 1))
  expect(await switchText($)).toBe(undefined)
  // a new recommendation is a new suggestion
  next = switchReading({ premiumHeld: true, recommend: REC_OPUS_HIGH })
  await clock.advance(31 * 60000)
  await $.session.measure(measure(10))
  await $.turn.complete(turn('claude-fable-5-2', 1))
  expect(await switchText($)).toBe('⚠️ Fable 5.2\'s own meter is over its line. Switch to Opus 5.5 high; Fable stays for hard tasks.')
  expect(seen.runs).toEqual([])
})

test('the switch that cannot run fills the box for the user to send; one that did not take says so', async ($, on) => {
  engine(on)
  on('process.run', () => ({ value: switchReading({ premiumOut: true, recommend: REC_OPUS_HIGH }) }))
  const seen = switchEngine(on, { failRun: true })
  await $.prompt.submit({ text: 'work on', asUser: true })
  await $.session.measure(measure(10))
  await $.turn.complete(turn('claude-fable-5-2', 1))
  const ui = await $.ui.mount(BAND)
  await ui.press({ key: 'pacing-switch' })
  await ui.unmount()
  expect(seen.fills).toEqual(['/model claude-opus-5-5'])
  expect(seen.toasts.at(-1)).toBe('🔁 press Enter to switch to Opus 5.5; then set effort high in the model menu.')
  expect(switchedText(REC_OPUS_HIGH, 'claude-fable-5-2', 'high')).toBe('❌ the switch did not take; the session still runs on Fable 5.2. The model menu does it: Opus 5.5, effort high.')
})

test('one row at a time: a model that is out before the offer to compact, the offer before a calm switch', async ($, on) => {
  engine(on)
  let next = switchReading({ premiumOut: true, recommend: REC_OPUS_HIGH })
  on('process.run', () => ({ value: next }))
  const clock = mock.clock(on, { now: T0 })
  switchEngine(on)
  await $.prompt.submit({ text: 'work on', asUser: true })
  await $.session.measure(measure(10, [], 320000))
  await $.turn.complete(turn('claude-fable-5-2', 1))
  expect(await switchText($)).toMatch(/^🔴 Fable 5\.2 is out until the reset/)
  // a calm one waits behind the offer to compact
  next = switchReading({ recommend: { model: 'claude-opus-5-5', label: 'Opus 5.5', effort: 'medium' } })
  await clock.advance(31 * 60000)
  await $.session.measure(measure(10, [], 330000))
  await $.turn.complete(turn('claude-fable-5-2', 1))
  expect(await switchText($)).toBe('🗜️ This session is 320k tokens. Compacting now makes every later turn cheaper.')
})

test('off, a session nobody typed in, or a reading without a recommendation: no switch row', async ($, on) => {
  engine(on)
  on('process.run', () => ({ value: switchReading({ premiumOut: true, recommend: REC_OPUS_HIGH }) }))
  switchEngine(on, { config: JSON.stringify({ switchAsk: false }) })
  await $.prompt.submit({ text: 'work on', asUser: true })
  await $.session.measure(measure(10))
  await $.turn.complete(turn('claude-fable-5-2', 1))
  expect(await switchText($)).toBe(undefined)
})

test('a side session another session drives gets no switch row', async ($, on) => {
  engine(on)
  on('process.run', () => ({ value: switchReading({ premiumOut: true, recommend: REC_OPUS_HIGH }) }))
  switchEngine(on)
  await $.prompt.submit({ text: 'do the task', origin: { kind: 'peer' } } as any)
  await $.session.measure(measure(10))
  await $.turn.complete(turn('claude-fable-5-2', 1))
  expect(await switchText($)).toBe(undefined)
})

// ---- a fresh line at load ----

// the engine beneath at a load: session.start, the command, the meters the
// last response reported (none before the first), the stored reading, the
// runs of budget.mjs with what each answered, the toasts
const loadEngine = (on: any, opts: { limits?: any[]; state?: Record<string, unknown> | null; answers: () => any }) => {
  const seen = { runs: [] as string[][], toasts: [] as string[] }
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'pacing-status' } }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1000000, tokens: 1000, percent: 0 }, rateLimits: opts.limits ?? [] } }))
  on('env.get', (_: unknown, e: any) => ({ value: e.name === 'USERPROFILE' ? '/home/test' : undefined }))
  on('fs.read', (_: unknown, e: any) => {
    if (/[\\/]\.claude[\\/]pacing[\\/]state\.json$/.test(String(e.path)) && opts.state) return { value: JSON.stringify(opts.state) }
    return { value: '{}' }
  })
  on('process.run', (_: unknown, e: any) => (seen.runs.push([...e.argv]), { value: opts.answers() }))
  on('ui.toast', (_: unknown, e: any) => (seen.toasts.push(e.text), { value: undefined }))
  return seen
}
const start = ($: any) => $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true } as any)
// the load's reading runs on, unawaited: wait until the line changes
const settled = async (status: (string | undefined)[], n: number) => { for (let i = 0; i < 50 && status.length <= n; i++) await new Promise(r => setTimeout(r, 10)) }

test('a load in a session the user detached: the line drawn afresh at once, without "sub"', async ($, on) => {
  const status = engine(on)
  let spawned = true
  const seen = loadEngine(on, { state: { all: 10, reset: RESET, five: 4, fiveReset: '2026-11-13T15:00:00.000Z' }, answers: () => answer('ahead', 10, { spawned }) })
  // what the module drew before the user detached the session
  await $.session.measure(measure(10))
  await $.turn.complete(turn('claude-opus-5-5', 1))
  expect(status.at(-1)).toMatch(/^sub · /)
  // detached, then /reload-plugins: register and session.start run again
  spawned = false
  const n = status.length
  await start($)
  await settled(status, n)
  expect(status.at(-1)).toBe('Budget 50% · usage: Weekly 10% Fable 40%')
  // from the stored figures, dry: nothing logged
  expect(seen.runs.at(-1)!.slice(2)).toEqual(['--all', '10', '--reset', RESET, '--source', 'hook', '--five', '4', '--five-reset', '2026-11-13T15:00:00.000Z', '--dry'])
})

test('a load with no meters yet redraws from a dry run; the first reading after it comes at once, and is no change of level for the toast', async ($, on) => {
  const status = engine(on)
  let next = answer('over', 21)
  const seen = loadEngine(on, { state: { all: 21, reset: RESET }, answers: () => next })
  await start($)
  await settled(status, 0)
  expect(status.at(-1)).toBe('Budget 105% · usage: Weekly 21% Fable 40%')
  expect(seen.runs.length).toBe(1)
  expect(seen.runs[0]).toContain('--dry')
  // the first response: a full reading at once, no 30 minutes, no point moved
  next = answer('ahead', 10)
  await $.session.measure(measure(21))
  expect(seen.runs.length).toBe(2)
  expect(seen.runs[1]).not.toContain('--dry')
  // over -> ahead between a stored figure and a fresh one is no change the user was told of
  expect(seen.toasts).toEqual([])
  expect(status.at(-1)).toBe('Budget 50% · usage: Weekly 10% Fable 40%')
})

test('a load with the meters the last response reported: a full reading at once, which counts as the last one', async ($, on) => {
  const status = engine(on)
  const seen = loadEngine(on, {
    limits: [{ kind: 'seven_day', percentUsed: 12, resetsAt: RESET }, { kind: 'five_hour', percentUsed: 3, resetsAt: '2026-11-13T15:00:00.000Z' }],
    state: { all: 9, reset: RESET }, answers: () => answer('ahead', 12),
  })
  await start($)
  await settled(status, 0)
  expect(seen.runs.length).toBe(1)
  expect(seen.runs[0].slice(2)).toEqual(['--all', '12', '--reset', RESET, '--source', 'hook', '--five', '3', '--five-reset', '2026-11-13T15:00:00.000Z'])
  expect(status.at(-1)).toBe('Budget 60% · usage: Weekly 12% Fable 40%')
  // the same figure moments later: no second run
  await $.session.measure(measure(12))
  expect(seen.runs.length).toBe(1)
})

test('a load with nothing stored and no meters draws nothing new, silently', async ($, on) => {
  const status = engine(on)
  const seen = loadEngine(on, { state: null, answers: () => answer('ahead', 10) })
  await start($)
  await new Promise(r => setTimeout(r, 100))
  expect(seen.runs).toEqual([])
  expect(status).toEqual([])
})

// ---- faster: at once on the call, every 5 seconds while anything runs ----

test('an agent shows the moment its Agent call comes, before the spawn; the spawn takes the entry over', async ($, on) => {
  const status = engine(on)
  big(on)
  mock.clock(on, { now: T0 })
  const seen = agentEngine(on, { list: () => [{ id: 'ag1', status: 'running' }] })
  const during: (string | undefined)[] = []
  on('tool.call', { tool: 'Agent' }, async (_: unknown, e: any) => {
    // the engine resolving the agent: the line already shows it
    during.push(status.at(-1))
    await $.agent.spawn({ prompt: 'p', description: e.description, subagentType: e.subagent_type, model: e.model, tool_use_id: e.tool_use_id } as any)
    during.push(status.at(-1))
    return { result: {} }
  })
  await $.session.measure(measure(10))
  await $.tool.call({ tool: 'Agent', description: 'read logs', prompt: 'p', subagent_type: 'pacing:reader', model: 'haiku', effort: 'medium' } as any)
  expect(during[0]).toBe('⏳ reader is running 0s · Budget 50% · usage: Weekly 10% Fable 40%')
  expect(during[1]).toBe('⏳ reader is running 0s · Budget 50% · usage: Weekly 10% Fable 40%')
  // one agent, not two: the provisional entry was taken over
  expect(seen.toasts).toEqual(['▶️ reader is running "read logs" on Haiku 5.5 medium.'])
})

test('an Agent call that spawns nothing leaves the line when it ends', async ($, on) => {
  const status = engine(on)
  big(on)
  mock.clock(on, { now: T0 })
  agentEngine(on)
  on('tool.call', { tool: 'Agent' }, () => ({ deny: 'not now' }))
  await $.session.measure(measure(10))
  await $.tool.call({ tool: 'Agent', description: 'x', prompt: 'p', subagent_type: 'pacing:verifier' } as any)
  expect(status.at(-1)).toBe('Budget 50% · usage: Weekly 10% Fable 40%')
})

test('every 5 seconds while an agent runs; the timer stops when nothing runs', async ($, on) => {
  const status = engine(on)
  big(on)
  const clock = mock.clock(on, { now: T0 })
  agentEngine(on, { list: () => [{ id: 'ag1', status: 'running' }] })
  await $.session.measure(measure(10))
  await spawn($, 'pacing:reader')
  await clock.advance(5000)
  expect(status.at(-1)).toBe('⏳ reader is running 5s · Budget 50% · usage: Weekly 10% Fable 40%')
  await clock.advance(5000)
  expect(status.at(-1)).toBe('⏳ reader is running 10s · Budget 50% · usage: Weekly 10% Fable 40%')
  await $.turn.complete(turn('claude-haiku-5-5', 1, 'ag1'))
  const n = status.length
  await clock.advance(60000)
  expect(status.length).toBe(n)
})

// the app's list_sessions, as a tool answers it: this session is local_main
const sessionEngine = (on: any, rows: () => any[]) => {
  const seen = { polls: 0, toasts: [] as string[] }
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'pacing-status' } }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1000000, tokens: 1000, percent: 0 }, rateLimits: [] } }))
  on('env.get', (_: unknown, e: any) => ({ value: e.name === 'CLAUDE_CODE_HOST_SESSION_ID' ? 'local_main' : e.name === 'USERPROFILE' ? '/home/test' : undefined }))
  on('fs.read', () => ({ value: '{}' }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.toast', (_: unknown, e: any) => (seen.toasts.push(e.text), { value: undefined }))
  on('agent.list', () => ({ value: [] }))
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'ag1' }))
  on('tool.call', (_: unknown, e: any) => {
    if (e.tool === 'mcp__ccd_session_mgmt__list_sessions') { seen.polls++; return { result: { content: [{ type: 'text', text: JSON.stringify(rows()) }] } } }
    return { result: {} }
  })
  return seen
}
const row = (id: string, isRunning: boolean, startedBy = 'local_main') => ({ sessionId: id, name: 'pacing-' + id, title: 'Task ' + id, isRunning, isArchived: false, startedBy })

test('a side session this session started: in the line while it works, a toast when it starts and when it ends its turn', async ($, on) => {
  const status = engine(on)
  big(on)
  const clock = mock.clock(on, { now: T0 })
  let running = false
  const seen = sessionEngine(on, () => [row('s1', running), row('other', true, 'local_someone')])
  await $.session.measure(measure(10))
  // the model starts one: watched from the next refresh on
  running = true
  await $.tool.call({ tool: 'mcp__ccd_session__start_session', title: 'Task s1', initiation: 'user_asked' } as any)
  await clock.advance(5000)
  expect(status.at(-1)).toBe('⏳ Task s1 is running 5s · Budget 50% · usage: Weekly 10% Fable 40%')
  expect(seen.toasts).toEqual(['▶️ side session Task s1 is running.'])
  await clock.advance(20000)
  expect(status.at(-1)).toBe('⏳ Task s1 is running 25s · Budget 50% · usage: Weekly 10% Fable 40%')
  // its turn ends: gone at the next poll
  running = false
  await clock.advance(15000)
  expect(seen.toasts.at(-1)).toBe('✅ side session Task s1 ended its turn after 35s; nothing else is running.')
  expect(status.at(-1)).toBe('Budget 50% · usage: Weekly 10% Fable 40%')
  // a session another one started is not this one's
  expect(status.join('\n')).not.toContain('other')
})

test('at load, side sessions already working show without a toast; an agent and a side session are one count of Agents', async ($, on) => {
  const status = engine(on)
  big(on)
  mock.clock(on, { now: T0 })
  const seen = sessionEngine(on, () => [row('s1', true)])
  await $.session.measure(measure(10))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true } as any)
  await new Promise(r => setTimeout(r, 50))
  expect(seen.toasts).toEqual([])
  expect(status.at(-1)).toBe('⏳ Task s1 is running 0s · Budget 50% · usage: Weekly 10% Fable 40%')
  await $.agent.spawn({ prompt: 'p', description: 'x', subagentType: 'pacing:reader', model: 'haiku' } as any)
  expect(status.at(-1)).toBe('⏳ Task s1 is running 0s, ⏳ reader is running 0s · Budget 50%')
})

test('no side sessions: one look at load, then none, however long the session runs', async ($, on) => {
  engine(on)
  big(on)
  const clock = mock.clock(on, { now: T0 })
  const seen = sessionEngine(on, () => [])
  await $.session.measure(measure(10))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true } as any)
  await new Promise(r => setTimeout(r, 50))
  expect(seen.polls).toBe(1)
  await $.prompt.submit({ text: 'go', asUser: true } as any).catch(() => {})
  await $.turn.complete(turn('claude-fable-5-2', 1))
  await clock.advance(10 * 60000)
  await $.turn.complete(turn('claude-fable-5-2', 1))
  expect(seen.polls).toBe(1)
})

test('a side session by its short title like any agent; the count only for more than one; a lone side session too long for the room is "1 Agent is running"', async () => {
  const a = { id: 'a', type: 'pacing:reader', startedAt: T0 - 60000 } as any
  const s = { id: 's', kind: 'session', type: 'pacing-pace-fable-met-4', label: 'Pacing: pace Fable meter…', startedAt: T0 - 120000 } as any
  expect(countText([a, s])).toBe('2 Agents')
  expect(agentPart([s], T0, 80)).toBe('⏳ Pacing: pace Fable meter… is running 2m')
  expect(agentPart([s], T0, 22)).toBe('⏳ 1 Agent is running')
  expect(agentPart([s], T0, 12)).toBe('⏳ 1 Agent')
  expect(agentPart([a, s], T0, 80)).toBe('⏳ reader is running 1m, ⏳ Pacing: pace Fable meter… is running 2m')
  expect(agentPart([a, s], T0, 40)).toBe('⏳ reader, ⏳ Pacing: pace Fable meter…')
  expect(agentPart([a, s], T0, 22)).toBe('⏳ 2 Agents are running')
  expect(agentPart([a, s], T0, 12)).toBe('⏳ 2 Agents')
  expect(agentPart([a, s], T0, 3)).toBe('⏳2')
  // with the budget, within the width
  expect(statusText({ all: 36, ofBudget: 77, level: 'ahead' } as any, [], null, T0, [s])).toBe('⏳ Pacing: pace Fable meter… is running 2m · Budget 77% · usage: Weekly 36%')
  expect(statusText({ all: 99, ofBudget: 214, level: 'throttle' } as any, [], null, T0, [a, s])).toBe('⏳ reader, ⏳ Pacing: pace Fable meter… · Budget 214% · usage: Weekly 99%')
  expect(chars(statusText({ ...FAR, level: 'throttle' } as any, [], 'Other' as any, T0, [a, s, { ...s, id: 't' }]))).toBeLessThanOrEqual(LINE_MAX)
  // "Agent" never for a single named in-process agent
  expect(agentPart([a], T0, 4)).toBe('⏳1')
  expect(agentPart([a], T0, 9)).toBe('⏳ reader')
})
test('the app\'s list_sessions answer as a module gets it: the rows from its text, or from its content items', async () => {
  const rows = [{ sessionId: 'local_a', isRunning: true, startedBy: 'local_main', title: 'A task' }]
  const live = { text: JSON.stringify(rows), result: [{ type: 'text', text: JSON.stringify(rows) }] }
  expect(sessionRows(live)).toEqual(rows)
  expect(sessionRows({ result: [{ type: 'text', text: JSON.stringify(rows) }] })).toEqual(rows)
  expect(sessionRows({ result: { content: [{ type: 'text', text: JSON.stringify(rows) }] } })).toEqual(rows)
  expect(sessionRows({ deny: 'no' })).toEqual([])
  expect(sessionRows({ text: 'not json' })).toEqual([])
  expect(workingSessions(rows, 'local_main').length).toBe(1)
  expect(workingSessions(rows, 'local_other')).toEqual([])
})

// ---- a new version: the session reloads its plugins by itself ----

// the engine beneath: the manifest and the module's own file as they stand
// on disk (a test changes them as the app's sync would), the session's id,
// the config file, the module's store, the slash commands run and the toasts
const MARK = 'reload:local_s1'
const manifestOf = (version: string) => JSON.stringify({ name: 'pacing', version })
const reloadEngine = (on: any, opts: { config?: string; reject?: boolean; hang?: boolean; store?: Record<string, unknown> } = {}) => {
  const seen = { runs: [] as string[], toasts: [] as string[], store: { ...(opts.store ?? {}) } as Record<string, unknown>, manifest: manifestOf('0.9.10') as string | null, code: 'the module as it was loaded' }
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'pacing-status' } }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1000000, tokens: 1000, percent: 0 }, rateLimits: [] } }))
  on('session.id', () => ({ value: 'local_s1' }))
  on('env.get', (_: unknown, e: any) => ({ value: e.name === 'USERPROFILE' ? '/home/test' : undefined }))
  on('fs.read', (_: unknown, e: any) => {
    const p = String(e.path)
    if (/[\\/]\.claude-plugin[\\/]plugin\.json$/.test(p)) {
      if (seen.manifest === null) throw new Error('ENOENT')
      return { value: seen.manifest }
    }
    if (/[\\/]hooks[\\/]readings\.mjs$/.test(p)) return { value: seen.code }
    return { value: opts.config !== undefined && /[\\/]\.claude[\\/]pacing[\\/]config\.json$/.test(p) ? opts.config : '{}' }
  })
  on('command.run', (_: unknown, e: any) => {
    seen.runs.push('/' + e.command + (e.args ? ' ' + e.args : ''))
    if (opts.reject) throw new Error('a module may not run this command')
    if (opts.hang) return new Promise(() => {})
    return { text: 'Reloaded plugins' }
  })
  on('store.get', (_: unknown, e: any) => ({ value: seen.store[e.key] }))
  on('store.set', (_: unknown, e: any) => { seen.store[e.key] = e.value; return { value: undefined } })
  on('store.delete', (_: unknown, e: any) => { delete seen.store[e.key]; return { value: undefined } })
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.toast', (_: unknown, e: any) => (seen.toasts.push(e.text), { value: undefined }))
  on('prompt.submit', (_: unknown, e: any) => ({ text: e.text }))
  on('turn.start', (_: unknown, e: any) => ({ turnId: e.turnId }))
  return seen
}
// a session loaded as 0.9.10 that a person has typed in, its turn ended
const loadedAndTyped = async ($: any, clock: any) => {
  await start($)
  await clock.settle()
  await $.prompt.submit({ text: 'work on', asUser: true })
  await $.turn.complete(turn('claude-fable-5-2', 1))
  await clock.advance(RELOAD_AFTER_TURN)
}

test('the reload\'s words, and the version a manifest names', async () => {
  expect(reloadedText('0.9.11')).toBe('🔄 updated to 0.9.11 and reloaded.')
  expect(reloadAskText('0.9.11')).toBe('📦 Pacing 0.9.11 is installed: type /reload-plugins to load it.')
  expect(versionOf(manifestOf('0.9.11'))).toBe('0.9.11')
  // half-written during a sync, or no version in it: none
  expect(versionOf('{ "name": "pacing", "vers')).toBe(null)
  expect(versionOf('')).toBe(null)
  expect(versionOf('{"name":"pacing"}')).toBe(null)
  expect(versionOf('{"version":11}')).toBe(null)
})

test('the version unchanged: nothing, at a turn\'s end or on the slow timer', async ($, on) => {
  engine(on)
  const clock = mock.clock(on, { now: T0 })
  const seen = reloadEngine(on)
  await loadedAndTyped($, clock)
  await clock.advance(4 * RELOAD_CHECK_EVERY)
  await $.turn.complete(turn('claude-fable-5-2', 1))
  await clock.advance(RELOAD_AFTER_TURN)
  expect(seen.runs).toEqual([])
  expect(seen.toasts).toEqual([])
})

test('a new version while the session is idle: /reload-plugins once, as if typed; the copy that stays, its own file unchanged, says so once', async ($, on) => {
  engine(on)
  const clock = mock.clock(on, { now: T0 })
  const seen = reloadEngine(on)
  await loadedAndTyped($, clock)
  // the app's sync puts 0.9.11 in the folder; the slow timer finds it
  seen.manifest = manifestOf('0.9.11')
  await clock.advance(RELOAD_CHECK_EVERY)
  expect(seen.runs).toEqual(['/reload-plugins'])
  // a copy the reload brings says so at its load; this one waits for it
  expect(seen.toasts).toEqual([])
  expect(seen.store[MARK]).toEqual({ version: '0.9.11', at: T0 + RELOAD_CHECK_EVERY })
  await clock.advance(RELOAD_SETTLE)
  expect(seen.toasts).toEqual(['🔄 updated to 0.9.11 and reloaded.'])
  expect(seen.store[MARK]).toBe(undefined)
  // no loop: this copy now counts as 0.9.11
  await clock.advance(3 * RELOAD_CHECK_EVERY)
  await $.turn.complete(turn('claude-fable-5-2', 1))
  await clock.advance(RELOAD_AFTER_TURN)
  expect(seen.runs.length).toBe(1)
  expect(seen.toasts.length).toBe(1)
})

test('a new version found as a turn ends: the reload comes after the turn, never from inside it', async ($, on) => {
  engine(on)
  const clock = mock.clock(on, { now: T0 })
  const seen = reloadEngine(on)
  await loadedAndTyped($, clock)
  seen.manifest = manifestOf('0.9.11')
  await $.turn.start({ text: 'next', turnId: 't2' } as any)
  await $.turn.complete(turn('claude-fable-5-2', 1))
  // the hook itself ran nothing
  expect(seen.runs).toEqual([])
  await clock.advance(RELOAD_AFTER_TURN)
  expect(seen.runs).toEqual(['/reload-plugins'])
})

test('the copy a reload brings finds the mark at its load and says "updated", once', async ($, on) => {
  engine(on)
  const clock = mock.clock(on, { now: T0 })
  // what the copy that asked left for this session
  const seen = reloadEngine(on, { store: { [MARK]: { version: '0.9.11', at: T0 - 1000 } } })
  seen.manifest = manifestOf('0.9.11')
  await start($)
  await clock.settle()
  expect(seen.toasts).toEqual(['🔄 updated to 0.9.11 and reloaded.'])
  expect(seen.store[MARK]).toBe(undefined)
  // loaded is what is on disk: nothing more
  await $.prompt.submit({ text: 'work on', asUser: true })
  await $.turn.complete(turn('claude-fable-5-2', 1))
  await clock.advance(3 * RELOAD_CHECK_EVERY)
  expect(seen.runs).toEqual([])
  expect(seen.toasts.length).toBe(1)
})

test('a load with no mark says nothing: a new session, or a reload the person typed', async ($, on) => {
  engine(on)
  const clock = mock.clock(on, { now: T0 })
  const seen = reloadEngine(on, { store: { 'reload:local_other': { version: '0.9.10', at: T0 - 1000 } } })
  await start($)
  await clock.settle()
  expect(seen.toasts).toEqual([])
  // another session's mark is not this one's
  expect(seen.store).toEqual({ 'reload:local_other': { version: '0.9.10', at: T0 - 1000 } })
})

test('during a turn it waits; so it does under a survey and while a subagent of its own runs', async ($, on) => {
  engine(on)
  const clock = mock.clock(on, { now: T0 })
  const seen = reloadEngine(on)
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'ag1' }))
  on('agent.list', () => ({ value: [{ id: 'ag1', status: 'running', description: '', type: 'x' }] }))
  await loadedAndTyped($, clock)
  seen.manifest = manifestOf('0.9.11')
  // a turn runs: the slow timer looks and leaves it
  await $.turn.start({ text: 'a long one', turnId: 't2' } as any)
  await clock.advance(2 * RELOAD_CHECK_EVERY)
  expect(seen.runs).toEqual([])
  // a subagent's turn ending is not the session's
  await $.turn.complete(turn('claude-haiku-5-5', 1, 'a9'))
  await clock.advance(RELOAD_CHECK_EVERY)
  expect(seen.runs).toEqual([])
  // the turn ends with a background agent still at work: not yet
  await spawn($, 'pacing:reader', 'haiku', true)
  await $.turn.complete(turn('claude-fable-5-2', 1))
  await clock.advance(RELOAD_AFTER_TURN)
  expect(seen.runs).toEqual([])
  await $.turn.complete(turn('claude-haiku-5-5', 1, 'ag1'))
  // a survey is up: not yet
  const survey = await $.ui.mount({ ...BAND, props: { ...BAND.props, hasSurvey: true } })
  await survey.unmount()
  await clock.advance(RELOAD_CHECK_EVERY)
  expect(seen.runs).toEqual([])
  // gone: the next look runs it
  const band = await $.ui.mount(BAND)
  await band.unmount()
  await clock.advance(RELOAD_CHECK_EVERY)
  expect(seen.runs).toEqual(['/reload-plugins'])
})

test('a rejection: the line asking the person to type it, once per version, and no second attempt', async ($, on) => {
  engine(on)
  const clock = mock.clock(on, { now: T0 })
  const seen = reloadEngine(on, { reject: true })
  await loadedAndTyped($, clock)
  seen.manifest = manifestOf('0.9.11')
  await clock.advance(RELOAD_CHECK_EVERY)
  expect(seen.runs).toEqual(['/reload-plugins'])
  expect(seen.toasts).toEqual(['📦 Pacing 0.9.11 is installed: type /reload-plugins to load it.'])
  expect(seen.store[MARK]).toBe(undefined)
  // every later look, at a turn's end or on the timer: nothing
  await clock.advance(6 * RELOAD_CHECK_EVERY)
  await $.turn.complete(turn('claude-fable-5-2', 1))
  await clock.advance(RELOAD_AFTER_TURN)
  expect(seen.runs.length).toBe(1)
  expect(seen.toasts.length).toBe(1)
  // the next version is a new one: one attempt, one line
  seen.manifest = manifestOf('0.9.12')
  await clock.advance(RELOAD_CHECK_EVERY)
  expect(seen.runs.length).toBe(2)
  expect(seen.toasts).toEqual(['📦 Pacing 0.9.11 is installed: type /reload-plugins to load it.', '📦 Pacing 0.9.12 is installed: type /reload-plugins to load it.'])
})

test('a reload that leaves the old code running: one attempt, then the line to type it, and the guard holds', async ($, on) => {
  engine(on)
  const clock = mock.clock(on, { now: T0 })
  const seen = reloadEngine(on)
  await loadedAndTyped($, clock)
  // the new version changed this module too, yet this copy still runs
  seen.manifest = manifestOf('0.9.11')
  seen.code = 'the module of 0.9.11'
  await clock.advance(RELOAD_CHECK_EVERY)
  expect(seen.runs).toEqual(['/reload-plugins'])
  await clock.advance(RELOAD_SETTLE)
  expect(seen.toasts).toEqual(['📦 Pacing 0.9.11 is installed: type /reload-plugins to load it.'])
  await clock.advance(6 * RELOAD_CHECK_EVERY)
  await $.turn.complete(turn('claude-fable-5-2', 1))
  await clock.advance(RELOAD_AFTER_TURN)
  expect(seen.runs.length).toBe(1)
  expect(seen.toasts.length).toBe(1)
})

test('a command that never answers is given up after 10 minutes: the line to type it, once', async ($, on) => {
  engine(on)
  const clock = mock.clock(on, { now: T0 })
  const seen = reloadEngine(on, { hang: true })
  await loadedAndTyped($, clock)
  seen.manifest = manifestOf('0.9.11')
  await clock.advance(RELOAD_CHECK_EVERY)
  expect(seen.runs).toEqual(['/reload-plugins'])
  await clock.advance(RELOAD_CHECK_EVERY)
  expect(seen.toasts).toEqual([])
  await clock.advance(RELOAD_GIVE_UP)
  expect(seen.toasts).toEqual(['📦 Pacing 0.9.11 is installed: type /reload-plugins to load it.'])
  await clock.advance(3 * RELOAD_CHECK_EVERY)
  expect(seen.runs.length).toBe(1)
  expect(seen.toasts.length).toBe(1)
})

test('an unreadable manifest is no change, and is read again later', async ($, on) => {
  engine(on)
  const clock = mock.clock(on, { now: T0 })
  const seen = reloadEngine(on)
  await loadedAndTyped($, clock)
  // half-written during a sync, then missing, then without a version
  for (const text of ['{ "name": "pacing", "vers', null, '{"name":"pacing"}']) {
    seen.manifest = text
    await clock.advance(RELOAD_CHECK_EVERY)
    await $.turn.complete(turn('claude-fable-5-2', 1))
    await clock.advance(RELOAD_AFTER_TURN)
  }
  expect(seen.runs).toEqual([])
  expect(seen.toasts).toEqual([])
  // written whole: found at the next look
  seen.manifest = manifestOf('0.9.11')
  await clock.advance(RELOAD_CHECK_EVERY)
  expect(seen.runs).toEqual(['/reload-plugins'])
})

test('reload off: nothing; so too in a side session nobody types in', async ($, on) => {
  engine(on)
  const clock = mock.clock(on, { now: T0 })
  const seen = reloadEngine(on, { config: JSON.stringify({ autoReload: false }) })
  await loadedAndTyped($, clock)
  seen.manifest = manifestOf('0.9.11')
  await clock.advance(3 * RELOAD_CHECK_EVERY)
  await $.turn.complete(turn('claude-fable-5-2', 1))
  await clock.advance(RELOAD_AFTER_TURN)
  expect(seen.runs).toEqual([])
  expect(seen.toasts).toEqual([])
})

test('a side session nobody types in is left alone', async ($, on) => {
  engine(on)
  const clock = mock.clock(on, { now: T0 })
  const seen = reloadEngine(on)
  await start($)
  await clock.settle()
  await $.prompt.submit({ text: 'do the task', origin: { kind: 'peer' } } as any)
  await $.turn.complete(turn('claude-fable-5-2', 1))
  seen.manifest = manifestOf('0.9.11')
  await clock.advance(3 * RELOAD_CHECK_EVERY)
  expect(seen.runs).toEqual([])
  expect(seen.toasts).toEqual([])
})

// ---- every meter, read by the module itself ----

// the desktop app's get_usage answer, as a module gets it (verified live):
// `text`, JSON, and `result`, the tool's content as { type, text } items
const USAGE = {
  plan: {
    windows: [
      { label: '5-hour limit', percentUsed: 12, resetsAt: '2026-11-13T15:00:00.000Z' },
      { label: 'Weekly · all models', percentUsed: 36, resetsAt: RESET },
      { label: 'Weekly · Fable', percentUsed: 41, resetsAt: RESET },
    ],
    extraUsage: { enabled: true, spent: 12.4, monthlyLimit: 50, currency: 'EUR' },
  },
  context: { tokensUsed: 120000, percentUsed: 12, categories: [{ name: 'Messages', tokens: 80000 }, { name: 'System tools', tokens: 25759 }, { name: 'MCP tools', tokens: 13768 }] },
}
const usageAnswer = (u: unknown = USAGE) => ({ text: JSON.stringify(u), result: [{ type: 'text', text: JSON.stringify(u) }] })
const FULL_ARGS = ['--premium', '41', '--context', '12', '--context-tokens', '120000', '--categories', 'Messages=80000,System tools=25759,MCP tools=13768',
  '--extra-spent', '12.4', '--extra-limit', '50', '--extra-currency', 'EUR']
// the engine beneath where the app's usage tool answers: the calls of it, the runs of budget.mjs
const usageEngine = (on: any, opts: { usage?: () => unknown; config?: string; answers?: (argv: string[]) => any } = {}) => {
  const seen = { calls: 0, runs: [] as string[][], toasts: [] as string[] }
  on('env.get', (_: unknown, e: any) => ({ value: e.name === 'USERPROFILE' ? '/home/test' : undefined }))
  on('fs.read', (_: unknown, e: any) => ({ value: opts.config !== undefined && /[\\/]\.claude[\\/]pacing[\\/]config\.json$/.test(String(e.path)) ? opts.config : '{}' }))
  on('tool.call', (_: unknown, e: any) => {
    if (e.tool !== USAGE_TOOL) return { result: {} }
    seen.calls++
    const u = opts.usage ? opts.usage() : USAGE
    if (u === null) throw new Error('no such tool')
    return usageAnswer(u)
  })
  on('process.run', (_: unknown, e: any) => (seen.runs.push([...e.argv]), { value: opts.answers ? opts.answers([...e.argv]) : answer('ahead', 36, { premium: 41, needFull: null, full: true }) }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.toast', (_: unknown, e: any) => (seen.toasts.push(e.text), { value: undefined }))
  return seen
}

test('the usage tool\'s answer as a module gets it: every meter, the per-model window by the config\'s name', async () => {
  const m = usageOf(usageAnswer())!
  expect(m).toEqual({ all: 36, reset: RESET, premium: 41, five: 12, fiveReset: '2026-11-13T15:00:00.000Z', context: 12, contextTokens: 120000,
    categories: 'Messages=80000,System tools=25759,MCP tools=13768', extra: { spent: 12.4, limit: 50, currency: 'EUR' } })
  // from the text alone, or from the content items alone
  expect(usageOf({ text: JSON.stringify(USAGE) })).toEqual(m)
  expect(usageOf({ result: { content: [{ type: 'text', text: JSON.stringify(USAGE) }] } })).toEqual(m)
  // another model's window, a plan without one, and premium none
  expect(usageOf(usageAnswer(), 'opus')!.premium).toBeNull()
  expect(usageOf(usageAnswer(), null as any)!.premium).toBeNull()
  const opus = { ...USAGE, plan: { ...USAGE.plan, windows: [...USAGE.plan.windows, { label: 'Weekly · Opus', percentUsed: 7, resetsAt: RESET }] } }
  expect(usageOf(usageAnswer(opus), 'opus')!.premium).toBe(7)
  // extra usage only when it is on; a category name with a comma cannot split in two; one without tokens is left out
  const odd = { plan: { windows: USAGE.plan.windows, extraUsage: { enabled: false, spent: 0, monthlyLimit: 50, currency: 'EUR' } },
    context: { tokensUsed: 9000, categories: [{ name: 'Skills, agents', tokens: 4000.4 }, { name: 'Broken' }, { name: '', tokens: 3 }] } }
  expect(usageOf(usageAnswer(odd))).toEqual({ all: 36, reset: RESET, premium: 41, five: 12, fiveReset: '2026-11-13T15:00:00.000Z', context: null, contextTokens: 9000,
    categories: 'Skills agents=4000', extra: null })
  // a reset time in seconds since the epoch is handed on as a date
  const secs = { plan: { windows: [{ label: 'Weekly · all models', percentUsed: 5, resetsAt: Date.parse(RESET) / 1000 }] } }
  expect(usageOf(usageAnswer(secs))!.reset).toBe(RESET)
  // nothing to read: no weekly window, a refusal, text that is no JSON, no answer
  expect(usageOf(usageAnswer({ plan: { windows: [USAGE.plan.windows[0]] } }))).toBeNull()
  expect(usageOf({ deny: 'no' })).toBeNull()
  expect(usageOf({ text: 'not json' })).toBeNull()
  expect(usageOf({ result: {} })).toBeNull()
  expect(usageOf(undefined)).toBeNull()
})

test('where the usage tool answers, the reading is a full one: its own meters go to budget.mjs as the skill hands them, with the session\'s model', async ($, on) => {
  const status = engine(on)
  const seen = usageEngine(on)

  await $.turn.complete(turn('claude-fable-5-2', 1))
  await $.session.measure(measure(35.6, [{ kind: 'five_hour', percentUsed: 11, resetsAt: '2026-11-13T14:59:00.000Z' }]))
  expect(seen.calls).toBe(1)
  expect(seen.runs.length).toBe(1)
  // the tool's figures, not the engine's two windows
  expect(seen.runs[0].slice(2)).toEqual(['--all', '36', '--reset', RESET, '--source', 'hook', '--five', '12', '--five-reset', '2026-11-13T15:00:00.000Z',
    ...FULL_ARGS, '--session', 'claude-fable-5-2'])
  expect(status.at(-1)).toBe('Budget 180% · usage: Weekly 36% Fable 41%')
})

test('a plan without the per-model window, extra usage off, no context: - for the meter and nothing made up', async ($, on) => {
  engine(on)
  const seen = usageEngine(on, { usage: () => ({ plan: { windows: [USAGE.plan.windows[1]], extraUsage: { enabled: false } } }) })
  await $.session.measure(measure(36, [{ kind: 'five_hour', percentUsed: 11, resetsAt: '2026-11-13T14:59:00.000Z' }]))
  // the 5-hour window the tool lacks comes from the engine's
  expect(seen.runs[0].slice(2)).toEqual(['--all', '36', '--reset', RESET, '--source', 'hook', '--five', '11', '--five-reset', '2026-11-13T14:59:00.000Z', '--premium', '-'])
})

test('no more often than before: one tool call per reading, none while the meter stands still', async ($, on) => {
  engine(on)
  const clock = mock.clock(on, { now: T0 })
  const seen = usageEngine(on)
  await $.session.measure(measure(36))
  await $.session.measure(measure(36.4))
  await $.session.measure(measure(36.9))
  expect(seen.calls).toBe(1)
  await $.session.measure(measure(37))
  expect(seen.calls).toBe(2)
  await clock.advance(29 * 60000)
  await $.session.measure(measure(37))
  expect(seen.calls).toBe(2)
  await clock.advance(60000)
  await $.session.measure(measure(37))
  expect(seen.calls).toBe(3)
  expect(seen.runs.length).toBe(3)
})

test('the fallback: a tool that is absent, fails or reads as nothing gives the plain reading, the note beside the prompt included', async ($, on) => {
  const status = engine(on)
  mock.clock(on, { now: AT_16 })
  let usage: unknown = null
  const seen = usageEngine(on, { usage: () => usage, answers: () => answer('over', 49, STALE) })
  const entered: (readonly string[] | undefined)[] = []
  on('prompt.submit', (_: unknown, e: any) => (entered.push(e.context), { text: e.text, context: e.context }))

  // the call throws: a terminal session without the app
  await $.session.measure(measure(49))
  expect(seen.calls).toBe(1)
  expect(seen.runs.length).toBe(1)
  expect(seen.runs[0].slice(2)).toEqual(['--all', '49', '--reset', RESET, '--source', 'hook'])
  expect(status.at(-1)).toBe('Budget 245% · usage: Weekly 49% Fable 71%')
  await $.prompt.submit({ text: 'go on', asUser: true })
  expect(entered.at(-1)?.[0]).toContain('take a full reading: run the `pacing` skill with `usage now`')
  // an answer with no weekly window, and one that is no JSON
  usage = { plan: { windows: [] } }
  await $.session.measure(measure(50))
  expect(seen.runs[1].slice(2)).toEqual(['--all', '50', '--reset', RESET, '--source', 'hook'])
  usage = 'unreadable'
  await $.session.measure(measure(51))
  expect(seen.runs[2].slice(2)).toEqual(['--all', '51', '--reset', RESET, '--source', 'hook'])
})

test('figures budget.mjs refuses: the plain reading in the same go, never none', async ($, on) => {
  const status = engine(on)
  const seen = usageEngine(on, { answers: argv => (argv.includes('--premium') ? { ...answer('ahead', 10), exitCode: 1, stdout: 'bad input' } : answer('ahead', 10)) })
  await $.session.measure(measure(10))
  expect(seen.runs.length).toBe(2)
  expect(seen.runs[0]).toContain('--premium')
  expect(seen.runs[1].slice(2)).toEqual(['--all', '10', '--reset', RESET, '--source', 'hook'])
  expect(status.at(-1)).toBe('Budget 50% · usage: Weekly 10% Fable 40%')
})

test('a full reading asks the session for nothing: no note beside the prompt', async ($, on) => {
  engine(on)
  mock.clock(on, { now: AT_16 })
  // budget.mjs answers a reading that was handed --premium with needFull null (tests/auto.test.mjs)
  const seen = usageEngine(on)
  const entered: (readonly string[] | undefined)[] = []
  on('prompt.submit', (_: unknown, e: any) => (entered.push(e.context), { text: e.text, context: e.context }))
  await $.session.measure(measure(36))
  expect(seen.runs[0]).toContain('--premium')
  await $.prompt.submit({ text: 'go on', asUser: true })
  expect(entered).toEqual([undefined])
})

test('at a load with no meters from the engine yet, the usage tool gives a logged reading at once', async ($, on) => {
  const status = engine(on)
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('command.register', (_: unknown, e: any) => ({ value: { command: e.name } }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1000000, tokens: 1000, percent: 0 }, rateLimits: [] } }))
  const seen = usageEngine(on)
  await start($)
  await settled(status, 0)
  expect(seen.runs.length).toBe(1)
  expect(seen.runs[0]).not.toContain('--dry')
  expect(seen.runs[0].slice(2, 6)).toEqual(['--all', '36', '--reset', RESET])
  expect(status.at(-1)).toBe('Budget 180% · usage: Weekly 36% Fable 41%')
  // it counts as the last one: the same figure from the engine moments later runs nothing
  await $.session.measure(measure(36))
  expect(seen.runs.length).toBe(1)
})

test('when an agent finishes: one reading if the last is 5 minutes old, none if it is newer', async ($, on) => {
  const status = engine(on)
  const clock = mock.clock(on, { now: T0 })
  const seen = usageEngine(on)
  on('agent.spawn', (_: unknown, e: any) => ({ model: 'claude-haiku-5-5', agentId: e.description }))
  on('agent.list', () => ({ value: ['a1', 'a2', 'a3'].map(id => ({ id, description: '', type: 'x', status: 'running' })) }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1000000, tokens: 1000, percent: 0 }, rateLimits: [{ kind: 'seven_day', percentUsed: 36, resetsAt: RESET }] } }))

  await $.session.measure(measure(36))
  expect(seen.runs.length).toBe(1)
  await spawn($, 'general-purpose', 'haiku', false, 'a1')
  await clock.advance(4 * 60000)
  await $.turn.complete(turn('claude-haiku-5-5', 1, 'a1'))
  await clock.settle()
  expect(seen.runs.length).toBe(1)
  await spawn($, 'general-purpose', 'haiku', false, 'a2')
  await clock.advance(60000)
  await $.turn.complete(turn('claude-haiku-5-5', 1, 'a2'))
  await clock.settle()
  expect(seen.runs.length).toBe(2)
  expect(seen.runs[1]).toContain('--premium')
  expect(seen.calls).toBe(2)
  expect(status.at(-1)).toBe('Budget 180% · usage: Weekly 36% Fable 41%')
  // and that one counts as the last: another agent a minute later reads nothing
  await spawn($, 'general-purpose', 'haiku', false, 'a3')
  await clock.advance(60000)
  await $.turn.complete(turn('claude-haiku-5-5', 1, 'a3'))
  await clock.settle()
  expect(seen.runs.length).toBe(2)
})

// ---- each finished task of a role agent, on record ----

// the engine beneath: the agents' list with their tokens and effort, the
// runs of config.mjs with what each answered, the session's own effort
const recordEngine = (on: any, opts: { rows?: () => any[]; out?: () => string; effort?: () => string | undefined } = {}) => {
  const seen = { records: [] as string[][], n: 0, entered: [] as (readonly string[] | undefined)[] }
  on('agent.spawn', (_: unknown, e: any) => ({ model: e.model === 'opus' ? 'claude-opus-5-5' : 'claude-haiku-5-5', agentId: e.resume ? e.resume.agentId : 'ag' + (++seen.n) }))
  on('agent.list', () => ({ value: (opts.rows ? opts.rows() : []).map(a => ({ description: '', type: 'x', status: 'running', ...a })) }))
  on('env.get', (_: unknown, e: any) => ({ value: e.name === 'USERPROFILE' ? '/home/test' : e.name === 'CLAUDE_EFFORT' && opts.effort ? opts.effort() : undefined }))
  on('fs.read', () => ({ value: '{}' }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('process.run', (_: unknown, e: any) => {
    if (!String(e.argv[1]).endsWith('/config.mjs')) return { value: answer('ahead', 10) }
    seen.records.push([...e.argv])
    return { value: { exitCode: 0, stdout: (opts.out ? opts.out() : 'recorded: x') + '\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('prompt.submit', (_: unknown, e: any) => (seen.entered.push(e.context), { text: e.text, context: e.context }))
  return seen
}
const FRESH_LINE = 'the next implementer task goes to a fresh agent (5 tasks or 150k tokens reached)'

test('the record\'s words: the role of a type, a model\'s short name, the line about a fresh agent', async () => {
  expect(roleFor('pacing:implementer')).toBe('implementer')
  expect(roleFor('reader')).toBe('reader')
  expect(roleFor('general-purpose')).toBeNull()
  expect(roleFor('other:reader')).toBeNull()
  expect(roleFor('Explore')).toBeNull()
  expect(shortModel('claude-haiku-5-5')).toBe('haiku')
  expect(shortModel('claude-fable-5-2-20261001')).toBe('fable')
  expect(shortModel('opus')).toBe('opus')
  expect(freshOf('recorded: implementer ag1, task 1, 296k tokens; ' + FRESH_LINE + '\n')).toBe(FRESH_LINE)
  expect(freshOf('recorded: implementer ag1, task 1, 41k tokens\n')).toBeNull()
  expect(freshNote([FRESH_LINE])).toBe('Pacing (automatic note, not from the user): the next implementer task goes to a fresh agent (5 tasks or 150k tokens reached). Start a new agent of that role for it, not the kept one.')
  expect(freshNote([])).toBeNull()
})

test('a role agent\'s finished task is recorded by the module: role, id, model, effort and the tokens the engine\'s list has', async ($, on) => {
  engine(on)
  const clock = mock.clock(on, { now: T0 })
  const seen = recordEngine(on, { rows: () => [{ id: 'ag1', tokenCount: 41200, model: 'claude-opus-5-5', effort: 'medium' }], out: () => 'recorded: implementer ag1, task 1, 41k tokens' })
  on('tool.call', { tool: 'Agent' }, async (_: unknown, e: any) => {
    await $.agent.spawn({ prompt: 'p', description: e.description, subagentType: e.subagent_type, model: e.model, tool_use_id: e.tool_use_id } as any)
    return { result: {} }
  })

  await $.session.measure(measure(10))
  await $.tool.call({ tool: 'Agent', tool_use_id: 'tu1', description: 'the change', prompt: 'p', subagent_type: 'pacing:implementer', model: 'opus', effort: 'high' } as any)
  await clock.advance(60000)
  await $.turn.complete(turn('claude-opus-5-5', 1, 'ag1'))
  await clock.settle()
  expect(seen.records.length).toBe(1)
  expect(seen.records[0][0]).toBe('node')
  expect(seen.records[0][1].endsWith('/skills/pacing/scripts/config.mjs')).toBe(true)
  // the Agent call's effort before the list's; the tokens as the list has them, not the run's summed usage
  expect(seen.records[0].slice(2)).toEqual(['agent', 'implementer', 'ag1', 'opus', 'high', '41200'])
  // nothing is due: the session is told nothing
  await $.prompt.submit({ text: 'next', asUser: true })
  expect(seen.entered).toEqual([undefined])
})

test('the session hears of a record only when a fresh agent is due: one hidden line beside the next prompt, once', async ($, on) => {
  engine(on)
  const clock = mock.clock(on, { now: T0 })
  let out = 'recorded: implementer ag1, task 5, 96k tokens; ' + FRESH_LINE
  const seen = recordEngine(on, { rows: () => [{ id: 'ag1', tokenCount: 96000, effort: 'high' }, { id: 'ag2', tokenCount: 20000, effort: 'medium' }], out: () => out })

  await $.session.measure(measure(10))
  await spawn($, 'pacing:implementer', 'opus')
  await clock.advance(60000)
  await $.turn.complete(turn('claude-opus-5-5', 1, 'ag1'))
  await clock.settle()
  expect(seen.records[0].slice(2)).toEqual(['agent', 'implementer', 'ag1', 'opus', 'high', '96000'])
  // a slash command does not carry it, and does not use it up
  await $.prompt.submit({ text: '/compact', asUser: true })
  expect(seen.entered.at(-1)).toBeUndefined()
  const r = await $.prompt.submit({ text: 'and the docs', asUser: true })
  expect(r.text).toBe('and the docs')
  expect(seen.entered.at(-1)).toEqual(['Pacing (automatic note, not from the user): ' + FRESH_LINE + '. Start a new agent of that role for it, not the kept one.'])
  await $.prompt.submit({ text: 'go on', asUser: true })
  expect(seen.entered.at(-1)).toBeUndefined()
  // a record that names no fresh agent adds nothing
  out = 'recorded: reader ag2, task 1, 20k tokens'
  await spawn($, 'pacing:reader')
  await clock.advance(60000)
  await $.turn.complete(turn('claude-haiku-5-5', 1, 'ag2'))
  await clock.settle()
  expect(seen.records.length).toBe(2)
  await $.prompt.submit({ text: 'more', asUser: true })
  expect(seen.entered.at(-1)).toBeUndefined()
})

test('the line about a fresh agent rides on a background agent\'s notification too, and goes when a fresh agent of that role started meanwhile', async ($, on) => {
  engine(on)
  const clock = mock.clock(on, { now: T0 })
  const seen = recordEngine(on, { rows: () => [{ id: 'ag1', tokenCount: 160000, effort: 'high' }, { id: 'ag2', tokenCount: 160000, effort: 'high' }], out: () => 'recorded: x; ' + FRESH_LINE })

  await $.session.measure(measure(10))
  await spawn($, 'pacing:implementer', 'opus', true)
  await clock.advance(60000)
  await $.turn.complete(turn('claude-opus-5-5', 1, 'ag1'))
  await clock.settle()
  await $.prompt.submit({ text: '<task-notification>', origin: { kind: 'task-notification' } } as any)
  expect(seen.entered.at(-1)?.length).toBe(1)
  // the kept agent resumed for one more task: due again, and still due after
  await $.agent.spawn({ prompt: 'p', description: 'one more', subagentType: 'pacing:implementer', resume: { agentId: 'ag1' } } as any)
  await clock.advance(60000)
  await $.turn.complete(turn('claude-opus-5-5', 1, 'ag1'))
  await clock.settle()
  // resumed with no Agent call: the effort it started with is not known here, the list's is
  expect(seen.records[1].slice(2)).toEqual(['agent', 'implementer', 'ag1', 'opus', 'high', '160000'])
  // a fresh implementer starts before any prompt: nothing left to say
  await spawn($, 'pacing:implementer', 'opus')
  await $.prompt.submit({ text: 'go on', asUser: true })
  expect(seen.entered.at(-1)).toBeUndefined()
})

test('no record without what it needs: another kind of agent, a stopped run, no token count, no effort; the session\'s effort serves an agent that names none', async ($, on) => {
  engine(on)
  const clock = mock.clock(on, { now: T0 })
  let rows: any[] = [{ id: 'ag1', tokenCount: 30000 }, { id: 'ag2', tokenCount: 30000 }, { id: 'ag3' }, { id: 'ag4', tokenCount: 30000 }]
  let effort: string | undefined
  const seen = recordEngine(on, { rows: () => rows, effort: () => effort })
  const run = async (type: string, id: string, more: Record<string, unknown> = {}) => {
    await spawn($, type)
    await clock.advance(60000)
    await $.turn.complete({ ...turn('claude-haiku-5-5', 1, id), ...more } as any)
    await clock.settle()
  }

  await $.session.measure(measure(10))
  await run('general-purpose', 'ag1')
  await run('pacing:reader', 'ag2', { isAborted: true, reason: 'aborted' })
  await run('pacing:reader', 'ag3')
  // no effort anywhere: the call named none, the list has none, the session's is not known
  await run('pacing:reader', 'ag4')
  expect(seen.records).toEqual([])
  effort = 'xhigh'
  rows = [{ id: 'ag5', tokenCount: 30000 }]
  await run('pacing:verifier', 'ag5')
  expect(seen.records.map(r => r.slice(2))).toEqual([['agent', 'verifier', 'ag5', 'haiku', 'xhigh', '30000']])
})

test('the tokens the refresh saw while the agent ran serve when the list has let it go at its end', async ($, on) => {
  engine(on)
  const clock = mock.clock(on, { now: T0 })
  let rows: any[] = [{ id: 'ag1', status: 'running', tokenCount: 52000, effort: 'medium' }]
  const seen = recordEngine(on, { rows: () => rows })
  await $.session.measure(measure(10))
  await spawn($, 'pacing:researcher')
  await clock.advance(31000)
  rows = []
  await $.turn.complete(turn('claude-haiku-5-5', 1, 'ag1'))
  await clock.settle()
  expect(seen.records.map(r => r.slice(2))).toEqual([['agent', 'researcher', 'ag1', 'haiku', 'medium', '52000']])
})

// ---- reports the module answers itself ----

const REPORT = [
  'last reading 11-15 10:00, 5 min ago (automatic, full), not measured now',
  'not in it: context, extra usage · /pacing usage now measures',
  '5-hour     ██░░░░░░░░░░░░░░░░░░  12 %  resets 13:00',
  'All models ██████░░│░░░░░░░░░░░  30 % / 47 % pace · resets in 4d 2h',
  'Fable 5.2  ███████░│░░░░░░░░░░░  35 % / 47 % pace · read 11-15 10:00',
  '',
  'tier  model              takes now · level ahead',
  '────  ─────────────────  ───────────────────────────────────────────',
  '1     Fable 5.2 high     the session: judgment, medium, routine,',
  '                         trivial work',
  '',
  'All models at 30 % is 17 points under today\'s allowed 47 %.',
  '',
  'day 4 of 8 (calendar days), 2.9 days elapsed, 4.1 days to reset',
  'All models used 30 %, delta -16.7, Fable 5.2 35 % -> ahead',
  'do: the session model does nearly everything',
  'next session: Fable 5.2 high',
]
const stdout = (text: string, exitCode = 0) => ({ value: { exitCode, stdout: text, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
const run = ($: any, command: string) => $.command.run({ command, args: '' } as any)

test('the usage report as the command shows it: the bars and the sheet in a code block, and what to do only where that is the point', async () => {
  const text = usageText(REPORT.join('\r\n'))
  expect(text.split('\n')[0]).toBe('```')
  expect(text.split('\n').at(-1)).toBe('```')
  // every line of the block as the script printed it, in its own row, nothing after "day N of M"
  expect(text.split('\n').slice(1, -1)).toEqual(REPORT.slice(0, 12))
  expect(text).not.toContain('day 4 of 8')
  expect(text).not.toContain('Now:')
  const over = REPORT.map(l => (l.startsWith('All models used') ? 'All models used 44 %, delta 3 -> over (raised by the trend)' : l.startsWith('do: ') ? 'do: medium tasks leave the session model too' : l))
  expect(usageText(over.join('\n')).split('\n').at(-1)).toBe('Now: medium tasks leave the session model too')
  // a model the session should leave: the fact and the row that offers it, never the steps
  const out = REPORT.map(l => (l.startsWith('do: ') ? 'do: Fable 5.2 is out until the reset: this session belongs on Opus 5.5 high now; the Switch row offers it (without the hooks module: model menu Opus 5.5, effort high). the session model does nearly everything' : l))
  expect(usageText(out.join('\n')).split('\n').at(-1)).toBe('Now: Fable 5.2 is out until the reset: this session belongs on Opus 5.5 high now; the Switch row offers it. the session model does nearly everything')
  expect(measureWhy('measure: the last reading is 31 min old\n')).toBe('the last reading is 31 min old')
  expect(measureWhy(REPORT.join('\n'))).toBeNull()
})

test('the module registers its commands, and answers /pacing-usage with the report of budget.mjs last, for the person alone', async ($, on) => {
  engine(on)
  const names: string[] = []
  const immediate: string[] = []
  const runs: string[][] = []
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('command.register', (_: unknown, e: any) => (names.push(e.name), e.immediate && immediate.push(e.name), { value: { command: e.name } }))
  on('process.run', (_: unknown, e: any) => (runs.push([...e.argv]), stdout(REPORT.join('\n') + '\n')))
  await start($)
  expect(names).toEqual(['pacing-status', 'pacing-usage', 'pacing-help', 'pacing-guide', 'pacing-agents'])
  // the three reports wait for a turn's end: answered mid-turn, their text would stay in the requests
  expect(immediate).toEqual(['pacing-status', 'pacing-agents'])

  const r = await run($, 'pacing-usage')
  expect(runs.length).toBe(1)
  expect(runs[0][1].endsWith('/skills/pacing/scripts/budget.mjs')).toBe(true)
  expect(runs[0].slice(2)).toEqual(['last'])
  expect(r.isTextDisplayOnly).toBe(true)
  expect(r.context).toBeUndefined()
  expect(r.text).toBe(['```', ...REPORT.slice(0, 12), '```'].join('\n'))
})

test('/pacing-usage with a reading too old to show: the module measures first where the usage tool answers, and says why where it does not', async ($, on) => {
  const status = engine(on)
  let fresh = false
  let usage: unknown = USAGE
  const seen = usageEngine(on, { usage: () => usage, answers: argv => {
    if (argv[2] === 'last') return stdout(fresh ? REPORT.join('\n') + '\n' : 'measure: the last reading is 45 min old\n').value
    fresh = true
    return answer('ahead', 36, { premium: 41 })
  } })

  const r = await run($, 'pacing-usage')
  expect(seen.runs.map(a => a[2])).toEqual(['last', '--all', 'last'])
  expect(seen.runs[1]).toContain('--premium')
  expect(r.text.startsWith('```\nlast reading 11-15 10:00')).toBe(true)
  // the reading it took is the session's reading now
  expect(status.at(-1)).toBe('Budget 180% · usage: Weekly 36% Fable 41%')
  // without the tool and with no window from the engine there is nothing to measure with
  fresh = false
  usage = null
  const none = await run($, 'pacing-usage')
  expect(none.text).toBe('Pacing: no reading to show (the last reading is 45 min old). `/pacing usage now` measures.')
  expect(none.isTextDisplayOnly).toBe(true)
})

test('/pacing-help and /pacing-guide show what config.mjs prints, whole and for the person alone; a failure says where to ask', async ($, on) => {
  engine(on)
  const guide = Array.from({ length: 476 }, (_, i) => (i % 9 ? 'line ' + i + ' of the guide' : '| tier | model | takes |')).join('\n')
  const runs: string[][] = []
  let fail = false
  on('process.run', (_: unknown, e: any) => (runs.push([...e.argv]), fail ? stdout('', 1) : stdout((e.argv[3] === 'full' ? guide : 'Pacing, the short help.\n\n## Setup') + '\n')))

  const help = await run($, 'pacing-help')
  expect(runs[0][1].endsWith('/skills/pacing/scripts/config.mjs')).toBe(true)
  expect(runs[0].slice(2)).toEqual(['help'])
  expect(help.text).toBe('Pacing, the short help.\n\n## Setup')
  expect(help.isTextDisplayOnly).toBe(true)
  const full = await run($, 'pacing-guide')
  expect(runs[1].slice(2)).toEqual(['help', 'full'])
  // 476 lines, every one, in order
  expect(full.text.split('\n').length).toBe(476)
  expect(full.text).toBe(guide)
  expect(full.isTextDisplayOnly).toBe(true)
  fail = true
  expect((await run($, 'pacing-help')).text).toBe('Pacing: the help could not be read. `/pacing help` asks the session for it.')
  expect((await run($, 'pacing-guide')).text).toBe('Pacing: the guide could not be read. `/pacing help full` asks the session for it.')
})

// ---- real progress: the parts an agent says it has finished ----

test('the parts off an agent\'s own call: `config.mjs part <done> <total>` in Bash, or its to-do list where it said none', async () => {
  const bash = (command: string) => ({ tool: 'Bash', command })
  expect(partOf(bash('node "C:/p/skills/pacing/scripts/config.mjs" part 2 4'))).toEqual({ done: 2, total: 4, said: true })
  expect(partOf(bash('node /p/scripts/config.mjs part 0 3 && echo ok'))).toEqual({ done: 0, total: 3, said: true })
  expect(partText({ part: partOf(bash('node x/config.mjs part 4 4')) })).toBe('part 4 of 4')
  // as the agents run it: before a command they run anyway, joined with ";"
  expect(partOf(bash('node "C:/p/skills/pacing/scripts/config.mjs" part 3 5; node --test tests/budget.test.mjs'))).toEqual({ done: 3, total: 5, said: true })
  expect(partOf(bash('cd /x/app; node "C:/p/skills/pacing/scripts/config.mjs" part 1 5; git status'))).toEqual({ done: 1, total: 5, said: true })
  // not a part: more done than there are, none in all, another command, another script's words
  const was = { done: 1, total: 4, said: true }
  expect(partOf(bash('node x/config.mjs part 5 4'), was)).toBe(was)
  expect(partOf(bash('node x/config.mjs part 0 0'), was)).toBe(was)
  expect(partOf(bash('node x/config.mjs agents'), was)).toBe(was)
  expect(partOf(bash('echo part 2 4'), null)).toBeNull()
  expect(partOf({ tool: 'Read', file_path: 'config.mjs part 2 4' }, null)).toBeNull()
  // the build's to-do list, the whole list in each call
  const todos = { tool: 'TodoWrite', todos: [{ content: 'a', status: 'completed' }, { content: 'b', status: 'in_progress' }, { content: 'c', status: 'pending' }] }
  expect(partOf(todos, null)).toEqual({ done: 1, total: 3 })
  expect(partOf(todos, { done: 0, total: 5 })).toEqual({ done: 1, total: 3 })
  // what the agent said itself stands over its list
  expect(partOf(todos, was)).toBe(was)
  expect(partText({})).toBe('')
})

test('part 2 of 4 shows where the estimate did, and goes first when the room shrinks', async () => {
  const a = { ...IMPL, part: { done: 2, total: 4, said: true } }
  // the estimate is not shown beside it
  expect(agentPart([a], T0, LINE_MAX)).toBe('⏳ implementer editing 2m part 2 of 4')
  expect(agentPart([IMPL], T0, LINE_MAX)).toBe('⏳ implementer editing 2m ~60%')
  // one character short: the part goes, before the step and the time
  const whole = chars(agentPart([a], T0, LINE_MAX))
  expect(agentPart([a], T0, whole - 1)).toBe('⏳ implementer editing 2m')
  // an agent with no history shows its parts all the same
  expect(agentPart([{ ...VERIFIER, part: { done: 1, total: 2 } }], T0, LINE_MAX)).toBe('⏳ verifier is running 30s part 1 of 2')
  // the row, the 5-minute toast and the status line with the budget
  expect(backgroundText([a], T0)).toBe('In the background: ⏳ implementer: Auto-reload on plugin update, editing 2m part 2 of 4')
  expect(progressText([a], T0)).toBe('⏳ still running: implementer "Auto-reload on plugin update", editing 2m part 2 of 4, about 2m left.')
  expect(progressText([a, VERIFIER], T0)).toBe('⏳ still running: implementer "Auto-reload on plugin update", editing 2m part 2 of 4; verifier "Run the suite" 30s.')
  // two that pass 120 with them: the part and the estimate go first, for both
  expect(progressText([a, READER], T0)).toBe('⏳ still running: implementer "Auto-reload on plugin update", editing 2m; reader "Read the test logs", searching 3m.')
  // in the line, beside the budget and the weekly usage
  expect(statusText(J77, [], null, T0, [a])).toBe('⏳ implementer editing 2m part 2 of 4 · Budget 77% · usage: Weekly 100%')
  // two agents with parts pass 75 beside the budget: the parts go first, for both
  expect(statusText(J77, [], null, T0, [a, { ...READER, part: { done: 1, total: 3 } }])).toBe('⏳ implementer editing 2m, ⏳ reader searching 3m · Budget 77%')
})

test('in a session: an agent\'s Bash call says its parts, and the line, the toast and /pacing-status show them in place of the estimate', async ($, on) => {
  const status = engine(on)
  big(on)
  const clock = mock.clock(on, { now: T0 })
  const seen = agentEngine(on, { list: () => [{ id: 'ag1', status: 'running' }] })
  let store: any = JSON.parse(JSON.stringify(HISTORY))
  on('store.get', (_: unknown, e: any) => ({ value: e.key === 'agentRuns' ? JSON.parse(JSON.stringify(store)) : undefined }))
  on('store.set', (_: unknown, e: any) => { if (e.key === 'agentRuns') store = e.value; return { value: undefined } })
  on('tool.call', () => ({ result: {} }))
  const second = async () => (await $.command.run({ command: 'pacing-status', args: '' } as any)).text.split('\n').slice(1)

  await $.session.measure(measure(10))
  await spawn($, 'pacing:reader')
  await clock.advance(3 * 60000)
  // no part said yet: the estimate by time, with its note
  expect(status.at(-1)).toBe('⏳ reader is running 3m ~60% · Budget 50% · usage: Weekly 10% Fable 40%')
  expect((await second())[1]).toMatch(/^~ is a rough estimate/)
  // the main thread running the same command is nobody's progress
  await $.tool.call({ tool: 'Bash', command: 'node x/config.mjs part 3 4' } as any)
  expect(status.at(-1)).toContain('~60%')
  await $.tool.call({ tool: 'Bash', command: 'node "/p/skills/pacing/scripts/config.mjs" part 1 3', agentId: 'ag1' } as any)
  await clock.advance(5000)
  expect(status.at(-1)).toBe('⏳ reader running 3m part 1 of 3 · Budget 50% · usage: Weekly 10% Fable 40%')
  await $.tool.call({ tool: 'Grep', pattern: 'x', agentId: 'ag1' } as any)
  await $.tool.call({ tool: 'Bash', command: 'node "/p/skills/pacing/scripts/config.mjs" part 2 3', agentId: 'ag1' } as any)
  await clock.advance(2 * 60000 - 5000)
  expect(seen.toasts.at(-1)).toBe('⏳ still running: reader "a task", running 5m part 2 of 3, about 3m left.')
  // no estimate shown, so no note about one
  expect(await second()).toEqual(['Running: reader: a task, running 5m part 2 of 3 (Haiku 5.5)', 'Now: the default split'])
})

// ---- the agents panel ----

const PANE = {
  plugin: 'pacing', component: 'Pane', requestId: PANEL, surface: 'desktop',
  props: { title: 'Agents', isFocused: false, bodyColumns: 48, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} },
} as const
// the engine beneath for the panel: every open and close asked of it, the
// panes it holds, whether a surface draws them, the module's store
const panelEngine = (on: any, opts: { config?: string; placed?: () => boolean; store?: Record<string, unknown>; list?: () => any[] } = {}) => {
  const seen = { opens: [] as any[], closes: [] as any[], up: false, toasts: [] as string[], n: 0, store: opts.store ?? {} as Record<string, any> }
  on('agent.spawn', (_: unknown, e: any) => ({ model: e.model === 'opus' ? 'claude-opus-5-5' : 'claude-haiku-5-5', agentId: 'ag' + (++seen.n) }))
  on('agent.list', () => ({ value: (opts.list ? opts.list() : []).map((a: any) => ({ description: '', type: 'x', ...a })) }))
  on('env.get', (_: unknown, e: any) => ({ value: e.name === 'USERPROFILE' ? '/home/test' : undefined }))
  on('fs.read', (_: unknown, e: any) => ({ value: opts.config !== undefined && /[\\/]\.claude[\\/]pacing[\\/]config\.json$/.test(String(e.path)) ? opts.config : '{}' }))
  on('session.id', () => ({ value: 'local_s1' }))
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1000000, tokens: 1000, percent: 0 }, rateLimits: [] } }))
  on('command.register', (_: unknown, e: any) => ({ value: { command: e.name } }))
  on('store.get', (_: unknown, e: any) => ({ value: seen.store[e.key] }))
  on('store.set', (_: unknown, e: any) => { seen.store[e.key] = e.value; return { value: undefined } })
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.toast', (_: unknown, e: any) => (seen.toasts.push(e.text), { value: undefined }))
  on('ui.open', (_: unknown, e: any) => {
    seen.opens.push({ id: e.id, title: e.title })
    const placed = opts.placed ? opts.placed() : true
    seen.up = placed
    return { value: placed ? { isPlaced: true } : { isPlaced: false, reason: 'the terminal is 100 columns wide, an unasked pane needs 144' } }
  })
  on('ui.close', (_: unknown, e: any) => (seen.closes.push({ id: e.id, origin: e.origin && e.origin.kind }), seen.up = false, { value: undefined }))
  on('ui.panes', () => ({ value: seen.up ? [{ id: PANEL, title: 'Agents', isShown: true, isFocused: false, isPlaced: true }] : [] }))
  return seen
}
// the panel's rows as drawn now
const paneRows = async ($: any, props: Record<string, unknown> = {}) => {
  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, ...props } })
  const rows = (await ui.findAll({ type: 'Text' })).map((t: any) => t.text as string)
  await ui.unmount()
  return rows
}

test('the panel as text: a header with the count and the budget, a row per running agent, then what this session finished', async () => {
  const part = { ...IMPL, part: { done: 2, total: 4, said: true } }
  const side = { id: 's', kind: 'session', type: 'pacing-s1', label: 'Task s1', description: 'Task s1', startedAt: T0 - 25000, step: null, runs: [] } as any
  const done = [
    { name: 'reader', task: 'Read the test logs', ms: 3 * 60000, tokens: 41000, outcome: 'The failing assertion is in auth.test.ts.', aborted: false },
    { name: 'Task s0', session: true, ms: 35000 },
    { name: 'verifier', task: 'Run the suite', ms: 40000, tokens: 0, outcome: '', aborted: true },
  ]
  expect(panelLines([part, READER, VERIFIER, side], done, J77, T0).map(l => l.text)).toEqual([
    '4 Agents are running · Budget 77%',
    '⏳ implementer: Auto-reload on plugin update',
    '   editing · 2m · part 2 of 4 · about 2m left · Fable 5.2 high',
    '⏳ reader: Read the test logs',
    '   searching · 3m · ~60% · about 2m left · Haiku 5.5 medium',
    '⏳ verifier: Run the suite',
    '   running · 30s · Haiku 5.5 medium',
    '⏳ Task s1 (side session)',
    '   working · 25s',
    ' ',
    'Finished in this session',
    '✗ verifier: Run the suite',
    '   stopped after 40s',
    '✓ Task s0 (side session)',
    '   ended its turn after 35s',
    '✓ reader: Read the test logs',
    '   3m · 41k tokens · The failing assertion is in auth.test.ts.',
  ])
  // the detail under each name is dim, the names and the header are not
  expect(panelLines([part], [], J77, T0).map(l => !!l.dim)).toEqual([false, false, true])
  // one agent, no reading yet, nothing at all
  expect(panelLines([part], [], null, T0)[0].text).toBe('1 Agent is running')
  expect(panelLines([], [], J77, T0).map(l => l.text)).toEqual(['No agent is running · Budget 77%', 'Agents and side sessions this session starts show here.'])
  expect(panelLines([], done, { ofBudget: null } as any, T0)[0].text).toBe('No agent is running · Budget -')
  // only the last ten finished show, the newest first, and the rest are counted
  const many = Array.from({ length: 13 }, (_, i) => ({ name: 'reader', task: 'task ' + i, ms: 1000, tokens: 0, outcome: '', aborted: false }))
  const shown = panelLines([], many, null, T0).map(l => l.text)
  expect(shown.filter(t => t.startsWith('✓ ')).length).toBe(DONE_SHOWN)
  expect(shown[3]).toBe('✓ reader: task 12')
  expect(shown.at(-1)).toBe('and 3 earlier')
  // as a widget on the desktop app: the header and a line per agent
  expect(panelLines([part, READER], done, J77, T0, true).map(l => l.text)).toEqual([
    '2 Agents are running · Budget 77%', '⏳ implementer editing 2m part 2 of 4', '⏳ reader searching 3m ~60%'])
  // an answer's first line, without markdown's marks, cut at 100
  expect(outcomeOf('\n## Done\n\nAll **212** tests pass.')).toBe('Done')
  expect(outcomeOf('- `npm test`: 3 failed')).toBe('npm test: 3 failed')
  expect(outcomeOf('')).toBe('')
  expect(chars(outcomeOf('x'.repeat(300)))).toBe(100)
})

test('auto: the panel opens when the first agent starts, shows it, and lists it once it has finished', async ($, on) => {
  engine(on)
  big(on)
  const clock = mock.clock(on, { now: T0 })
  const seen = panelEngine(on, { list: () => [{ id: 'ag1', status: 'running' }] })
  on('tool.call', () => ({ result: {} }))

  await $.session.measure(measure(10))
  expect(seen.opens).toEqual([])
  await spawn($, 'pacing:implementer', 'opus', false, 'Auto-reload on plugin update')
  await clock.settle()
  expect(seen.opens).toEqual([{ id: 'pacing-agents', title: 'Agents' }])
  await $.tool.call({ tool: 'Edit', file_path: 'x', agentId: 'ag1' } as any)
  await $.tool.call({ tool: 'Bash', command: 'node p/config.mjs part 1 2', agentId: 'ag1' } as any)
  await clock.advance(2 * 60000)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.findAll({ type: 'Text' })).map((t: any) => t.text)).toEqual([
      '1 Agent is running · Budget 50%',
      '⏳ implementer: Auto-reload on plugin update',
      '   running · 2m · part 1 of 2 · about 2m left · Opus 5.5',
    ])
    await ui.unmount()
  }
  // a second agent does not open it again
  await spawn($, 'pacing:reader')
  await clock.settle()
  expect(seen.opens.length).toBe(1)
  await $.turn.complete({ ...turn('claude-opus-5-5', 1, 'ag1'), answer: 'Changed readings.mjs.\nTests pass.' })
  const rows = await paneRows($)
  expect(rows[0]).toBe('1 Agent is running · Budget 50%')
  expect(rows.slice(1, 3)).toEqual(['⏳ reader: a task', '   running · 0s · Haiku 5.5'])
  expect(rows.slice(3, 6)).toEqual([' ', 'Finished in this session', '✓ implementer: Auto-reload on plugin update'])
  expect(rows[6]).toMatch(/^ {3}2m · \d+k tokens · Changed readings\.mjs\.$/)
  // as a widget: the glance
  expect(await paneRows($, { placement: 'widget' })).toEqual(['1 Agent is running · Budget 50%', '⏳ reader is running 0s'])
})

test('closed by the person it stays closed for the session, a reload included; /pacing-agents opens it and closes it', async ($, on) => {
  engine(on)
  big(on)
  const clock = mock.clock(on, { now: T0 })
  const seen = panelEngine(on)

  await $.session.measure(measure(10))
  await spawn($, 'pacing:reader')
  await clock.settle()
  expect(seen.opens.length).toBe(1)
  // a second agent while it is up: nothing asked
  await spawn($, 'pacing:implementer')
  await clock.settle()
  expect(seen.opens.length).toBe(1)
  // the person's close mark: the engine's panes no longer hold it
  seen.up = false
  await spawn($, 'pacing:verifier')
  await clock.settle()
  expect(seen.opens.length).toBe(1)
  expect(Object.keys(seen.store.panelClosed)).toEqual(['local_s1'])
  await spawn($, 'pacing:researcher')
  await clock.settle()
  expect(seen.opens.length).toBe(1)
  // a reload starts the module's memory over; the store still knows
  await start($)
  await clock.settle()
  await spawn($, 'pacing:reader')
  await clock.settle()
  expect(seen.opens.length).toBe(1)
  // the command opens it at any time
  const opened = await run($, 'pacing-agents')
  expect(opened.text).toBe('Pacing: the agents panel is open. /pacing-agents closes it.')
  expect(opened.isTextDisplayOnly).toBe(true)
  expect(seen.opens.length).toBe(2)
  expect(seen.up).toBe(true)
  // and closes it: closed for the session again
  const closed = await run($, 'pacing-agents')
  expect(closed.text).toBe('Pacing: the agents panel is closed, and stays closed in this session. /pacing-agents opens it again.')
  expect(seen.closes.at(-1)).toEqual({ id: 'pacing-agents', origin: 'plugin' })
  expect(seen.up).toBe(false)
  await spawn($, 'pacing:implementer')
  await clock.settle()
  expect(seen.opens.length).toBe(2)
  expect(Object.keys(seen.store.panelClosed)).toEqual(['local_s1'])
})

test('the note of a close is per session: another session opens it by itself, and an old note is let go', async ($, on) => {
  engine(on)
  big(on)
  const clock = mock.clock(on, { now: T0 })
  const seen = panelEngine(on, { store: { panelClosed: { local_other: T0 - 60000, local_old: T0 - 8 * 24 * 3600000 } } })
  await $.session.measure(measure(10))
  await spawn($, 'pacing:reader')
  await clock.settle()
  expect(seen.opens.length).toBe(1)
  // closed by the command here: this session's note beside the other's, the week-old one gone
  await run($, 'pacing-agents')
  expect(Object.keys(seen.store.panelClosed).sort()).toEqual(['local_other', 'local_s1'])
})

test('off: never by itself, and still by /pacing-agents', async ($, on) => {
  engine(on)
  big(on)
  const clock = mock.clock(on, { now: T0 })
  const seen = panelEngine(on, { config: JSON.stringify({ agentsPanel: 'off' }) })
  await $.session.measure(measure(10))
  await spawn($, 'pacing:reader')
  await clock.settle()
  expect(seen.opens).toEqual([])
  expect((await run($, 'pacing-agents')).text).toBe('Pacing: the agents panel is open. /pacing-agents closes it.')
  expect(seen.opens.length).toBe(1)
  expect(await paneRows($)).toEqual(['1 Agent is running · Budget 50%', '⏳ reader: a task', '   running · 0s · Haiku 5.5'])
})

test('an open no surface draws: nothing more is done, and the next agent\'s start asks again', async ($, on) => {
  engine(on)
  big(on)
  const clock = mock.clock(on, { now: T0 })
  let placed = false
  const seen = panelEngine(on, { placed: () => placed })
  await $.session.measure(measure(10))
  await spawn($, 'pacing:reader')
  await clock.settle()
  expect(seen.opens.length).toBe(1)
  expect(seen.closes).toEqual([])
  expect(seen.toasts.filter(t => /panel/.test(t))).toEqual([])
  // asked for by hand where nothing draws it: the reason, in one line
  expect((await run($, 'pacing-agents')).text).toBe('Pacing: the agents panel cannot be drawn here (the terminal is 100 columns wide, an unasked pane needs 144). The status line and /pacing-status show the agents.')
  placed = true
  await spawn($, 'pacing:verifier')
  await clock.settle()
  expect(seen.opens.length).toBe(3)
  // drawn now: the third agent asks nothing
  await spawn($, 'pacing:implementer')
  await clock.settle()
  expect(seen.opens.length).toBe(3)
})

test('an engine without panes: the agents show in the line as before, and the command says so', async ($, on) => {
  const status = engine(on)
  big(on)
  mock.clock(on, { now: T0 })
  agentEngine(on, { list: () => [{ id: 'ag1', status: 'running' }] })
  await $.session.measure(measure(10))
  await spawn($, 'pacing:reader')
  expect(status.at(-1)).toBe('⏳ reader is running 0s · Budget 50% · usage: Weekly 10% Fable 40%')
  expect((await run($, 'pacing-agents')).text).toBe('Pacing: the agents panel is not available here. The status line and /pacing-status show the agents.')
})

test('a side session that starts working brings the panel too, and shows in it; one already working at load does not open it', async ($, on) => {
  engine(on)
  big(on)
  const clock = mock.clock(on, { now: T0 })
  let running = true
  const polls = sessionEngine(on, () => [row('s1', running)])
  const opens: string[] = []
  on('ui.open', (_: unknown, e: any) => (opens.push(e.id), { value: { isPlaced: true } }))
  on('session.id', () => ({ value: 'local_main' }))
  await $.session.measure(measure(10))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true } as any)
  await new Promise(r => setTimeout(r, 50))
  expect(polls.polls).toBe(1)
  expect(opens).toEqual([])
  // its turn ends, then the session messages it again
  running = false
  await clock.advance(15000)
  running = true
  await $.tool.call({ tool: 'mcp__ccd_session_mgmt__send_message', sessionId: 's1', message: 'go on' } as any)
  await clock.advance(5000)
  await clock.settle()
  expect(opens).toEqual(['pacing-agents'])
  expect(await paneRows($)).toEqual(['1 Agent is running · Budget 50%', '⏳ Task s1 (side session)', '   working · 5s',
    ' ', 'Finished in this session', '✓ Task s1 (side session)', '   ended its turn after 15s'])
})

// ---- a toast by its kind ----

test('every toast leads with the icon of its kind where "Pacing: " stood, and keeps its words after it', async () => {
  expect(ICON).toEqual({ started: '▶️', done: '✅', still: '⏳', worse: '⚠️', stop: '🔴', better: '🟢', switched: '🔁', failed: '❌',
    updated: '🔄', waiting: '📦', compacted: '🗜️', pause: '💤' })
  const side = { id: 's1', kind: 'session', label: 'Task s1', startedAt: T0 - 35000 } as any
  const texts: [string, string][] = [
    ['▶️', startedText(FIRST, [FIRST])],
    ['▶️', sessionStartedText(row('s1', true), [])],
    ['✅', doneText(IMPL, 3 * 60000, 41000, [])],
    ['✅', sessionDoneText(side, 35000, [])],
    ['⏳', progressText([IMPL], T0)],
    ['⏳', progressText([...SETS.six, ...SETS.six.map(a => ({ ...a, id: a.id + 'b' }))] as any, T0)],
    ['🔁', switchedText(REC_OPUS_HIGH, 'claude-opus-5-5', 'high')],
    ['❌', switchedText(REC_OPUS_HIGH, 'claude-fable-5-2', 'high')],
    ['🔄', reloadedText('0.9.12')],
    ['📦', reloadAskText('0.9.12')],
    ['🗜️', compactedText(320000, 40000)],
    ['🗜️', compactedText(0, 0)],
    ['💤', pauseNote(420000, 85 * 60000)!],
  ]
  for (const [icon, text] of texts) {
    expect(text.startsWith(icon + ' ')).toBe(true)
    expect(text).not.toContain('Pacing:')
    // the width counts the icon
    expect(chars(text)).toBeLessThanOrEqual(text.startsWith('💤') ? 2000 : MSG_MAX)
  }
  // the words as they were, after the icon
  expect(texts[0][1]).toBe('▶️ implementer is running "Auto-reload on plugin update" on Fable 5.2 high.')
  expect(texts[1][1]).toBe('▶️ side session Task s1 is running.')
  expect(texts[2][1]).toBe('✅ implementer is done with "Auto-reload on plugin update" after 3m, 41k tokens; nothing else is running.')
  expect(texts[3][1]).toBe('✅ side session Task s1 ended its turn after 35s; nothing else is running.')
  expect(texts[4][1]).toBe('⏳ still running: implementer "Auto-reload on plugin update", editing 2m ~60%, about 1m left.')
  expect(texts[5][1]).toBe('⏳ 12 Agents are still running, the longest for 12m.')
  expect(texts[6][1]).toBe('🔁 this session now runs on Opus 5.5 high.')
  expect(texts[7][1]).toBe('❌ the switch did not take; the session still runs on Fable 5.2. The model menu does it: Opus 5.5, effort high.')
  expect(texts[8][1]).toBe('🔄 updated to 0.9.12 and reloaded.')
  expect(texts[9][1]).toBe('📦 Pacing 0.9.12 is installed: type /reload-plugins to load it.')
  expect(texts[10][1]).toBe('🗜️ compacted from 320k to 40k tokens.')
  expect(texts[11][1]).toBe('🗜️ compacted. The status line shows the new size after the next turn.')
  expect(texts[12][1]).toBe('💤 this session is 420k tokens and sat idle 1 h 25 min, so its cache has lapsed and this turn stores it all again. After a break, /compact first is cheaper.')
  // a reading's state in one colour: stop or the model out, over the line, within it
  expect(levelIcon({ level: 'stop' })).toBe('🔴')
  expect(levelIcon({ level: 'ahead', premiumOut: true })).toBe('🔴')
  expect(levelIcon({ level: 'throttle' })).toBe('⚠️')
  expect(levelIcon({ level: 'over' })).toBe('⚠️')
  expect(levelIcon({ level: 'ahead', premiumHeld: true })).toBe('⚠️')
  expect(levelIcon({ level: 'on pace' })).toBe('🟢')
  expect(levelIcon({ level: 'ahead' })).toBe('🟢')
})

test('in a session: each toast with its icon, the routine ones for the engine\'s 4 seconds, what must not be missed for 15', async ($, on) => {
  engine(on)
  const clock = mock.clock(on, { now: T0 })
  const shown: { text: string; ms: number | undefined }[] = []
  let next = answer('on pace', 18)
  on('process.run', () => ({ value: next }))
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'ag1' }))
  on('agent.list', () => ({ value: [{ id: 'ag1', description: '', type: 'x', status: 'running' }] }))
  on('env.get', (_: unknown, e: any) => ({ value: e.name === 'USERPROFILE' ? '/home/test' : undefined }))
  on('fs.read', () => ({ value: '{}' }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.toast', (_: unknown, e: any) => (shown.push({ text: e.text, ms: e.timeoutMs }), { value: undefined }))
  expect(TOAST_LONG).toBe(15000)

  await $.session.measure(measure(18))
  await spawn($, 'pacing:reader')
  expect(shown.at(-1)).toEqual({ text: '▶️ reader is running "a task" on Haiku 5.5.', ms: undefined })
  await clock.advance(5 * 60000)
  expect(shown.at(-1)).toEqual({ text: '⏳ still running: reader "a task" 5m.', ms: undefined })
  await $.turn.complete(turn('claude-haiku-5-5', 1, 'ag1'))
  expect(shown.at(-1)!.text).toMatch(/^✅ reader is done with "a task" after 5m, \d+k tokens; nothing else is running\.$/)
  expect(shown.at(-1)!.ms).toBe(15000)
  // (the look at the meters its end started is over)
  await clock.settle()
  // the level: over the line, the week nearly used, back under it
  next = answer('over', 21, { do: 'medium tasks leave the session model too' })
  await $.session.measure(measure(21))
  expect(shown.at(-1)).toEqual({ text: '⚠️ on budget -> over budget. medium tasks leave the session model too', ms: 15000 })
  next = answer('stop', 96, { do: 'wrap up, the week is nearly used' })
  await $.session.measure(measure(96))
  expect(shown.at(-1)).toEqual({ text: '🔴 over budget -> stop. wrap up, the week is nearly used', ms: 15000 })
  next = answer('ahead', 10, { do: 'the session model does nearly everything' })
  await $.session.measure(measure(10))
  expect(shown.at(-1)).toEqual({ text: '🟢 stop -> under budget. the session model does nearly everything', ms: 15000 })
  // the per-model meter over its line, the level as it was; then that model out
  next = answer('ahead', 11, { premiumHeld: true, do: 'Fable 5.2\'s own meter is over its line' })
  await $.session.measure(measure(11))
  expect(shown.at(-1)).toEqual({ text: '⚠️ Fable 5.2\'s own meter is over its line', ms: 15000 })
  next = answer('ahead', 12, { premiumOut: true, do: 'Fable 5.2 is out until the reset' })
  await $.session.measure(measure(12))
  expect(shown.at(-1)).toEqual({ text: '🔴 Fable 5.2 is out until the reset', ms: 15000 })
  // and none of them says "Pacing:"
  expect(shown.filter(t => t.text.includes('Pacing:'))).toEqual([])
})

// ---- an estimate of the time left ----

test('the time left: from the parts said, else from the history of that kind of run; nothing without a basis or past the estimate', async () => {
  const m = 60000
  // parts: the time so far per part done, times the parts left
  const parts = { ...IMPL, startedAt: T0 - 12 * m, part: { done: 2, total: 4, said: true } }
  expect(leftOf(parts, T0)).toBe(12 * m)
  expect(leftText(parts, T0)).toBe('about 12m left')
  expect(leftText({ ...parts, part: { done: 3, total: 4 } }, T0)).toBe('about 4m left')
  // the parts stand over the history (three runs of 20 minutes would say 8)
  expect(leftText({ ...parts, runs: [20 * m, 20 * m, 20 * m] }, T0)).toBe('about 12m left')
  // every part done: the report is what is left
  expect(leftText({ ...parts, part: { done: 4, total: 4 } }, T0)).toBe('under 1m left')
  // no part done yet says nothing about the pace: the history, where there is one
  expect(leftText({ ...parts, runs: [], part: { done: 0, total: 4 } }, T0)).toBe('')
  expect(leftText({ ...parts, runs: [20 * m, 20 * m, 20 * m], part: { done: 0, total: 4 } }, T0)).toBe('about 8m left')
  // history: the median of three runs or more, less the time run; whole minutes, under one said so
  const hist = { ...IMPL, startedAt: T0 - 12 * m, runs: [20 * m, 20 * m, 20 * m] }
  expect(leftText(hist, T0)).toBe('about 8m left')
  expect(leftText({ ...hist, startedAt: T0 - 19.6 * m }, T0)).toBe('under 1m left')
  expect(leftText({ ...hist, startedAt: T0 - 18.4 * m }, T0)).toBe('about 2m left')
  expect(leftText({ ...hist, runs: [300 * m, 300 * m, 300 * m] }, T0)).toBe('about 5h left')
  // no basis: two runs are no history, a side session has none
  expect(leftText({ ...hist, runs: [20 * m, 20 * m] }, T0)).toBe('')
  expect(leftText({ id: 's', kind: 'session', label: 'Task s1', startedAt: T0 - m, runs: [] }, T0)).toBe('')
  // past the estimate: no figure, never a negative one
  expect(leftOf({ ...hist, startedAt: T0 - 25 * m }, T0)).toBeNull()
  expect(leftText({ ...hist, startedAt: T0 - 20 * m }, T0)).toBe('')
  // the usual length, for the start toast
  expect(usualText(hist)).toBe('about 20m')
  expect(usualText({ runs: [20000, 30000, 40000] })).toBe('under 1m')
  expect(usualText({ runs: [20 * m, 20 * m] })).toBe('')
})

test('the toasts with it: the 5-minute toast per agent, the start toast with the usual length; the first thing to go at 120 characters', async () => {
  const m = 60000
  const hist = { ...IMPL, startedAt: T0 - 12 * m, runs: [20 * m, 20 * m, 20 * m] }
  const parts = { ...FIRST, startedAt: T0 - 12 * m, part: { done: 2, total: 4, said: true } }
  expect(progressText([hist], T0)).toBe('⏳ still running: implementer "Auto-reload on plugin update", editing 12m ~60%, about 8m left.')
  expect(progressText([parts], T0)).toBe('⏳ still running: implementer "Auto-reload on plugin update", editing 12m part 2 of 4, about 12m left.')
  // no basis, or past the estimate: the toast as it was
  expect(progressText([{ ...FIRST, startedAt: T0 - 12 * m }], T0)).toBe('⏳ still running: implementer "Auto-reload on plugin update", editing 12m.')
  expect(progressText([{ ...hist, startedAt: T0 - 25 * m }], T0)).toBe('⏳ still running: implementer "Auto-reload on plugin update", editing 25m ~95%.')
  // several: each its own, joined by "; " so the commas stay inside one agent's part
  const short = [{ ...IMPL, description: 'Fix it' }, { ...READER, description: 'Logs' }]
  expect(progressText(short, T0)).toBe('⏳ still running: implementer "Fix it", editing 2m ~60%, about 1m left; reader "Logs", searching 3m ~60%, about 2m left.')
  expect(progressText([{ ...READER, description: undefined }, { ...VERIFIER, description: undefined }], T0)).toBe('⏳ still running: reader searching 3m ~60%, about 2m left; verifier 30s.')
  // past 120 characters the time left goes first, for all of them, before the progress does
  expect(progressText([parts, VERIFIER], T0)).toBe('⏳ still running: implementer "Auto-reload on plugin update", editing 12m part 2 of 4; verifier "Run the suite" 30s.')
  for (const list of [[hist], [parts], short, [parts, VERIFIER], [hist, READER, VERIFIER], described(SETS.six as any)]) expect(chars(progressText(list as any, T0))).toBeLessThanOrEqual(MSG_MAX)
  // the start toast: the usual length of that kind of run, where three runs say one
  expect(startedText(IMPL, [IMPL])).toBe('▶️ implementer is running "Auto-reload on plugin update" on Fable 5.2 high, about 3m.')
  expect(startedText(hist, [hist])).toBe('▶️ implementer is running "Auto-reload on plugin update" on Fable 5.2 high, about 20m.')
  expect(startedText(IMPL, [IMPL, READER])).toBe('▶️ implementer is running "Auto-reload on plugin update" on Fable 5.2 high, about 3m; reader is also running.')
  // it goes before who else runs does
  expect(startedText(IMPL, [IMPL, READER, VERIFIER])).toBe('▶️ implementer is running "Auto-reload on plugin update" on Fable 5.2 high; reader and verifier are also running.')
  expect(chars(startedText(IMPL, [IMPL, READER, VERIFIER]))).toBeLessThanOrEqual(MSG_MAX)
  // the panel's row has it; the status line and the row above the prompt do not
  expect(panelLines([hist], [], null, T0)[2].text).toBe('   editing · 12m · ~60% · about 8m left · Fable 5.2 high')
  expect(agentPart([hist], T0, LINE_MAX)).toBe('⏳ implementer editing 12m ~60%')
  expect(backgroundText([hist], T0)).toBe('In the background: ⏳ implementer: Auto-reload on plugin update, editing 12m ~60%')
})
