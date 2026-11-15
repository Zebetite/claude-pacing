// The hooks module under the engine's own test kit: `claude plugin test` on
// the plugin folder. The hooks here stand for the engine: they answer the
// module's $.process.run with what budget.mjs --source hook prints, and catch
// the status line it sets. budget.mjs itself is tested under tests/ with
// node --test.
import { expect, mock, test } from 'claude-code/testing'
import { pauseNote, unattended } from './readings.mjs'

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

test('the status line: share of the budget, each tier\'s share of the session\'s use, the meters', async ($, on) => {
  const status = engine(on)
  on('process.run', () => ({ value: answer('ahead', 15.4) }))

  await $.session.measure(measure(15.4))
  expect(status.at(-1)).toBe('77% of budget, (15% Weekly, 40% Fable)')

  await $.turn.complete(turn('claude-fable-5-2', 8))
  await $.turn.complete(turn('claude-opus-5-5', 1.5, 'a1'))
  await $.turn.complete(turn('claude-haiku-5-5', 0.5, 'a2'))
  // no new reading is due (the meter did not move): the line is redrawn all the same
  await $.session.measure(measure(15.4))
  expect(status.at(-1)).toBe('77% of budget, 🟡Tier 1[80%] ⚪Tier 2[15%] 🟤Tier 4[5%], (15% Weekly, 40% Fable)')
})

test('a priced model off the ladder is Other, one with no price is left out; a long ladder takes more colours', async ($, on) => {
  const status = engine(on)
  on('process.run', () => ({ value: answer('on pace', 18, { tierOf: { 'claude-fable-5-2': 1, 'claude-sonnet-5-5': 3, 'claude-haiku-5-5': 5 }, premium: null }) }))

  await $.turn.complete(turn('claude-sonnet-5-5', 3))
  await $.turn.complete(turn('claude-haiku-5-5', 0.5))
  await $.turn.complete(turn('claude-opus-5-5', 0.5))
  await $.turn.complete({ ...turn('claude-sonnet-5-5', 1), usage: { model: 'claude-opus-4-8', input_tokens: 0, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } })
  await $.session.measure(measure(18))
  expect(status.at(-1)).toBe('90% of budget, 🟠Tier 3[75%] 🟣Tier 5[13%] ⚫Other[12%], (18% Weekly)')
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
  const line = status.at(-1) ?? ''
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

test('a change of level is one toast; stop says wrap up', async ($, on) => {
  const status = engine(on)
  const toasts: string[] = []
  let next = answer('on pace', 18)
  on('process.run', () => ({ value: next }))
  on('ui.toast', (_, e) => (toasts.push(e.text), { value: undefined }))

  await $.session.measure(measure(18))
  expect(toasts).toEqual([])
  next = answer('over', 21, { do: 'medium tasks leave the session model too' })
  await $.session.measure(measure(21))
  expect(toasts).toEqual(['Pacing: on pace -> over. medium tasks leave the session model too'])
  next = answer('stop', 96)
  await $.session.measure(measure(96))
  expect(status.at(-1)).toBe('480% of budget, (96% Weekly, 40% Fable), wrap up')
})

test('a failed run changes nothing and never throws into the session', async ($, on) => {
  const status = engine(on)
  on('process.run', () => ({ value: { ...answer('ahead', 10), exitCode: 1, stdout: 'usage: ...' } }))

  const r = await $.session.measure(measure(10))
  expect(r.changed).toEqual(['rateLimits'])
  expect(status).toEqual([])
})

// ---- the per-model meter in the status line ----

test('a carried per-model figure is current for half an hour; the meter that set the level shows its own budget share', async ($, on) => {
  const status = engine(on)
  const toasts: string[] = []
  const NOW = Date.parse('2026-11-13T10:00:00.000Z')
  mock.clock(on, { now: NOW })
  // read 20 min ago: still shown as it is
  let next = answer('ahead', 10, { premium: 18, premiumAt: '2026-11-13T09:40:00.000Z', premiumLevel: 'on pace', levelBy: 'all', premiumOfBudget: 90 })
  on('process.run', () => ({ value: next }))
  on('ui.toast', (_, e) => (toasts.push(e.text), { value: undefined }))

  await $.session.measure(measure(10))
  expect(status.at(-1)).toBe('50% of budget, (10% Weekly, 18% Fable)')
  next = answer('over', 11, { premium: 22, premiumAt: null, premiumLevel: 'over', levelBy: 'premium', premiumOfBudget: 110, do: 'medium tasks leave the session model too' })
  await $.session.measure(measure(11))
  expect(status.at(-1)).toBe('110% of Fable budget, (11% Weekly, 22% Fable)')
  expect(toasts).toEqual(['Pacing: ahead -> over (Fable meter). medium tasks leave the session model too'])
})

test('the session moved off the per-model meter\'s model is one toast, though the level stays', async ($, on) => {
  engine(on)
  const toasts: string[] = []
  let next = answer('ahead', 10)
  on('process.run', () => ({ value: next }))
  on('ui.toast', (_, e) => (toasts.push(e.text), { value: undefined }))

  await $.session.measure(measure(10))
  next = answer('ahead', 11, { premium: 30, premiumHeld: true, premiumLevel: 'throttle', premiumOfBudget: 150, do: 'Fable 5.2\'s own meter is at throttle: SWITCH the session to Opus 5.5 high now' })
  await $.session.measure(measure(11))
  expect(toasts).toEqual(['Pacing: Fable 5.2\'s own meter is at throttle: SWITCH the session to Opus 5.5 high now'])
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
    'toast: Pacing: this session is 420k tokens and sat idle 1 h 25 min, so its cache has lapsed and this turn stores it all again. After a break, /compact or a handover first is cheaper.',
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
    'toast: Pacing: this session is 600k tokens and sat idle 1 h 10 min, so its cache has lapsed and this turn stores it all again. After a break, /compact or a handover first is cheaper.',
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
  expect(status.at(-1)).toBe('⚪Tier 2 Sub Agent - 50% of budget, ⚪Tier 2[90%] 🟤Tier 4[10%], (10% Weekly, 40% Fable)')
})

test('a side session: the per-model meter\'s share when it decides; a model off the ladder is Other', async ($, on) => {
  const status = engine(on)
  let next = answer('over', 11, { premium: 22, levelBy: 'premium', premiumOfBudget: 110, spawned: true })
  on('process.run', () => ({ value: next }))

  await $.turn.complete(turn('claude-fable-5-2', 1))
  await $.session.measure(measure(11))
  expect(status.at(-1)).toBe('🟡Tier 1 Sub Agent - 110% of Fable budget, 🟡Tier 1[100%], (11% Weekly, 22% Fable)')
  next = answer('ahead', 12, { spawned: true })
  await $.turn.complete({ ...turn('claude-fable-5-2', 1), usage: { model: 'claude-opus-4-8', input_tokens: 0, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } })
  await $.session.measure(measure(12))
  expect(status.at(-1)).toBe('⚫Other Sub Agent - 60% of budget, 🟡Tier 1[100%], (12% Weekly, 40% Fable)')
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
  expect(status.at(-1)).toBe('50% of budget, ⚪Tier 2[100%], (10% Weekly, 40% Fable)')
  next = answer('ahead', 11, { spawned: null })
  await $.session.measure(measure(11))
  expect(status.at(-1)).toBe('55% of budget, ⚪Tier 2[100%], (11% Weekly, 40% Fable)')
  // an older budget.mjs says nothing of it
  next = answer('ahead', 12)
  await $.session.measure(measure(12))
  expect(status.at(-1)).toBe('60% of budget, ⚪Tier 2[100%], (12% Weekly, 40% Fable)')
})

test('a side session before its first turn keeps the plain line', async ($, on) => {
  const status = engine(on)
  on('process.run', () => ({ value: answer('ahead', 10, { spawned: true }) }))

  await $.turn.complete(turn('claude-opus-5-5', 1, 'a1'))
  await $.session.measure(measure(10))
  expect(status.at(-1)).toBe('50% of budget, ⚪Tier 2[100%], (10% Weekly, 40% Fable)')
})

// ---- a carried per-model figure is not a current one ----

// the case reported: Fable read at 71 %, then unread for 15 hours while all
// models went from 45 to 49 %; the real meter stood at 90 %
const STALE = { premium: 71, premiumAt: '2026-11-15T01:00:00.000Z', premiumEstimate: 90, premiumLevel: 'throttle', premiumHeld: true, premiumOfBudget: 152,
  needFull: 'the Fable 5.2 figure is 15 h old', do: 'Fable 5.2\'s own meter is at throttle: SWITCH the session to Opus 5.5 high now' }
const AT_16 = Date.parse('2026-11-15T16:00:00.000Z')

test('a 15-hour-old carried figure is shown with its age and an estimate, never as current', async ($, on) => {
  const status = engine(on)
  const clock = mock.clock(on, { now: AT_16 })
  let next = answer('over', 49, STALE)
  on('process.run', () => ({ value: next }))

  await $.session.measure(measure(49))
  expect(status.at(-1)).toBe('152% of Fable budget, (49% Weekly, 71% Fable 15h ago, est. 90%)')
  // the line is redrawn every turn: the age moves on without a new reading
  await clock.advance(20 * 60000)
  await $.session.measure(measure(49))
  expect(status.at(-1)).toContain('71% Fable 15h ago, est. 90%')
  // no estimate to give: the age alone; under an hour in minutes, past two days in days
  next = answer('over', 50, { ...STALE, premiumEstimate: null, premiumAt: '2026-11-15T15:35:00.000Z' })
  await $.session.measure(measure(50))
  expect(status.at(-1)).toContain('(50% Weekly, 71% Fable 45m ago)')
  next = answer('over', 51, { ...STALE, premiumEstimate: 71, premiumAt: '2026-11-12T16:20:00.000Z' })
  await $.session.measure(measure(51))
  expect(status.at(-1)).toContain('(51% Weekly, 71% Fable 3d ago)')
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
  expect(status.at(-1)).toBe('🟡Tier 1 Sub Agent - 50% of budget, 🟡Tier 1[60%] ⚪Tier 2[30%] 🟤Tier 4[10%], (10% Weekly, 40% Fable)')
})

test('an older budget.mjs without agentTierOf: every turn counts by tierOf, as before', async ($, on) => {
  const status = engine(on)
  on('process.run', () => ({ value: answer('ahead', 10) }))

  await $.turn.complete(turn('claude-fable-5-2', 8))
  await $.turn.complete(turn('claude-opus-5-5', 2, 'a1'))
  await $.session.measure(measure(10))
  expect(status.at(-1)).toBe('50% of budget, 🟡Tier 1[80%] ⚪Tier 2[20%], (10% Weekly, 40% Fable)')
})
