// The hooks module under the engine's own test kit: `claude plugin test` on
// the plugin folder. The hooks here stand for the engine: they answer the
// module's $.process.run with what budget.mjs --source hook prints, and catch
// the status line it sets. budget.mjs itself is tested under tests/ with
// node --test.
import { expect, mock, test } from 'claude-code/testing'
import { pauseNote, unattended, statusText, fullText, HEAD_MAX, levelPhrase, offerText, nowText, COMPACT_INSTRUCTIONS, LINE_MAX, MSG_MAX, agentPart, roleOf, startedText, doneText, progressText, backgroundText, estimateOf, median, keepRuns, RUNS_KEPT, stepOf, switchOffer, switchedText } from './readings.mjs'

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
  expect(status.at(-1)).toBe('Budget 77% · week 15% Fable 40%')

  await $.turn.complete(turn('claude-fable-5-2', 8))
  await $.turn.complete(turn('claude-opus-5-5', 1.5, 'a1'))
  await $.turn.complete(turn('claude-haiku-5-5', 0.5, 'a2'))
  // no new reading is due (the meter did not move): the line is redrawn all the same
  await $.session.measure(measure(15.4))
  expect(status.at(-1)).toBe('Budget 77% · 🟡T1 80% ⚪T2 15% 🟤T4 5% · week 15% Fable 40%')
})

test('a priced model off the ladder is Other, one with no price is left out; a long ladder takes more colours', async ($, on) => {
  const status = engine(on)
  on('process.run', () => ({ value: answer('on pace', 18, { tierOf: { 'claude-fable-5-2': 1, 'claude-sonnet-5-5': 3, 'claude-haiku-5-5': 5 }, premium: null }) }))

  await $.turn.complete(turn('claude-sonnet-5-5', 3))
  await $.turn.complete(turn('claude-haiku-5-5', 0.5))
  await $.turn.complete(turn('claude-opus-5-5', 0.5))
  await $.turn.complete({ ...turn('claude-sonnet-5-5', 1), usage: { model: 'claude-opus-4-8', input_tokens: 0, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } })
  await $.session.measure(measure(18))
  expect(status.at(-1)).toBe('Budget 90% · 🟠T3 75% 🟣T5 13% ⚫Other 12% · week 18%')
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
  const shares = [...line.matchAll(/T\d+ (\d+)%/g)].map(m => Number(m[1]))
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
  expect(toasts).toEqual(['Pacing: on budget -> over budget. medium tasks leave the session model too'])
  next = answer('stop', 96)
  await $.session.measure(measure(96))
  expect(status.at(-1)).toBe('Budget 480% · week 96% Fable 40%')
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
  expect(status.at(-1)).toBe('Budget 50% · week 10% Fable 18%')
  next = answer('over', 11, { premium: 22, premiumAt: null, premiumLevel: 'over', levelBy: 'premium', premiumOfBudget: 110, do: 'medium tasks leave the session model too' })
  await $.session.measure(measure(11))
  // no "Fable over 110%": the per-model meter shows as its usage only
  expect(status.at(-1)).toBe('Budget 55% · week 11% Fable 22%')
  expect(toasts).toEqual(['Pacing: under budget -> over budget (Fable meter). medium tasks leave the session model too'])
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
    'toast: Pacing: this session is 420k tokens and sat idle 1 h 25 min, so its cache has lapsed and this turn stores it all again. After a break, /compact first is cheaper.',
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
    'toast: Pacing: this session is 600k tokens and sat idle 1 h 10 min, so its cache has lapsed and this turn stores it all again. After a break, /compact first is cheaper.',
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
  expect(status.at(-1)).toBe('⚪T2 sub · Budget 50% · ⚪T2 90% 🟤T4 10% · week 10%')
})

test('a side session shows no per-model meter, even when it set the level; a model off the ladder is Other', async ($, on) => {
  const status = engine(on)
  let next = answer('over', 11, { premium: 22, levelBy: 'premium', premiumOfBudget: 110, spawned: true })
  on('process.run', () => ({ value: next }))

  await $.turn.complete(turn('claude-fable-5-2', 1))
  await $.session.measure(measure(11))
  // no per-model meter in a side session: the weekly share alone, without the
  // level's word, since that meter set the level
  expect(status.at(-1)).toBe('🟡T1 sub · Budget 55% · 🟡T1 100% · week 11%')
  next = answer('ahead', 12, { spawned: true })
  await $.turn.complete({ ...turn('claude-fable-5-2', 1), usage: { model: 'claude-opus-4-8', input_tokens: 0, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } })
  await $.session.measure(measure(12))
  expect(status.at(-1)).toBe('⚫Other sub · Budget 60% · 🟡T1 100% · week 12%')
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
  expect(status.at(-1)).toBe('Budget 50% · ⚪T2 100% · week 10% Fable 40%')
  next = answer('ahead', 11, { spawned: null })
  await $.session.measure(measure(11))
  expect(status.at(-1)).toBe('Budget 55% · ⚪T2 100% · week 11% Fable 40%')
  // an older budget.mjs says nothing of it
  next = answer('ahead', 12)
  await $.session.measure(measure(12))
  expect(status.at(-1)).toBe('Budget 60% · ⚪T2 100% · week 12% Fable 40%')
})

test('a side session before its first turn ends takes the model it is set to', async ($, on) => {
  // the case reported: after a reload the session.measure calls of a turn
  // came before its end, and the line went out without Sub Agent
  const status = engine(on)
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('process.run', () => ({ value: answer('ahead', 10, { spawned: true }) }))

  await $.turn.complete(turn('claude-haiku-5-5', 1, 'a1'))
  await $.session.measure(measure(10))
  expect(status.at(-1)).toBe('⚪T2 sub · Budget 50% · 🟤T4 100% · week 10%')
})

test('a side session whose model is not known yet keeps the plain line, and shows no per-model meter', async ($, on) => {
  const status = engine(on)
  on('session.model', () => ({ value: 'opus' }))
  on('process.run', () => ({ value: answer('ahead', 10, { spawned: true }) }))

  await $.turn.complete(turn('claude-opus-5-5', 1, 'a1'))
  await $.session.measure(measure(10))
  expect(status.at(-1)).toBe('Budget 50% · ⚪T2 100% · week 10%')
})

test('the line is redrawn when the main thread\'s turn ends', async ($, on) => {
  const status = engine(on)
  on('process.run', () => ({ value: answer('ahead', 10, { spawned: true }) }))

  await $.session.measure(measure(10))
  const before = status.length
  await $.turn.complete(turn('claude-opus-5-5', 1))
  expect(status.length).toBe(before + 1)
  expect(status.at(-1)).toBe('⚪T2 sub · Budget 50% · ⚪T2 100% · week 10%')
  // a subagent's turn waits for the next measure
  await $.turn.complete(turn('claude-haiku-5-5', 1, 'a1'))
  expect(status.length).toBe(before + 1)
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
  expect(status.at(-1)).toBe('Budget 245% · week 49% Fable 71% (15h old est 90%)')
  // the line is redrawn every turn: the age moves on without a new reading
  await clock.advance(20 * 60000)
  await $.session.measure(measure(49))
  expect(status.at(-1)).toContain('Fable 71% (15h old est 90%)')
  // no estimate to give: the age alone; under an hour in minutes, past two days in days
  next = answer('over', 50, { ...STALE, premiumEstimate: null, premiumAt: '2026-11-15T15:35:00.000Z' })
  await $.session.measure(measure(50))
  expect(status.at(-1)).toContain('week 50% Fable 71% (45m old)')
  next = answer('over', 51, { ...STALE, premiumEstimate: 71, premiumAt: '2026-11-12T16:20:00.000Z' })
  await $.session.measure(measure(51))
  expect(status.at(-1)).toContain('week 51% Fable 71% (3d old)')
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
  expect(status.at(-1)).toBe('🟡T1 sub · Budget 50% · 🟡T1 60% ⚪T2 30% 🟤T4 10% · week 10%')
})

test('an older budget.mjs without agentTierOf: every turn counts by tierOf, as before', async ($, on) => {
  const status = engine(on)
  on('process.run', () => ({ value: answer('ahead', 10) }))

  await $.turn.complete(turn('claude-fable-5-2', 8))
  await $.turn.complete(turn('claude-opus-5-5', 2, 'a1'))
  await $.session.measure(measure(10))
  expect(status.at(-1)).toBe('Budget 50% · 🟡T1 80% ⚪T2 20% · week 10% Fable 40%')
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
  expect(reported).toBe('🟡T1 sub · Budget 107% · 🟡T1 100% · week 50%')
  expect(chars(head(reported))).toBeLessThanOrEqual(HEAD_MAX)
  // a realistic main session's whole line is shorter than the old form's
  const realistic = statusText({ ...BASE, all: 48, premium: 71, ofBudget: 103, level: 'over' }, [{ tier: 1, share: 45 }, { tier: 2, share: 55 }], null, now)
  expect(realistic).toBe('Budget 103% · 🟡T1 45% ⚪T2 55% · week 48% Fable 71%')
  expect(chars(realistic)).toBeLessThan(chars(fullText({ ...BASE, all: 48, premium: 71, ofBudget: 103, level: 'over' }, [{ tier: 1, share: 45 }, { tier: 2, share: 55 }], null, now)))
})

test('the order: tier, level and share, then the split, then the meters; a cut takes the tail', async () => {
  const now = Date.parse('2026-11-16T12:00:00.000Z')
  const s = statusText({ ...BASE, level: 'throttle', premiumHeld: true, premiumOfBudget: 158, premiumAt: '2026-11-16T09:00:00.000Z', premiumEstimate: 104 },
    [{ tier: 1, share: 60 }, { tier: 2, share: 40 }], null, now)
  const parts = s.split(' · ')
  // the weekly level and share; the per-model meter only as its usage, last
  expect(parts[0]).toBe('Budget 214%')
  expect(parts.join(' · ')).not.toContain('held')
  expect(parts[1]).toBe('🟡T1 60% ⚪T2 40%')
  expect(parts[2]).toBe('week 100% Fable 100% (3h old est 104%)')
  // a side session: its tier first, then the weekly share, no per-model meter
  const side = statusText({ ...BASE, level: 'throttle', premiumHeld: true, premiumOfBudget: 158, premiumAt: '2026-11-16T09:00:00.000Z', premiumEstimate: 104 },
    [{ tier: 1, share: 60 }, { tier: 2, share: 40 }], 2, now).split(' · ')
  expect(side).toEqual(['⚪T2 sub', 'Budget 214%', '🟡T1 60% ⚪T2 40%', 'week 100%'])
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
  expect(text).toBe('This session is 320k tokens. Compacting now makes every later turn cheaper.')
  expect(text).toBe(offerText('suggest', 320000))
  await ui.press({ key: 'pacing-compact' })
  expect(seen.compacts).toEqual([COMPACT_INSTRUCTIONS])
  expect(COMPACT_INSTRUCTIONS).toContain('the goal; the decisions made and why; the open items, in order; the files and commands that matter; what was tried and ruled out')
  expect(seen.toasts).toEqual(['Pacing: compacted from 320k to 38k tokens.'])
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
  expect(text).toBe('This session is 540k tokens, and every turn sends all 540k again. Compact now to cut that.')
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
  expect((await bandText($)).text).toBe('This session is 420k tokens, and its cache lapses in about 10 minutes. Then the next turn stores all of it again. Compacting now is cheaper.')
  expect((await bandText($)).text).toBe(nowText(420000, false))
  await clock.advance(10 * 60000)
  const ui = await $.ui.mount(BAND)
  expect((await ui.find({ type: 'Text', text: /session is/ }))?.text).toBe('This session is 420k tokens and its cache has lapsed, so the next turn stores all of it again. Compacting first is cheaper.')
  await ui.press({ key: 'pacing-compact' })
  await ui.unmount()
  expect(seen.compacts).toEqual([COMPACT_INSTRUCTIONS])
  expect(seen.toasts).toEqual(['Pacing: compacted from 420k to 41k tokens.'])
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

test('one agent: a toast when it starts, the line leads with it and its time, a toast when it ends, then the plain line', async ($, on) => {
  const status = engine(on)
  big(on)
  const clock = mock.clock(on, { now: T0 })
  const seen = agentEngine(on, { list: () => [{ id: 'ag1', status: 'running' }] })

  await $.session.measure(measure(10))
  expect(status.at(-1)).toBe('Budget 50% · week 10% Fable 40%')
  await spawn($, 'pacing:reader')
  expect(seen.toasts).toEqual(['Pacing: reader started on Haiku 5.5; 1 agent running.'])
  expect(status.at(-1)).toBe('⏳ reader 0s · Budget 50%')
  // it refreshes while it runs
  await clock.advance(3 * 60000)
  expect(status.at(-1)).toBe('⏳ reader 3m · Budget 50%')
  await $.turn.complete(turn('claude-haiku-5-5', 1, 'ag1'))
  expect(seen.toasts.at(-1)).toMatch(/^Pacing: reader done in 3m, \d+k tokens; no agents running now\.$/)
  // the plain line again, the agent's spend in its tier split
  expect(status.at(-1)).toBe('Budget 50% · 🟤T4 100% · week 10% Fable 40%')
})

test('several agents: the count leads; a progress toast every 5 minutes and no more often; the count falls as each ends', async ($, on) => {
  const status = engine(on)
  big(on)
  const clock = mock.clock(on, { now: T0 })
  const live = new Set(['ag1', 'ag2'])
  const seen = agentEngine(on, { list: () => [...live].map(id => ({ id, status: 'running' })) })

  await $.session.measure(measure(10))
  await spawn($, 'pacing:reader')
  await clock.advance(40 * 1000)
  await spawn($, 'pacing:implementer', 'opus')
  expect(seen.toasts.at(-1)).toBe('Pacing: implementer started on Opus 5.5; 2 agents running.')
  expect(status.at(-1)).toBe('⏳ 2 agents 40s · Budget 50%')

  await clock.advance(4 * 60000)
  expect(seen.toasts.filter(t => t.includes('still working'))).toEqual([])
  await clock.advance(30 * 1000)
  expect(seen.toasts.filter(t => t.includes('still working'))).toEqual(['Pacing: 2 agents still working: reader 5m, implementer 4m.'])
  // not again before another 5 minutes
  await clock.advance(4 * 60000)
  expect(seen.toasts.filter(t => t.includes('still working')).length).toBe(1)
  await clock.advance(60 * 1000)
  expect(seen.toasts.filter(t => t.includes('still working')).length).toBe(2)

  live.delete('ag1')
  await $.turn.complete(turn('claude-haiku-5-5', 1, 'ag1'))
  expect(seen.toasts.at(-1)).toMatch(/^Pacing: reader done in 10m, \d+k tokens; 1 agent still running\.$/)
  expect(status.at(-1)).toBe('⏳ implementer 10m · Budget 50%')
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
  expect(status.at(-1)).toMatch(/^⏳ general 0s · Budget 50%/)
  // the engine lists the background one as done: gone at the next refresh
  live.clear()
  await clock.advance(30 * 1000)
  expect(status.at(-1)).toMatch(/^Budget 50% · .*week 10% Fable 40%$/)

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
  expect(texts).toEqual(['This session is 320k tokens. Compacting now makes every later turn cheaper.', '⏳ 1 agent still working in the background: researcher 2m'])
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
  expect(status.at(-1)).toBe('⏳ reader 0s · Budget 50%')
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
  expect(status.at(-1)).toMatch(/^Budget 50% · .*week 10% Fable 40%$/)
})

// the whole line within LINE_MAX while agents run, at every level and length
const A = (type: string, mins: number, model = 'claude-haiku-5-5', effort?: string) => ({ id: type + mins, type, model, effort, startedAt: T0 - mins * 60000, background: false })
const LONGEST_MIX = [1, 2, 3, 4, 5, 6, 7, 8].map(tier => ({ tier, share: 12 })).concat([{ tier: 'Other' as any, share: 4 }])
const FAR = { all: 100, line: 46.7, ofBudget: 214, level: 'throttle', premium: 100, premiumLabel: 'Fable 5.2', premiumAt: null }
const SETS = {
  one: [A('pacing:reader', 3, 'claude-haiku-5-5', 'medium')],
  two: [A('pacing:reader', 3), A('pacing:implementer', 1, 'claude-opus-5-5', 'high')],
  six: [A('general-purpose', 12), A('someplugin:very-long-agent-name', 9), A('pacing:implementer', 7), A('pacing:verifier', 5), A('Explore', 3), A('pacing:researcher', 1)],
}

test('with 1, 2 and 6 agents, long names, far over budget and the longest split: the line fits and holds the count and the level', async () => {
  let longest = ''
  for (const [name, list] of Object.entries(SETS)) {
    for (const [j, self] of [[FAR, null], [FAR, 'Other'], [{ ...FAR, level: 'stop', ofBudget: 999 }, 'Other'], [{ ...FAR, level: 'ahead', ofBudget: 77 }, 1]] as const) {
      const s = statusText(j as any, LONGEST_MIX, self as any, T0, list as any)
      if (chars(s) > chars(longest)) longest = s
      expect(chars(s)).toBeLessThanOrEqual(LINE_MAX)
      expect(s.startsWith('⏳') || s.includes(' · ⏳')).toBe(true)
      if (list.length > 1) expect(s).toMatch(new RegExp('⏳ ?' + list.length))
      expect(s).toContain('Budget ' + j.ofBudget + '%')
    }
  }
  expect(LINE_MAX).toBe(33)
  expect(chars(longest)).toBeLessThanOrEqual(33)
  // the steps, widest room first
  expect(agentPart(SETS.two as any, T0, 80)).toBe('⏳ 2 agents · reader 3m · implementer 1m')
  expect(agentPart(SETS.two as any, T0, 34)).toBe('⏳ 2 agents · reader · implementer')
  expect(agentPart(SETS.six as any, T0, 15)).toBe('⏳ 6 agents 12m')
  expect(agentPart(SETS.six as any, T0, 10)).toBe('⏳ 6 agents')
  expect(agentPart(SETS.six as any, T0, 3)).toBe('⏳6')
  expect(agentPart(SETS.one as any, T0, 80)).toBe('⏳ reader 3m (Haiku 5.5 medium)')
  expect(roleOf('general-purpose')).toBe('general')
  expect(roleOf('someplugin:very-long-agent-name')).toBe('very-long-a…')
})

test('the toasts and the row are one line each, within MSG_MAX, however many run', async () => {
  const six = SETS.six as any
  const msgs = [startedText(six[1], 6), doneText(six[1], 9 * 60000, 123456, 5), progressText(six, T0), backgroundText(six, T0), backgroundText(six, T0, 40)]
  for (const m of msgs) {
    expect(chars(m)).toBeLessThanOrEqual(MSG_MAX)
    expect(m).not.toContain('\n')
  }
  expect(progressText(six, T0)).toBe('Pacing: 6 agents still working, the longest for 12m.')
  expect(progressText(SETS.two as any, T0)).toBe('Pacing: 2 agents still working: reader 3m, implementer 1m.')
  expect(startedText(SETS.one[0] as any, 1)).toBe('Pacing: reader started on Haiku 5.5 medium; 1 agent running.')
  expect(backgroundText(six, T0, 40)).toBe('⏳ 6 agents still working, 12m')
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
const withRuns = (list: any[], runs = HISTORY['pacing:reader']) => list.map(a => ({ ...a, runs, step: 'searching' }))

test('with an estimate the line stays within 33 for 1, 2 and 6 agents; the estimate takes the time\'s place, and goes before the count or the level', async () => {
  for (const [name, list] of Object.entries(SETS)) {
    for (const j of [FAR, { ...FAR, level: 'ahead', ofBudget: 77 }, { ...FAR, level: 'stop', ofBudget: 999 }]) {
      const s = statusText(j as any, LONGEST_MIX, null, T0, withRuns(list as any))
      expect(chars(s)).toBeLessThanOrEqual(LINE_MAX)
      if (list.length > 1) expect(s).toMatch(new RegExp('⏳ ?' + list.length))
      expect(s).toContain('Budget ' + j.ofBudget + '%')
    }
  }
  const one = withRuns(SETS.one as any)
  expect(statusText({ ...FAR, level: 'ahead', ofBudget: 77 } as any, [], null, T0, one)).toBe('⏳ reader 3m ~60% · Budget 77%')
  expect(agentPart(one, T0, 80)).toBe('⏳ reader 3m ~60% (Haiku 5.5 medium)')
  expect(agentPart(one, T0, 16)).toBe('⏳ reader 3m ~60%')
  expect(agentPart(one, T0, 13)).toBe('⏳ reader ~60%')
  expect(agentPart(one, T0, 9)).toBe('⏳ reader')
  expect(agentPart(withRuns(SETS.two as any), T0, 80)).toBe('⏳ 2 agents · reader 3m ~60% · implementer 1m ~20%')
  expect(agentPart(withRuns(SETS.two as any), T0, 44)).toBe('⏳ 2 agents · reader ~60% · implementer ~20%')
  // a type without history has none
  expect(agentPart(withRuns(SETS.one as any, []), T0, 80)).toBe('⏳ reader 3m (Haiku 5.5 medium)')
})

test('the full detail, with the step, in the 5-minute toast and the row, each one line within MSG_MAX', async () => {
  const two = withRuns(SETS.two as any)
  expect(progressText(two, T0)).toBe('Pacing: 2 agents still working: reader 3m ~60%, implementer 1m ~20%.')
  // too long with the steps: they go first
  expect(chars(progressText(two, T0))).toBeLessThanOrEqual(MSG_MAX)
  expect(backgroundText(withRuns(SETS.one as any), T0)).toBe('⏳ 1 agent still working in the background: reader 3m ~60% searching')
  for (const m of [progressText(withRuns(SETS.six as any), T0), backgroundText(withRuns(SETS.six as any), T0), backgroundText(two, T0, 50)]) {
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
  expect(status.at(-1)).toBe('⏳ reader 3m ~60% · Budget 50%')
  await $.tool.call({ tool: 'Grep', pattern: 'x', agentId: 'ag1' } as any)
  await clock.advance(2 * 60000)
  // capped at 95 % at the median and past it, the step in the toast
  expect(seen.toasts.at(-1)).toBe('Pacing: 1 agent still working: reader 5m ~95% searching.')
  expect(status.at(-1)).toBe('⏳ reader 5m ~95% · Budget 50%')
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
  expect(status.at(-1)).toBe('⏳ reader 3m · Budget 50%')
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
  expect((await ui.find({ type: 'Text' }))?.text).toBe('Fable 5.2 is out until the reset. Switch this session to Opus 5.5 high.')
  await ui.press({ key: 'pacing-switch' })
  await ui.unmount()
  expect(seen.runs).toEqual(['/model claude-opus-5-5', '/effort high'])
  expect(seen.toasts.at(-1)).toBe('Pacing: this session now runs on Opus 5.5 high.')
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
  expect((await ui.find({ type: 'Text' }))?.text).toBe('This week\'s budget suggests Opus 5.5 medium for this session.')
  await ui.press({ key: 'pacing-switch-not-now' })
  await ui.unmount()
  await $.turn.complete(turn('claude-fable-5-2', 1))
  expect(await switchText($)).toBe(undefined)
  // a new recommendation is a new suggestion
  next = switchReading({ premiumHeld: true, recommend: REC_OPUS_HIGH })
  await clock.advance(31 * 60000)
  await $.session.measure(measure(10))
  await $.turn.complete(turn('claude-fable-5-2', 1))
  expect(await switchText($)).toBe('Fable 5.2\'s own meter is over its line. Switch to Opus 5.5 high; Fable stays for hard tasks.')
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
  expect(seen.toasts.at(-1)).toBe('Pacing: press Enter to switch to Opus 5.5; then set effort high in the model menu.')
  expect(switchedText(REC_OPUS_HIGH, 'claude-fable-5-2', 'high')).toBe('Pacing: the switch did not take; the session still runs on Fable 5.2. The model menu does it: Opus 5.5, effort high.')
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
  expect(await switchText($)).toMatch(/^Fable 5\.2 is out until the reset/)
  // a calm one waits behind the offer to compact
  next = switchReading({ recommend: { model: 'claude-opus-5-5', label: 'Opus 5.5', effort: 'medium' } })
  await clock.advance(31 * 60000)
  await $.session.measure(measure(10, [], 330000))
  await $.turn.complete(turn('claude-fable-5-2', 1))
  expect(await switchText($)).toBe('This session is 320k tokens. Compacting now makes every later turn cheaper.')
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
