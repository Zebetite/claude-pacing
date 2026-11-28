// The hooks module under the engine's own test kit: `claude plugin test` on
// the plugin folder. The hooks here stand for the engine: they answer the
// module's $.process.run with what budget.mjs --source hook prints, and catch
// the status line it sets. budget.mjs itself is tested under tests/ with
// node --test.
import { expect, mock, test } from 'claude-code/testing'
import { OUT_FILL, stepsSvg, stepsText, STEPS_MAX, STEPS_H, DIALS, FRAMES, frameSvg, barSvg, overShade, overText, OVER_CALM, OVER_RED, ORANGE, YELLOW, HUD, breakable, BREAK_AT, PREM_CALM, PREM_YELLOW, PREM_RED, premShade, premText, LEVEL_COLORS, barText, robotSvg, reactorSvg, rulerSvg, drawingId, builtCount, buildsDone, MEMO_MAX, phased, phaseOf, DIAL_SIZE, paneView, AUTO_COMPACT_OWN_LABEL } from './pane.mjs'
import { pauseNote, pauseDue, unattended, statusText, fullText, HEAD_MAX, levelPhrase, offerText, nowText, COMPACT_INSTRUCTIONS, LINE_MAX, LINE_MAX_NARROW, lineMaxOf, READ_BACK_LAG, commandFailed, spentOf, recordArgv, MSG_MAX, TASK_MAX, agentPart, roleOf, startedText, doneText, progressText, backgroundText, estimateOf, median, keepRuns, RUNS_KEPT, stepOf, switchOffer, switchedText, countText, sessionRows, workingSessions, versionOf, reloadText, RELOADED, RELOAD_CHECK_EVERY, RELOAD_AFTER_TURN, usageOf, USAGE_TOOL, roleFor, shortModel, freshOf, freshNote, usageText, measureWhy, partOf, partText, ICON, TOAST_LONG, levelIcon, sessionStartedText, sessionDoneText, compactedText, compactFailedText, sharedOf, SHARED_EVERY, liveLeft, timeText, budgetWords, costText, SWITCH_LARGE, COMPACT_DROP, compactedBetween, contextLines, PANE_ID, PANE_CLOSED, closedByPerson, paneModel, PANE_TITLE, RUN_WAIT, COMPACT_WAIT_TEXT, COMPACT_RUN_WAIT, FAIL_SAY, failedText, staleLine, FAILED_NOTE, PRUNED, AGENT_GAP, switchWaitText, leftOf, leftText, usualText, budgetText, tokensText, spentUsd, CONFIG_FRESH, textsOf, taskStarted, taskEnded, taskRows, TASK_DONE_FOR, PANE_COMPACT_AT, FIVE_HOLD, levelToastText, levelStepText, levelToastDue, HELD_SWITCH_AT, viewDeniedText, SESSIONS_TOOL, AUTO_COMPACT_DEFAULT, AUTO_COMPACT_STEP, AUTO_COMPACT_LAST, AUTO_COMPACT_OWN_NOTE, AUTO_COMPACT_OFF_TEXT, autoCompactLastOf, autoCompactOf, autoCompactFailedText, AUTO_COMPACT_BUFFER, autoCompactBuffer, autoCompactWindow, autoCompactHas, stepBarOf, modelArrow, modelIdOf, outLine, commandWhat, reportLines, finishedText, OUT_LINES, OUT_CHARS, OUT_SHOWN, OUT_MAIN, OUT_MAIN_CHARS, doneLine, finishedOut, changedLine, changedFile, runKind, runLine, noteMeaning, meaningOf } from './readings.mjs'

const RESET = '2026-11-19T12:00:00.000Z'
const PRICES = {
  'claude-fable-5-2': [8, 40, 0.2, 10],
  'claude-opus-5-5': [4, 20, 0.2, 5],
  'claude-sonnet-5-5': [2, 10, 0.1, 2.5],
  'claude-haiku-5-5': [0.1, 0.5, 0.01, 0.125],
}
// the default ladder: Fable, Opus, Sonnet; the reader on Haiku after it
const TIER_OF = { 'claude-fable-5-2': 1, 'claude-opus-5-5': 2, 'claude-sonnet-5-5': 3, 'claude-haiku-5-5': 4 }
// each place by name, as budget.mjs sends them for /pacing-status
const TIER_NAMES = { 1: 'Fable 5.2 high', 2: 'Opus 5.5 medium', 3: 'Sonnet 5.5 medium', 4: 'Haiku 5.5 medium' }

const measure = (pct: number, more: { kind: string; percentUsed: number; resetsAt?: string }[] = [], tokens = 50000) => ({
  context: { window: 1000000, tokens, percent: Math.round(tokens / 10000) },
  rateLimits: [{ kind: 'seven_day', percentUsed: pct, resetsAt: RESET }, ...more],
  changed: ['rateLimits' as const],
})
// `rate`: the tokens per point budget.mjs learned (none: the left shows in points)
const answer = (level: string, all: number, extra: Record<string, unknown> = {}) => ({
  exitCode: 0,
  stdout: JSON.stringify({ level, all, line: 20, ofBudget: Math.round(100 * all / 20),
    tokensPerPoint: typeof extra.rate === 'number' ? extra.rate : null,
    left: { points: Math.round((20 - all) * 10) / 10, tokens: typeof extra.rate === 'number' ? Math.round((20 - all) * extra.rate) : null },
    tierOf: TIER_OF, tierNames: TIER_NAMES, prices: PRICES, premium: 40,
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

// the tier split, now only in /pacing-status's long form, each tier by its model
const split = async ($: any) => (await $.command.run({ command: 'pacing-status', args: '' } as any)).text.split('\n')[0].replace(/^Pacing: /, '').split(', ')
  .find((p: string) => /^[🟡⚪🟠🟤🟣🔴🔵🟢⚫]/u.test(p) && !p.includes('side session')) || ''

test('the status line: what is left of the budget and the usage, no tiers; the tier split in /pacing-status', async ($, on) => {
  const status = engine(on)
  on('process.run', () => ({ value: answer('ahead', 15.4) }))

  await $.session.measure(measure(15.4))
  expect(status.at(-1)).toBe('Budget: 5% · usage: Weekly 15% Fable 40%')

  await $.turn.complete(turn('claude-fable-5-2', 8))
  await $.turn.complete(turn('claude-opus-5-5', 1.5, 'a1'))
  await $.turn.complete(turn('claude-haiku-5-5', 0.5, 'a2'))
  // no new reading is due (the meter did not move): the line is redrawn all the same
  await $.session.measure(measure(15.4))
  expect(status.at(-1)).toBe('Budget: 5% · usage: Weekly 15% Fable 40%')
  expect(status.at(-1)).not.toMatch(/T\d|Tier/)
  expect(await split($)).toBe('🟡Fable 5.2 high 80% ⚪Opus 5.5 medium 15% 🟤Haiku 5.5 medium 5%')
})

test('a priced model off the ladder is Other, one with no price is left out; a long ladder takes more colours', async ($, on) => {
  const status = engine(on)
  on('process.run', () => ({ value: answer('on pace', 18, { tierOf: { 'claude-fable-5-2': 1, 'claude-sonnet-5-5': 3, 'claude-haiku-5-5': 5 }, premium: null }) }))

  await $.turn.complete(turn('claude-sonnet-5-5', 3))
  await $.turn.complete(turn('claude-haiku-5-5', 0.5))
  await $.turn.complete(turn('claude-opus-5-5', 0.5))
  await $.turn.complete({ ...turn('claude-sonnet-5-5', 1), usage: { model: 'claude-opus-4-8', input_tokens: 0, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } })
  await $.session.measure(measure(18))
  expect(status.at(-1)).toBe('Budget: 2% · usage: Weekly 18%')
  // a place budget.mjs gave no name (an older one): the model alone, by tierOf
  expect(await split($)).toBe('🟠Sonnet 5.5 medium 75% 🟣Haiku 5.5 13% ⚫Other 12%')
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
  const shares = [...line.matchAll(/ (\d+)%/g)].map(m => Number(m[1]))
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

test('a level that gets worse to stop is one toast with the level words; a little over is none; the line says what is left alone', async ($, on) => {
  const status = engine(on)
  const toasts: string[] = []
  let next = answer('on pace', 18)
  on('process.run', () => ({ value: next }))
  on('ui.toast', (_, e) => (toasts.push(e.text), { value: undefined }))

  await $.session.measure(measure(18))
  expect(toasts).toEqual([])
  // just over: the pane says it, no toast
  next = answer('over', 21, { do: 'medium tasks leave the session\'s model too' })
  await $.session.measure(measure(21))
  expect(toasts).toEqual([])
  next = answer('stop', 96)
  await $.session.measure(measure(96))
  expect(toasts).toEqual(['🔴 over budget -> stop. Wrap up: the week is nearly used.'])
  expect(status.at(-1)).toBe('Budget: -76% · usage: Weekly 96% Fable 40%')
})

test('what is left in tokens: K, M from a million, the sign in front, 0K under a thousand', () => {
  expect(tokensText(850000)).toBe('850K')
  expect(tokensText(1234567)).toBe('1.2M')
  expect(tokensText(999400)).toBe('999K')
  expect(tokensText(-120000)).toBe('-120K')
  expect(tokensText(-2460000)).toBe('-2.5M')
  expect(tokensText(999)).toBe('0K')
  expect(tokensText(-400)).toBe('0K')
  expect(tokensText(0)).toBe('0K')
  expect(budgetText({ line: 20, all: 10, left: { points: 10, tokens: 850000 } })).toBe('Budget tokens: 850K')
  expect(budgetText({ line: 20, all: 21.5, left: { points: -1.5, tokens: -120000 } })).toBe('Budget tokens: -120K')
  expect(budgetText({ line: 20, all: 20, left: { points: 0, tokens: 0 } })).toBe('Budget tokens: 0K')
  // an estimate from this week's transcripts, before a rate is learned
  expect(budgetText({ line: 60, all: 38, rateFrom: 'estimate', left: { points: 22, tokens: 36100000 } })).toBe('Budget tokens: ~36.1M')
  expect(budgetText({ line: 60, all: 38, rateFrom: 'early', left: { points: 22, tokens: 36100000 } })).toBe('Budget tokens: 36.1M')
})

test('until a rate is learned, the points of the week; a dash only with no figure at all', () => {
  expect(budgetText({ line: 20, all: 15.4, left: { points: 4.6, tokens: null } })).toBe('Budget: 5%')
  expect(budgetText({ line: 20, all: 26, left: { points: -6, tokens: null } })).toBe('Budget: -6%')
  expect(budgetText({ line: 20, all: 20.3, left: { points: -0.3, tokens: null } })).toBe('Budget: 0%')
  // a reading without `left`: from the line and the meter
  expect(budgetText({ line: 46.7, all: 40 })).toBe('Budget: 7%')
  expect(budgetText({})).toBe('Budget: -')
  expect(budgetText(null)).toBe('Budget: -')
})

test('the status line in tokens once budget.mjs has a rate, negative past the line', async ($, on) => {
  const status = engine(on)
  let next = answer('ahead', 10, { rate: 85000 })
  on('process.run', () => ({ value: next }))
  await $.session.measure(measure(10))
  expect(status.at(-1)).toBe('Budget tokens: 850K · usage: Weekly 10% Fable 40%')
  next = answer('throttle', 26, { rate: 85000 })
  await $.session.measure(measure(26))
  expect(status.at(-1)).toBe('Budget tokens: -510K · usage: Weekly 26% Fable 40%')
})

test('with a pace, what is left reads as time: 5 minutes under an hour, 10 from there, whole hours from 10, over past the line', () => {
  expect(timeText(0.74)).toBe('45m')
  expect(timeText(0.02)).toBe('0m')
  expect(timeText(0.99)).toBe('1h')
  expect(timeText(2.17)).toBe('2h 10m')
  expect(timeText(3.02)).toBe('3h')
  expect(timeText(9.99)).toBe('10h')
  expect(timeText(12.4)).toBe('12h')
  expect(timeText(30)).toBe('24h+')
  expect(timeText(-0.66)).toBe('40m')
  // 850K tokens at $8 a million are $6.80: at $3.40 an hour, two hours
  const j = { line: 20, all: 10, left: { points: 10, tokens: 850000 }, tokenUsd: 8e-6, paceUsd: 3.4 }
  expect(budgetText(j)).toBe('Budget: 2h left')
  expect(budgetText({ ...j, rateFrom: 'estimate' })).toBe('Budget: ~2h left')
  expect(budgetText({ ...j, left: { points: -2, tokens: -170000 } })).toBe('Budget: 25m over')
  expect(budgetText({ ...j, left: { points: 0, tokens: -100 } })).toBe('Budget: 0m left')
  // /pacing-status: the tokens and the pace behind it
  expect(budgetWords(j)).toBe('Budget: 2h left (850K tokens, at $3.40 an hour)')
  // no pace yet, or an older budget.mjs: the tokens, as before
  expect(budgetText({ ...j, paceUsd: undefined })).toBe('Budget tokens: 850K')
  expect(budgetWords({ ...j, paceUsd: undefined })).toBe('Budget tokens: 850K')
  expect(budgetText({ line: 20, all: 15.4, left: { points: 4.6, tokens: null }, paceUsd: 3.4, tokenUsd: 8e-6 })).toBe('Budget: 5%')
  // a cost in the line's unit
  expect(costText(j, 1.7)).toBe('30m')
  expect(costText({ tokenUsd: 8e-6 }, 2)).toBe('250K tokens')
  expect(costText({}, 2)).toBe('')
  expect(costText(j, 0)).toBe('')
})

test('in a session: the status line in time, falling with the session\'s turns; /pacing-status adds the tokens and what goes unused', async ($, on) => {
  const status = engine(on)
  const toasts: string[] = []
  on('ui.toast', (_: unknown, e: any) => (toasts.push(e.text), { value: undefined }))
  // 85000 tokens a point at $10 a million; $1.70 an hour
  on('process.run', () => ({ value: answer('ahead', 10, { rate: 85000, tokenUsd: 1e-5, paceUsd: 1.7, unused: 18, reset: RESET }) }))
  await $.session.measure(measure(10))
  expect(status.at(-1)).toBe('Budget: 5h left · usage: Weekly 10% Fable 40%')
  // $0.85 of the session's own: half an hour
  await $.turn.complete(turn('claude-fable-5-2', 0.85))
  expect(status.at(-1)).toBe('Budget: 4h 30m left · usage: Weekly 10% Fable 40%')
  const r = await $.command.run({ command: 'pacing-status' } as any)
  expect(r.text).toContain('Budget: 4h 30m left (765K tokens, at $1.70 an hour)')
  expect(r.text).toContain('\nUnused: at this pace about 18% of the week goes unused at the reset; it does not carry over.')
})

test('what goes unused at the reset is no toast at any step or week: the pane and /pacing-status say it', async ($, on) => {
  engine(on)
  const toasts: string[] = []
  on('ui.toast', (_: unknown, e: any) => (toasts.push(e.text), { value: undefined }))
  storeEngine(on)
  const said = () => new Promise(r => setTimeout(r, 30))
  let next = answer('ahead', 10, { unused: 9, reset: RESET })
  on('process.run', () => ({ value: next }))
  await $.session.measure(measure(10))
  next = answer('ahead', 11, { unused: 18, reset: RESET })
  await $.session.measure(measure(11))
  next = answer('ahead', 14, { unused: 31, reset: RESET })
  await $.session.measure(measure(14))
  next = answer('ahead', 2, { unused: 12, reset: '2026-11-26T12:00:00.000Z' })
  await $.session.measure(measure(2))
  await said()
  expect(toasts).toEqual([])
  const r = await $.command.run({ command: 'pacing-status' } as any)
  expect(r.text).toContain('\nUnused: at this pace about 12% of the week goes unused at the reset; it does not carry over.')
})

test('between readings the session\'s own turns come off Budget tokens, at the reading\'s full-price token; the next reading starts over', async ($, on) => {
  const status = engine(on)
  let next = answer('ahead', 10, { rate: 85000, tokenUsd: 1e-5 })
  on('process.run', () => ({ value: next }))
  await $.session.measure(measure(10))
  expect(status.at(-1)).toBe('Budget tokens: 850K · usage: Weekly 10% Fable 40%')
  // $0.50 at $10 a million: 50K
  await $.turn.complete(turn('claude-fable-5-2', 0.5))
  expect(status.at(-1)).toBe('Budget tokens: 800K · usage: Weekly 10% Fable 40%')
  await $.turn.complete(turn('claude-fable-5-2', 0.25))
  expect(status.at(-1)).toBe('Budget tokens: 775K · usage: Weekly 10% Fable 40%')
  // the meter moved: budget.mjs's figure, which counts those turns, from here
  next = answer('ahead', 11, { rate: 85000, tokenUsd: 1e-5 })
  await $.session.measure(measure(11))
  expect(status.at(-1)).toBe('Budget tokens: 765K · usage: Weekly 11% Fable 40%')
  expect(liveLeft({ left: { points: 1, tokens: 100000 }, tokenUsd: 1e-5 }, 0.2)).toEqual({ left: { points: 1, tokens: 80000 }, tokenUsd: 1e-5 })
  // no full-price token (an older budget.mjs), no figure, nothing spent: as it stands
  const j = { left: { points: 1, tokens: 100000 } }
  expect(liveLeft(j, 0.2)).toBe(j)
  expect(liveLeft({ left: { points: 1, tokens: null }, tokenUsd: 1e-5 }, 0.2).left.tokens).toBe(null)
  expect(liveLeft(null, 0.2)).toBe(null)
})

test('every minute the status line takes the newest shared reading another session wrote; an older one changes nothing', async ($, on) => {
  const status = engine(on)
  const clock = mock.clock(on, { now: T0 })
  let shared = ''
  on('env.get', (_: unknown, e: any) => ({ value: e.name === 'USERPROFILE' ? '/home/test' : undefined }))
  on('fs.read', (_: unknown, e: any) => ({ value: /[\\/]\.claude[\\/]pacing[\\/]line\.json$/.test(String(e.path)) ? shared : '{}' }))
  on('process.run', () => ({ value: answer('ahead', 10, { rate: 85000, t: '2026-11-13T10:00:00.000Z' }) }))
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true } as any)
  await $.session.measure(measure(10))
  expect(status.at(-1)).toBe('Budget tokens: 850K · usage: Weekly 10% Fable 40%')
  // another session's reading, newer: taken at the next minute
  shared = JSON.stringify({ t: '2026-11-13T10:05:00.000Z', all: 12, line: 20, ofBudget: 60, usdPerPoint: 1, rateFrom: 'week', left: { points: 8, tokens: 680000 }, premium: 41, premiumAt: null, premiumOut: false })
  await clock.advance(SHARED_EVERY + 1000)
  expect(status.at(-1)).toBe('Budget tokens: 680K · usage: Weekly 12% Fable 41%')
  // an older one, or one without the per-model figure, leaves what is held
  const n = status.length
  shared = JSON.stringify({ t: '2026-11-13T09:00:00.000Z', all: 30, line: 20, left: { points: -10, tokens: -850000 }, premium: 50 })
  await clock.advance(SHARED_EVERY)
  expect(status.length).toBe(n)
  expect(sharedOf(JSON.stringify({ t: '2026-11-13T11:00:00.000Z', all: 13, line: 20, premium: null, premiumAt: null, level: 'over' }))).toEqual({ t: '2026-11-13T11:00:00.000Z', all: 13, line: 20 })
  expect(sharedOf('not json')).toBe(null)
  expect(sharedOf('{"all": 1, "line": 2}')).toBe(null)
})

test('--spent-usd: every dollar of the session and its agents since the last reading that ran; a failed run keeps them for the next', async ($, on) => {
  engine(on)
  const runs: string[][] = []
  let fail = false
  on('process.run', (_, e) => (runs.push([...e.argv]), { value: fail ? { ...answer('ahead', 10), exitCode: 1, stdout: 'bad input' } : answer('ahead', 10) }))
  const usdOf = (argv: string[]) => (argv.includes('--spent-usd') ? argv[argv.indexOf('--spent-usd') + 1] : null)

  // a turn before the first reading: no prices yet, so no flag; it goes with the next
  await $.turn.complete(turn('claude-fable-5-2', 0.5))
  await $.session.measure(measure(10))
  expect(usdOf(runs[0])).toBe(null)
  // $1 of Fable output, $1 of Opus output (a subagent's)
  await $.turn.complete(turn('claude-fable-5-2', 1))
  await $.turn.complete(turn('claude-opus-5-5', 1, 'a1'))
  await $.session.measure(measure(11))
  expect(usdOf(runs[1])).toBe('2.5')
  // the raw count is gone
  expect(runs[1]).not.toContain('--spent')
  // a run that failed: its dollars go with the next one
  await $.turn.complete(turn('claude-fable-5-2', 0.4))
  fail = true
  await $.session.measure(measure(12))
  expect(usdOf(runs[2])).toBe('0.4')
  fail = false
  await $.turn.complete(turn('claude-fable-5-2', 0.4))
  await $.session.measure(measure(13))
  expect(usdOf(runs[3])).toBe('0.8')
  // and nothing twice
  await $.session.measure(measure(14))
  expect(usdOf(runs[4])).toBe(null)
})

test('--spent-usd prices cache reads at their own price; a model with no price counts at the session model\'s', async ($, on) => {
  engine(on)
  const runs: string[][] = []
  on('process.run', (_, e) => (runs.push([...e.argv]), { value: answer('ahead', 10) }))
  const usdOf = (argv: string[]) => (argv.includes('--spent-usd') ? argv[argv.indexOf('--spent-usd') + 1] : null)
  await $.session.measure(measure(10))
  // a long session's turn on Opus 5.5: 400K cache read, 5K input, 2K output
  // is 407K tokens, but $0.08 + $0.02 + $0.04 = $0.14
  await $.turn.complete({ ...turn('claude-opus-5-5', 0), usage: { model: 'claude-opus-5-5', input_tokens: 5000, output_tokens: 2000, cache_read_input_tokens: 400000, cache_creation_input_tokens: 0 } })
  await $.session.measure(measure(11))
  expect(usdOf(runs[1])).toBe('0.14')
  // a subagent on a model the prices do not know: at Opus 5.5's, the session's
  await $.turn.complete({ ...turn('claude-opus-5-5', 0, 'a1'), usage: { model: 'claude-opus-4-8', input_tokens: 0, output_tokens: 1000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } })
  await $.session.measure(measure(12))
  expect(usdOf(runs[2])).toBe('0.02')
})

test('spentUsd: each model at its prices, input, output, cache read and cache write', () => {
  const tokens = { 'claude-opus-5-5': { in: 5000, out: 2000, read: 400000, write: 10000 } }
  const agents = { 'claude-haiku-5-5-20261101': { in: 1e6, out: 1e6, read: 1e6, write: 1e6 } }
  // 0.02 + 0.04 + 0.08 + 0.05, and Haiku 5.5's 0.1 + 0.5 + 0.01 + 0.125
  const cents = (usd: number) => Math.round(usd * 1e6) / 1e6
  expect(cents(spentUsd(tokens, agents, PRICES, 'claude-opus-5-5'))).toBe(0.925)
  // an unknown model at the session's prices; with no session priced, left out
  const odd = { 'claude-mystery-1': { in: 0, out: 1000, read: 0, write: 0 } }
  expect(cents(spentUsd(odd, {}, PRICES, 'claude-fable-5-2'))).toBe(0.04)
  expect(spentUsd(odd, {}, PRICES, null)).toBe(0)
  expect(spentUsd(odd, {}, PRICES, 'claude-mystery-1')).toBe(0)
  // no prices yet (no reading): nothing
  expect(spentUsd(tokens, {}, undefined as any, 'claude-opus-5-5')).toBe(0)
})

test('the width with the longer budget text: the budget and the usage whole, the agents\' count in what is left', () => {
  const now = Date.parse('2026-11-16T12:00:00.000Z')
  const wide = { all: 100, line: 46.7, level: 'throttle', premium: 100, premiumLabel: 'Fable 5.2', premiumAt: null, left: { points: -53.3, tokens: -12345678 } }
  const two = [
    { id: 'i', type: 'pacing:implementer', model: 'claude-opus-5-5', startedAt: now - 120000, step: 'editing' },
    { id: 'r', type: 'pacing:reader', model: 'claude-haiku-5-5', startedAt: now - 180000, step: 'searching' },
  ]
  for (const list of [two.slice(0, 1), two]) {
    for (const self of [null, 'Other']) {
      const s = statusText(wide as any, [], self as any, now, list as any)
      expect(chars(s)).toBeLessThanOrEqual(LINE_MAX)
      expect(s).toContain(' · Budget tokens: -12.3M')
    }
  }
  expect(statusText(wide as any, [], null, now, two as any)).toBe('⏳ 2 Subagents · Budget tokens: -12.3M · usage: Weekly 100% Fable 100%')
  expect(statusText(wide as any, [], null, now, two.slice(0, 1) as any)).toBe('⏳ 1 Subagent · Budget tokens: -12.3M · usage: Weekly 100% Fable 100%')
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
  expect(status.at(-1)).toBe('Budget: 10% · usage: Weekly 10% Fable 18%')
  next = answer('throttle', 11, { premium: 30, premiumAt: null, premiumLevel: 'throttle', levelBy: 'premium', premiumOfBudget: 150, do: 'most work leaves the session\'s model' })
  await $.session.measure(measure(11))
  // no "Fable over 150%": the per-model meter shows as its usage only
  expect(status.at(-1)).toBe('Budget: 9% · usage: Weekly 11% Fable 30%')
  expect(toasts).toEqual(['⚠️ under budget -> far over budget (Fable\'s meter). Most work goes to Opus 5.5 medium subagents.'])
})

test('the per-model meter\'s model held back at an unchanged level is no toast: the pane says it', async ($, on) => {
  engine(on)
  const toasts: string[] = []
  let next = answer('ahead', 10)
  on('process.run', () => ({ value: next }))
  on('ui.toast', (_, e) => (toasts.push(e.text), { value: undefined }))

  await $.session.measure(measure(10))
  next = answer('ahead', 11, { premium: 30, premiumHeld: true, premiumLevel: 'throttle', premiumOfBudget: 150, do: 'Fable 5.2\'s meter is at throttle: this session belongs on Opus 5.5 high now, and Fable 5.2 is kept for judgment work; the Switch row offers it. the session\'s model does nearly everything' })
  await $.session.measure(measure(11))
  next = answer('ahead', 12, { premium: 100, premiumOut: true, premiumLevel: 'stop', premiumOfBudget: 500, do: 'Fable 5.2 is out until the reset' })
  await $.session.measure(measure(12))
  expect(toasts).toEqual([])
})

test('a level toast is due only when the level gets worse to far over or stop, and not where the Switch row says it', () => {
  const was = { level: 'on pace' }
  const prem = { premiumModelId: 'claude-fable-5-2', premiumLabel: 'Fable 5.2', line: 70 }
  expect(levelToastDue(was, { level: 'over' })).toBe(false)
  expect(levelToastDue(was, { level: 'throttle' })).toBe(true)
  expect(levelToastDue(was, { level: 'stop' })).toBe(true)
  expect(levelToastDue({ level: 'stop' }, { level: 'throttle' })).toBe(false)
  expect(levelToastDue({ level: 'throttle' }, { level: 'throttle', premiumHeld: true })).toBe(false)
  // a reading taken at a load is no level the user was told of
  expect(levelToastDue({ level: 'on pace', fromLoad: true }, { level: 'stop' })).toBe(false)
  // on the model that is out, or held 20 points or more over its line: the Switch row
  expect(levelToastDue(was, { ...prem, level: 'throttle', premiumOut: true, premium: 100 }, 'claude-fable-5-2')).toBe(false)
  expect(levelToastDue(was, { ...prem, level: 'throttle', premiumHeld: true, premium: 90 }, 'claude-fable-5-2')).toBe(false)
  // held only 10 over: no row, so the toast
  expect(levelToastDue(was, { ...prem, level: 'throttle', premiumHeld: true, premium: 80 }, 'claude-fable-5-2')).toBe(true)
  // a session on another model: the toast
  expect(levelToastDue(was, { ...prem, level: 'throttle', premiumOut: true, premium: 100 }, 'claude-opus-5-5')).toBe(true)
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
  // the next pause at about the same size: told already, not again
  await $.turn.complete(turn('claude-fable-5-2', 1))
  await clock.advance(61 * 60000)
  await $.prompt.submit({ text: 'next', asUser: true })
  expect(order.filter(o => o.startsWith('toast')).length).toBe(1)
  // 250 000 tokens on, a pause is told again
  await $.session.measure(measure(10, [], 670000))
  await $.turn.complete(turn('claude-fable-5-2', 1))
  await clock.advance(62 * 60000)
  await $.prompt.submit({ text: 'later', asUser: true })
  expect(order.filter(o => o.startsWith('toast')).length).toBe(2)
  expect(order.at(-2)).toContain('670k tokens and sat idle 1 h 2 min')
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

test('a side session leads with sub, and shows the weekly meter only', async ($, on) => {
  const status = engine(on)
  on('process.run', () => ({ value: answer('ahead', 10, { spawned: true }) }))

  await $.turn.complete(turn('claude-opus-5-5', 9))
  await $.turn.complete(turn('claude-haiku-5-5', 1, 'a1'))
  await $.session.measure(measure(10))
  expect(status.at(-1)).toBe('sub · Budget: 10% · usage: Weekly 10%')
})

test('a side session shows no per-model meter, even when it set the level; a model off the ladder is Other', async ($, on) => {
  const status = engine(on)
  let next = answer('over', 11, { premium: 22, levelBy: 'premium', premiumOfBudget: 110, spawned: true })
  on('process.run', () => ({ value: next }))

  await $.turn.complete(turn('claude-fable-5-2', 1))
  await $.session.measure(measure(11))
  // no per-model meter in a side session: the weekly share alone, without the
  // level's word, since that meter set the level
  expect(status.at(-1)).toBe('sub · Budget: 9% · usage: Weekly 11%')
  next = answer('ahead', 12, { spawned: true })
  await $.turn.complete({ ...turn('claude-fable-5-2', 1), usage: { model: 'claude-opus-4-8', input_tokens: 0, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } })
  await $.session.measure(measure(12))
  expect(status.at(-1)).toBe('sub · Budget: 8% · usage: Weekly 12%')
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
  expect(status.at(-1)).toBe('Budget: 10% · usage: Weekly 10% Fable 40%')
  next = answer('ahead', 11, { spawned: null })
  await $.session.measure(measure(11))
  expect(status.at(-1)).toBe('Budget: 9% · usage: Weekly 11% Fable 40%')
  // an older budget.mjs says nothing of it
  next = answer('ahead', 12)
  await $.session.measure(measure(12))
  expect(status.at(-1)).toBe('Budget: 8% · usage: Weekly 12% Fable 40%')
})

test('a side session before its first turn ends takes the model it is set to', async ($, on) => {
  // the case reported: after a reload the session.measure calls of a turn
  // came before its end, and the line went out without Sub Agent
  const status = engine(on)
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('process.run', () => ({ value: answer('ahead', 10, { spawned: true }) }))

  await $.turn.complete(turn('claude-haiku-5-5', 1, 'a1'))
  await $.session.measure(measure(10))
  expect(status.at(-1)).toBe('sub · Budget: 10% · usage: Weekly 10%')
})

test('a side session whose model is not known yet is marked sub at once, and shows no per-model meter', async ($, on) => {
  const status = engine(on)
  on('session.model', () => ({ value: 'opus' }))
  on('process.run', () => ({ value: answer('ahead', 10, { spawned: true }) }))

  await $.turn.complete(turn('claude-opus-5-5', 1, 'a1'))
  await $.session.measure(measure(10))
  expect(status.at(-1)).toBe('sub · Budget: 10% · usage: Weekly 10%')
})

test('the line is redrawn when the main thread\'s turn ends', async ($, on) => {
  const status = engine(on)
  on('process.run', () => ({ value: answer('ahead', 10, { spawned: true }) }))

  await $.session.measure(measure(10))
  const before = status.length
  await $.turn.complete(turn('claude-opus-5-5', 1))
  expect(status.length).toBe(before + 1)
  expect(status.at(-1)).toBe('sub · Budget: 10% · usage: Weekly 10%')
  // a subagent's turn waits for the next measure
  await $.turn.complete(turn('claude-haiku-5-5', 1, 'a1'))
  expect(status.length).toBe(before + 1)
})

// ---- a carried per-model figure is not a current one ----

// the case reported: Fable read at 71 %, then unread for 15 hours while all
// models went from 45 to 49 %; the real meter stood at 90 %
const STALE = { premium: 71, premiumAt: '2026-11-15T01:00:00.000Z', premiumEstimate: 90, premiumLevel: 'throttle', premiumHeld: true, premiumOfBudget: 152,
  needFull: 'the Fable 5.2 figure is 15 h old', do: 'Fable 5.2\'s meter is at throttle: this session belongs on Opus 5.5 high now, and Fable 5.2 is kept for judgment work; the Switch row offers it. Medium tasks go to subagents too.' }
const AT_16 = Date.parse('2026-11-15T16:00:00.000Z')

test('a 15-hour-old carried figure: the line shows it plainly; /pacing-status gives its age and the estimate', async ($, on) => {
  const status = engine(on)
  const clock = mock.clock(on, { now: AT_16 })
  let next = answer('over', 49, STALE)
  on('process.run', () => ({ value: next }))
  const full = async () => (await $.command.run({ command: 'pacing-status', args: '' } as any)).text.split('\n')[0]

  await $.session.measure(measure(49))
  expect(status.at(-1)).toBe('Budget: -29% · usage: Weekly 49% Fable 71%')
  expect(status.at(-1)).not.toMatch(/old|est|\(/)
  expect(await full()).toContain('71% Fable 15h ago, est. 90%')
  await clock.advance(20 * 60000)
  await $.session.measure(measure(49))
  expect(status.at(-1)).toBe('Budget: -29% · usage: Weekly 49% Fable 71%')
  // no estimate to give: the age alone, in /pacing-status; under an hour in minutes, past two days in days
  next = answer('over', 50, { ...STALE, premiumEstimate: null, premiumAt: '2026-11-15T15:35:00.000Z' })
  await $.session.measure(measure(50))
  expect(status.at(-1)).toBe('Budget: -30% · usage: Weekly 50% Fable 71%')
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
  tierNames: { 1: 'Opus 5.5 high', 2: 'Opus 5.5 medium', 3: 'Sonnet 5.5 medium', 4: 'Haiku 5.5 medium' },
  agentTierOf: { 'claude-opus-5-5': 2, 'claude-sonnet-5-5': 3, 'claude-fable-5-2': 1, 'claude-haiku-5-5': 4 } }

test('the session on the fallback is tier 1; its subagents on the same model are tier 2', async ($, on) => {
  const status = engine(on)
  on('process.run', () => ({ value: answer('ahead', 10, { ...HELD_MAP, spawned: true }) }))

  await $.turn.complete(turn('claude-opus-5-5', 6))
  await $.turn.complete(turn('claude-opus-5-5', 3, 'a1'))
  await $.turn.complete(turn('claude-haiku-5-5', 1, 'a2'))
  await $.session.measure(measure(10))
  expect(status.at(-1)).toBe('sub · Budget: 10% · usage: Weekly 10%')
  expect(await split($)).toBe('🟡Opus 5.5 high 60% ⚪Opus 5.5 medium 30% 🟤Haiku 5.5 medium 10%')
})

test('an older budget.mjs without agentTierOf: every turn counts by tierOf, as before', async ($, on) => {
  const status = engine(on)
  on('process.run', () => ({ value: answer('ahead', 10) }))

  await $.turn.complete(turn('claude-fable-5-2', 8))
  await $.turn.complete(turn('claude-opus-5-5', 2, 'a1'))
  await $.session.measure(measure(10))
  expect(status.at(-1)).toBe('Budget: 10% · usage: Weekly 10% Fable 40%')
  expect(await split($)).toBe('🟡Fable 5.2 high 80% ⚪Opus 5.5 medium 20%')
})

// ---- the line fits the footer the desktop app gives it ----

// The app draws the line in the composer's footer, beside the model and mode
// pickers, and cuts the rest with an ellipsis: about 32 characters while a
// turn runs (the case reported: `🟤Tier 1 Sub Agent - 158% of Fable ...`).
// So the line leads with what matters, and that lead fits the narrow case.
const chars = (s: string) => [...s].length
const head = (s: string) => { const p = s.split(' · '); return p.slice(0, /sub$/.test(p[0]) ? 2 : 1).join(' · ') }
const LONG_MIX = [1, 2, 3, 4, 5, 6, 7, 8].map(tier => ({ tier, share: 12 })).concat([{ tier: 'Other' as any, share: 4 }])
const BASE = { all: 100, line: 46.7, ofBudget: 214, left: { points: -53.3, tokens: -4530500 }, premium: 100, premiumLabel: 'Fable 5.2', premiumAt: null as string | null }
const WORST = [
  // a side session off the ladder, the per-model meter held, three digits
  { j: { ...BASE, level: 'throttle', premiumHeld: true, premiumOfBudget: 999 }, self: 'Other' },
  // the per-model meter out
  { j: { ...BASE, level: 'over', premiumOut: true, premiumOfBudget: 214 }, self: 8 },
  // the per-model meter set the level
  { j: { ...BASE, level: 'throttle', levelBy: 'premium', premiumOfBudget: 999 }, self: 'Other' },
  // stop, which says wrap up
  { j: { ...BASE, level: 'stop', ofBudget: 999, left: { points: -99.9, tokens: -12345678 } }, self: 'Other' },
  // on pace, the longest level word
  { j: { ...BASE, level: 'on pace', ofBudget: 999, left: { points: -99.9, tokens: -12345678 } }, self: 'Other' },
]

test('the lead, a side session\'s tier and the level with its budget share, fits the narrowest footer', async () => {
  const now = Date.parse('2026-11-16T12:00:00.000Z')
  for (const { j, self } of WORST) {
    const s = statusText({ ...j, premiumAt: '2026-11-13T12:00:00.000Z', premiumEstimate: 140 }, LONG_MIX, self, now)
    expect(chars(head(s))).toBeLessThanOrEqual(HEAD_MAX)
  }
  // the case reported, now: the lead within the narrow room, the split after it
  const reported = statusText({ ...BASE, all: 50, premium: 90, level: 'over', ofBudget: 107, left: { points: -3.3, tokens: -280000 }, premiumHeld: true, premiumOfBudget: 158 }, [{ tier: 1, share: 100 }], 1, now)
  // a side session shows no per-model meter
  expect(reported).toBe('sub · Budget tokens: -280K · usage: Weekly 50%')
  expect(chars(head(reported))).toBeLessThanOrEqual(HEAD_MAX)
  // a realistic main session's whole line is shorter than the old form's
  const realistic = statusText({ ...BASE, all: 48, premium: 71, ofBudget: 103, left: { points: -1.3, tokens: -110000 }, level: 'over' }, [{ tier: 1, share: 45 }, { tier: 2, share: 55 }], null, now)
  expect(realistic).toBe('Budget tokens: -110K · usage: Weekly 48% Fable 71%')
  expect(chars(realistic)).toBeLessThan(chars(fullText({ ...BASE, all: 48, premium: 71, ofBudget: 103, left: { points: -1.3, tokens: -110000 }, level: 'over' }, [{ tier: 1, share: 45 }, { tier: 2, share: 55 }], null, now)))
})

test('the order: sub, the budget share, then the usage; no tiers; a cut takes the tail', async () => {
  const now = Date.parse('2026-11-16T12:00:00.000Z')
  const s = statusText({ ...BASE, level: 'throttle', premiumHeld: true, premiumOfBudget: 158, premiumAt: '2026-11-16T09:00:00.000Z', premiumEstimate: 104 },
    [{ tier: 1, share: 60 }, { tier: 2, share: 40 }], null, now)
  const parts = s.split(' · ')
  // the weekly level and share; the per-model meter only as its usage, last
  expect(parts[0]).toBe('Budget tokens: -4.5M')
  expect(parts.join(' · ')).not.toContain('held')
  expect(parts[1]).toBe('usage: Weekly 100% Fable 100%')
  expect(parts.length).toBe(2)
  // a side session: sub first, then the weekly share, no per-model meter
  const side = statusText({ ...BASE, level: 'throttle', premiumHeld: true, premiumOfBudget: 158, premiumAt: '2026-11-16T09:00:00.000Z', premiumEstimate: 104 },
    [{ tier: 1, share: 60 }, { tier: 2, share: 40 }], 2, now).split(' · ')
  expect(side).toEqual(['sub', 'Budget tokens: -4.5M', 'usage: Weekly 100%'])
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
  expect(r.text).toBe('Pacing: ⚪side session on Opus 5.5 medium - Budget: -1%, ⚪Opus 5.5 medium 100%, (21% Weekly)\nNow: Fable 5.2 held: Opus 5.5 high')
})

test('/pacing-status names models, not tier numbers: from an older budget.mjs the model alone; a side session off the ladder by its own model', () => {
  const now = Date.parse('2026-11-16T12:00:00.000Z')
  const j = { ...BASE, level: 'ahead', tierOf: { 'claude-opus-5-5': 2 } }
  expect(fullText(j, [{ tier: 2, share: 70 }, { tier: 7, share: 20 }, { tier: 'Other' as any, share: 10 }], null, now)).toContain('⚪Opus 5.5 70% 🔵Tier 7 20% ⚫Other 10%')
  expect(fullText(j, [], 'Other', now, 'claude-haiku-5-5').startsWith('⚫side session on Haiku 5.5 - Budget tokens: ')).toBe(true)
  expect(fullText({ ...j, tierNames: { 2: 'Opus 5.5 medium' } }, [{ tier: 2, share: 100 }], 2, now).startsWith('⚪side session on Opus 5.5 medium - ')).toBe(true)
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

// Live, a press hook that waited 10 s was dropped ("ui.press hook skipped:
// ran past its 10s budget") and the command it had queued with it: /compact
// takes a minute. So the press returns before its command has run.
test('Compact now in the desktop app: the direct call is refused, so /compact runs as if typed, after the press and not within it', async ($, on) => {
  engine(on)
  const clock = mock.clock(on, { now: T0 })
  big(on)
  const toasts: string[] = [], fills: string[] = [], runs: string[] = []
  on('env.get', (_: unknown, e: any) => ({ value: e.name === 'USERPROFILE' ? '/home/test' : undefined }))
  on('fs.read', () => ({ value: '{}' }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.toast', (_: unknown, e: any) => (toasts.push(e.text), { value: undefined }))
  on('session.compact', () => { throw new Error('pacing: $.session.compact: not available in a headless (-p / SDK) session yet') })
  // the compaction answers only when the test lets it: a minute, live
  let done = () => {}
  const compacting = new Promise<void>(r => { done = r })
  on('command.run', async (_: unknown, e: any) => { runs.push('/' + e.command + ' ' + e.args); await compacting; return { text: '' } })
  on('prompt.fill', (_: unknown, e: any) => (fills.push(e.text), { isFilled: true }))
  on('prompt.submit', (_: unknown, e: any) => ({ text: e.text }))
  await $.prompt.submit({ text: 'work on', asUser: true })
  await $.session.measure(measure(10, [], 420000))
  await $.turn.complete(turn('claude-fable-5-2', 1))
  const said = toasts.length
  const ui = await $.ui.mount(BAND)
  // the press is back with nothing run yet
  await ui.press({ key: 'pacing-compact' })
  expect(runs).toEqual([])
  await clock.advance(1)
  await ui.unmount()
  expect(runs).toEqual(['/compact ' + COMPACT_INSTRUCTIONS])
  expect(toasts.slice(said)).toEqual([])
  expect((await bandText($)).text).toBe(undefined)
  // no compaction started after a while (the session is busy): a toast says it runs when the session is free
  await clock.advance(RUN_WAIT)
  expect(toasts.slice(said)).toEqual([])
  await clock.advance(COMPACT_RUN_WAIT - RUN_WAIT)
  expect(toasts.slice(said)).toEqual(['🗜️ compacting: /compact runs as soon as the session is free.'])
  expect(COMPACT_WAIT_TEXT).toBe('🗜️ compacting: /compact runs as soon as the session is free.')
  done()
  await clock.advance(1)
  expect(fills).toEqual([])
  expect(toasts.slice(said)).toEqual([COMPACT_WAIT_TEXT, '🗜️ compacted.'])
})

// the user's word: the toast that it soon runs is not wanted when it starts right away
test('Compact now that starts right away: no toast that it waits, only that it compacted', async ($, on) => {
  engine(on)
  const clock = mock.clock(on, { now: T0 })
  big(on)
  const toasts: string[] = []
  on('env.get', (_: unknown, e: any) => ({ value: e.name === 'USERPROFILE' ? '/home/test' : undefined }))
  on('fs.read', () => ({ value: '{}' }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.toast', (_: unknown, e: any) => (toasts.push(e.text), { value: undefined }))
  on('session.compact', () => { throw new Error('pacing: $.session.compact: not available in a headless (-p / SDK) session yet') })
  let done = () => {}
  const compacting = new Promise<void>(r => { done = r })
  on('command.run', async () => { await compacting; return { text: '' } })
  on('prompt.fill', () => ({ isFilled: true }))
  on('prompt.submit', (_: unknown, e: any) => ({ text: e.text }))
  await $.prompt.submit({ text: 'work on', asUser: true })
  await $.session.measure(measure(10, [], 420000))
  await $.turn.complete(turn('claude-fable-5-2', 1))
  const said = toasts.length
  const ui = await $.ui.mount(BAND)
  await ui.press({ key: 'pacing-compact' })
  await clock.advance(1)
  await ui.unmount()
  // the engine starts the compaction at once: the module's hook on it runs
  try { await $.session.compact({ trigger: 'manual', messages: [] } as any) } catch { /* this engine has none to give */ }
  // a minute of compacting, and nothing said of waiting
  await clock.advance(60000)
  expect(toasts.slice(said)).toEqual([])
  done()
  await clock.advance(1)
  expect(toasts.slice(said)).toEqual(['🗜️ compacted.'])
})

test('Compact now that the engine refuses both ways: its own reason in the toast, /compact in the box', async ($, on) => {
  engine(on)
  const clock = mock.clock(on, { now: T0 })
  big(on)
  const toasts: string[] = [], fills: string[] = []
  on('env.get', (_: unknown, e: any) => ({ value: e.name === 'USERPROFILE' ? '/home/test' : undefined }))
  on('fs.read', () => ({ value: '{}' }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.toast', (_: unknown, e: any) => (toasts.push(e.text), { value: undefined }))
  on('session.compact', () => { throw new Error('Not enough messages to compact.') })
  on('command.run', () => { throw new Error('no such command here') })
  on('prompt.fill', (_: unknown, e: any) => (fills.push(e.text), { isFilled: true }))
  on('prompt.submit', (_: unknown, e: any) => ({ text: e.text }))
  await $.prompt.submit({ text: 'work on', asUser: true })
  await $.session.measure(measure(10, [], 420000))
  await $.turn.complete(turn('claude-fable-5-2', 1))
  const ui = await $.ui.mount(BAND)
  await ui.press({ key: 'pacing-compact' })
  await clock.advance(1)
  await ui.unmount()
  expect(fills).toEqual(['/compact'])
  // the engine's own words, whatever they are (the test engine words its own refusal)
  expect(toasts.at(-1)).toMatch(/^❌ the compaction did not start: .+\. \/compact is in the box: press Enter to send it\.$/)
  expect(toasts.at(-1)).not.toContain('turn runs')
  expect(compactFailedText('Not enough messages to compact.', true)).toBe('❌ the compaction did not start: Not enough messages to compact. /compact is in the box: press Enter to send it.')
  expect(compactFailedText('pacing: $.session.compact: not available', true)).toBe('❌ the compaction did not start: $.session.compact: not available. /compact is in the box: press Enter to send it.')
  expect(compactFailedText(undefined, false)).toBe('❌ the compaction did not start. Type /compact to run it.')
  expect(compactFailedText('x'.repeat(200), true)).toHaveLength('❌ the compaction did not start: '.length + 120 + '. /compact is in the box: press Enter to send it.'.length)
})

test('suggest: from 400 000 tokens, a calm row with Compact now; it compacts with the instructions and says the sizes', async ($, on) => {
  engine(on)
  const clock = mock.clock(on, { now: T0 })
  big(on)
  const seen = offers(on, { compacted: { tokensBefore: 420000, tokensAfter: 38000 } })

  await $.prompt.submit({ text: 'work on', asUser: true })
  await $.session.measure(measure(10, [], 420000))
  await $.turn.complete(turn('claude-fable-5-2', 1))
  const ui = await $.ui.mount(BAND)
  const text = (await ui.find({ type: 'Text', text: /session is/ }))?.text
  expect(text).toBe('🗜️ This session is 420k tokens. Compacting now makes every later turn cheaper.')
  expect(text).toBe('🗜️ ' + offerText('suggest', 420000))
  await ui.press({ key: 'pacing-compact' })
  await clock.advance(1)
  expect(seen.compacts).toEqual([COMPACT_INSTRUCTIONS])
  expect(COMPACT_INSTRUCTIONS).toContain('the goal; the decisions made and why; the open items, in order; the files and commands that matter; what was tried and ruled out')
  expect(seen.toasts).toEqual(['🗜️ compacted from 420k to 38k tokens.'])
  await ui.unmount()
  // the row is gone after the press
  expect((await bandText($)).text).toBe(undefined)
})

test('urge: from 650 000 tokens, plainer words with what each turn sends again', async ($, on) => {
  engine(on)
  big(on)
  offers(on)
  await $.prompt.submit({ text: 'work on', asUser: true })
  await $.session.measure(measure(10, [], 700000))
  await $.turn.complete(turn('claude-fable-5-2', 1))
  const { text } = await bandText($)
  expect(text).toBe('🗜️ This session is 700k tokens, and every turn sends all 700k again. Compact now to cut that.')
})

test('once per level: Not now holds until the session grows by 250 000 more; a new level comes at once', async ($, on) => {
  engine(on)
  big(on)
  const seen = offers(on)
  await $.prompt.submit({ text: 'work on', asUser: true })
  await $.session.measure(measure(10, [], 420000))
  await $.turn.complete(turn('claude-fable-5-2', 1))
  const first = await $.ui.mount(BAND)
  expect((await first.find({ type: 'Text', text: /session is/ }))?.text).toContain('420k')
  await first.press({ key: 'pacing-not-now' })
  await first.unmount()
  expect(seen.compacts).toEqual([])

  for (const size of [430000, 525000, 645000]) {
    await $.session.measure(measure(10, [], size))
    await $.turn.complete(turn('claude-fable-5-2', 1))
    expect((await bandText($)).text).toBe(undefined)
  }
  await $.session.measure(measure(10, [], 655000))
  await $.turn.complete(turn('claude-fable-5-2', 1))
  expect((await bandText($)).text).toContain('every turn sends all 655k again')
  // the user's next prompt answers it: gone, and not back until 250 000 on
  await $.prompt.submit({ text: 'go on', asUser: true })
  expect((await bandText($)).text).toBe(undefined)
  for (const size of [760000, 900000]) {
    await $.session.measure(measure(10, [], size))
    await $.turn.complete(turn('claude-fable-5-2', 1))
    expect((await bandText($)).text).toBe(undefined)
  }
  await $.session.measure(measure(10, [], 910000))
  await $.turn.complete(turn('claude-fable-5-2', 1))
  expect((await bandText($)).text).toContain('every turn sends all 910k again')
})

test('now: a pause is warned of once per size; the next pause at about the same size brings no row and no notice', async ($, on) => {
  engine(on)
  big(on)
  const clock = mock.clock(on, { now: T0 })
  const seen = offers(on)
  await $.prompt.submit({ text: 'work on', asUser: true })
  await $.session.measure(measure(10, [], 420000))
  await $.turn.complete(turn('claude-fable-5-2', 1))
  await clock.advance(50 * 60000)
  expect((await bandText($)).text).toContain('lapses in about 10 minutes')
  await clock.advance(10 * 60000)
  expect((await bandText($)).text).toContain('its cache has lapsed')
  await $.prompt.submit({ text: 'back', asUser: true })
  await $.session.measure(measure(10, [], 450000))
  await $.turn.complete(turn('claude-fable-5-2', 1))
  await clock.advance(75 * 60000)
  expect((await bandText($)).text).toBe(undefined)
  await $.prompt.submit({ text: 'back again', asUser: true })
  expect(seen.toasts).toEqual([])
  expect(pauseDue(450000, 2, { now: 420000, nowPause: 1 })).toBe(false)
  expect(pauseDue(420000, 1, { now: 420000, nowPause: 1 })).toBe(true)
  expect(pauseDue(670000, 2, { now: 420000, nowPause: 1 })).toBe(true)
  expect(pauseDue(420000, 1, {})).toBe(true)
})

test('never while a turn runs, never before a person has typed, gone after the user\'s own /compact', async ($, on) => {
  engine(on)
  big(on)
  offers(on)
  // a side session another session drives: its prompt is a peer's
  await $.prompt.submit({ text: 'do the task', origin: { kind: 'peer' } } as any)
  await $.session.measure(measure(10, [], 450000))
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
  expect((await bandText($)).text).toContain('450k')
  // the user compacts by hand: the row goes, and the offers start over
  await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'all of it', toolUses: [] }] } as any)
  expect((await bandText($)).text).toBe(undefined)
})

test('a large tool result in the main thread: no toast, and no line about it in /pacing-status (compacting is what the module offers)', async ($, on) => {
  engine(on)
  big(on)
  const clock = mock.clock(on, { now: T0 })
  const toasts: string[] = []
  on('env.get', (_: unknown, e: any) => ({ value: e.name === 'USERPROFILE' ? '/home/test' : undefined }))
  on('fs.read', () => ({ value: '{}' }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.toast', (_: unknown, e: any) => (toasts.push(e.text), { value: undefined }))
  // the tool answers with as many characters as the call asks for
  on('tool.call', (_: unknown, e: any) => ({ result: {}, text: 'x'.repeat(e.chars || 10) }))
  await $.session.measure(measure(10))
  const said = toasts.length
  // 12 000 tokens, 4 characters a token
  await $.tool.call({ tool: 'Read', file_path: 'big.log', chars: 48000 } as any)
  expect(toasts.slice(said)).toEqual([])
  // small, a subagent's, an agent's answer: nothing
  await $.tool.call({ tool: 'Read', file_path: 'small', chars: 39000 } as any)
  await $.tool.call({ tool: 'Bash', command: 'x', chars: 80000, agentId: 'ag1' } as any)
  await $.tool.call({ tool: 'Agent', description: 'd', prompt: 'p', chars: 80000 } as any)
  // further large ones, and none is toasted (the user's word: no messages about tokens used)
  await $.tool.call({ tool: 'mcp__github__get_file_contents', chars: 100000 } as any)
  await clock.advance(15 * 60000)
  await $.tool.call({ tool: 'mcp__github__get_file_contents', chars: 100000 } as any)
  expect(toasts.slice(said)).toEqual([])
  // no large-results text (the user's word: not needed)
  const status = (await $.command.run({ command: 'pacing-status', args: '' } as any)).text
  expect(status).not.toContain('Large results')
  expect(status).not.toContain('Largest results')
})

// ---- what fills the context, and the pane ----
// the engine's breakdown as $.session.usage({ breakdown: 'summary' }) answers it
const BREAKDOWN = {
  categories: [
    { name: 'System prompt', tokens: 3200, color: 'x', isDeferred: false, kind: 'used' },
    { name: 'System tools', tokens: 15400, color: 'x', isDeferred: false, kind: 'used' },
    { name: 'Memory files', tokens: 4100, color: 'x', isDeferred: false, kind: 'used' },
    { name: 'Messages', tokens: 160000, color: 'x', isDeferred: false, kind: 'used' },
    { name: 'MCP tools', tokens: 9000, color: 'x', isDeferred: true, kind: 'deferred' },
    { name: 'Free space', tokens: 650000, color: 'x', isDeferred: false, kind: 'free' },
    { name: 'Autocompact buffer', tokens: 33000, color: 'x', isDeferred: false, kind: 'buffer' },
  ],
  totalTokens: 182700, maxTokens: 1000000, rawMaxTokens: 1000000, autocompactSource: 'auto', percentage: 18,
  gridRows: [], model: 'claude-fable-5-2', memoryFiles: [], mcpTools: [], agents: [],
  autoCompactThreshold: 967000, isAutoCompactEnabled: true, apiUsage: null,
}

test('what fills the context: the total, the Messages row\'s total, the fixed parts; no split of tool results', () => {
  expect(contextLines(BREAKDOWN)).toEqual([
    'Context: 183k of 1M (18%); it compacts by itself at 967k',
    '  Messages 160k',
    '  System tools 15k · Memory files 4k · System prompt 3k',
  ])
  // no breakdown from the engine: nothing
  expect(contextLines(null)).toEqual([])
})

test('/pacing-status adds the context: the Messages total, no large results', async ($, on) => {
  engine(on)
  big(on)
  offers(on)
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 182700, window: 1000000, percent: 18, breakdown: BREAKDOWN }, rateLimits: [] } }))
  on('tool.call', (_: unknown, e: any) => ({ result: {}, text: 'x'.repeat(e.chars || 10) }))
  await $.prompt.submit({ text: 'work on', asUser: true })
  await $.session.measure(measure(10, [], 182700))
  await $.tool.call({ tool: 'Read', file_path: '/a/big.log', chars: 80000 } as any)
  const text = (await $.command.run({ command: 'pacing-status', args: '' } as any)).text
  expect(text).toContain('\nContext: 183k of 1M (18%); it compacts by itself at 967k\n  Messages 160k\n')
  expect(text).not.toContain('tool results about')
  expect(text).not.toContain('Largest results')
  expect(text).not.toContain('Large results')
})

const PANE = {
  plugin: 'pacing', component: 'Pane', requestId: 'pacing', surface: 'desktop',
  props: { title: 'Pacing', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

test('the context figure: against the model window, not the auto-compact window pacing sets', () => {
  expect(paneModel({ bd: BREAKDOWN }).context).toEqual({ used: '183k', of: '1M', pct: 18 })
  const set = { ...BREAKDOWN, autocompactSource: 'settings', rawMaxTokens: 433000, maxTokens: 433000, autoCompactThreshold: 400000, totalTokens: 198000, percentage: 46 }
  expect(paneModel({ bd: { ...set, modelWindow: 1000000 } }).context).toEqual({ used: '198k', of: '1M', pct: 20 })
  // the model window not known: the breakdown's own
  expect(paneModel({ bd: set }).context).toEqual({ used: '198k', of: '433k', pct: 46 })
})

test('the pane: /pacing-pane opens it; it shows the budget, what to do and the context, with Refresh', async ($, on) => {
  engine(on)
  big(on)
  offers(on)
  const opened: any[] = []
  let usage = 0
  on('session.usage', () => (usage++, { value: { startedAt: 0, context: { tokens: 182700, window: 1000000, percent: 18, breakdown: BREAKDOWN }, rateLimits: [] } }))
  on('ui.open', (_: unknown, e: any) => (opened.push(e), { value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: opened.map(o => ({ id: o.id, title: o.title, isPlaced: true })) }))
  on('tool.call', (_: unknown, e: any) => ({ result: {}, text: 'x'.repeat(e.chars || 10) }))
  const clock = mock.clock(on, { now: T0 })
  await $.prompt.submit({ text: 'work on', asUser: true })
  await $.session.measure(measure(10, [], 182700))
  await $.turn.complete(turn('claude-fable-5-2', 1))
  // before it is opened, a turn's end asks for no breakdown
  expect(usage).toBe(0)
  const r = await $.command.run({ command: 'pacing-pane', args: '' } as any)
  expect(r.text).toBe('Pacing pane opened.')
  expect(opened).toEqual([{ id: PANE_ID, title: PANE_TITLE }])
  const ui = await $.ui.mount(PANE)
  const texts = (await ui.findAll({ type: 'Text' })).map((t: any) => t.text)
  // the time or share left today in plain words, then the level
  expect(texts.slice(0, 3)).toEqual(['10%', 'of the week left to use today to stay on budget', '● Within budget'])
  // never in tokens or dollars, and no Now, parts of the context or largest results
  expect(texts.some((s: string) => /tokens|\$|NOW|LARGEST|Messages|compacts/.test(s))).toBe(false)
  // the meters: a figure each, the weekly one with its budget line
  for (const s of ['▸ THIS WEEK', 'Weekly', 'budget line 20%', 'Fable 5.2', '40%', '▸ MODELS THIS SESSION', 'Fable 5.2 high', '100%']) expect(texts).toContain(s)
  // the context: how full it is, one figure
  for (const s of ['▸ CONTEXT', '183k of 1M', '18%']) expect(texts).toContain(s)
  // drawn, on a surface with Svg: the pane's two edges, the week's dial, the ruler under it, and for the week, the models and the context an edge above, one below and their bars, and the auto-compact switch
  const svgs = await ui.findAll({ type: 'Svg' })
  expect(svgs.length).toBe(15)
  for (const s of svgs) { expect(s.props.source.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true); expect(s.props.alt.length).toBeGreaterThan(0) }
  await ui.press({ key: 'pacing-pane-refresh' })
  await clock.advance(1)
  await ui.unmount()
  // the command asked for the context, the first draw again (its reading
  // was under a minute old: not taken again), and Refresh asks for the
  // context and then takes a reading (the engine's windows are a second ask)
  expect(usage).toBe(4)
  // open: each turn's end measures the context again
  await $.turn.complete(turn('claude-fable-5-2', 1))
  await clock.advance(1)
  expect(usage).toBe(5)
})

test('the pane\'s first draw takes fresh figures: the context, and a reading where the last is a minute old or more; later draws do not', async ($, on) => {
  engine(on)
  offers(on)
  const opened: any[] = []
  let usage = 0
  const runs: string[] = []
  on('session.usage', () => (usage++, { value: { startedAt: 0, context: { tokens: 182700, window: 1000000, percent: 18, breakdown: BREAKDOWN }, rateLimits: [{ kind: 'seven_day', percentUsed: 11, resetsAt: RESET }] } }))
  on('ui.open', (_: unknown, e: any) => (opened.push(e), { value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: opened.map(o => ({ id: o.id, title: o.title, isPlaced: true })) }))
  on('process.run', (_: unknown, e: any) => (runs.push(JSON.stringify(e)), { value: answer('ahead', 10) }))
  const clock = mock.clock(on, { now: T0 })
  await $.prompt.submit({ text: 'work on', asUser: true })
  await $.session.measure(measure(10, [], 182700))
  await $.turn.complete(turn('claude-fable-5-2', 1))
  const before = runs.filter(r => r.includes('budget.mjs')).length
  await clock.advance(5 * 60000)
  await $.command.run({ command: 'pacing-pane', args: '' } as any)
  const ui = await $.ui.mount(PANE)
  await clock.advance(1)
  // the command's ask, the first draw's, and the reading's windows
  expect(usage).toBe(3)
  expect(runs.filter(r => r.includes('budget.mjs')).length).toBe(before + 1)
  await ui.unmount()
  const again = await $.ui.mount(PANE)
  await clock.advance(1)
  await again.unmount()
  expect(usage).toBe(3)
})

test('a pane the engine does not place: /pacing-pane says why', async ($, on) => {
  engine(on)
  offers(on)
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1000000 } } }))
  on('ui.open', () => ({ value: { isPlaced: false, reason: 'no surface attached' } }))
  expect((await $.command.run({ command: 'pacing-pane', args: '' } as any)).text).toBe('Pacing pane: not shown (no surface attached).')
  // the pane before any reading or turn
  const ui = await $.ui.mount(PANE)
  expect((await ui.findAll({ type: 'Text' })).map((t: any) => t.text)).toEqual(['No reading yet in this session: /pacing usage takes one.', '▸ CONTEXT', 'Not measured yet; it shows after the next turn.', 'Compact at 750k', 'Use Claude Auto Compact', '      '])
  await ui.unmount()
})

test('the pane on a surface without Svg, and minimized: the same figures as rows of blocks; the glance has the budget and the week', async ($, on) => {
  engine(on)
  big(on)
  offers(on)
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 182700, window: 1000000, percent: 18, breakdown: BREAKDOWN }, rateLimits: [] } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  mock.clock(on, { now: T0 })
  await $.prompt.submit({ text: 'work on', asUser: true })
  await $.session.measure(measure(10, [], 182700))
  await $.turn.complete(turn('claude-fable-5-2', 1))
  await $.command.run({ command: 'pacing-pane', args: '' } as any)
  const term = await $.ui.mount({ ...PANE, surface: 'terminal' } as any)
  expect((await term.findAll({ type: 'Svg' })).length).toBe(0)
  const texts = (await term.findAll({ type: 'Text' })).map((t: any) => t.text)
  expect(texts.some((s: string) => /^█+░+$/.test(s))).toBe(true)
  expect(texts).toContain('183k of 1M')
  await term.unmount()
  const glance = await $.ui.mount({ ...PANE, props: { ...PANE.props, placement: 'widget' } } as any)
  expect((await glance.findAll({ type: 'Text' })).map((t: any) => t.text)).toEqual(['10% of the week left to use today to stay on budget', 'Weekly 10%'])
  expect((await glance.findAll({ type: 'Button' })).length).toBe(0)
  await glance.unmount()
})

test('the pane opens by itself at a session\'s start; closed by the person it stays closed, until /pacing-pane', async ($, on) => {
  engine(on)
  offers(on)
  const opened: any[] = []
  const store = new Map<string, unknown>()
  on('store.get', (_: unknown, e: any) => ({ value: store.get(e.key) }))
  on('store.set', (_: unknown, e: any) => (store.set(e.key, e.value), { value: undefined }))
  on('store.delete', (_: unknown, e: any) => (store.delete(e.key), { value: undefined }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1000000 } } }))
  on('ui.open', (_: unknown, e: any) => (opened.push(e.id), { value: { isPlaced: true } }))
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  const clock = mock.clock(on, { now: T0 })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true } as any)
  await clock.advance(1)
  expect(opened).toEqual([PANE_ID])
  // only the person closing pacing's own pane counts (the test kit raises no ui.close of a person's)
  expect(closedByPerson({ id: 'other', origin: { kind: 'person' } })).toBe(false)
  expect(closedByPerson({ id: PANE_ID, origin: { kind: 'plugin' } })).toBe(false)
  expect(closedByPerson({ id: PANE_ID, origin: { kind: 'unload' } })).toBe(false)
  expect(closedByPerson({ id: PANE_ID, origin: { kind: 'person' } })).toBe(true)
  // closed by the person: the next start leaves it closed
  store.set(PANE_CLOSED, true)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true } as any)
  await clock.advance(1)
  expect(opened).toEqual([PANE_ID])
  // asked for again: open, and by itself from then on
  await $.command.run({ command: 'pacing-pane', args: '' } as any)
  expect(store.has(PANE_CLOSED)).toBe(false)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true } as any)
  await clock.advance(1)
  expect(opened).toEqual([PANE_ID, PANE_ID, PANE_ID])
})

// Live, another plugin's session.compact hook ran first and skipped pacing's:
// a typed /compact went unseen, and the old offer stood at the old size.
test('a compaction pacing does not hear: the context falling by half between two measures ends the row, and the offers start over', async ($, on) => {
  engine(on)
  big(on)
  offers(on)
  await $.prompt.submit({ text: 'work on', asUser: true })
  await $.session.measure(measure(10, [], 450000))
  await $.turn.complete(turn('claude-fable-5-2', 1))
  expect((await bandText($)).text).toContain('450k')
  // no session.compact reaches pacing; the next measure is small
  await $.session.measure(measure(10, [], 40000))
  expect((await bandText($)).text).toBe(undefined)
  // grown again to 450k: offered again, as after a compaction it heard
  await $.session.measure(measure(10, [], 450000))
  await $.turn.complete(turn('claude-fable-5-2', 1))
  expect((await bandText($)).text).toContain('450k')
  // a drop that is no compaction: the row stays
  await $.session.measure(measure(10, [], 420000))
  expect((await bandText($)).text).toContain('450k')
  expect(COMPACT_DROP).toBe(50000)
  expect(compactedBetween(350000, 40000)).toBe(true)
  expect(compactedBetween(90000, 40000)).toBe(true)
  expect(compactedBetween(80000, 40000)).toBe(false)
  expect(compactedBetween(350000, 200000)).toBe(false)
  expect(compactedBetween(null, 40000)).toBe(false)
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
  await clock.advance(1)
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

test('one agent: a toast when it starts, the line leads with the count, the assignment in the toasts, a toast when it ends, then the plain line', async ($, on) => {
  const status = engine(on)
  big(on)
  const clock = mock.clock(on, { now: T0 })
  const seen = agentEngine(on, { list: () => [{ id: 'ag1', status: 'running' }] })

  await $.session.measure(measure(10))
  expect(status.at(-1)).toBe('Budget: 10% · usage: Weekly 10% Fable 40%')
  await spawn($, 'pacing:reader')
  expect(seen.toasts).toEqual(['▶️ reader is running "a task" on Haiku 5.5.'])
  expect(status.at(-1)).toBe('⏳ 1 Subagent running · Budget: 10% · usage: Weekly 10% Fable 40%')
  // it refreshes while it runs
  await clock.advance(3 * 60000)
  expect(status.at(-1)).toBe('⏳ 1 Subagent running · Budget: 10% · usage: Weekly 10% Fable 40%')
  await $.turn.complete(turn('claude-haiku-5-5', 1, 'ag1'))
  expect(seen.toasts.at(-1)).toMatch(/^✅ reader is done with "a task" after 3m, \d+k tokens; nothing else is running\.$/)
  // the plain line again, the agent's spend in its tier split
  expect(status.at(-1)).toBe('Budget: 10% · usage: Weekly 10% Fable 40%')
})

test('with the pane on show: no toast that an agent started, still runs or is done (the pane lists them)', async ($, on) => {
  engine(on)
  big(on)
  const clock = mock.clock(on, { now: T0 })
  const seen = agentEngine(on, { list: () => [{ id: 'ag1', status: 'running' }] })
  let panes: any[] = [{ id: PANE_ID, title: PANE_TITLE, isShown: true, isFocused: false, isPlaced: true }]
  on('ui.panes', () => ({ value: panes }))
  await $.session.measure(measure(10))
  await spawn($, 'pacing:reader')
  await clock.advance(6 * 60000)
  expect(seen.toasts).toEqual([])
  await $.turn.complete(turn('claude-haiku-5-5', 1, 'ag1'))
  expect(seen.toasts).toEqual([])
  // behind another tab, or waiting undrawn: the pane shows nothing, so the toasts are back
  panes = [{ id: PANE_ID, title: PANE_TITLE, isShown: false, isFocused: false, isPlaced: true }]
  await spawn($, 'pacing:reader')
  expect(seen.toasts.at(-1)).toMatch(/^▶️ reader is running/)
})
test('several agents: counted in the line; a progress toast every 5 minutes and no more often; the line follows as each ends', async ($, on) => {
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
  expect(status.at(-1)).toBe('⏳ 2 Subagents running · Budget: 10% · usage: Weekly 10% Fable 40%')

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
  expect(status.at(-1)).toBe('⏳ 1 Subagent running · Budget: 10% · usage: Weekly 10% Fable 40%')
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
  expect(status.at(-1)).toMatch(/^⏳ 1 Subagent running · Budget: 10%/)
  // the engine lists the background one as done: gone at the next refresh
  live.clear()
  await clock.advance(30 * 1000)
  expect(status.at(-1)).toMatch(/^Budget: 10% · usage: Weekly 10% Fable 40%$/)

  live.add('ag3')
  await spawn($, 'pacing:verifier')
  expect(status.at(-1)).toMatch(/^⏳ 1 Subagent running/)
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
  await $.session.measure(measure(10, [], 420000))
  await spawn($, 'pacing:researcher', 'sonnet', true)
  await clock.advance(2 * 60000)
  await $.turn.complete(turn('claude-fable-5-2', 1))
  const ui = await $.ui.mount(BAND)
  const texts = (await ui.findAll({ type: 'Text' })).map((t: any) => t.text)
  await ui.unmount()
  expect(texts).toEqual(['🗜️ This session is 420k tokens. Compacting now makes every later turn cheaper.', 'In the background: ⏳ researcher is running: a task 2m'])
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
  expect(status.at(-1)).toBe('⏳ 1 Subagent running · Budget: 10% · usage: Weekly 10% Fable 40%')
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
  expect(status.at(-1)).toMatch(/^⏳ 1 Subagent running/)
  await clock.advance(121 * 60000)
  await $.turn.complete(turn('claude-fable-5-2', 1))
  expect(status.at(-1)).toMatch(/^Budget: 10% · usage: Weekly 10% Fable 40%$/)
})

// the whole line within LINE_MAX while agents run, at every level and length
const A = (type: string, mins: number, model = 'claude-haiku-5-5', effort?: string, description?: string) => ({ id: type + mins, type, model, effort, description, startedAt: T0 - mins * 60000, background: false })
const LONGEST_MIX = [1, 2, 3, 4, 5, 6, 7, 8].map(tier => ({ tier, share: 12 })).concat([{ tier: 'Other' as any, share: 4 }])
const FAR = { all: 100, line: 46.7, ofBudget: 214, left: { points: -53.3, tokens: -4530500 }, level: 'throttle', premium: 100, premiumLabel: 'Fable 5.2', premiumAt: null }
const SETS = {
  one: [A('pacing:reader', 3, 'claude-haiku-5-5', 'medium')],
  two: [A('pacing:reader', 3), A('pacing:implementer', 1, 'claude-opus-5-5', 'high')],
  six: [A('general-purpose', 12), A('someplugin:very-long-agent-name', 9), A('pacing:implementer', 7), A('pacing:verifier', 5), A('Explore', 3), A('pacing:researcher', 1)],
}
// the same agents, each with an assignment, a step and a history
const LONG_TASK = 'Auto-reload on plugin update when the desktop app has installed a new version of the plugin'
const described = (list: any[], description = LONG_TASK) => list.map(a => ({ ...a, description, step: 'on the web', runs: [4 * 60000, 5 * 60000, 6 * 60000] }))

test('with 1, 2, 3 and 6 agents, long names and assignments, far over budget: the line keeps within 75, or 70 in the desktop app, and holds their count, the budget and the usage', async () => {
  const longest = { [LINE_MAX]: '', [LINE_MAX_NARROW]: '' } as Record<number, string>
  const three = [...SETS.two, A('pacing:verifier', 0.5)]
  for (const max of [LINE_MAX, LINE_MAX_NARROW]) {
    for (const plain of [SETS.one, SETS.two, three, SETS.six]) {
      for (const list of [plain, described(plain), described(plain, 'Read the logs')]) {
        for (const [j, self] of [[FAR, null], [FAR, 'Other'], [{ ...FAR, level: 'stop', ofBudget: 999, left: { points: -99.9, tokens: -12345678 } }, 'Other'], [{ ...FAR, level: 'ahead', ofBudget: 77, left: { points: 10.7, tokens: 850000 } }, 1]] as const) {
          const s = statusText(j as any, LONGEST_MIX, self as any, T0, list as any, max)
          if (chars(s) > chars(longest[max])) longest[max] = s
          expect(chars(s)).toBeLessThanOrEqual(max)
          expect(s.startsWith('⏳') || s.includes(' · ⏳')).toBe(true)
          // their count, never a name: who runs is the toasts', the row's and /pacing-status's
          expect(s).toMatch(new RegExp('(⏳ ' + list.length + ' Subagents?( running)?|⏳' + list.length + ') · '))
          expect(list.some(a => s.includes(roleOf(a.type)))).toBe(false)
          expect(s).toContain(budgetText(j))
          expect(s).toContain('usage: Weekly ')
          // the agents, then the budget share, then the usage: a cut by the app takes the least important end
          expect(s.indexOf('⏳')).toBeLessThan(s.indexOf('Budget'))
          expect(s.indexOf('Budget')).toBeLessThan(s.indexOf('usage:'))
        }
      }
    }
  }
  // the width: a line of 75 characters was seen whole in a footer; the desktop app's footer in a normal window has room for about 70
  expect(LINE_MAX).toBe(75)
  expect(LINE_MAX_NARROW).toBe(70)
  expect(longest[LINE_MAX]).toBe('⏳ 1 Subagent running · Budget tokens: -4.5M · usage: Weekly 100% Fable 100%')
  expect(longest[LINE_MAX_NARROW]).toBe('sub · ⏳ 1 Subagent running · Budget tokens: -4.5M · usage: Weekly 100%')
  // more than one beside the longest budget: without "running"; in less room the bare count; in less still the bare count all the same, past the room, the budget and the usage whole
  const farthest = { ...FAR, left: { points: -99.9, tokens: -12345678 } } as any
  expect(statusText(farthest, [], null, T0, SETS.two as any, LINE_MAX_NARROW)).toBe('⏳ 2 Subagents · Budget tokens: -12.3M · usage: Weekly 100% Fable 100%')
  expect(statusText(farthest, [], null, T0, SETS.two as any, 60)).toBe('⏳2 · Budget tokens: -12.3M · usage: Weekly 100% Fable 100%')
  expect(statusText(farthest, [], null, T0, SETS.two as any, 40)).toBe('⏳2 · Budget tokens: -12.3M · usage: Weekly 100% Fable 100%')
  expect(statusText(farthest, [], null, T0, [], 40)).toBe('Budget tokens: -12.3M · usage: Weekly 100% Fable 100%')
  // the line never shows an assignment, whatever the room; where one shows (the toasts, the row) it is never longer than TASK_MAX
  expect(TASK_MAX).toBe(60)
  expect(agentPart(described(SETS.one as any), T0, 500)).toBe('⏳ 1 Subagent running')
  expect(backgroundText(described(SETS.one as any), T0, 500)).toBe('In the background: ⏳ reader: Auto-reload on plugin update when the desktop app has insta…, on the web ~60%, 3m')
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
  expect(progressText(twelve, T0)).toBe('⏳ 12 Subagents are still running, the longest for 12m.')
  expect(progressText(SETS.two as any, T0)).toBe('⏳ still running: reader 3m, implementer 1m.')
  // an agent without a description has no assignment part
  expect(startedText(SETS.one[0] as any, SETS.one as any)).toBe('▶️ reader is running on Haiku 5.5 medium.')
  expect(startedText(SETS.two[1] as any, SETS.two as any)).toBe('▶️ implementer is running on Opus 5.5 high; reader is also running.')
  expect(doneText(six[1], 9 * 60000, 123456, six.slice(2))).toBe('✅ very-long-a… is done after 9m, 123k tokens; 4 Subagents are still running.')
  expect(doneText(SETS.two[0] as any, 60000, 1000, [SETS.two[1]] as any)).toBe('✅ reader is done after 1m, 1k tokens; implementer is still running.')
  expect(backgroundText(six, T0, 43)).toBe('⏳ 6 Subagents are running in the background')
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
const J77 = { ...FAR, level: 'ahead', ofBudget: 77, left: { points: 10.7, tokens: 850000 } } as any
// the same implementer where its kind has no finished runs yet: no usual length, no time left
const FIRST = { ...IMPL, runs: [] } as any

test('the forms the user approved: the line with the count alone (0.9.13), the toasts with the assignment, word for word after the icon', async () => {
  // the status line: how many run, nothing of who they are or what they do
  expect(statusText(J77, [], null, T0, [IMPL])).toBe('⏳ 1 Subagent running · Budget tokens: 850K · usage: Weekly 100% Fable 100%')
  expect(agentPart([{ ...IMPL, step: null, runs: [] }], T0, 80)).toBe('⏳ 1 Subagent running')
  expect(agentPart([{ ...IMPL, part: { done: 2, total: 4, said: true } }, READER], T0, 80)).toBe('⏳ 2 Subagents running')
  // the toasts keep the assignment
  expect(startedText(FIRST, [FIRST])).toBe('▶️ implementer is running "Auto-reload on plugin update" on Fable 5.2 high.')
  // and the others of the same shape
  expect(startedText(FIRST, [FIRST, READER])).toBe('▶️ implementer is running "Auto-reload on plugin update" on Fable 5.2 high; reader is also running.')
  expect(startedText(FIRST, [FIRST, READER, VERIFIER])).toBe('▶️ implementer is running "Auto-reload on plugin update" on Fable 5.2 high; reader and verifier are also running.')
  expect(startedText(FIRST, [FIRST, READER, VERIFIER, { ...VERIFIER, id: 'w' }])).toBe('▶️ implementer is running "Auto-reload on plugin update" on Fable 5.2 high; 3 Subagents are also running.')
  expect(doneText(IMPL, 3 * 60000, 41000, [])).toBe('✅ implementer is done with "Auto-reload on plugin update" after 3m, 41k tokens; nothing else is running.')
  expect(doneText(IMPL, 3 * 60000, 41000, [READER])).toBe('✅ implementer is done with "Auto-reload on plugin update" after 3m, 41k tokens; reader is still running.')
  expect(doneText(IMPL, 3 * 60000, 41000, [READER, VERIFIER, { ...VERIFIER, id: 'w' }])).toBe('✅ implementer is done with "Auto-reload on plugin update" after 3m, 41k tokens; 3 Subagents are still running.')
  expect(progressText([{ ...IMPL, startedAt: T0 - 12 * 60000, runs: [20 * 60000, 20 * 60000, 20 * 60000] }], T0)).toBe('⏳ still running: implementer "Auto-reload on plugin update", editing ~60%, 12m, about 8m left.')
})

test('the agent part as the room shrinks: the count with "running", then without it, then the bare count; side sessions counted in', async () => {
  const one = [IMPL], two = [IMPL, READER], three = [IMPL, READER, VERIFIER]
  expect(agentPart(one, T0, 200)).toBe('⏳ 1 Subagent running')
  expect(agentPart(one, T0, 20)).toBe('⏳ 1 Subagent running')
  expect(agentPart(one, T0, 19)).toBe('⏳ 1 Subagent')
  expect(agentPart(one, T0, 12)).toBe('⏳ 1 Subagent')
  expect(agentPart(one, T0, 11)).toBe('⏳1')
  expect(agentPart(two, T0, 21)).toBe('⏳ 2 Subagents running')
  expect(agentPart(two, T0, 20)).toBe('⏳ 2 Subagents')
  expect(agentPart(two, T0, 13)).toBe('⏳ 2 Subagents')
  expect(agentPart(two, T0, 12)).toBe('⏳2')
  expect(agentPart(three, T0, 80)).toBe('⏳ 3 Subagents running')
  expect(agentPart([], T0, 80)).toBe('')
  // nothing of a name, a step, a time, a progress or an assignment, at any width
  for (let room = 2; room <= 160; room++) {
    for (const list of [one, two, three]) {
      const p = agentPart(list, T0, room)
      expect(chars(p)).toBeLessThanOrEqual(Math.max(room, 2))
      expect(p).toMatch(/^⏳( \d+ Subagents?( running)?|\d+)$/)
    }
  }
})

test('the line in a terminal (75) and in the desktop app (70): the budget and the usage always whole, the agents in what is left', async () => {
  const two = [IMPL, READER]
  const J = { all: 36, premium: 40, premiumLabel: 'Fable 5.2', left: { points: 10.7, tokens: 850000 }, level: 'ahead' } as any
  // the terminal
  expect(statusText(J, [], null, T0, [])).toBe('Budget tokens: 850K · usage: Weekly 36% Fable 40%')
  expect(statusText(J, [], null, T0, [IMPL])).toBe('⏳ 1 Subagent running · Budget tokens: 850K · usage: Weekly 36% Fable 40%')
  expect(statusText(J77, [], null, T0, [IMPL, READER, VERIFIER])).toBe('⏳ 3 Subagents running · Budget tokens: 850K · usage: Weekly 100% Fable 100%')
  // the desktop app: only "running" goes, never the budget or the usage
  expect(statusText(J, [], null, T0, [], LINE_MAX_NARROW)).toBe('Budget tokens: 850K · usage: Weekly 36% Fable 40%')
  expect(statusText(J, [], null, T0, [IMPL], LINE_MAX_NARROW)).toBe('⏳ 1 Subagent · Budget tokens: 850K · usage: Weekly 36% Fable 40%')
  expect(statusText(J, [], null, T0, two, LINE_MAX_NARROW)).toBe('⏳ 2 Subagents · Budget tokens: 850K · usage: Weekly 36% Fable 40%')
  expect(statusText({ ...J, left: { points: -2, tokens: -120000 } }, [], null, T0, two, LINE_MAX_NARROW)).toBe('⏳ 2 Subagents · Budget tokens: -120K · usage: Weekly 36% Fable 40%')
  // before a rate is learned, the points: "Budget:" without the word tokens
  expect(statusText({ ...J, left: { points: 4.6, tokens: null } }, [], null, T0, [IMPL], LINE_MAX_NARROW)).toBe('⏳ 1 Subagent running · Budget: 5% · usage: Weekly 36% Fable 40%')
  // the usage whole beside the longest budget, in a terminal too: the agents give way
  const ten = Array.from({ length: 10 }, (_, i) => ({ ...READER, id: 'r' + i }))
  expect(statusText({ ...FAR, left: { points: -99.9, tokens: -12345678 } } as any, [], null, T0, ten)).toBe('⏳ 10 Subagents · Budget tokens: -12.3M · usage: Weekly 100% Fable 100%')
  // a side session's "sub" where it costs the agents nothing
  expect(statusText({ ...J, spawned: true }, [], null, T0, [], LINE_MAX_NARROW)).toBe('sub · Budget tokens: 850K · usage: Weekly 36%')
  expect(statusText({ ...J, spawned: true }, [], null, T0, [IMPL], LINE_MAX_NARROW)).toBe('sub · ⏳ 1 Subagent running · Budget tokens: 850K · usage: Weekly 36%')
  expect(statusText({ ...J, spawned: true, left: { points: -2, tokens: -120000 } }, [], null, T0, two, LINE_MAX_NARROW)).toBe('sub · ⏳ 2 Subagents running · Budget tokens: -120K · usage: Weekly 36%')
  expect(statusText({ ...J, spawned: true, left: { points: -99.9, tokens: -12345678 } }, [], null, T0, two, LINE_MAX_NARROW)).toBe('⏳ 2 Subagents running · Budget tokens: -12.3M · usage: Weekly 36%')
  // the room by the surfaces that draw the session: the narrowest counts
  expect(lineMaxOf(['terminal'])).toBe(LINE_MAX)
  expect(lineMaxOf(['desktop'])).toBe(LINE_MAX_NARROW)
  expect(lineMaxOf(['terminal', 'desktop'])).toBe(LINE_MAX_NARROW)
  expect(lineMaxOf(['mobile'])).toBe(LINE_MAX_NARROW)
  expect(lineMaxOf(['vscode'])).toBe(LINE_MAX)
  expect(lineMaxOf([])).toBe(LINE_MAX)
  expect(lineMaxOf(undefined)).toBe(LINE_MAX)
})

test('an agent without a description has no assignment part, in the line, the row or the toasts', async () => {
  const bare = [{ ...READER, description: undefined }]
  expect(agentPart(bare, T0, 80)).toBe('⏳ 1 Subagent running')
  expect(statusText(J77, [], null, T0, bare)).toBe('⏳ 1 Subagent running · Budget tokens: 850K · usage: Weekly 100% Fable 100%')
  expect(startedText(bare[0], bare)).toBe('▶️ reader is running on Haiku 5.5 medium, about 5m.')
  expect(doneText(bare[0], 3 * 60000, 41000, [])).toBe('✅ reader is done after 3m, 41k tokens; nothing else is running.')
  expect(progressText(bare, T0)).toBe('⏳ still running: reader searching ~60%, 3m, about 2m left.')
  expect(backgroundText(bare, T0)).toBe('In the background: ⏳ reader searching ~60%, 3m')
  // a description over several lines is one line, where it shows
  expect(backgroundText([{ ...READER, description: 'Read\n  the logs', step: null, runs: [] }], T0)).toBe('In the background: ⏳ reader is running: Read the logs 3m')
})

test('the 5-minute toast and the row follow the same order and shrink the same way, each one line within 120', async () => {
  const two = [IMPL, READER], three = [IMPL, READER, VERIFIER]
  // the toast: the assignment quoted, several joined by "; "
  expect(progressText([IMPL], T0)).toBe('⏳ still running: implementer "Auto-reload on plugin update", editing ~60%, 2m, about 1m left.')
  expect(progressText(two, T0)).toBe('⏳ still running: implementer "Auto-reload on plugin update", editing 2m; reader "Read the test logs", searching 3m.')
  expect(progressText(three, T0)).toBe('⏳ still running: implementer "Auto-reload on plugin …" 2m; reader "Read the test logs" 3m; verifier "Run the suite" 30s.')
  const short = [{ ...IMPL, description: 'Fix' }, { ...READER, description: 'Logs' }]
  expect(progressText(short, T0)).toBe('⏳ still running: implementer "Fix", editing ~60%, 2m, about 1m left; reader "Logs", searching ~60%, 3m, about 2m left.')
  // the row above the prompt keeps the assignment: it has more room than the status line
  expect(backgroundText([IMPL], T0)).toBe('In the background: ⏳ implementer: Auto-reload on plugin update, editing ~60%, 2m')
  expect(backgroundText([{ ...IMPL, step: null, runs: [] }], T0)).toBe('In the background: ⏳ implementer is running: Auto-reload on plugin update 2m')
  expect(backgroundText(two, T0)).toBe('In the background: ⏳ implementer: Auto-reload on plugin update, editing 2m, ⏳ reader: Read the test logs, searching 3m')
  expect(backgroundText(two, T0, 117)).toBe('In the background: ⏳ implementer is running: Auto-reload on plugin up… 2m, ⏳ reader is running: Read the test logs 3m')
  expect(backgroundText(two, T0, 75)).toBe('In the background: ⏳ implementer is running 2m, ⏳ reader is running 3m')
  expect(backgroundText(two, T0, 60)).toBe('In the background: ⏳ implementer, ⏳ reader')
  expect(backgroundText(two, T0, 41)).toBe('⏳ 2 Subagents are running')
  expect(backgroundText(two, T0, 24)).toBe('⏳ 2 Subagents')
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
  expect(status.at(-1)).toBe('⏳ 1 Subagent running · Budget: 10% · usage: Weekly 10% Fable 40%')
  await $.tool.call({ tool: 'Grep', pattern: 'x', agentId: 'ag1' } as any)
  await clock.advance(2 * 60000)
  // capped at 95 % at the median and past it, the step in the toast
  expect(seen.toasts.at(-1)).toBe('⏳ still running: reader "a task", searching ~95%, 5m.')
  expect(status.at(-1)).toBe('⏳ 1 Subagent running · Budget: 10% · usage: Weekly 10% Fable 40%')
  // /pacing-status: the same order, and the model the agent runs on
  expect((await $.command.run({ command: 'pacing-status', args: '' } as any)).text.split('\n')[1]).toBe('Running: reader: a task, searching ~95%, 5m (Haiku 5.5)')
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
  expect(status.at(-1)).toBe('⏳ 1 Subagent running · Budget: 10% · usage: Weekly 10% Fable 40%')
})

// ---- an offer to switch the session's model or effort ----

const REC_OPUS_HIGH = { model: 'claude-opus-5-5', label: 'Opus 5.5', effort: 'high' }
const switchReading = (extra: Record<string, unknown> = {}) => answer('ahead', 10, { premiumModelId: 'claude-fable-5-2', recommend: { model: 'claude-fable-5-2', label: 'Fable 5.2', effort: 'high' }, ...extra })
// the engine beneath for a switch: the commands run, what the session runs
// on (it follows /model and /effort), the box filled, the toasts, the config
const switchEngine = (on: any, opts: { model?: string; effort?: string; config?: string; failRun?: boolean; sticky?: boolean; busy?: Promise<void> } = {}) => {
  const seen = { runs: [] as string[], fills: [] as string[], toasts: [] as string[], model: opts.model ?? 'claude-fable-5-2', effort: opts.effort ?? 'high' }
  on('command.run', async (_: unknown, e: any) => {
    if (opts.failRun) throw new Error('no such command here')
    seen.runs.push('/' + e.command + ' ' + e.args)
    // a busy session runs a queued command only once it is free
    if (opts.busy) await opts.busy
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

test('the switch: only for a session on the per-model meter\'s model while it is out, or held 20 points or more over its line', async () => {
  const base = { premiumModelId: 'claude-fable-5-2', premiumLabel: 'Fable 5.2', recommend: REC_OPUS_HIGH, line: 70 }
  expect(switchOffer({ ...base, premiumOut: true }, 'claude-fable-5-2', 'high')).toMatchObject({ kind: 'out', urgent: true, text: 'Fable 5.2 is out until the reset. Switch this session to Opus 5.5 high.' })
  expect(HELD_SWITCH_AT).toBe(20)
  expect(switchOffer({ ...base, premiumHeld: true, premium: 90 }, 'claude-fable-5-2', 'high')).toMatchObject({ kind: 'held', urgent: true, text: 'Fable 5.2\'s meter is over its budget line. Switch to Opus 5.5 high; Fable stays for hard tasks.' })
  // held only 10 points over: the subagents take the work, no row
  expect(switchOffer({ ...base, premiumHeld: true, premium: 80 }, 'claude-fable-5-2', 'high')).toBe(null)
  // out or held, on another model: no row
  expect(switchOffer({ ...base, premiumOut: true }, 'claude-sonnet-5-5', 'high')).toBe(null)
  expect(switchOffer({ ...base, premiumHeld: true, premium: 90 }, 'claude-sonnet-5-5', 'high')).toBe(null)
  // another model or effort than recommended, nothing out or held: no row (the plugin moves work to subagents itself)
  expect(switchOffer({ ...base, recommend: { model: 'claude-opus-5-5', label: 'Opus 5.5', effort: 'medium' } }, 'claude-fable-5-2', 'high')).toBe(null)
  expect(switchOffer({ ...base, recommend: { model: 'claude-opus-5-5', label: 'Opus 5.5', effort: 'medium' } }, 'claude-opus-5-5', 'high')).toBe(null)
  const step = { ...base, recommend: { model: 'claude-fable-5-2', label: 'Fable 5.2', effort: 'high' }, effortStep: { model: 'claude-fable-5-2', label: 'Fable 5.2', effort: 'medium' } }
  expect(switchOffer(step, 'claude-fable-5-2', 'high')).toBe(null)
  expect(switchOffer({ ...base, recommend: REC_OPUS_HIGH }, 'claude-opus-5-5', 'high')).toBe(null)
  expect(switchOffer(base, null as any, 'high')).toBe(null)
})

test('Fable out: the row in the warning colour; Switch runs /model and /effort and a toast reads back what the session runs on', async ($, on) => {
  engine(on)
  const clock = mock.clock(on, { now: T0 })
  on('process.run', () => ({ value: switchReading({ premiumOut: true, recommend: REC_OPUS_HIGH }) }))
  const seen = switchEngine(on, { effort: 'medium' })
  await $.prompt.submit({ text: 'work on', asUser: true })
  await $.session.measure(measure(10))
  await $.turn.complete(turn('claude-fable-5-2', 1))
  const ui = await $.ui.mount(BAND)
  expect((await ui.find({ type: 'Text' }))?.text).toBe('🔴 Fable 5.2 is out until the reset. Switch this session to Opus 5.5 high.')
  await ui.press({ key: 'pacing-switch' })
  await clock.advance(1)
  await ui.unmount()
  expect(seen.runs).toEqual(['/model claude-opus-5-5', '/effort high'])
  expect(seen.toasts.at(-1)).toBe('🔁 this session now runs on Opus 5.5 high; the model menu may still show Fable 5.2.')
  expect(await switchText($)).toBe(undefined)
})

test('Switch goes by the model the offer saw: a session read that already names the target still runs /model', async ($, on) => {
  engine(on)
  const clock = mock.clock(on, { now: T0 })
  on('process.run', () => ({ value: switchReading({ premiumHeld: true, recommend: REC_OPUS_HIGH }) }))
  // the session read says Opus 5.5, the turns run on Fable 5.2
  const seen = switchEngine(on, { model: 'claude-opus-5-5', effort: 'medium' })
  await $.prompt.submit({ text: 'work on', asUser: true })
  await $.session.measure(measure(10))
  await $.turn.complete(turn('claude-fable-5-2', 1))
  const ui = await $.ui.mount(BAND)
  expect((await ui.find({ type: 'Text' }))?.text).toBe('⚠️ Fable 5.2\'s meter is over its budget line. Switch to Opus 5.5 high; Fable stays for hard tasks.')
  await ui.press({ key: 'pacing-switch' })
  await clock.advance(1)
  await ui.unmount()
  expect(seen.runs).toEqual(['/model claude-opus-5-5', '/effort high'])
  expect(seen.toasts.at(-1)).toBe('🔁 this session now runs on Opus 5.5 high; the model menu may still show Fable 5.2.')
})

test('Fable out or held is no row for a session the turns show on another model, whatever its effort', async ($, on) => {
  engine(on)
  mock.clock(on, { now: T0 })
  let next = switchReading({ premiumOut: true, recommend: { model: 'claude-opus-5-5', label: 'Opus 5.5', effort: 'medium' } })
  on('process.run', () => ({ value: next }))
  // the turns' usage names Opus 5.5 (what the module goes by), at another effort than recommended
  const seen = switchEngine(on, { model: 'claude-opus-5-5', effort: 'high' })
  await $.prompt.submit({ text: 'work on', asUser: true })
  await $.session.measure(measure(10))
  await $.turn.complete(turn('claude-opus-5-5', 1))
  expect(await switchText($)).toBe(undefined)
  next = switchReading({ premiumHeld: true, recommend: { model: 'claude-opus-5-5', label: 'Opus 5.5', effort: 'medium' } })
  await $.session.measure(measure(11))
  await $.turn.complete(turn('claude-opus-5-5', 1))
  expect(await switchText($)).toBe(undefined)
  expect(seen.runs).toEqual([])
})

// The user found a switch too many commands: only the part that differs runs.
test('Switch runs only what differs from what the session runs on: an effort already set needs no /effort, a model already set no /model', async ($, on) => {
  engine(on)
  const clock = mock.clock(on, { now: T0 })
  on('process.run', () => ({ value: switchReading({ premiumOut: true, recommend: REC_OPUS_HIGH }) }))
  const seen = switchEngine(on, { effort: 'medium' })
  await $.prompt.submit({ text: 'work on', asUser: true })
  // the session is set to high already (typed); the model is Fable
  await $.command.run({ command: 'effort', args: 'high' } as any)
  await $.session.measure(measure(10))
  await $.turn.complete(turn('claude-fable-5-2', 1))
  seen.runs.length = 0
  const ui = await $.ui.mount(BAND)
  await ui.press({ key: 'pacing-switch' })
  await clock.advance(1)
  await ui.unmount()
  expect(seen.runs).toEqual(['/model claude-opus-5-5'])
  expect(seen.toasts.at(-1)).toBe('🔁 this session now runs on Opus 5.5 high; the model menu may still show Fable 5.2.')
})

test('what the main thread\'s last request carried counts as what the session runs on; a subagent\'s does not', async ($, on) => {
  engine(on)
  const clock = mock.clock(on, { now: T0 })
  on('process.run', () => ({ value: switchReading({ premiumOut: true, recommend: REC_OPUS_HIGH }) }))
  const seen = switchEngine(on, { effort: 'medium' })
  on('turn.step', async function* (_: unknown, e: any) { return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null } as any })
  const step = async (extra: Record<string, unknown>) => {
    const s = ($.turn as any).step({ turnId: 't', index: 0, messageCount: 1, ...extra })
    for await (const _ of s) { /* drained */ }
  }
  await $.prompt.submit({ text: 'work on', asUser: true })
  await step({ model: 'claude-fable-5-2', effort: 'high' })
  // a subagent on another effort changes nothing
  await step({ model: 'claude-haiku-5-5', effort: 'low', agentId: 'a1' })
  await $.session.measure(measure(10))
  await $.turn.complete(turn('claude-fable-5-2', 1))
  const ui = await $.ui.mount(BAND)
  await ui.press({ key: 'pacing-switch' })
  await clock.advance(1)
  await ui.unmount()
  expect(seen.runs).toEqual(['/model claude-opus-5-5'])
})

test('a session on another model than the reading recommends gets no row, nothing out or held: the subagents take the work', async ($, on) => {
  engine(on)
  mock.clock(on, { now: T0 })
  on('process.run', () => ({ value: switchReading({ recommend: { model: 'claude-opus-5-5', label: 'Opus 5.5', effort: 'medium' } }) }))
  switchEngine(on, { effort: 'medium' })
  on('turn.step', async function* (_: unknown, e: any) { return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null } as any })
  await $.prompt.submit({ text: 'work on', asUser: true })
  for await (const _ of ($.turn as any).step({ turnId: 't', index: 0, messageCount: 1, model: 'claude-fable-5-2', effort: 'high' })) { /* drained */ }
  await $.session.measure(measure(10))
  await $.turn.complete(turn('claude-fable-5-2', 1))
  expect(await switchText($)).toBe(undefined)
})

test('another effort alone, on the model the reading recommends, is no row: no /effort is offered', async ($, on) => {
  engine(on)
  mock.clock(on, { now: T0 })
  on('process.run', () => ({ value: switchReading({ recommend: { model: 'claude-opus-5-5', label: 'Opus 5.5', effort: 'medium' } }) }))
  const seen = switchEngine(on, { model: 'claude-opus-5-5', effort: 'high' })
  await $.prompt.submit({ text: 'work on', asUser: true })
  // set to Opus 5.5 high by the commands (typed)
  await $.command.run({ command: 'model', args: 'claude-opus-5-5' } as any)
  await $.command.run({ command: 'effort', args: 'high' } as any)
  await $.session.measure(measure(10))
  await $.turn.complete(turn('claude-opus-5-5', 1))
  seen.runs.length = 0
  expect(await switchText($)).toBe(undefined)
  expect(await bandKeys($)).toEqual([])
  expect(seen.runs).toEqual([])
})

test('Switch while the session is busy: the press is back at once, a toast says the switch waits, and it runs when the session is free', async ($, on) => {
  engine(on)
  const clock = mock.clock(on, { now: T0 })
  on('process.run', () => ({ value: switchReading({ premiumOut: true, recommend: REC_OPUS_HIGH }) }))
  let free = () => {}
  const seen = switchEngine(on, { effort: 'medium', busy: new Promise<void>(r => { free = r }) })
  await $.prompt.submit({ text: 'work on', asUser: true })
  await $.session.measure(measure(10))
  await $.turn.complete(turn('claude-fable-5-2', 1))
  const said = seen.toasts.length
  const ui = await $.ui.mount(BAND)
  await ui.press({ key: 'pacing-switch' })
  await ui.unmount()
  // nothing ran within the press, and the row is gone
  expect(seen.runs).toEqual([])
  expect(await switchText($)).toBe(undefined)
  await clock.advance(1)
  expect(seen.runs).toEqual(['/model claude-opus-5-5'])
  expect(seen.toasts.slice(said)).toEqual([])
  await clock.advance(RUN_WAIT)
  expect(seen.toasts.slice(said)).toEqual(['🔁 the switch to Opus 5.5 high runs as soon as the session is free.'])
  expect(switchWaitText(REC_OPUS_HIGH)).toBe('🔁 the switch to Opus 5.5 high runs as soon as the session is free.')
  free()
  await clock.advance(1)
  expect(seen.runs).toEqual(['/model claude-opus-5-5', '/effort high'])
  expect(seen.toasts.slice(said)).toEqual([switchWaitText(REC_OPUS_HIGH), '🔁 this session now runs on Opus 5.5 high; the model menu may still show Fable 5.2.'])
  // a switch that ran at once says nothing of waiting
  expect(RUN_WAIT).toBe(1500)
})

test('a switch in a large session says what it costs and offers the compaction first; a small one and a model that is out do not', () => {
  const base = { premiumModelId: 'claude-fable-5-2', premiumLabel: 'Fable 5.2', prices: PRICES, premiumHeld: true, premium: 95, line: 73.3, recommend: { model: 'claude-opus-5-5', label: 'Opus 5.5', effort: 'medium' } }
  const plain = 'Fable 5.2\'s meter is over its budget line. Switch to Opus 5.5 medium; Fable stays for hard tasks.'
  expect(SWITCH_LARGE).toBe(200000)
  // 250 000 tokens at Opus 5.5's $5 a million to store: $1.25
  expect(switchOffer(base, 'claude-fable-5-2', 'high', 250000)).toMatchObject({ kind: 'held', urgent: true, compactFirst: true,
    text: plain + ' A switch stores this session\'s 250k tokens again: compact first.' })
  expect(switchOffer({ ...base, tokenUsd: 8e-6 }, 'claude-fable-5-2', 'high', 250000)?.text)
    .toBe(plain + ' A switch stores this session\'s 250k tokens again (about 156K tokens of the budget): compact first.')
  expect(switchOffer({ ...base, tokenUsd: 8e-6, paceUsd: 2.5 }, 'claude-fable-5-2', 'high', 250000)?.text)
    .toBe(plain + ' A switch stores this session\'s 250k tokens again (about 30m of the budget): compact first.')
  // under 200 000 tokens, or a size not known: as before
  expect(switchOffer(base, 'claude-fable-5-2', 'high', 199999)).toMatchObject({ compactFirst: false, text: plain })
  expect(switchOffer(base, 'claude-fable-5-2', 'high')).toMatchObject({ compactFirst: false, text: plain })
  // out: the compaction would run on the model that is out
  expect(switchOffer({ ...base, premiumHeld: false, premiumOut: true }, 'claude-fable-5-2', 'high', 250000)).toMatchObject({ kind: 'out', compactFirst: false })
})

test('Compact, then switch: the compaction first, then /model and /effort; Switch alone still switches at once', async ($, on) => {
  engine(on)
  const clock = mock.clock(on, { now: T0 })
  on('process.run', () => ({ value: switchReading({ premiumHeld: true, premiumLabel: 'Fable 5.2', recommend: REC_OPUS_HIGH }) }))
  const seen = switchEngine(on, { effort: 'medium' })
  on('session.compact', (_: unknown, e: any) => (seen.runs.push('compact'), { messages: [{ role: 'assistant', text: 's', toolUses: [] }], tokensBefore: 250000, tokensAfter: 40000 }))
  await $.prompt.submit({ text: 'work on', asUser: true })
  await $.session.measure(measure(10, [], 250000))
  await $.turn.complete(turn('claude-fable-5-2', 1))
  expect(await switchText($)).toBe('⚠️ Fable 5.2\'s meter is over its budget line. Switch to Opus 5.5 high; Fable stays for hard tasks. A switch stores this session\'s 250k tokens again: compact first.')
  expect(await bandKeys($)).toEqual(['pacing-compact-switch', 'pacing-switch', 'pacing-switch-not-now'])
  const ui = await $.ui.mount(BAND)
  await ui.press({ key: 'pacing-compact-switch' })
  await clock.advance(1)
  await ui.unmount()
  expect(seen.runs).toEqual(['compact', '/model claude-opus-5-5', '/effort high'])
  expect(seen.toasts.at(-1)).toBe('🔁 this session now runs on Opus 5.5 high; the model menu may still show Fable 5.2.')
  expect(await switchText($)).toBe(undefined)
})

test('Compact, then switch in the desktop app: /compact as if typed, then the switch; a compaction that does not start leaves the model alone', async ($, on) => {
  engine(on)
  const clock = mock.clock(on, { now: T0 })
  on('process.run', () => ({ value: switchReading({ premiumHeld: true, recommend: { model: 'claude-opus-5-5', label: 'Opus 5.5', effort: 'medium' } }) }))
  const seen = switchEngine(on)
  on('session.compact', () => { throw new Error('pacing: $.session.compact: not available in a headless (-p / SDK) session yet') })
  await $.prompt.submit({ text: 'work on', asUser: true })
  await $.session.measure(measure(10, [], 250000))
  await $.turn.complete(turn('claude-fable-5-2', 1))
  const ui = await $.ui.mount(BAND)
  await ui.press({ key: 'pacing-compact-switch' })
  await clock.advance(1)
  await ui.unmount()
  expect(seen.runs).toEqual(['/compact ' + COMPACT_INSTRUCTIONS, '/model claude-opus-5-5', '/effort medium'])
  expect(seen.toasts.at(-1)).toBe('🔁 this session now runs on Opus 5.5 medium; the model menu may still show Fable 5.2.')
})

test('Compact, then switch where no compaction starts: /compact in the box and the reason, the model left alone', async ($, on) => {
  engine(on)
  const clock = mock.clock(on, { now: T0 })
  on('process.run', () => ({ value: switchReading({ premiumHeld: true, recommend: { model: 'claude-opus-5-5', label: 'Opus 5.5', effort: 'medium' } }) }))
  const seen = switchEngine(on, { failRun: true })
  on('session.compact', () => { throw new Error('pacing: $.session.compact: not available here') })
  await $.prompt.submit({ text: 'work on', asUser: true })
  await $.session.measure(measure(10, [], 250000))
  await $.turn.complete(turn('claude-fable-5-2', 1))
  const ui = await $.ui.mount(BAND)
  await ui.press({ key: 'pacing-compact-switch' })
  await clock.advance(1)
  await ui.unmount()
  expect(seen.runs).toEqual([])
  expect(seen.fills).toEqual(['/compact'])
  expect(seen.toasts.at(-1)).toMatch(/^❌ the compaction did not start: .*\/compact is in the box: press Enter to send it\.$/)
})

test('once per suggestion: Not now holds until the recommendation changes', async ($, on) => {
  engine(on)
  let next = switchReading({ premiumHeld: true, recommend: { model: 'claude-opus-5-5', label: 'Opus 5.5', effort: 'medium' } })
  on('process.run', () => ({ value: next }))
  const clock = mock.clock(on, { now: T0 })
  const seen = switchEngine(on)
  await $.prompt.submit({ text: 'work on', asUser: true })
  await $.session.measure(measure(10))
  await $.turn.complete(turn('claude-fable-5-2', 1))
  const ui = await $.ui.mount(BAND)
  expect((await ui.find({ type: 'Text' }))?.text).toBe('⚠️ Fable 5.2\'s meter is over its budget line. Switch to Opus 5.5 medium; Fable stays for hard tasks.')
  await ui.press({ key: 'pacing-switch-not-now' })
  await ui.unmount()
  await $.turn.complete(turn('claude-fable-5-2', 1))
  expect(await switchText($)).toBe(undefined)
  // a new recommendation is a new suggestion
  next = switchReading({ premiumHeld: true, recommend: REC_OPUS_HIGH })
  await clock.advance(31 * 60000)
  await $.session.measure(measure(10))
  await $.turn.complete(turn('claude-fable-5-2', 1))
  expect(await switchText($)).toBe('⚠️ Fable 5.2\'s meter is over its budget line. Switch to Opus 5.5 high; Fable stays for hard tasks.')
  expect(seen.runs).toEqual([])
})

test('the switch that cannot run fills the box for the user to send; one that did not take says so', async ($, on) => {
  engine(on)
  const clock = mock.clock(on, { now: T0 })
  on('process.run', () => ({ value: switchReading({ premiumOut: true, recommend: REC_OPUS_HIGH }) }))
  const seen = switchEngine(on, { failRun: true })
  await $.prompt.submit({ text: 'work on', asUser: true })
  await $.session.measure(measure(10))
  await $.turn.complete(turn('claude-fable-5-2', 1))
  const ui = await $.ui.mount(BAND)
  await ui.press({ key: 'pacing-switch' })
  await clock.advance(1)
  await ui.unmount()
  expect(seen.fills).toEqual(['/model claude-opus-5-5'])
  expect(seen.toasts.at(-1)).toBe('🔁 press Enter to switch to Opus 5.5; then set effort high in the model menu.')
  expect(switchedText(REC_OPUS_HIGH, 'claude-fable-5-2', 'high')).toBe('❌ the switch did not take; the session still runs on Fable 5.2. The model menu does it: Opus 5.5, effort high.')
})

test('one row at a time: a model that is out before the offer to compact; a session left on another model than recommended leaves the offer', async ($, on) => {
  engine(on)
  let next = switchReading({ premiumOut: true, recommend: REC_OPUS_HIGH })
  on('process.run', () => ({ value: next }))
  const clock = mock.clock(on, { now: T0 })
  switchEngine(on)
  await $.prompt.submit({ text: 'work on', asUser: true })
  await $.session.measure(measure(10, [], 420000))
  await $.turn.complete(turn('claude-fable-5-2', 1))
  expect(await switchText($)).toMatch(/^🔴 Fable 5\.2 is out until the reset/)
  // another model recommended is no row: the offer to compact shows
  next = switchReading({ recommend: { model: 'claude-opus-5-5', label: 'Opus 5.5', effort: 'medium' } })
  await clock.advance(31 * 60000)
  await $.session.measure(measure(10, [], 330000))
  await $.turn.complete(turn('claude-fable-5-2', 1))
  expect(await switchText($)).toBe('🗜️ This session is 420k tokens. Compacting now makes every later turn cheaper.')
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

// the engine's store and the session's id, for what the module keeps
const storeEngine = (on: any) => {
  const store: Record<string, any> = {}
  on('session.id', () => ({ value: 'local_s1' }))
  on('store.get', (_: unknown, e: any) => ({ value: store[e.key] === undefined ? undefined : JSON.parse(JSON.stringify(store[e.key])) }))
  on('store.set', (_: unknown, e: any) => { store[e.key] = JSON.parse(JSON.stringify(e.value)); return { value: undefined } })
  on('store.delete', (_: unknown, e: any) => { delete store[e.key]; return { value: undefined } })
  return store
}
const FABLE_MEDIUM = { model: 'claude-fable-5-2', label: 'Fable 5.2', effort: 'medium' }

test('Switch: a read-back that still names the old model is read again after a moment, the commands trusted; the toast says the menu may lag; the row does not come back', async ($, on) => {
  engine(on)
  on('process.run', () => ({ value: switchReading({ premiumOut: true, recommend: REC_OPUS_HIGH }) }))
  const clock = mock.clock(on, { now: T0 })
  // the engine goes on naming Fable 5.2 and CLAUDE_EFFORT medium after the commands ran
  const seen = switchEngine(on, { effort: 'medium', sticky: true })
  const store = storeEngine(on)
  await $.prompt.submit({ text: 'work on', asUser: true })
  await $.session.measure(measure(10))
  await $.turn.complete(turn('claude-fable-5-2', 1))
  const ui = await $.ui.mount(BAND)
  await ui.press({ key: 'pacing-switch' })
  await clock.advance(1)
  await ui.unmount()
  expect(seen.runs).toEqual(['/model claude-opus-5-5', '/effort high'])
  // right after the press: no failure said, and no word yet
  expect(seen.toasts).toEqual([])
  await clock.advance(READ_BACK_LAG)
  expect(seen.toasts).toEqual(['🔁 this session now runs on Opus 5.5 high; the model menu may still show Fable 5.2.'])
  expect(store['switch:local_s1']).toEqual({ model: 'claude-opus-5-5', effort: 'high' })
  // the next turn runs on Opus 5.5: its usage names the model from here; the effort stays as set
  await $.turn.complete(turn('claude-opus-5-5', 1))
  expect(await switchText($)).toBe(undefined)
  expect(store['switch:local_s1']).toEqual({ model: null, effort: 'high' })
  // a command that answered with an error is not trusted
  expect(commandFailed({ text: 'no', exitCode: 1 })).toBe(true)
  expect(commandFailed({ text: 'Set model to Opus 5.5' })).toBe(false)
  expect(commandFailed(undefined)).toBe(false)
  // only an effort switched: no word on the menu
  expect(switchedText(FABLE_MEDIUM, 'claude-fable-5-2', 'medium', 'claude-fable-5-2')).toBe('🔁 this session now runs on Fable 5.2 medium.')
})

test('a typed /effort is noted: the session runs at it, though CLAUDE_EFFORT still says the old one, and Switch runs no /effort for it', async ($, on) => {
  engine(on)
  const clock = mock.clock(on, { now: T0 })
  on('process.run', () => ({ value: switchReading({ premiumOut: true, recommend: REC_OPUS_HIGH }) }))
  const seen = switchEngine(on, { effort: 'medium', sticky: true })
  const store = storeEngine(on)
  await $.prompt.submit({ text: 'work on', asUser: true })
  // an effort the command does not take is not noted
  await $.command.run({ command: 'effort', args: 'turbo' } as any)
  expect(store['switch:local_s1']).toBe(undefined)
  await $.command.run({ command: 'effort', args: 'high' } as any)
  expect(store['switch:local_s1']).toEqual({ model: null, effort: 'high' })
  await $.session.measure(measure(10))
  await $.turn.complete(turn('claude-fable-5-2', 1))
  const ui = await $.ui.mount(BAND)
  await ui.press({ key: 'pacing-switch' })
  await clock.advance(1)
  await ui.unmount()
  expect(seen.runs).toEqual(['/effort turbo', '/effort high', '/model claude-opus-5-5'])
})

test('the effort last set is kept across a reload: the new copy offers no switch to what is set already', async ($, on) => {
  engine(on)
  on('process.run', () => ({ value: switchReading({ recommend: FABLE_MEDIUM }) }))
  const clock = mock.clock(on, { now: T0 })
  switchEngine(on, { sticky: true })
  const store = storeEngine(on)
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('command.register', (_: unknown, e: any) => ({ value: { command: e.name } }))
  on('tool.call', () => ({ result: {} }))
  store['switch:local_s1'] = { model: null, effort: 'medium' }
  await start($)
  await clock.settle()
  await $.prompt.submit({ text: 'work on', asUser: true })
  await $.session.measure(measure(10))
  await $.turn.complete(turn('claude-fable-5-2', 1))
  expect(await switchText($)).toBe(undefined)
})

test('Switch after a reload: the effort kept in the store is already the target, so the press sends no /effort', async ($, on) => {
  engine(on)
  on('process.run', () => ({ value: switchReading({ premiumOut: true, recommend: REC_OPUS_HIGH }) }))
  const clock = mock.clock(on, { now: T0 })
  // CLAUDE_EFFORT still says medium, as at the session's start
  const seen = switchEngine(on, { effort: 'medium' })
  const store = storeEngine(on)
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('command.register', (_: unknown, e: any) => ({ value: { command: e.name } }))
  on('tool.call', () => ({ result: {} }))
  // set to high before the reload; the new copy's memory is empty
  store['switch:local_s1'] = { model: null, effort: 'high' }
  await start($)
  await clock.settle()
  await $.prompt.submit({ text: 'work on', asUser: true })
  await $.session.measure(measure(10))
  await $.turn.complete(turn('claude-fable-5-2', 1))
  const ui = await $.ui.mount(BAND)
  await ui.press({ key: 'pacing-switch' })
  await clock.advance(1)
  await ui.unmount()
  expect(seen.runs).toEqual(['/model claude-opus-5-5'])
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
  expect(status.at(-1)).toBe('Budget: 10% · usage: Weekly 10% Fable 40%')
  // from the stored figures, dry: nothing logged
  expect(seen.runs.at(-1)!.slice(2)).toEqual(['--all', '10', '--reset', RESET, '--source', 'hook', '--five', '4', '--five-reset', '2026-11-13T15:00:00.000Z', '--dry'])
})

test('a load with no meters yet redraws from a dry run; the first reading after it comes at once, and is no change of level for the toast', async ($, on) => {
  const status = engine(on)
  let next = answer('over', 21)
  const seen = loadEngine(on, { state: { all: 21, reset: RESET }, answers: () => next })
  await start($)
  await settled(status, 0)
  expect(status.at(-1)).toBe('Budget: -1% · usage: Weekly 21% Fable 40%')
  expect(seen.runs.length).toBe(1)
  expect(seen.runs[0]).toContain('--dry')
  // the first response: a full reading at once, no 30 minutes, no point moved
  next = answer('ahead', 10)
  await $.session.measure(measure(21))
  expect(seen.runs.length).toBe(2)
  expect(seen.runs[1]).not.toContain('--dry')
  // over -> ahead between a stored figure and a fresh one is no change the user was told of
  expect(seen.toasts).toEqual([])
  expect(status.at(-1)).toBe('Budget: 10% · usage: Weekly 10% Fable 40%')
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
  expect(status.at(-1)).toBe('Budget: 8% · usage: Weekly 12% Fable 40%')
  // the same figure moments later: no second run
  await $.session.measure(measure(12))
  expect(seen.runs.length).toBe(1)
})

test('a pane drawn before the load reading came in shows it when it comes; meanwhile it says a reading is on its way', async ($, on) => {
  const status = engine(on)
  loadEngine(on, {
    limits: [{ kind: 'seven_day', percentUsed: 12, resetsAt: RESET }],
    state: { all: 9, reset: RESET }, answers: () => answer('ahead', 12),
  })
  await start($)
  const ui = await $.ui.mount(PANE)
  const first = (await ui.findAll({ type: 'Text' })).map((t: any) => t.text)
  expect(first.some((s: string) => s === 'Reading the meters…' || s === '8%')).toBe(true)
  await settled(status, 0)
  await new Promise(r => setTimeout(r, 50))
  const texts = (await ui.findAll({ type: 'Text' })).map((t: any) => t.text)
  expect(texts).toContain('8%')
  expect(texts.some((s: string) => /No reading yet|Reading the meters/.test(s))).toBe(false)
  await ui.unmount()
  expect(paneModel({ busy: true }).empty).toBe('Reading the meters…')
  expect(paneModel({}).empty).toBe('No reading yet in this session: /pacing usage takes one.')
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
  expect(during[0]).toBe('⏳ 1 Subagent running · Budget: 10% · usage: Weekly 10% Fable 40%')
  expect(during[1]).toBe('⏳ 1 Subagent running · Budget: 10% · usage: Weekly 10% Fable 40%')
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
  expect(status.at(-1)).toBe('Budget: 10% · usage: Weekly 10% Fable 40%')
})

test('every 5 seconds while an agent runs; the timer stops when nothing runs', async ($, on) => {
  const status = engine(on)
  big(on)
  const clock = mock.clock(on, { now: T0 })
  agentEngine(on, { list: () => [{ id: 'ag1', status: 'running' }] })
  await $.session.measure(measure(10))
  await spawn($, 'pacing:reader')
  const drawn = status.length
  await clock.advance(5000)
  expect(status.length).toBe(drawn + 1)
  expect(status.at(-1)).toBe('⏳ 1 Subagent running · Budget: 10% · usage: Weekly 10% Fable 40%')
  await clock.advance(5000)
  expect(status.length).toBe(drawn + 2)
  await $.turn.complete(turn('claude-haiku-5-5', 1, 'ag1'))
  const n = status.length
  await clock.advance(60000)
  expect(status.length).toBe(n)
})

test('in the desktop app the line keeps within 70: the count without "running", the budget and the usage whole; a terminal alone keeps 75', async ($, on) => {
  const status = engine(on)
  // a learned rate: the budget in tokens, 850K
  on('process.run', () => ({ value: answer('ahead', 10, { rate: 85000 }) }))
  mock.clock(on, { now: T0 })
  agentEngine(on, { list: () => [{ id: 'ag1', status: 'running' }, { id: 'ag2', status: 'running' }] })
  let surfaces = ['terminal', 'desktop']
  let asked = 0
  on('session.surfaces', () => (asked++, { value: surfaces }))
  on('session.detach', (_: unknown, e: any) => ({ ...e }))
  await $.session.measure(measure(10))
  expect(status.at(-1)).toBe('Budget tokens: 850K · usage: Weekly 10% Fable 40%')
  await spawn($, 'pacing:reader')
  expect(status.at(-1)).toBe('⏳ 1 Subagent · Budget tokens: 850K · usage: Weekly 10% Fable 40%')
  await spawn($, 'pacing:implementer')
  expect(status.at(-1)).toBe('⏳ 2 Subagents · Budget tokens: 850K · usage: Weekly 10% Fable 40%')
  // asked once, and kept
  await $.session.measure(measure(10))
  expect(asked).toBe(1)
  // the desktop app detaches: asked again, the terminal's room
  surfaces = ['terminal']
  await $.session.detach({ clientId: 'desktop:default' } as any)
  expect(asked).toBe(2)
  expect(status.at(-1)).toBe('⏳ 2 Subagents running · Budget tokens: 850K · usage: Weekly 10% Fable 40%')
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
  expect(status.at(-1)).toBe('⏳ 1 Subagent running · Budget: 10% · usage: Weekly 10% Fable 40%')
  expect(seen.toasts).toEqual(['▶️ side session Task s1 is running.'])
  await clock.advance(20000)
  expect(status.at(-1)).toBe('⏳ 1 Subagent running · Budget: 10% · usage: Weekly 10% Fable 40%')
  // its turn ends: gone at the next poll
  running = false
  await clock.advance(15000)
  expect(seen.toasts.at(-1)).toBe('✅ side session Task s1 ended its turn after 35s; nothing else is running.')
  expect(status.at(-1)).toBe('Budget: 10% · usage: Weekly 10% Fable 40%')
  // a session another one started is not this one's
  expect(status.join('\n')).not.toContain('other')
})

test('at load, side sessions already working show without a toast; an agent and a side session are one count of Subagents', async ($, on) => {
  const status = engine(on)
  big(on)
  mock.clock(on, { now: T0 })
  const seen = sessionEngine(on, () => [row('s1', true)])
  await $.session.measure(measure(10))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true } as any)
  await new Promise(r => setTimeout(r, 50))
  expect(seen.toasts).toEqual([])
  expect(status.at(-1)).toBe('⏳ 1 Subagent running · Budget: 10% · usage: Weekly 10% Fable 40%')
  await $.agent.spawn({ prompt: 'p', description: 'x', subagentType: 'pacing:reader', model: 'haiku' } as any)
  expect(status.at(-1)).toBe('⏳ 2 Subagents running · Budget: 10% · usage: Weekly 10% Fable 40%')
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

test('a side session counts as a subagent in the line; the toasts name it by its short title', async () => {
  const a = { id: 'a', type: 'pacing:reader', startedAt: T0 - 60000 } as any
  const s = { id: 's', kind: 'session', type: 'pacing-pace-fable-met-4', label: 'Pacing: pace Fable meter…', startedAt: T0 - 120000 } as any
  expect(countText([a, s])).toBe('2 Subagents')
  expect(agentPart([s], T0, 80)).toBe('⏳ 1 Subagent running')
  expect(agentPart([s], T0, 12)).toBe('⏳ 1 Subagent')
  expect(agentPart([a, s], T0, 80)).toBe('⏳ 2 Subagents running')
  expect(agentPart([a, s], T0, 13)).toBe('⏳ 2 Subagents')
  expect(agentPart([a, s], T0, 3)).toBe('⏳2')
  // with the budget, within the width
  expect(statusText({ all: 36, ofBudget: 77, left: { points: 10.7, tokens: 850000 }, level: 'ahead' } as any, [], null, T0, [s])).toBe('⏳ 1 Subagent running · Budget tokens: 850K · usage: Weekly 36%')
  expect(statusText({ all: 99, ofBudget: 214, left: { points: -53.3, tokens: -4530500 }, level: 'throttle' } as any, [], null, T0, [a, s], LINE_MAX_NARROW)).toBe('⏳ 2 Subagents running · Budget tokens: -4.5M · usage: Weekly 99%')
  expect(chars(statusText({ ...FAR, level: 'throttle' } as any, [], 'Other' as any, T0, [a, s, { ...s, id: 't' }]))).toBeLessThanOrEqual(LINE_MAX)
  expect(sessionDoneText(s, 120000, [a])).toBe('✅ side session Pacing: pace Fable meter… ended its turn after 2m; reader is still running.')
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

// ---- a new version: the new-version row ----

// the engine beneath: the manifest as it stands
// on disk (a test changes them as the app's sync would), the session's id,
// the config file, the module's store, the slash commands run (none should
// be), the prompt box filled (never) and the toasts
const manifestOf = (version: string) => JSON.stringify({ name: 'pacing', version })
const reloadEngine = (on: any, opts: { config?: string; store?: Record<string, unknown> } = {}) => {
  const seen = { runs: [] as string[], toasts: [] as string[], fills: [] as string[], store: { ...(opts.store ?? {}) } as Record<string, unknown>, manifest: manifestOf('0.9.10') as string | null }
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
    return { value: opts.config !== undefined && /[\\/]\.claude[\\/]pacing[\\/]config\.json$/.test(p) ? opts.config : '{}' }
  })
  on('command.run', (_: unknown, e: any) => {
    seen.runs.push('/' + e.command + (e.args ? ' ' + e.args : ''))
    return { text: 'ran' }
  })
  on('store.get', (_: unknown, e: any) => ({ value: seen.store[e.key] }))
  on('store.set', (_: unknown, e: any) => { seen.store[e.key] = e.value; return { value: undefined } })
  on('store.delete', (_: unknown, e: any) => { delete seen.store[e.key]; return { value: undefined } })
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.toast', (_: unknown, e: any) => (seen.toasts.push(e.text), { value: undefined }))
  on('prompt.submit', (_: unknown, e: any) => ({ text: e.text }))
  on('prompt.fill', (_: unknown, e: any) => (seen.fills.push(e.text), { isFilled: true }))
  on('turn.start', (_: unknown, e: any) => ({ turnId: e.turnId }))
  return seen
}
// the new-version row's text as drawn now, or undefined
const reloadRow = async ($: any) => {
  const ui = await $.ui.mount(BAND)
  const r = await ui.find({ type: 'Text', text: /is installed/ })
  await ui.unmount()
  return r?.text as string | undefined
}
// the buttons of the band as drawn now, by key
const bandKeys = async ($: any) => {
  const ui = await $.ui.mount(BAND)
  const keys = (await ui.findAll({ type: 'Button' })).map((b: any) => b.key ?? b.props?.key)
  await ui.unmount()
  return keys
}
// a button of the row pressed, and what it started settled
const pressRow = async ($: any, clock: any, key: string) => {
  const ui = await $.ui.mount(BAND)
  await ui.press({ key })
  await ui.unmount()
  await clock.settle()
}
// a session loaded as 0.9.10 that a person has typed in, its turn ended
const loadedAndTyped = async ($: any, clock: any) => {
  await start($)
  await clock.settle()
  await $.prompt.submit({ text: 'work on', asUser: true })
  await $.turn.complete(turn('claude-fable-5-2', 1))
  await clock.advance(RELOAD_AFTER_TURN)
}
// loaded and typed in, and the slow timer has found 0.9.11: the row is up
const rowUp = async ($: any, clock: any, seen: any) => {
  await loadedAndTyped($, clock)
  seen.manifest = manifestOf('0.9.11')
  await clock.advance(RELOAD_CHECK_EVERY)
}
const ROW_11 = '📦 Pacing 0.9.11 is installed: type /reload-plugins to load it, or open a new session.'
const ROW_12 = '📦 Pacing 0.9.12 is installed: type /reload-plugins to load it, or open a new session.'

test('the new version\'s words, and the version a manifest names', async () => {
  expect(reloadText('0.9.11')).toBe(ROW_11)
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
  expect(await reloadRow($)).toBe(undefined)
})

test('a new version: the row at the first look that sees it, the text and Not now only, nothing run and nothing filled', async ($, on) => {
  engine(on)
  const clock = mock.clock(on, { now: T0 })
  const seen = reloadEngine(on)
  await loadedAndTyped($, clock)
  expect(await reloadRow($)).toBe(undefined)
  // the app's sync puts 0.9.11 in the folder; the slow timer finds it
  seen.manifest = manifestOf('0.9.11')
  await clock.advance(RELOAD_CHECK_EVERY)
  expect(await reloadRow($)).toBe(ROW_11)
  expect(await bandKeys($)).toEqual(['pacing-reload-not-now'])
  expect(seen.runs).toEqual([])
  expect(seen.fills).toEqual([])
  expect(seen.toasts).toEqual([])
  // every later look: nothing more, the row stays
  await clock.advance(6 * RELOAD_CHECK_EVERY)
  await $.turn.complete(turn('claude-fable-5-2', 1))
  await clock.advance(RELOAD_AFTER_TURN)
  expect(seen.runs).toEqual([])
  expect(seen.fills).toEqual([])
  expect(seen.toasts).toEqual([])
  expect(await reloadRow($)).toBe(ROW_11)
  // the next version takes its place, the same way
  seen.manifest = manifestOf('0.9.12')
  await clock.advance(RELOAD_CHECK_EVERY)
  expect(await reloadRow($)).toBe(ROW_12)
  expect(await bandKeys($)).toEqual(['pacing-reload-not-now'])
})

test('a new version found as a turn ends: the row right after the turn', async ($, on) => {
  engine(on)
  const clock = mock.clock(on, { now: T0 })
  const seen = reloadEngine(on)
  await loadedAndTyped($, clock)
  seen.manifest = manifestOf('0.9.11')
  await $.turn.start({ text: 'next', turnId: 't2' } as any)
  await $.turn.complete(turn('claude-fable-5-2', 1))
  await clock.advance(RELOAD_AFTER_TURN)
  expect(await reloadRow($)).toBe(ROW_11)
  expect(seen.runs).toEqual([])
})

test('a load says nothing of a version: a new session, or a reload the person typed', async ($, on) => {
  engine(on)
  const clock = mock.clock(on, { now: T0 })
  // a mark an earlier copy's Reload button left (0.9.14, 0.9.15) means nothing now
  const seen = reloadEngine(on, { store: { 'reload:local_s1': { version: '0.9.10', at: T0 - 1000 } } })
  await start($)
  await clock.settle()
  expect(seen.toasts).toEqual([])
  await $.prompt.submit({ text: 'work on', asUser: true })
  await $.turn.complete(turn('claude-fable-5-2', 1))
  await clock.advance(3 * RELOAD_CHECK_EVERY)
  expect(seen.toasts).toEqual([])
  expect(await reloadRow($)).toBe(undefined)
})

test('reloaded in another session: the row goes at the next look, and does not come up where it was not yet shown', async ($, on) => {
  engine(on)
  const clock = mock.clock(on, { now: T0 })
  const seen = reloadEngine(on)
  await rowUp($, clock, seen)
  expect(await reloadRow($)).toBe(ROW_11)
  // this copy noted what it loaded as
  expect(seen.store['version:local_s1']).toBe('0.9.10')
  // another session's copy, reloaded into 0.9.11, says so
  seen.store[RELOADED] = '0.9.11'
  await clock.advance(RELOAD_CHECK_EVERY)
  expect(await reloadRow($)).toBe(undefined)
  // the next version: not reloaded anywhere yet, the row as before
  seen.manifest = manifestOf('0.9.12')
  await clock.advance(RELOAD_CHECK_EVERY)
  expect(await reloadRow($)).toBe(ROW_12)
  seen.store[RELOADED] = '0.9.12'
  await $.turn.complete(turn('claude-fable-5-2', 1))
  await clock.advance(RELOAD_AFTER_TURN)
  expect(await reloadRow($)).toBe(undefined)
  expect(seen.toasts).toEqual([])
})

test('a copy loaded in a session that ran an older one is a reload: it tells the others', async ($, on) => {
  engine(on)
  const clock = mock.clock(on, { now: T0 })
  const seen = reloadEngine(on, { store: { 'version:local_s1': '0.9.10' } })
  seen.manifest = manifestOf('0.9.11')
  await start($)
  await clock.settle()
  expect(seen.store[RELOADED]).toBe('0.9.11')
  expect(seen.store['version:local_s1']).toBe('0.9.11')
})

test('a new session tells the others nothing of a reload', async ($, on) => {
  engine(on)
  const clock = mock.clock(on, { now: T0 })
  const seen = reloadEngine(on)
  seen.manifest = manifestOf('0.9.11')
  await start($)
  await clock.settle()
  expect(seen.store[RELOADED]).toBe(undefined)
  expect(seen.store['version:local_s1']).toBe('0.9.11')
})

test('Not now hides the row for that version only', async ($, on) => {
  engine(on)
  const clock = mock.clock(on, { now: T0 })
  const seen = reloadEngine(on)
  await rowUp($, clock, seen)
  await pressRow($, clock, 'pacing-reload-not-now')
  expect(await reloadRow($)).toBe(undefined)
  await clock.advance(3 * RELOAD_CHECK_EVERY)
  await $.turn.complete(turn('claude-fable-5-2', 1))
  await clock.advance(RELOAD_AFTER_TURN)
  expect(await reloadRow($)).toBe(undefined)
  expect(seen.runs).toEqual([])
  expect(seen.toasts).toEqual([])
  // the next version shows it again
  seen.manifest = manifestOf('0.9.12')
  await clock.advance(RELOAD_CHECK_EVERY)
  expect(await reloadRow($)).toBe(ROW_12)
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
  expect(await reloadRow($)).toBe(undefined)
  expect(seen.toasts).toEqual([])
  // written whole: found at the next look
  seen.manifest = manifestOf('0.9.11')
  await clock.advance(RELOAD_CHECK_EVERY)
  expect(await reloadRow($)).toBe(ROW_11)
})

test('reload off: no row, one toast per version with the same words', async ($, on) => {
  engine(on)
  const clock = mock.clock(on, { now: T0 })
  const seen = reloadEngine(on, { config: JSON.stringify({ autoReload: false }) })
  await rowUp($, clock, seen)
  expect(seen.toasts).toEqual([ROW_11])
  expect(await reloadRow($)).toBe(undefined)
  await clock.advance(2 * RELOAD_CHECK_EVERY)
  await $.turn.complete(turn('claude-fable-5-2', 1))
  await clock.advance(RELOAD_AFTER_TURN)
  expect(seen.toasts.length).toBe(1)
  expect(seen.runs).toEqual([])
  seen.manifest = manifestOf('0.9.12')
  await clock.advance(RELOAD_CHECK_EVERY)
  expect(seen.toasts).toEqual([ROW_11, ROW_12])
  expect(await reloadRow($)).toBe(undefined)
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
  expect(await reloadRow($)).toBe(undefined)
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
  // the tool's figures, not the engine's two windows; no --spent-usd yet: the
  // prices come with a reading, so a turn before the first one is priced and
  // handed over with the next
  expect(seen.runs[0].slice(2)).toEqual(['--all', '36', '--reset', RESET, '--source', 'hook', '--five', '12', '--five-reset', '2026-11-13T15:00:00.000Z',
    ...FULL_ARGS, '--session', 'claude-fable-5-2'])
  expect(status.at(-1)).toBe('Budget: -16% · usage: Weekly 36% Fable 41%')
})

test('a plan without the per-model window, extra usage off, no context: - for the meter and nothing made up', async ($, on) => {
  engine(on)
  const seen = usageEngine(on, { usage: () => ({ plan: { windows: [USAGE.plan.windows[1]], extraUsage: { enabled: false } } }) })
  await $.session.measure(measure(36, [{ kind: 'five_hour', percentUsed: 11, resetsAt: '2026-11-13T14:59:00.000Z' }]))
  // the 5-hour window the tool lacks comes from the engine's
  expect(seen.runs[0].slice(2)).toEqual(['--all', '36', '--reset', RESET, '--source', 'hook', '--five', '11', '--five-reset', '2026-11-13T14:59:00.000Z', '--premium', '-'])
})

test('one tool call per reading: none while the meter stands still, one every 10 minutes', async ($, on) => {
  engine(on)
  const clock = mock.clock(on, { now: T0 })
  const seen = usageEngine(on)
  await $.session.measure(measure(36))
  await $.session.measure(measure(36.4))
  await $.session.measure(measure(36.9))
  expect(seen.calls).toBe(1)
  await $.session.measure(measure(37))
  expect(seen.calls).toBe(2)
  await clock.advance(9 * 60000)
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
  expect(status.at(-1)).toBe('Budget: -29% · usage: Weekly 49% Fable 71%')
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
  expect(status.at(-1)).toBe('Budget: 10% · usage: Weekly 10% Fable 40%')
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
  expect(status.at(-1)).toBe('Budget: -16% · usage: Weekly 36% Fable 41%')
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
  expect(status.at(-1)).toBe('Budget: -16% · usage: Weekly 36% Fable 41%')
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

test('a role agent\'s finished task is recorded by the module: role, id, model, effort, the tokens the engine\'s list has and what the run spent', async ($, on) => {
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
  // the run's usage: every request of it summed
  await $.turn.complete({ ...turn('claude-opus-5-5', 1, 'ag1'), usage: { model: 'claude-opus-5-5', input_tokens: 1200, output_tokens: 8000, cache_read_input_tokens: 350000, cache_creation_input_tokens: 9100 } } as any)
  await clock.settle()
  expect(seen.records.length).toBe(1)
  expect(seen.records[0][0]).toBe('node')
  expect(seen.records[0][1].endsWith('/skills/pacing/scripts/config.mjs')).toBe(true)
  // the Agent call's effort before the list's; the tokens as the list has them, not the run's summed usage;
  // that summed usage as what the task spent, input, output, cache read, cache write
  expect(seen.records[0].slice(2)).toEqual(['agent', 'implementer', 'ag1', 'opus', 'high', '41200', '--spent', '1200,8000,350000,9100'])
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
  expect(seen.records[0].slice(2, 8)).toEqual(['agent', 'implementer', 'ag1', 'opus', 'high', '96000'])
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
  expect(seen.records[1].slice(2, 8)).toEqual(['agent', 'implementer', 'ag1', 'opus', 'high', '160000'])
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
  expect(seen.records.map(r => r.slice(2, 8))).toEqual([['agent', 'verifier', 'ag5', 'haiku', 'xhigh', '30000']])
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
  expect(seen.records.map(r => r.slice(2, 8))).toEqual([['agent', 'researcher', 'ag1', 'haiku', 'medium', '52000']])
})

test('what a run spent goes on record as four whole numbers; no usage, no --spent', async () => {
  expect(spentOf({ model: 'm', input_tokens: 10, output_tokens: 20.4, cache_read_input_tokens: 30 } as any)).toEqual({ in: 10, out: 20.4, read: 30, write: 0 })
  expect(spentOf(undefined)).toBeNull()
  expect(recordArgv('/p', 'reader', 'a1', 'haiku', 'medium', 41000.6, { in: 10, out: 20.4, read: 30, write: 0 }).slice(2)).toEqual(['agent', 'reader', 'a1', 'haiku', 'medium', '41001', '--spent', '10,20,30,0'])
  expect(recordArgv('/p', 'reader', 'a1', 'haiku', 'medium', 41000, null).slice(2)).toEqual(['agent', 'reader', 'a1', 'haiku', 'medium', '41000'])
  expect(recordArgv('/p', 'reader', 'a1', 'haiku', 'medium', 41000, { in: -1, out: 0, read: 0, write: 0 }).slice(2)).toEqual(['agent', 'reader', 'a1', 'haiku', 'medium', '41000'])
})

// ---- reports the module answers itself ----

const REPORT = [
  'last reading 11-15 10:00, 5 min ago (automatic, full), not read now',
  'not in it: context, extra usage · /pacing usage now takes a new one',
  '5-hour     ██░░░░░░░░░░░░░░░░░░  12 %  resets 13:00',
  'Weekly     ██████░░│░░░░░░░░░░░  30 % / 47 % pace · resets in 4d 2h',
  'Fable 5.2  ███████░│░░░░░░░░░░░  35 % / 47 % pace · read 11-15 10:00',
  '',
  'tier  model              takes now · level ahead',
  '────  ─────────────────  ───────────────────────────────────────────',
  '1     Fable 5.2 high     the session: judgment, medium, routine,',
  '                         trivial work',
  '',
  'The weekly meter at 30 % is 17 points under today\'s allowed 47 %.',
  '',
  'day 4 of 8 (calendar days), 2.9 days elapsed, 4.1 days to reset',
  'Weekly used 30 %, delta -16.7, Fable 5.2 35 % -> ahead',
  'do: the session\'s model does nearly everything',
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
  const over = REPORT.map(l => (l.startsWith('Weekly used') ? 'Weekly used 44 %, delta 3 -> over (raised by the trend)' : l.startsWith('do: ') ? 'do: medium tasks leave the session\'s model too' : l))
  expect(usageText(over.join('\n')).split('\n').at(-1)).toBe('Now: medium tasks leave the session\'s model too')
  // a model the session should leave: the fact and the row that offers it, never the steps
  const out = REPORT.map(l => (l.startsWith('do: ') ? 'do: Fable 5.2 is out until the reset: this session belongs on Opus 5.5 high now; the Switch row offers it (without the hooks module: model menu Opus 5.5, effort high). the session\'s model does nearly everything' : l))
  expect(usageText(out.join('\n')).split('\n').at(-1)).toBe('Now: Fable 5.2 is out until the reset: this session belongs on Opus 5.5 high now; the Switch row offers it. the session\'s model does nearly everything')
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
  expect(names).toEqual(['pacing-status', 'pacing-usage', 'pacing-help', 'pacing-guide', 'pacing-doctor', 'pacing-saved', 'pacing-pane'])
  // the three reports wait for a turn's end: answered mid-turn, their text would stay in the requests
  expect(immediate).toEqual(['pacing-status'])

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
  expect(status.at(-1)).toBe('Budget: -16% · usage: Weekly 36% Fable 41%')
  // without the tool and with no window from the engine there is nothing to measure with
  fresh = false
  usage = null
  const none = await run($, 'pacing-usage')
  expect(none.text).toBe('Pacing: no reading to show (the last reading is 45 min old). `/pacing usage now` takes a new one.')
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

test('/pacing-doctor shows the self-check whole in a code block, a failed check too; /pacing-saved runs saved.mjs against the session\'s model', async ($, on) => {
  engine(on)
  const runs: string[][] = []
  let code = 1
  let text = 'ok    version     running 0.9.12\nFAIL  settings    config.json does not parse -> run /pacing reset\n\n1 failed check: see above.\n'
  on('process.run', (_: unknown, e: any) => (runs.push([...e.argv]), stdout(text, code)))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  // doctor exits 1 on a failed check: its lines are shown all the same
  const doc = await run($, 'pacing-doctor')
  expect(runs[0][1].endsWith('/skills/pacing/scripts/doctor.mjs')).toBe(true)
  expect(runs[0].length).toBe(2)
  expect(doc.text).toBe('```\n' + text.trim() + '\n```')
  expect(doc.isTextDisplayOnly).toBe(true)
  text = ''
  expect((await run($, 'pacing-doctor')).text).toBe('Pacing: the self-check could not run. `/pacing doctor` asks the session for it.')

  code = 0
  const line = 'Delegation this week: 2 tasks; on Opus 5.5 they would have cost 2.9× as much (about 66% less).'
  text = line + '\n'
  runs.length = 0
  const sv = await run($, 'pacing-saved')
  expect(runs[0][1].endsWith('/skills/pacing/scripts/saved.mjs')).toBe(true)
  expect(runs[0].slice(2)).toEqual(['--session', 'claude-opus-5-5'])
  expect(sv.text).toBe(line)
  expect(sv.isTextDisplayOnly).toBe(true)
  // detail: the table in a code block, its columns kept
  const table = 'by role and model, against Opus 5.5:\n  role    model      tasks  tokens  saved\n  reader  Haiku 5.5      1       -    97%'
  text = line + '\n\n' + table + '\n'
  const det = await $.command.run({ command: 'pacing-saved', args: 'detail' } as any)
  expect(runs[1].slice(2)).toEqual(['--session', 'claude-opus-5-5', '--detail'])
  expect(det.text).toBe(line + '\n\n```\n' + table + '\n```')
  // saved.mjs refusing the model: again without it; refusing that too: where to ask
  code = 1
  runs.length = 0
  expect((await run($, 'pacing-saved')).text).toBe('Pacing: the savings could not be read. `/pacing saved` asks the session for it.')
  expect(runs.map(r => r.slice(2))).toEqual([['--session', 'claude-opus-5-5'], []])
})

test('/pacing-status is for the person alone, as the other reports', async ($, on) => {
  engine(on)
  const r = await run($, 'pacing-status')
  expect(r.text).toBe('Pacing: no automatic reading yet in this session. /pacing usage takes one now.')
  expect(r.isTextDisplayOnly).toBe(true)
})

// ---- real progress: the parts an agent says it has finished ----

test('the parts off an agent\'s own call: `config.mjs part <done> <total>` in Bash, or its to-do list where it said none', async () => {
  const bash = (command: string) => ({ tool: 'Bash', command })
  expect(partOf(bash('node "C:/p/skills/pacing/scripts/config.mjs" part 2 4'))).toEqual({ done: 2, total: 4, said: true })
  expect(partOf(bash('node /p/scripts/config.mjs part 0 3 && echo ok'))).toEqual({ done: 0, total: 3, said: true })
  expect(partText({ part: partOf(bash('node x/config.mjs part 4 4')) })).toBe('step 4 of 4')
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

test('step 2 of 4 shows where the estimate did: the row, the toasts and /pacing-status; the line keeps the count alone', async () => {
  const a = { ...IMPL, part: { done: 2, total: 4, said: true } }
  // the row, the 5-minute toast and the status line with the budget
  expect(backgroundText([a], T0)).toBe('In the background: ⏳ implementer: Auto-reload on plugin update, editing step 2 of 4, 2m')
  expect(progressText([a], T0)).toBe('⏳ still running: implementer "Auto-reload on plugin update", editing step 2 of 4, 2m, about 2m left.')
  expect(progressText([a, VERIFIER], T0)).toBe('⏳ still running: implementer "Auto-reload on plugin update", editing step 2 of 4, 2m; verifier "Run the suite" 30s.')
  // two that pass 120 with them: the part and the estimate go first, for both
  expect(progressText([a, READER], T0)).toBe('⏳ still running: implementer "Auto-reload on plugin update", editing 2m; reader "Read the test logs", searching 3m.')
  // in the line, the count alone
  expect(statusText(J77, [], null, T0, [a])).toBe('⏳ 1 Subagent running · Budget tokens: 850K · usage: Weekly 100% Fable 100%')
  expect(statusText(J77, [], null, T0, [a, { ...READER, part: { done: 1, total: 3 } }])).toBe('⏳ 2 Subagents running · Budget tokens: 850K · usage: Weekly 100% Fable 100%')
})

test('in a session: an agent\'s Bash call says its parts, and the toast and /pacing-status show them in place of the estimate', async ($, on) => {
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
  expect(status.at(-1)).toBe('⏳ 1 Subagent running · Budget: 10% · usage: Weekly 10% Fable 40%')
  expect((await second())[1]).toMatch(/^~ is a rough estimate/)
  // the main thread running the same command is nobody's progress
  await $.tool.call({ tool: 'Bash', command: 'node x/config.mjs part 3 4' } as any)
  expect((await second())[0]).toContain('~60%')
  await $.tool.call({ tool: 'Bash', command: 'node "/p/skills/pacing/scripts/config.mjs" part 1 3', agentId: 'ag1' } as any)
  await clock.advance(5000)
  expect((await second())[0]).toBe('Running: reader: a task, running step 1 of 3, 3m (Haiku 5.5)')
  expect(status.at(-1)).toBe('⏳ 1 Subagent running · Budget: 10% · usage: Weekly 10% Fable 40%')
  await $.tool.call({ tool: 'Grep', pattern: 'x', agentId: 'ag1' } as any)
  await $.tool.call({ tool: 'Bash', command: 'node "/p/skills/pacing/scripts/config.mjs" part 2 3', agentId: 'ag1' } as any)
  await clock.advance(2 * 60000 - 5000)
  expect(seen.toasts.at(-1)).toBe('⏳ still running: reader "a task", running step 2 of 3, 5m, about 3m left.')
  // no estimate shown, so no note about one
  expect(await second()).toEqual(['Running: reader: a task, running step 2 of 3, 5m (Haiku 5.5)', 'Now: the default split'])
})

// ---- running agents across a reload ----

// the engine beneath for a reload: the session's id and the module's store
const keptEngine = (on: any) => {
  const store: Record<string, any> = {}
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('command.register', (_: unknown, e: any) => ({ value: { command: e.name } }))
  on('session.id', () => ({ value: 'local_s1' }))
  on('store.get', (_: unknown, e: any) => ({ value: store[e.key] === undefined ? undefined : JSON.parse(JSON.stringify(store[e.key])) }))
  on('store.set', (_: unknown, e: any) => { store[e.key] = JSON.parse(JSON.stringify(e.value)); return { value: undefined } })
  on('store.delete', (_: unknown, e: any) => { delete store[e.key]; return { value: undefined } })
  on('tool.call', () => ({ result: {} }))
  return store
}

test('a reload in the middle of a run: the agent keeps its role, step, time and task, in the line and in the next toast', async ($, on) => {
  const status = engine(on)
  big(on)
  const clock = mock.clock(on, { now: T0 })
  const seen = agentEngine(on, { list: () => [{ id: 'ag1', status: 'running' }] })
  const store = keptEngine(on)
  await $.session.measure(measure(10))
  await spawn($, 'pacing:implementer', 'opus', false, 'Auto-reload on plugin update')
  await $.tool.call({ tool: 'Edit', agentId: 'ag1' } as any)
  await clock.advance(2 * 60000)
  const before = status.at(-1)
  expect(before).toBe('⏳ 1 Subagent running · Budget: 10% · usage: Weekly 10% Fable 40%')
  expect(store['agents:local_s1']).toEqual([{ id: 'ag1', type: 'pacing:implementer', description: 'Auto-reload on plugin update', model: 'claude-opus-5-5', background: false, startedAt: T0, step: 'editing' }])
  // /reload-plugins: the module's memory of the agents starts over, and session.start runs again
  const n = status.length
  await start($)
  await clock.settle()
  // drawn again from what was kept, not left over
  expect(status.length).toBeGreaterThan(n)
  expect(status.at(-1)).toBe(before)
  // its time goes on from its start, not from the reload
  await clock.advance(3 * 60000)
  expect(status.at(-1)).toBe('⏳ 1 Subagent running · Budget: 10% · usage: Weekly 10% Fable 40%')
  // the next progress toast, 5 minutes after the reload, has its name, task and step
  await clock.advance(2 * 60000)
  expect(seen.toasts.at(-1)).toBe('⏳ still running: implementer "Auto-reload on plugin update", editing 7m.')
  // its end: the toast with the task, and the store let go
  await $.turn.complete(turn('claude-opus-5-5', 1, 'ag1'))
  await clock.settle()
  expect(seen.toasts.at(-1)).toMatch(/^✅ implementer is done with "Auto-reload on plugin update" after 7m/)
  expect(store['agents:local_s1']).toBe(undefined)
})

test('an agent the engine no longer runs at the reload is dropped; without its list, none comes back', async ($, on) => {
  const status = engine(on)
  big(on)
  const clock = mock.clock(on, { now: T0 })
  const live = new Set(['ag1', 'ag2'])
  let list = true
  agentEngine(on, { list: () => (list ? [...live].map(id => ({ id, status: 'running' })) : null) })
  const store = keptEngine(on)
  await $.session.measure(measure(10))
  await spawn($, 'pacing:reader', 'haiku', true)
  await spawn($, 'pacing:verifier', 'haiku', true)
  expect(store['agents:local_s1'].map((a: any) => a.id)).toEqual(['ag1', 'ag2'])
  await clock.advance(60000)
  live.delete('ag2')
  await start($)
  await clock.settle()
  expect(status.at(-1)).toBe('⏳ 1 Subagent running · Budget: 10% · usage: Weekly 10% Fable 40%')
  expect(store['agents:local_s1'].map((a: any) => a.id)).toEqual(['ag1'])
  // an engine that cannot say which run: none is shown as running
  list = false
  await start($)
  await clock.settle()
  await $.session.measure(measure(10))
  expect(status.at(-1)).toBe('Budget: 10% · usage: Weekly 10% Fable 40%')
})

// ---- a toast by its kind ----

test('every toast leads with the icon of its kind where "Pacing: " stood, and keeps its words after it', async () => {
  expect(ICON).toEqual({ started: '▶️', done: '✅', still: '⏳', worse: '⚠️', stop: '🔴', better: '🟢', switched: '🔁', failed: '❌',
    waiting: '📦', compacted: '🗜️', pause: '💤', room: '💡' })
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
    ['📦', reloadText('0.9.12')],
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
  expect(texts[4][1]).toBe('⏳ still running: implementer "Auto-reload on plugin update", editing ~60%, 2m, about 1m left.')
  expect(texts[5][1]).toBe('⏳ 12 Subagents are still running, the longest for 12m.')
  expect(texts[6][1]).toBe('🔁 this session now runs on Opus 5.5 high.')
  expect(texts[7][1]).toBe('❌ the switch did not take; the session still runs on Fable 5.2. The model menu does it: Opus 5.5, effort high.')
  expect(texts[8][1]).toBe('📦 Pacing 0.9.12 is installed: type /reload-plugins to load it, or open a new session.')
  expect(texts[9][1]).toBe('🗜️ compacted from 320k to 40k tokens.')
  expect(texts[10][1]).toBe('🗜️ compacted.')
  expect(texts[11][1]).toBe('💤 this session is 420k tokens and sat idle 1 h 25 min, so its cache has lapsed and this turn stores it all again. After a break, /compact first is cheaper.')
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
  // the level: a little over is none; far over the line, the week nearly used
  const before = shown.length
  next = answer('over', 21, { do: 'medium tasks leave the session\'s model too' })
  await $.session.measure(measure(21))
  expect(shown.length).toBe(before)
  next = answer('throttle', 26, { do: 'most work leaves the session\'s model' })
  await $.session.measure(measure(26))
  expect(shown.at(-1)).toEqual({ text: '⚠️ over budget -> far over budget. Most work goes to Opus 5.5 medium subagents.', ms: 15000 })
  next = answer('stop', 96, { do: 'wrap up, the week is nearly used' })
  await $.session.measure(measure(96))
  expect(shown.at(-1)).toEqual({ text: '🔴 far over budget -> stop. Wrap up: the week is nearly used.', ms: 15000 })
  // back under it, the per-model meter over its line, then that model out: none
  const said = shown.length
  next = answer('ahead', 10, { do: 'the session\'s model does nearly everything' })
  await $.session.measure(measure(10))
  next = answer('ahead', 11, { premiumHeld: true, do: 'Fable 5.2\'s meter is over its budget line' })
  await $.session.measure(measure(11))
  next = answer('ahead', 12, { premiumOut: true, do: 'Fable 5.2 is out until the reset' })
  await $.session.measure(measure(12))
  expect(shown.length).toBe(said)
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
  expect(progressText([hist], T0)).toBe('⏳ still running: implementer "Auto-reload on plugin update", editing ~60%, 12m, about 8m left.')
  expect(progressText([parts], T0)).toBe('⏳ still running: implementer "Auto-reload on plugin update", editing step 2 of 4, 12m, about 12m left.')
  // no basis, or past the estimate: the toast as it was
  expect(progressText([{ ...FIRST, startedAt: T0 - 12 * m }], T0)).toBe('⏳ still running: implementer "Auto-reload on plugin update", editing 12m.')
  expect(progressText([{ ...hist, startedAt: T0 - 25 * m }], T0)).toBe('⏳ still running: implementer "Auto-reload on plugin update", editing ~95%, 25m.')
  // several: each its own, joined by "; " so the commas stay inside one agent's part
  const short = [{ ...IMPL, description: 'Fix' }, { ...READER, description: 'Logs' }]
  expect(progressText(short, T0)).toBe('⏳ still running: implementer "Fix", editing ~60%, 2m, about 1m left; reader "Logs", searching ~60%, 3m, about 2m left.')
  expect(progressText([{ ...READER, description: undefined }, { ...VERIFIER, description: undefined }], T0)).toBe('⏳ still running: reader searching ~60%, 3m, about 2m left; verifier 30s.')
  // past 120 characters the time left goes first, for all of them, before the progress does
  expect(progressText([parts, VERIFIER], T0)).toBe('⏳ still running: implementer "Auto-reload on plugin update", editing step 2 of 4, 12m; verifier "Run the suite" 30s.')
  for (const list of [[hist], [parts], short, [parts, VERIFIER], [hist, READER, VERIFIER], described(SETS.six as any)]) expect(chars(progressText(list as any, T0))).toBeLessThanOrEqual(MSG_MAX)
  // the start toast: the usual length of that kind of run, where three runs say one
  expect(startedText(IMPL, [IMPL])).toBe('▶️ implementer is running "Auto-reload on plugin update" on Fable 5.2 high, about 3m.')
  expect(startedText(hist, [hist])).toBe('▶️ implementer is running "Auto-reload on plugin update" on Fable 5.2 high, about 20m.')
  expect(startedText(IMPL, [IMPL, READER])).toBe('▶️ implementer is running "Auto-reload on plugin update" on Fable 5.2 high, about 3m; reader is also running.')
  // it goes before who else runs does
  expect(startedText(IMPL, [IMPL, READER, VERIFIER])).toBe('▶️ implementer is running "Auto-reload on plugin update" on Fable 5.2 high; reader and verifier are also running.')
  expect(chars(startedText(IMPL, [IMPL, READER, VERIFIER]))).toBeLessThanOrEqual(MSG_MAX)
  // the status line and the row above the prompt do not have it
  expect(agentPart([hist], T0, LINE_MAX)).toBe('⏳ 1 Subagent running')
  expect(backgroundText([hist], T0)).toBe('In the background: ⏳ implementer: Auto-reload on plugin update, editing ~60%, 12m')
})

test('the pane says the budget as time left today, never in tokens or dollars; past the line, as time over', () => {
  const base = { all: 50, line: 73.3, level: 'ok', tokenUsd: 0.000008, paceUsd: 14.05, left: { points: 23.3, tokens: 16600000 } }
  expect(paneModel({ j: base }).budget).toEqual({ big: '9h 30m', sub: 'left to use today to stay on budget' })
  expect(paneModel({ j: { ...base, rateFrom: 'estimate' } }).budget!.big).toBe('~9h 30m')
  expect(paneModel({ j: { ...base, level: 'over', left: { points: -5, tokens: -1200000 } } }).budget).toEqual({ big: '40m', sub: 'over today\'s budget' })
  // no pace: the points of the week
  expect(paneModel({ j: { all: 50, line: 60, level: 'ok' } }).budget).toEqual({ big: '10%', sub: 'of the week left to use today to stay on budget' })
  expect(paneModel({ j: { all: 70, line: 60, level: 'over' } }).budget).toEqual({ big: '10%', sub: 'of the week over today\'s budget' })
  // the top area is the week alone: a level the per-model meter set does not
  // show there (weekLevel; without it, the week's figure against its line)
  expect(paneModel({ j: { ...base, all: 55, line: 73.3, level: 'over', weekLevel: 'ahead', levelBy: 'premium', premium: 80, premiumLabel: 'Fable 5.2' } }).levelText).toBe('Within budget')
  expect(paneModel({ j: { ...base, all: 55, line: 73.3, level: 'over', levelBy: 'premium', premium: 80, premiumLabel: 'Fable 5.2' } }).level).toBe('ok')
  expect(paneModel({ j: { ...base, all: 76, line: 73.3, level: 'over', weekLevel: 'over' } }).levelText).toBe('Over the budget line · +3')
  // the words follow the week's own points over its line, not a level a
  // trend or Fable raised (live: 23 against 20 at throttle read "far over")
  const raised = paneModel({ j: { ...base, all: 23, line: 20, level: 'throttle', weekLevel: 'throttle' } })
  expect([raised.level, raised.levelText]).toEqual(['throttle', 'Over the budget line · +3'])
  expect(paneModel({ j: { ...base, all: 28, line: 20, level: 'throttle', weekLevel: 'throttle' } }).levelText).toBe('Far over the budget line · +8')
  expect(paneModel({ j: { ...base, all: 25.4, line: 20, level: 'throttle', weekLevel: 'throttle' } }).levelText).toBe('Over the budget line · +5')
  expect(paneModel({ j: { ...base, all: 20.2, line: 20, level: 'over', weekLevel: 'over' } }).levelText).toBe('Over the budget line · +1')
  expect(paneModel({ j: { ...base, all: 20, line: 20, level: 'over', weekLevel: 'over' } }).levelText).toBe('Within budget')
  expect(paneModel({ j: { ...base, all: 18, line: 20, level: 'throttle', weekLevel: 'throttle' } }).levelText).toBe('Within budget')
  expect(paneModel({ j: { ...base, all: 96, line: 80, level: 'stop', weekLevel: 'stop' } }).levelText).toBe('The week is nearly used')
  // drawn beside the dial, in the normal colour up to 5 over
  const dot = nodes(paneView(TABLE, raised, { surface: 'desktop' })).find(n => n.type === 'Text' && n.props.children === '● Over the budget line · +3')
  expect(dot.props.color).toBe('success')
  // the model held by its own meter: the week's words stay; its meter has its
  // line, drawn loud, and says by how much it is over
  const held = paneModel({ j: { ...base, level: 'ahead', weekLevel: 'ahead', all: 55, line: 73.3, premium: 83, premiumHeld: true, premiumLabel: 'Fable 5.2' } })
  expect(held.levelText).toBe('Within budget')
  expect(held.level).toBe('ok')
  expect(held.meters[1]).toEqual({ label: 'Fable 5.2', pct: 83, line: 73.3, loud: true, over: true, note: '10 points over its budget line 73%: held, kept for hard tasks' })
  const under = paneModel({ j: { ...base, level: 'ahead', all: 55, line: 73.3, premium: 60, premiumLabel: 'Fable 5.2' } })
  expect(under.meters[1]).toEqual({ label: 'Fable 5.2', pct: 60, line: 73.3, loud: true, over: false, note: 'budget line 73%' })
  // drawn: the week's tick under the line, a tag saying OVER past it
  // under the line: drawn as the weekly bar is, no tag (the user's word)
  expect(barSvg([{ pct: 60, color: '#22d3ee' }], 73.3, 480, 34, true)).toBe(barSvg([{ pct: 60, color: '#22d3ee' }], 73.3, 480, 34))
  const loud = barSvg([{ pct: 83, color: '#fbbf24' }], 73.3, 480, 34, true)
  expect(loud).toContain('>OVER +10<')
  // still, not pulsing (the user's word)
  expect(loud).not.toContain('<animate')
  // a terminal: the line as ┃ in its place
  expect(barText([{ pct: 50, color: '#fff' }], 10, 80)).toBe('█████░░┃░░')
  // the context: one figure
  expect(paneModel({ bd: { totalTokens: 171000, maxTokens: 1000000, percentage: 17.1, categories: [] } }).context).toEqual({ used: '171k', of: '1M', pct: 17.1 })
})

test('every dial draws the figure, the label and a mark at the budget line', () => {
  for (const [name, dial] of Object.entries(DIALS)) {
    const svg = dial(50, '#22d3ee', 73)
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true)
    expect(svg.endsWith('</svg>')).toBe(true)
    expect(svg).toContain('>50%</text>')
    expect(svg).toMatch(/>WEEK( USED)?<\/text>/)
    expect(svg).toMatch(/#e5e7eb|#fbbf24|#f8fafc/)
    expect(svg).not.toContain('NaN')
    expect(dial(0, '#22d3ee'), name).not.toContain('NaN')
    expect(dial(140, '#22d3ee', 100), name).not.toContain('NaN')
  }
})

test('every section has a frame of its own, above and below, in its accent', () => {
  const seen = new Set<string>()
  for (const kind of FRAMES) for (const bottom of [false, true]) {
    const svg = frameSvg(kind, bottom, '#a78bfa')
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true)
    expect(svg).toContain('#a78bfa')
    expect(svg).not.toMatch(/NaN|undefined/)
    seen.add(svg)
  }
  expect(seen.size).toBe(8)
})

// ---- the review's defects (0.9.38) ----

test('readings that keep failing: after three in a row one toast names /pacing-doctor, the line leads with a mark and the pane says so; a good one clears it', async ($, on) => {
  const status = engine(on)
  const toasts: string[] = []
  let fail = false
  on('ui.toast', (_: unknown, e: any) => (toasts.push(e.text), { value: undefined }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('process.run', () => ({ value: fail ? { ...answer('ahead', 10), exitCode: 1, stdout: '', stderr: 'node:internal\nSyntaxError: bad state.json\n' } : answer('ahead', 10) }))
  await $.session.measure(measure(10))
  const plain = 'Budget: 10% · usage: Weekly 10% Fable 40%'
  expect(status.at(-1)).toBe(plain)
  fail = true
  await $.session.measure(measure(11))
  await $.session.measure(measure(12))
  // two failures: nothing said yet, the line as it was
  expect(toasts).toEqual([])
  expect(status.at(-1)).toBe(plain)
  await $.session.measure(measure(13))
  expect(FAIL_SAY).toBe(3)
  expect(toasts).toEqual(['❌ pacing could not take a reading, 3 tries in a row (SyntaxError: bad state.json): the status line shows older figures. /pacing-doctor says what is wrong.'])
  expect(toasts[0]).toBe(failedText(3, 'SyntaxError: bad state.json'))
  expect(status.at(-1)).toBe('⚠️ old figures · ' + plain)
  // a fourth failure: no second toast
  await $.session.measure(measure(14))
  expect(toasts.length).toBe(1)
  fail = false
  await $.session.measure(measure(15))
  expect(status.at(-1)).toBe(plain)
  // the mark gives way where the line has no room, and the pane's note leads
  expect(staleLine('x'.repeat(60), 70)).toBe('⚠️ ' + 'x'.repeat(60))
  expect(staleLine('x'.repeat(70), 70)).toBe('x'.repeat(70))
  expect(paneModel({ failing: true }).notes[0]).toBe(FAILED_NOTE)
  expect(paneModel({}).notes).toEqual([])
})

test('one reading at a time: while an agent\'s end has a reading in flight, a measure that is due starts no second one', async ($, on) => {
  engine(on)
  const clock = mock.clock(on, { now: T0 })
  agentEngine(on, { list: () => [{ id: 'ag1', status: 'running' }] })
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1000000, tokens: 1000, percent: 0 }, rateLimits: [{ kind: 'seven_day', percentUsed: 10, resetsAt: RESET }] } }))
  let runs = 0, held = false
  let open = () => {}
  const gate = new Promise<void>(r => { open = r })
  on('process.run', async (_: unknown, e: any) => {
    if (!e.argv.some((a: string) => String(a).endsWith('budget.mjs'))) return { value: { exitCode: 0, stdout: '', stderr: '' } }
    runs++
    if (held) await gate
    return { value: answer('ahead', 10) }
  })
  await $.session.measure(measure(10))
  expect(runs).toBe(1)
  await spawn($, 'pacing:reader')
  await clock.advance(AGENT_GAP + 1000)
  held = true
  // the agent ends: its reading starts and waits on budget.mjs
  await $.turn.complete(turn('claude-haiku-5-5', 1, 'ag1'))
  await new Promise(r => setTimeout(r, 50))
  expect(runs).toBe(2)
  // the meter moved a point meanwhile: due, and it runs none beside the first
  await $.session.measure(measure(11))
  await $.session.measure(measure(12))
  expect(runs).toBe(2)
  open()
  await new Promise(r => setTimeout(r, 50))
  held = false
  // the first is in: the next due one runs
  await $.session.measure(measure(13))
  expect(runs).toBe(3)
})

test('a /clear starts the conversation\'s memory over: the offer goes, no pause notice for the old size, and the ending session\'s keys leave the store', async ($, on) => {
  engine(on)
  big(on)
  const clock = mock.clock(on, { now: T0 })
  const seen = offers(on)
  const store: Record<string, unknown> = { 'version:s1': '0.9.10', 'switch:s1': { effort: 'high' }, 'agents:s1': [{ id: 'x' }], 'version:s2': '0.9.10' }
  on('store.get', (_: unknown, e: any) => ({ value: store[e.key] }))
  on('store.set', (_: unknown, e: any) => { store[e.key] = e.value; return { value: undefined } })
  on('store.delete', (_: unknown, e: any) => { delete store[e.key]; return { value: undefined } })
  on('session.end', (_: unknown, e: any) => ({ sessionId: e.sessionId }))
  await $.prompt.submit({ text: 'work on', asUser: true })
  await $.session.measure(measure(10, [], 420000))
  await $.turn.complete(turn('claude-fable-5-2', 1))
  expect((await bandText($)).text).toContain('420k')
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: {} } as any)
  expect((await bandText($)).text).toBe(undefined)
  expect(Object.keys(store).filter(k => k.endsWith(':s1'))).toEqual([])
  expect(store['version:s2']).toBe('0.9.10')
  // two hours on, the first prompt of the new conversation: nothing of 420k tokens idle
  await clock.advance(2 * 3600000)
  expect((await bandText($)).text).toBe(undefined)
  const said = seen.toasts.length
  await $.prompt.submit({ text: 'something new', asUser: true })
  expect(seen.toasts.slice(said)).toEqual([])
})

test('a session that ends for good deletes its keys and keeps its memory (a reload may follow in another)', async ($, on) => {
  engine(on)
  big(on)
  offers(on)
  const store: Record<string, unknown> = { 'version:s1': '0.9.10', 'switch:s1': { effort: 'high' }, 'unused': { week: 'w', step: 10 } }
  on('store.get', (_: unknown, e: any) => ({ value: store[e.key] }))
  on('store.set', (_: unknown, e: any) => { store[e.key] = e.value; return { value: undefined } })
  on('store.delete', (_: unknown, e: any) => { delete store[e.key]; return { value: undefined } })
  on('session.end', (_: unknown, e: any) => ({ sessionId: e.sessionId }))
  await $.session.end({ reason: 'prompt_input_exit', sessionId: 's1', resume: {} } as any)
  expect(store).toEqual({ 'unused': { week: 'w', step: 10 } })
})

test('a notification\'s prompt while the person is away does not end "someone is here": the offer comes at that turn\'s end', async ($, on) => {
  engine(on)
  big(on)
  offers(on)
  await $.prompt.submit({ text: 'work on', asUser: true })
  await $.session.measure(measure(10, [], 200000))
  await $.turn.complete(turn('claude-fable-5-2', 1))
  expect((await bandText($)).text).toBe(undefined)
  // a background agent is done: its notification starts a turn nobody typed
  await $.prompt.submit({ text: 'an agent is done', origin: { kind: 'task-notification' } } as any)
  await $.session.measure(measure(10, [], 420000))
  await $.turn.complete(turn('claude-fable-5-2', 1))
  expect((await bandText($)).text).toContain('420k')
})

test('at a load, once a day: the version keys other sessions left under older versions are deleted; this session\'s and the current version\'s stay', async ($, on) => {
  engine(on)
  const clock = mock.clock(on, { now: T0 })
  const seen = reloadEngine(on, { store: { 'version:local_s1': '0.9.10', 'version:old1': '0.9.3', 'version:old2': '0.9.9', 'version:other': '0.9.10', 'switch:old1': { effort: 'high' }, agentRuns: {} } })
  on('store.keys', () => ({ value: Object.keys(seen.store) }))
  await start($)
  await clock.settle()
  expect(Object.keys(seen.store).filter(k => k.startsWith('version:')).sort()).toEqual(['version:local_s1', 'version:other'])
  expect(seen.store['switch:old1']).toEqual({ effort: 'high' })
  expect(seen.store[PRUNED]).toBe(T0)
})

test('a reset that has passed is no failure: between the weekly reset and the next response there is nothing to read, and nothing is said', async ($, on) => {
  const status = engine(on)
  const toasts: string[] = []
  let passed = false
  on('ui.toast', (_: unknown, e: any) => (toasts.push(e.text), { value: undefined }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('process.run', () => ({ value: passed
    ? { ...answer('ahead', 10), exitCode: 1, stdout: 'no reading was taken: --reset 2026-11-19T12:00:00.000Z has passed (now 2026-11-19T12:03:00.000Z)\n' }
    : answer('ahead', 10) }))
  await $.session.measure(measure(10))
  const plain = status.at(-1)
  passed = true
  for (const pct of [11, 12, 13, 14]) await $.session.measure(measure(pct))
  expect(toasts).toEqual([])
  expect(status.at(-1)).toBe(plain)
})

// ---- the hooks module's second review ----

// the engine beneath for what is kept in the store: the session's id, and a
// store that says what was written, how many writes were under way at once,
// and can hold one write of the agents back (`hold`)
const countedStore = (on: any) => {
  const seen = { store: {} as Record<string, any>, sets: [] as string[], ids: 0, flying: 0, most: 0, hold: null as null | Promise<void> }
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('command.register', (_: unknown, e: any) => ({ value: { command: e.name } }))
  on('session.id', () => (seen.ids++, { value: 'local_s1' }))
  on('store.get', (_: unknown, e: any) => ({ value: seen.store[e.key] === undefined ? undefined : JSON.parse(JSON.stringify(seen.store[e.key])) }))
  on('store.set', async (_: unknown, e: any) => {
    seen.flying++
    seen.most = Math.max(seen.most, seen.flying)
    // the list as it was when the write was made
    const value = JSON.parse(JSON.stringify(e.value))
    if (seen.hold && String(e.key).startsWith('agents:')) { const held = seen.hold; seen.hold = null; await held }
    seen.store[e.key] = value
    seen.sets.push(e.key)
    seen.flying--
    return { value: undefined }
  })
  on('store.delete', (_: unknown, e: any) => { delete seen.store[e.key]; return { value: undefined } })
  return seen
}

// Read, Grep and Bash take turns with every tool call of an agent: each was
// a $.session.id() and a $.store.set of every agent
test('the agents kept in the store: a new step alone waits for the next refresh and is written once; a part said is written at once', async ($, on) => {
  engine(on)
  big(on)
  const clock = mock.clock(on, { now: T0 })
  agentEngine(on, { list: () => [{ id: 'ag1', status: 'running' }] })
  const seen = countedStore(on)
  on('tool.call', () => ({ result: {} }))
  const writes = () => seen.sets.filter(k => k === 'agents:local_s1').length
  await $.session.measure(measure(10))
  await spawn($, 'pacing:implementer', 'opus', false, 'the task')
  await clock.settle()
  // its start is written
  expect(writes()).toBe(1)
  const asked = seen.ids
  await $.tool.call({ tool: 'Read', file_path: 'a.ts', agentId: 'ag1' } as any)
  await $.tool.call({ tool: 'Grep', pattern: 'x', agentId: 'ag1' } as any)
  await $.tool.call({ tool: 'Bash', command: 'ls', agentId: 'ag1' } as any)
  await clock.settle()
  // three steps: no write, and the session's id not asked for
  expect(writes()).toBe(1)
  expect(seen.ids).toBe(asked)
  expect(seen.store['agents:local_s1'][0].step).toBe(undefined)
  // the next refresh writes the step it stands at, once
  await clock.advance(5000)
  expect(writes()).toBe(2)
  expect(seen.store['agents:local_s1'][0].step).toBe('running')
  // a refresh with no step moved writes nothing
  await clock.advance(10000)
  expect(writes()).toBe(2)
  // a part said: at once
  await $.tool.call({ tool: 'Bash', command: 'node "/p/skills/pacing/scripts/config.mjs" part 1 3', agentId: 'ag1' } as any)
  await clock.settle()
  expect(writes()).toBe(3)
  expect(seen.store['agents:local_s1'][0].part).toEqual({ done: 1, total: 3, said: true })
})

// the writes were started and not waited for: an older list could land last
test('the agents kept in the store: one write at a time, and the last one holds the latest list', async ($, on) => {
  engine(on)
  big(on)
  const clock = mock.clock(on, { now: T0 })
  agentEngine(on, { list: () => [{ id: 'ag1', status: 'running' }, { id: 'ag2', status: 'running' }, { id: 'ag3', status: 'running' }] })
  const seen = countedStore(on)
  await $.session.measure(measure(10))
  // the first agent's write is held back in the store
  let release = () => {}
  seen.hold = new Promise<void>(r => { release = r })
  await spawn($, 'pacing:reader', 'haiku', true)
  // two more start while it is under way
  await spawn($, 'pacing:verifier', 'haiku', true)
  await spawn($, 'pacing:researcher', 'haiku', true)
  expect(seen.store['agents:local_s1']).toBe(undefined)
  expect(seen.flying).toBe(1)
  release()
  await clock.settle()
  // never two at once; the one write after it took the list as it stood then
  expect(seen.most).toBe(1)
  expect(seen.sets.filter(k => k === 'agents:local_s1').length).toBe(2)
  expect(seen.store['agents:local_s1'].map((a: any) => a.id)).toEqual(['ag1', 'ag2', 'ag3'])
})

// the engine beneath for pacing's files: how often the home folder was asked
// for and config.json read; `config` is the file as it stands now
const countedFiles = (on: any, config: () => string) => {
  const seen = { home: 0, config: 0, toasts: [] as string[] }
  on('env.get', (_: unknown, e: any) => { if (e.name === 'USERPROFILE') seen.home++; return { value: e.name === 'USERPROFILE' ? '/home/test' : undefined } })
  on('fs.read', (_: unknown, e: any) => {
    if (!/[\\/]\.claude[\\/]pacing[\\/]config\.json$/.test(String(e.path))) return { value: '{}' }
    seen.config++
    return { value: config() }
  })
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.toast', (_: unknown, e: any) => (seen.toasts.push(e.text), { value: undefined }))
  on('prompt.submit', (_: unknown, e: any) => ({ text: e.text }))
  return seen
}

test('config.json is read once for a main turn\'s end, whatever asks; the home folder is asked for once', async ($, on) => {
  engine(on)
  big(on)
  mock.clock(on, { now: T0 })
  const seen = countedFiles(on, () => '{}')
  await $.prompt.submit({ text: 'work on', asUser: true })
  await $.session.measure(measure(10, [], 420000))
  const before = seen.config
  // the turn's end asks whether the switch offer is on, then the offers to compact
  await $.turn.complete(turn('claude-fable-5-2', 1))
  expect(seen.config - before).toBe(1)
  expect((await bandText($)).text).toContain('420k')
  // a second turn's end: once again, and the home folder still asked for once
  await $.session.measure(measure(10, [], 430000))
  await $.turn.complete(turn('claude-fable-5-2', 1))
  expect(seen.config - before).toBe(2)
  expect(seen.home).toBe(1)
})

test('a setting changed during a turn holds at that turn\'s end, though it was read a moment before', async ($, on) => {
  engine(on)
  big(on)
  // the clock stands still: what was read stays fresh by the clock
  mock.clock(on, { now: T0 })
  let config = '{}'
  const seen = countedFiles(on, () => config)
  await $.prompt.submit({ text: 'work on', asUser: true })
  await $.session.measure(measure(10, [], 100000))
  await $.turn.complete(turn('claude-fable-5-2', 1))
  expect(seen.config).toBeGreaterThan(0)
  // `/pacing compact off`, in the next turn
  config = JSON.stringify({ compactAsk: false })
  await $.session.measure(measure(10, [], 420000))
  await $.turn.complete(turn('claude-fable-5-2', 1))
  expect((await bandText($)).text).toBe(undefined)
  // and on again
  config = '{}'
  await $.session.measure(measure(10, [], 425000))
  await $.turn.complete(turn('claude-fable-5-2', 1))
  expect((await bandText($)).text).toContain('425k')
})

test('between turns config.json is kept for 3 seconds: asked again within them it is not read, after them it is, and a change holds from then', async ($, on) => {
  engine(on)
  big(on)
  const clock = mock.clock(on, { now: T0 })
  let config = '{}'
  const seen = countedFiles(on, () => config)
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'ag' + (++n) }))
  on('agent.list', () => ({ value: [1, 2, 3].map(i => ({ id: 'ag' + i, status: 'running', description: '', type: 'x' })) }))
  await $.session.measure(measure(10))
  const before = seen.config
  // each start asks whether the toasts about agents are on
  await spawn($, 'pacing:reader', 'haiku', true)
  await spawn($, 'pacing:verifier', 'haiku', true)
  expect(seen.config - before).toBeLessThan(2)
  expect(seen.toasts.filter(t => t.startsWith('▶️')).length).toBe(2)
  // `/pacing notify off` from another session: read again once the 3 seconds are over
  config = JSON.stringify({ agentNotices: false })
  const mid = seen.config
  await clock.advance(CONFIG_FRESH)
  await spawn($, 'pacing:researcher', 'haiku', true)
  expect(seen.config - mid).toBe(1)
  expect(seen.toasts.filter(t => t.startsWith('▶️')).length).toBe(2)
  expect(CONFIG_FRESH).toBe(3000)
})

test('the texts of a tool\'s answer are read in one place: `text`, then the content\'s texts', () => {
  expect(textsOf({ text: 'a', result: [{ type: 'text', text: 'b' }, { type: 'image' }, null, { type: 'text', text: 'c' }] })).toEqual(['a', 'b', 'c'])
  expect(textsOf({ result: { content: [{ type: 'text', text: 'b' }] } })).toEqual(['b'])
  expect(textsOf({ text: 7, result: 'x' })).toEqual([])
  expect(textsOf(null)).toEqual([])
  // both readers go by it: the rows of the sessions list and the meters, from a content block
  expect(sessionRows({ result: { content: [{ type: 'text', text: 'not json' }, { type: 'text', text: '[{"sessionId":"s1"}]' }] } })).toEqual([{ sessionId: 's1' }])
  const usage = JSON.stringify({ plan: { windows: [{ label: 'Weekly · all models', percentUsed: 12, resetsAt: RESET }] } })
  expect(usageOf({ text: 'not json', result: [{ type: 'text', text: usage }] })!.all).toBe(12)
})

// the actions stood inside the drawing, written anew at every draw
test('the band only draws: drawn twice nothing has run and the row stands; Compact now pressed in both drawings is one compaction', async ($, on) => {
  engine(on)
  const clock = mock.clock(on, { now: T0 })
  big(on)
  const seen = offers(on, { compacted: { tokensBefore: 420000, tokensAfter: 38000 } })
  await $.prompt.submit({ text: 'work on', asUser: true })
  await $.session.measure(measure(10, [], 420000))
  await $.turn.complete(turn('claude-fable-5-2', 1))
  const one = await $.ui.mount(BAND)
  const two = await $.ui.mount({ ...BAND, requestId: 'pacing-2' } as any)
  expect((await one.find({ type: 'Text', text: /session is/ }))?.text).toContain('420k')
  expect((await two.find({ type: 'Text', text: /session is/ }))?.text).toContain('420k')
  await clock.advance(1)
  expect(seen.compacts).toEqual([])
  expect(seen.toasts).toEqual([])
  // both pressed before the first has run
  await one.press({ key: 'pacing-compact' })
  await two.press({ key: 'pacing-compact' })
  await clock.advance(1)
  await one.unmount()
  await two.unmount()
  expect(seen.compacts).toEqual([COMPACT_INSTRUCTIONS])
  expect(seen.toasts).toEqual(['🗜️ compacted from 420k to 38k tokens.'])
  expect((await bandText($)).text).toBe(undefined)
})

// a measure is the session's own: its input names no agent
test('a measure that fell by half ends the row whatever else its input carries', async ($, on) => {
  engine(on)
  big(on)
  offers(on)
  await $.prompt.submit({ text: 'work on', asUser: true })
  await $.session.measure(measure(10, [], 450000))
  await $.turn.complete(turn('claude-fable-5-2', 1))
  expect((await bandText($)).text).toContain('450k')
  await $.session.measure({ ...measure(10, [], 40000), agentId: 'a1' } as any)
  expect((await bandText($)).text).toBe(undefined)
})

// ---- the pane's drawings ----

// every drawing named its filter "glow": in one document url(#glow) meant
// the first drawing's, and its region cut the others' glow
test('each drawing has names of its own, from its kind and its input: none shared, each one defined where it is used', () => {
  const bars = [barSvg([{ pct: 60, color: '#22d3ee' }], 73.3), barSvg([{ pct: 18, color: '#34d399' }]), barSvg([{ pct: 83, color: '#fbbf24' }], 73.3, 480, 34, true)]
  const dials = Object.values(DIALS).map(dial => dial(50, '#22d3ee', 73))
  const robots = [robotSvg('#22d3ee', 0), robotSvg('#a78bfa', 1)]
  const all = [...bars, ...dials, ...robots]
  const names = all.map(svg => [...svg.matchAll(/ id="([^"]+)"/g)].map(m => m[1]))
  // what a drawing uses, it defines itself
  all.forEach((svg, i) => { for (const m of svg.matchAll(/url\(#([^)]+)\)/g)) expect(names[i]).toContain(m[1]) })
  const flat = names.flat()
  expect(flat.length).toBe(10)
  expect(new Set(flat).size).toBe(flat.length)
  expect(flat.filter(n => n === 'glow' || n === 'heart')).toEqual([])
  expect(names[0][0]).toMatch(/^glow-bar-[0-9a-z]+$/)
  expect(names[2][0]).toMatch(/^glow-loud-[0-9a-z]+$/)
  const reactor = names[bars.length + Object.keys(DIALS).indexOf('reactor')]
  expect(reactor[0]).toMatch(/^glow-reactor-[0-9a-z]+$/)
  expect(reactor[1]).toBe(reactor[0].replace(/^glow-/, 'heart-'))
  // a hash of the input, no counter: the same input, the same name and text
  expect(drawingId('bar', [{ pct: 60 }], 73.3)).toBe(drawingId('bar', [{ pct: 60 }], 73.3))
  expect(drawingId('bar', [{ pct: 60 }], 73.3)).not.toBe(drawingId('bar', [{ pct: 61 }], 73.3))
  expect(drawingId('ring', 1)).toMatch(/^ring-[0-9a-z]+$/)
  expect(reactorSvg(50, '#22d3ee', 73)).toBe(reactorSvg(50, '#22d3ee', 73))
  // another figure, another name
  expect(reactorSvg(51, '#22d3ee', 73)).not.toContain(reactor[0])
})

test('a drawing is built once for the same input, and the last 64 are kept', () => {
  const bar = barSvg([{ pct: 41, color: '#22d3ee' }], 50)
  const kept = builtCount(), done = buildsDone()
  expect(barSvg([{ pct: 41, color: '#22d3ee' }], 50)).toBe(bar)
  expect(robotSvg('#22d3ee', 3)).toBe(robotSvg('#22d3ee', 3))
  // the bar was not built again, the robot once for its two draws
  expect(buildsDone()).toBe(done + 1)
  expect(builtCount()).toBe(kept + 1)
  // an argument left out and its default given: the same drawing
  expect(barSvg([{ pct: 41, color: '#22d3ee' }], 50, 480, 34)).toBe(bar)
  for (let i = 0; i < MEMO_MAX + 10; i++) rulerSvg(100 + i)
  expect(builtCount()).toBe(MEMO_MAX)
  expect(MEMO_MAX).toBe(64)
  // one that left is built again, the same
  const before = buildsDone()
  expect(barSvg([{ pct: 41, color: '#22d3ee' }], 50)).toBe(bar)
  expect(buildsDone()).toBe(before + 1)
  expect(builtCount()).toBe(MEMO_MAX)
  // a pane drawn twice from the same model builds its drawings once
  const m = paneModel({ j: { all: 50, line: 73.3, level: 'ok' }, running: ['reader is running 3m'], mix: [{ name: 'Opus 5.5 high', share: 100 }] as any })
  paneView(TABLE, m, { surface: 'desktop', now: T0 })
  const drawn = buildsDone()
  paneView(TABLE, m, { surface: 'desktop', now: T0 + 5000 })
  expect(buildsDone()).toBe(drawn)
})

test('nothing blurred is animated: the robot\'s eyes and light glow by a gradient, the dial\'s turning rings and core have no filter', () => {
  const robot = robotSvg('#22d3ee', 0), reactor = reactorSvg(50, '#22d3ee', 73)
  const moving = [robot, ...Object.values(DIALS).map(dial => dial(50, '#22d3ee', 73)), frameSvg('agents', false, '#f472b6')]
  for (const svg of moving) {
    // no shape under a filter holds an animation, and none stands in a filtered group
    expect(svg).not.toMatch(/<(?:rect|circle|path|line|polygon)[^>]*filter="url\([^>]*[^/]>\s*<animate/)
    for (const group of svg.matchAll(/<g filter="[^"]+">([\s\S]*?)<\/g>/g)) expect(group[1]).not.toContain('<animate')
  }
  // the robot still blinks, pulses, talks and scans, with no filter at all
  expect(robot).not.toContain('<filter')
  expect(robot).not.toContain('filter=')
  expect(robot).toContain('<radialGradient id="halo-robot-')
  expect([...robot.matchAll(/<animate /g)].length).toBe(18)
  // the dial still turns and breathes; its glow is the data ring's, which stands still
  expect([...reactor.matchAll(/<animateTransform /g)].length).toBe(2)
  expect(reactor).toContain('values="0.8;1;0.8"')
  expect([...reactor.matchAll(/filter="url\(/g)].length).toBe(1)
})

// ---- the dial that jumped ----

// the begins of a drawing's animations, each with its duration
const begins = (svg: string) => [...svg.matchAll(/dur="([\d.]+)s" begin="(-?[\d.]+)s"/g)].map(m => [+m[1], +m[2]])
const hundredth = (n: number) => Math.round(n * 100) / 100

test('where an animation stands comes from the clock: a drawing handed over 5 seconds later is 5 seconds further on, and nothing else in it moved', () => {
  const dial = reactorSvg(50, '#22d3ee', 73)
  // as built: the outer brackets, the inner ring, the core's breath
  expect(begins(dial)).toEqual([[90, 0], [40, 0], [4, 0]])
  const first = phased(dial, T0 + 12300), second = phased(dial, T0 + 17300)
  const a = begins(first), b = begins(second)
  expect(a.map(x => x[0])).toEqual([90, 40, 4])
  a.forEach(([dur, begin], i) => {
    expect(begin <= 0 && begin > -dur).toBe(true)
    // (a begin is the negative of how far into its turn the animation is)
    expect(hundredth((((begin - b[i][1]) % dur) + dur) % dur)).toBe(5 % dur)
  })
  expect(first).not.toBe(second)
  const still = (svg: string) => svg.replace(/begin="-?[\d.]+s"/g, 'begin=""')
  expect(still(first)).toBe(still(dial))
  expect(still(second)).toBe(still(dial))
  // the same moment, the same text; within the rounding too
  expect(phased(dial, T0 + 12300)).toBe(first)
  expect(phased(dial, T0 + 12310)).toBe(first)
  // a tenth of a second for the slow turns, a twentieth for the quick ones; a whole turn is its start
  expect(phaseOf(90, 0, 12345)).toBe(12.3)
  expect(phaseOf(4, 0, 1234)).toBe(1.25)
  expect(phaseOf(4, 0, 3990)).toBe(0)
  expect(phaseOf(3.6, 0.37, 370)).toBe(0)
  expect(phaseOf(3.6, 0.37, 0)).toBe(3.25)
  // a robot's staggered animations each keep their own delay
  expect(begins(phased(robotSvg('#22d3ee', 1), 1000)).slice(0, 2)).toEqual([[1.4, -0.65], [3.6, -0.65]])
  // no time (a still picture), or nothing that moves: as built
  expect(phased(dial, 0)).toBe(dial)
  expect(phased(dial, undefined as any)).toBe(dial)
  const bar = barSvg([{ pct: 60, color: '#22d3ee' }], 73.3)
  expect(phased(bar, T0)).toBe(bar)
})

// an element table that keeps what it is handed, to read a tree by
const TABLE = Object.fromEntries(['Box', 'Text', 'Button', 'Svg'].map(type => [type, (props: any) => ({ type, props })])) as any
const nodes = (node: any, out: any[] = []): any[] => {
  if (!node || typeof node !== 'object') return out
  out.push(node)
  for (const child of [node.props?.children].flat()) nodes(child, out)
  return out
}

test('the dial keeps its place and size at every draw: a box that does not shrink, 124 by 124, whatever stands beside it', () => {
  const j = { all: 50, line: 73.3, level: 'ok', tokenUsd: 0.000008, paceUsd: 14.05, left: { points: 23.3, tokens: 16600000 } }
  const dials = [paneModel({ j }), paneModel({ j: { ...j, level: 'throttle', weekLevel: 'throttle', left: { points: -30, tokens: -40000000 } } })].map(m => {
    const tree = nodes(paneView(TABLE, m, { surface: 'desktop', now: T0 }))
    const box = tree.find(n => n.type === 'Box' && n.props.flexShrink === 0)
    expect(box.props.children.length).toBe(1)
    return box.props.children[0]
  })
  for (const dial of dials) {
    expect(dial.type).toBe('Svg')
    expect(dial.props.width).toBe(DIAL_SIZE)
    expect(dial.props.height).toBe(DIAL_SIZE)
    expect(dial.props.source).toContain('viewBox="0 0 160 160"')
  }
  expect(DIAL_SIZE).toBe(124)
})

test('the pane drawn again 5 seconds on: the dial\'s rings and core go on from where they were', async ($, on) => {
  engine(on)
  big(on)
  offers(on)
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 182700, window: 1000000, percent: 18, breakdown: BREAKDOWN }, rateLimits: [] } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  const clock = mock.clock(on, { now: T0 + 12300 })
  await $.prompt.submit({ text: 'work on', asUser: true })
  await $.session.measure(measure(10, [], 182700))
  await $.turn.complete(turn('claude-fable-5-2', 1))
  const dialOf = async () => {
    const ui = await $.ui.mount(PANE)
    const dial = (await ui.findAll({ type: 'Svg' })).find((s: any) => s.props.width === DIAL_SIZE)
    await ui.unmount()
    return dial.props
  }
  const first = await dialOf()
  await clock.advance(5000)
  const second = await dialOf()
  expect([first.width, first.height, second.width, second.height]).toEqual([124, 124, 124, 124])
  const a = begins(first.source), b = begins(second.source)
  expect(a.map(x => x[0])).toEqual([90, 40, 4])
  a.forEach(([dur, begin], i) => expect(hundredth((((begin - b[i][1]) % dur) + dur) % dur)).toBe(5 % dur))
  // the figure did not change: but for where the animations stand, the same drawing
  const still = (svg: string) => svg.replace(/begin="-?[\d.]+s"/g, 'begin=""')
  expect(still(second.source)).toBe(still(first.source))
})

// ---- background tasks in the pane ----

test('a background task is a call that answers with a task id: a shell, a monitor, a workflow; its end is its notification\'s word', () => {
  // Bash in the background, by the call or by Ctrl+B: its description, else its command
  expect(taskStarted({ tool: 'Bash', command: 'npm run dev', description: 'Run the dev server', run_in_background: true }, { result: { stdout: '', backgroundTaskId: 'b1' } }))
    .toEqual({ id: 'b1', kind: 'shell', what: 'Run the dev server', lasts: null })
  expect(taskStarted({ tool: 'Bash', command: 'npm  run\n dev' }, { result: { backgroundTaskId: 'b2', backgroundedByUser: true } }))
    .toEqual({ id: 'b2', kind: 'shell', what: 'npm run dev', lasts: null })
  expect(taskStarted({ tool: 'PowerShell', command: 'Get-Content -Wait log.txt' }, { result: { backgroundTaskId: 'p1' } })!.kind).toBe('shell')
  // a long command is cut
  expect(taskStarted({ tool: 'Bash', command: 'x'.repeat(200) }, { result: { backgroundTaskId: 'b3' } })!.what).toHaveLength(TASK_MAX)
  // a monitor with its own time limit, and one without
  expect(taskStarted({ tool: 'Monitor', description: 'the deploy log', command: 'tail -f deploy.log', timeout_ms: 300000 }, { result: { taskId: 'm1', timeoutMs: 300000 } }))
    .toEqual({ id: 'm1', kind: 'monitor', what: 'the deploy log', lasts: 300000 })
  expect(taskStarted({ tool: 'Monitor', description: 'the queue' }, { result: { taskId: 'm2', timeoutMs: 0, persistent: true } })!.lasts).toBe(null)
  // a workflow by its name
  expect(taskStarted({ tool: 'Workflow', name: 'review' }, { result: { status: 'async_launched', taskId: 'w1', workflowName: 'Review the branch' } }))
    .toEqual({ id: 'w1', kind: 'workflow', what: 'Review the branch', lasts: null })
  // not one: a foreground call, a refused one, another tool, an agent (it is among the agents)
  expect(taskStarted({ tool: 'Bash', command: 'ls' }, { result: { stdout: 'a' } })).toBe(null)
  expect(taskStarted({ tool: 'Bash', command: 'ls', run_in_background: true }, { deny: 'no' })).toBe(null)
  expect(taskStarted({ tool: 'Read', file_path: 'a' }, { result: { taskId: 'x' } })).toBe(null)
  expect(taskStarted({ tool: 'Agent', run_in_background: true }, { result: { agentId: 'ag1' } })).toBe(null)
  expect(taskStarted({ tool: 'Bash' }, null)).toBe(null)
  // the notification's text
  const note = (id: string, status: string) => '<task-notification>\n<task-id>' + id + '</task-id>\n<status>' + status + '</status>\n<summary>Background command "Run the dev server" ' + status + '</summary>\n</task-notification>'
  expect(taskEnded(note('b1', 'completed'))).toEqual({ id: 'b1', state: 'done' })
  expect(taskEnded(note('b1', 'failed'))).toEqual({ id: 'b1', state: 'failed' })
  expect(taskEnded(note('b1', 'killed'))).toEqual({ id: 'b1', state: 'stopped' })
  expect(taskEnded('<task_id> b1 </task_id><status> Completed </status>')).toEqual({ id: 'b1', state: 'done' })
  // no end: no status, a word that is none, no id, no text
  expect(taskEnded('<task-id>m1</task-id><summary>a line of the log</summary>')).toBe(null)
  expect(taskEnded(note('m1', 'running'))).toBe(null)
  expect(taskEnded('<status>completed</status>')).toBe(null)
  expect(taskEnded(undefined)).toBe(null)
  // the rows: oldest first, a finished one for its minute
  const list = [{ id: 'b', kind: 'monitor', what: 'the log', startedAt: T0 + 60000 }, { id: 'a', kind: 'shell', what: 'the server', startedAt: T0, state: 'failed', endedAt: T0 + 90000 }]
  expect(taskRows(list, T0 + 120000)).toEqual([{ kind: 'shell', what: 'the server', state: 'failed', time: '2m' }, { kind: 'monitor', what: 'the log', state: 'running', time: '1m' }])
  expect(taskRows(list, T0 + 90000 + TASK_DONE_FOR)).toEqual([{ kind: 'monitor', what: 'the log', state: 'running', time: '2m' }])
  expect(TASK_DONE_FOR).toBe(60000)
})

// the engine beneath for background tasks: Bash answers a call in the
// background with a task id, Monitor and Workflow with theirs; the store
const taskEngine = (on: any) => {
  const seen = { store: {} as Record<string, any>, toasts: [] as string[], n: 0 }
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('session.end', (_: unknown, e: any) => ({ sessionId: e.sessionId }))
  on('command.register', (_: unknown, e: any) => ({ value: { command: e.name } }))
  on('session.id', () => ({ value: 'local_s1' }))
  on('store.get', (_: unknown, e: any) => ({ value: seen.store[e.key] === undefined ? undefined : JSON.parse(JSON.stringify(seen.store[e.key])) }))
  on('store.set', (_: unknown, e: any) => { seen.store[e.key] = JSON.parse(JSON.stringify(e.value)); return { value: undefined } })
  on('store.delete', (_: unknown, e: any) => { delete seen.store[e.key]; return { value: undefined } })
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.toast', (_: unknown, e: any) => (seen.toasts.push(e.text), { value: undefined }))
  on('prompt.submit', (_: unknown, e: any) => ({ text: e.text }))
  on('tool.call', (_: unknown, e: any) => ({
    text: '',
    result: e.tool === 'Bash' && e.run_in_background ? { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'bg' + (++seen.n) }
      : e.tool === 'Monitor' ? { taskId: 'mon' + (++seen.n), timeoutMs: e.timeout_ms || 0 }
      : e.tool === 'TaskStop' ? { message: 'stopped', task_id: e.task_id, task_type: 'local_bash' }
      : {},
  }))
  return seen
}
const notification = (id: string, status: string) => ({
  text: '<task-notification>\n<task-id>' + id + '</task-id>\n<status>' + status + '</status>\n<summary>Background command ' + status + '</summary>\n</task-notification>',
  origin: { kind: 'task-notification' },
} as any)
// the pane's texts as drawn now, from the Background tasks heading on
const taskTexts = async ($: any, surface = 'desktop') => {
  const ui = await $.ui.mount({ ...PANE, surface } as any)
  const texts = (await ui.findAll({ type: 'Text' })).map((t: any) => t.text)
  await ui.unmount()
  const at = texts.indexOf('▸ BACKGROUND TASKS')
  return at < 0 ? null : texts.slice(at + 1)
}

test('background tasks at the foot of the pane: the kind, what it is and how long it has run; a finished one its minute with how it ended, then gone; no toasts', async ($, on) => {
  engine(on)
  const clock = mock.clock(on, { now: T0 })
  const seen = taskEngine(on)
  // none: no section
  expect(await taskTexts($)).toBe(null)
  await $.tool.call({ tool: 'Bash', command: 'npm run dev', description: 'Run the dev server', run_in_background: true } as any)
  await clock.advance(2 * 60000)
  await $.tool.call({ tool: 'Monitor', description: 'the deploy log', command: 'tail -f deploy.log', timeout_ms: 0 } as any)
  // a call in the foreground is none, nor is a subagent's own
  await $.tool.call({ tool: 'Bash', command: 'ls' } as any)
  await $.tool.call({ tool: 'Bash', command: 'sleep 100', run_in_background: true, agentId: 'ag1' } as any)
  await clock.advance(60000)
  expect(await taskTexts($)).toEqual(['shell', 'Run the dev server', '3m', 'monitor', 'the deploy log', '1m'])
  // the terminal: the same rows as text
  expect(await taskTexts($, 'terminal')).toEqual(['shell', 'Run the dev server', '3m', 'monitor', 'the deploy log', '1m'])
  expect(seen.store['tasks:local_s1'].map((t: any) => [t.id, t.kind])).toEqual([['bg1', 'shell'], ['mon2', 'monitor']])
  // the shell ends: its notification, delivered as a prompt
  await $.prompt.submit(notification('bg1', 'failed'))
  await clock.settle()
  expect(await taskTexts($)).toEqual(['shell', 'Run the dev server', '✗ failed · 3m', 'monitor', 'the deploy log', '1m'])
  await clock.advance(30000)
  expect(await taskTexts($)).toEqual(['shell', 'Run the dev server', '✗ failed · 3m', 'monitor', 'the deploy log', '2m'])
  // its minute over: gone, from the store too
  await clock.advance(30000)
  await clock.settle()
  expect(await taskTexts($)).toEqual(['monitor', 'the deploy log', '2m'])
  expect(seen.store['tasks:local_s1'].map((t: any) => t.id)).toEqual(['mon2'])
  // a notification of a task not listed (a subagent's, an agent) changes nothing
  await $.prompt.submit(notification('ag1', 'completed'))
  expect(await taskTexts($)).toEqual(['monitor', 'the deploy log', '2m'])
  // TaskStop ends the monitor; the notification after it is no second end
  await $.tool.call({ tool: 'TaskStop', task_id: 'mon2' } as any)
  await clock.advance(20000)
  await $.prompt.submit(notification('mon2', 'killed'))
  expect(await taskTexts($)).toEqual(['monitor', 'the deploy log', '■ stopped · 2m'])
  await clock.advance(40000)
  await clock.settle()
  expect(await taskTexts($)).toBe(null)
  expect(seen.store['tasks:local_s1']).toBe(undefined)
  expect(seen.toasts).toEqual([])
})

test('background tasks across a reload, a /clear and the session\'s end: kept under the session, kept in a new conversation, the key deleted at the end', async ($, on) => {
  engine(on)
  big(on)
  const clock = mock.clock(on, { now: T0 })
  const seen = taskEngine(on)
  await $.tool.call({ tool: 'Bash', command: 'npm run dev', description: 'Run the dev server', run_in_background: true } as any)
  await $.tool.call({ tool: 'Bash', command: 'npm test', description: 'Run the tests', run_in_background: true } as any)
  await clock.advance(60000)
  await $.prompt.submit(notification('bg2', 'completed'))
  await clock.settle()
  expect(seen.store['tasks:local_s1'].length).toBe(2)
  // /reload-plugins: this memory starts over and session.start runs again
  await clock.advance(30000)
  await start($)
  await clock.settle()
  expect(await taskTexts($)).toEqual(['shell', 'Run the dev server', '2m', 'shell', 'Run the tests', '✓ done · 1m'])
  // the finished one's minute counts on from its end, not from the reload
  await clock.advance(30000)
  await clock.settle()
  expect(await taskTexts($)).toEqual(['shell', 'Run the dev server', '2m'])
  // a /clear: the tasks are the process's, and stay; the old id's key goes
  await $.session.end({ reason: 'clear', sessionId: 'local_s1', resume: {} } as any)
  expect(seen.store['tasks:local_s1']).toBe(undefined)
  expect(await taskTexts($)).toEqual(['shell', 'Run the dev server', '2m'])
  // written again at the next prompt, under the id the session has then
  await $.prompt.submit({ text: 'something new', asUser: true })
  await clock.settle()
  expect(seen.store['tasks:local_s1'].map((t: any) => t.id)).toEqual(['bg1'])
  // the session ends for good: the key is deleted
  await $.session.end({ reason: 'prompt_input_exit', sessionId: 'local_s1', resume: {} } as any)
  expect(seen.store['tasks:local_s1']).toBe(undefined)
})

test('a monitor whose own time limit passed a minute ago with no word leaves the list', async ($, on) => {
  engine(on)
  const clock = mock.clock(on, { now: T0 })
  taskEngine(on)
  await $.tool.call({ tool: 'Monitor', description: 'the deploy log', command: 'tail -f deploy.log', timeout_ms: 300000 } as any)
  await clock.advance(5 * 60000 + 30000)
  expect(await taskTexts($)).toEqual(['monitor', 'the deploy log', '6m'])
  await clock.advance(60000)
  await clock.settle()
  expect(await taskTexts($)).toBe(null)
})

// ---- an agent's transcript from its row ----

test('a press on an agent\'s row in the terminal\'s pane opens that agent\'s transcript; a refusal is one toast; a side session\'s row is text', async ($, on) => {
  engine(on)
  big(on)
  const clock = mock.clock(on, { now: T0 })
  const seen = { toasts: [] as string[] }
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'ag1' }))
  on('agent.list', () => ({ value: [{ id: 'ag1', status: 'running', description: '', type: 'x' }] }))
  on('fs.read', () => ({ value: '{}' }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.toast', (_: unknown, e: any) => (seen.toasts.push(e.text), { value: undefined }))
  // the pane is on show, so the agents' own toasts stay away
  on('ui.panes', () => ({ value: [{ id: PANE_ID, title: PANE_TITLE, isShown: true, isFocused: false, isPlaced: true }] }))
  const views: any[] = []
  let deny: string | undefined
  on('ui.view', (_: unknown, e: any) => (views.push(e), { value: deny ? { deny } : {} }))
  // a side session this one started, working
  on('tool.call', (_: unknown, e: any) => (e.tool === SESSIONS_TOOL
    ? { result: {}, text: JSON.stringify([{ sessionId: 'local_side', title: 'Fix the docs build', startedBy: 'local_host', isRunning: true }]) } : { result: {} }))
  on('env.get', (_: unknown, e: any) => ({ value: e.name === 'CLAUDE_CODE_HOST_SESSION_ID' ? 'local_host' : e.name === 'USERPROFILE' ? '/home/test' : undefined }))
  await $.session.measure(measure(10))
  await spawn($, 'pacing:reader', 'haiku', true, 'read the logs')
  await $.tool.call({ tool: 'mcp__ccd_session__start_session' } as any)
  await clock.advance(20000)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' } as any)
  const buttons = (await ui.findAll({ type: 'Button' })).map((b: any) => b.key ?? b.props?.key)
  // one Button, the subagent's; the side session has none
  expect(buttons.filter((k: string) => k.startsWith('pacing-agent-'))).toEqual(['pacing-agent-ag1'])
  const texts = (await ui.findAll({ type: 'Text' })).map((t: any) => t.text)
  expect(texts.filter((s: string) => s.includes('side session'))).toEqual(['🤖 side session Fix the docs build is running 20s, Fix the docs build'])
  await ui.press({ key: 'pacing-agent-ag1' })
  expect(views).toEqual([{ agentId: 'ag1' }])
  expect(seen.toasts).toEqual([])
  // the engine says why not
  deny = 'the tasks list shows none for it.'
  await ui.press({ key: 'pacing-agent-ag1' })
  await ui.unmount()
  expect(views.length).toBe(2)
  expect(seen.toasts).toEqual(['❌ the agent\'s transcript did not open: the tasks list shows none for it.'])
  expect(viewDeniedText(undefined)).toBe('❌ the agent\'s transcript did not open.')
  expect(viewDeniedText('x'.repeat(200))).toHaveLength('❌ the agent\'s transcript did not open: '.length + 80 + 1)
})

test('the agents\' rows on a desktop are text, no Button; after a "no main view here" the terminal\'s are text too', async ($, on) => {
  engine(on)
  big(on)
  const clock = mock.clock(on, { now: T0 })
  const seen = { toasts: [] as string[] }
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'ag1' }))
  on('agent.list', () => ({ value: [{ id: 'ag1', status: 'running', description: '', type: 'x' }] }))
  on('fs.read', () => ({ value: '{}' }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.toast', (_: unknown, e: any) => (seen.toasts.push(e.text), { value: undefined }))
  on('ui.panes', () => ({ value: [{ id: PANE_ID, title: PANE_TITLE, isShown: true, isFocused: false, isPlaced: true }] }))
  const views: any[] = []
  on('ui.view', (_: unknown, e: any) => (views.push(e), { value: { deny: 'no main view here.' } }))
  await $.session.measure(measure(10))
  await spawn($, 'pacing:reader', 'haiku', true, 'read the logs')
  await clock.advance(20000)
  const agentButtons = async (ui: any) => (await ui.findAll({ type: 'Button' })).map((b: any) => b.key ?? b.props?.key).filter((k: string) => String(k).startsWith('pacing-agent-'))
  // the desktop: the row as text
  let ui = await $.ui.mount(PANE)
  expect(await agentButtons(ui)).toEqual([])
  expect((await ui.findAll({ type: 'Text' })).map((t: any) => t.text).filter((t: string) => String(t).includes('read the logs'))).toEqual(['reader is running: read the logs 20s'])
  await ui.unmount()
  // the terminal: a Button, until the engine says it draws no main view
  ui = await $.ui.mount({ ...PANE, surface: 'terminal' } as any)
  expect(await agentButtons(ui)).toEqual(['pacing-agent-ag1'])
  await ui.press({ key: 'pacing-agent-ag1' })
  await clock.settle()
  await ui.unmount()
  expect(views).toEqual([{ agentId: 'ag1' }])
  expect(seen.toasts).toEqual(['❌ the agent\'s transcript did not open: no main view here.'])
  ui = await $.ui.mount({ ...PANE, surface: 'terminal', requestId: 'pacing-2' } as any)
  expect(await agentButtons(ui)).toEqual([])
  await ui.unmount()
})

test('an agent\'s row as it is drawn: the robot beside a Button that holds its words; on the terminal the Button alone; without an id, text as before', () => {
  const m = paneModel({ running: [{ id: 'ag1', text: 'reader: read the logs, searching 3m (Haiku 5.5)' }, { id: null, text: 'side session Fix the docs 1m' }, 'verifier is running 40s'] as any })
  const pressed: string[] = []
  const tree = nodes(paneView(TABLE, m, { surface: 'desktop', onAgent: (id: string) => pressed.push(id) }))
  const buttons = tree.filter(n => n.type === 'Button' && String(n.props.key).startsWith('pacing-agent-'))
  expect(buttons.map(b => [b.props.key, b.props.label, b.props.plain])).toEqual([['pacing-agent-ag1', 'reader: read the logs, searching 3m (Haiku 5.5)', true]])
  buttons[0].props.onPress()
  expect(pressed).toEqual(['ag1'])
  // three robots, one beside each row, as before
  expect(tree.filter(n => n.type === 'Svg' && n.props.alt === 'An agent at work').length).toBe(3)
  const texts = tree.filter(n => n.type === 'Text').map(n => n.props.children)
  expect(texts).toContain('side session Fix the docs 1m')
  expect(texts).toContain('verifier is running 40s')
  // the terminal: the same words, the robot as a character
  const term = nodes(paneView(TABLE, m, { surface: 'terminal', onAgent: () => {} }))
  expect(term.filter(n => n.type === 'Button' && n.props.plain).map(n => n.props.label)).toEqual(['🤖 reader: read the logs, searching 3m (Haiku 5.5)'])
  expect(term.filter(n => n.type === 'Text').map(n => n.props.children)).toContain('🤖 verifier is running 40s')
  // nothing to press with: text
  expect(nodes(paneView(TABLE, m, { surface: 'desktop' })).filter(n => n.type === 'Button' && String(n.props.key).startsWith('pacing-agent-'))).toEqual([])
})

// ---- Compact, in the pane's Context section ----

// the engine beneath: a compaction that answers when the test lets it
const paneCompact = (on: any) => {
  const seen = { compacts: [] as string[], toasts: [] as string[], release: () => {} }
  const held = new Promise<void>(r => { seen.release = r })
  on('env.get', (_: unknown, e: any) => ({ value: e.name === 'USERPROFILE' ? '/home/test' : undefined }))
  on('fs.read', () => ({ value: '{}' }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.toast', (_: unknown, e: any) => (seen.toasts.push(e.text), { value: undefined }))
  on('prompt.submit', (_: unknown, e: any) => ({ text: e.text }))
  on('session.compact', async (_: unknown, e: any) => {
    seen.compacts.push(e.instructions)
    await held
    return { messages: [{ role: 'assistant', text: 'the summary', toolUses: [] }], tokensBefore: 300000, tokensAfter: 40000 }
  })
  return seen
}
const compactButton = async (ui: any) => (await ui.findAll({ type: 'Button' })).find((b: any) => (b.key ?? b.props?.key) === 'pacing-pane-compact')

test('the pane offers Compact from 300 000 tokens, not at 299 999; its press compacts with the instructions, and a second press while it runs does nothing', async ($, on) => {
  engine(on)
  big(on)
  const clock = mock.clock(on, { now: T0 })
  const seen = paneCompact(on)
  await $.session.measure(measure(10, [], 299999))
  let ui = await $.ui.mount(PANE)
  expect(await compactButton(ui)).toBeFalsy()
  await ui.unmount()
  await $.session.measure(measure(10, [], 300000))
  ui = await $.ui.mount(PANE)
  const button = await compactButton(ui)
  expect(button.label ?? button.props?.label).toBe('Compact')
  // (no row above the prompt at this size: the pane's button alone)
  expect((await bandText($)).text).toBe(undefined)
  await ui.press({ key: 'pacing-pane-compact' })
  await ui.press({ key: 'pacing-pane-compact' })
  await clock.advance(1)
  expect(seen.compacts).toEqual([COMPACT_INSTRUCTIONS])
  await ui.unmount()
  // while it runs the button says so, and a press on it is nothing
  ui = await $.ui.mount(PANE)
  const running = await compactButton(ui)
  expect(running.label ?? running.props?.label).toBe('Compacting…')
  await ui.press({ key: 'pacing-pane-compact' })
  await clock.advance(1)
  expect(seen.compacts.length).toBe(1)
  await ui.unmount()
  seen.release()
  await clock.advance(1)
  await clock.settle()
  expect(seen.toasts).toEqual(['🗜️ compacted from 300k to 40k tokens.'])
  // compacted: the session is small again, and the button is gone
  ui = await $.ui.mount(PANE)
  expect(await compactButton(ui)).toBeFalsy()
  await ui.unmount()
  // grown again: offered again, and a press compacts again
  await $.session.measure(measure(10, [], 310000))
  ui = await $.ui.mount(PANE)
  await ui.press({ key: 'pacing-pane-compact' })
  await clock.advance(1)
  await ui.unmount()
  expect(seen.compacts.length).toBe(2)
  expect(PANE_COMPACT_AT).toBe(300000)
})

test('Compact in the pane, as drawn: in the Context section with or without a breakdown; on the terminal a line of text', () => {
  expect(paneModel({ tokens: 300000 }).compact).toBe('offer')
  expect(paneModel({ tokens: 299999 }).compact).toBe(null)
  expect(paneModel({}).compact).toBe(null)
  expect(paneModel({ tokens: 120000, compacting: true }).compact).toBe('running')
  // without a measure yet, the breakdown's own total
  const bd = { totalTokens: 310000, maxTokens: 1000000, percentage: 31, categories: [] }
  expect(paneModel({ bd }).compact).toBe('offer')
  // the measure where there is one (after a compaction it is the smaller)
  expect(paneModel({ bd, tokens: 40000 }).compact).toBe(null)
  const keys = (m: any, surface: string) => nodes(paneView(TABLE, m, { surface })).filter(n => n.type === 'Button').map(n => n.props.key + ': ' + (n.props.label ?? [n.props.children].flat().map((c: any) => (c && c.props ? c.props.children : c)).join('')))
  expect(keys(paneModel({ bd }), 'desktop')).toEqual(['pacing-pane-compact: Compact', 'pacing-pane-refresh: Refresh'])
  expect(keys(paneModel({ tokens: 300000 }), 'desktop')).toEqual(['pacing-pane-compact: Compact', 'pacing-pane-refresh: Refresh'])
  expect(keys(paneModel({ bd, compacting: true }), 'desktop')).toEqual(['pacing-pane-compact: Compacting…', 'pacing-pane-refresh: Refresh'])
  expect(keys(paneModel({ bd, tokens: 40000 }), 'desktop')).toEqual(['pacing-pane-refresh: Refresh'])
  // the terminal: no button, the words
  expect(keys(paneModel({ bd }), 'terminal')).toEqual(['pacing-pane-refresh: Refresh'])
  const words = (m: any) => nodes(paneView(TABLE, m, { surface: 'terminal' })).filter(n => n.type === 'Text').map(n => n.props.children)
  expect(words(paneModel({ bd }))).toContain('/compact cuts it.')
  expect(words(paneModel({ bd, compacting: true }))).toContain('Compacting…')
  expect(words(paneModel({ bd, tokens: 40000 }))).not.toContain('/compact cuts it.')
})

test('the pane\'s Compact where the direct call is refused: /compact as if typed, the row\'s own way', async ($, on) => {
  engine(on)
  big(on)
  const clock = mock.clock(on, { now: T0 })
  const toasts: string[] = [], runs: string[] = []
  on('env.get', (_: unknown, e: any) => ({ value: e.name === 'USERPROFILE' ? '/home/test' : undefined }))
  on('fs.read', () => ({ value: '{}' }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.toast', (_: unknown, e: any) => (toasts.push(e.text), { value: undefined }))
  on('session.compact', () => { throw new Error('pacing: $.session.compact: not available in a headless (-p / SDK) session yet') })
  on('command.run', (_: unknown, e: any) => (runs.push('/' + e.command + ' ' + e.args), { text: '' }))
  await $.session.measure(measure(10, [], 350000))
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'pacing-pane-compact' })
  await clock.advance(1)
  await ui.unmount()
  expect(runs).toEqual(['/compact ' + COMPACT_INSTRUCTIONS])
  expect(toasts).toEqual(['🗜️ compacted.'])
})

// a colour of the yellow, orange, red run (the white #f8fafc is not one)
const RUN_HUE = /#f[4-79ab][0-9a-f]{4}/

test('colours by points over the line: a text, a bar and the dial keep their colours up to 5 over, then yellow, orange, red at 30', () => {
  expect(OVER_CALM).toBe(5)
  expect(OVER_RED).toBe(30)
  expect(overText(null)).toBe(null)
  expect(overText(-10)).toBe(null)
  expect(overText(5)).toBe(null)
  expect(overText(6)).toBe(overShade(6))
  expect(overShade(5)).toBe(YELLOW)
  expect(overShade(0)).toBe(YELLOW)
  expect(overShade(17.5)).toBe(ORANGE)
  expect(overShade(30)).toBe('#f43f5e')
  expect(overShade(60)).toBe('#f43f5e')
  // between the stops: blends
  expect([YELLOW, ORANGE, '#f43f5e']).not.toContain(overShade(10))
  expect([YELLOW, ORANGE, '#f43f5e']).not.toContain(overShade(25))
  // a bar under its line: no orange, no red
  const under = barSvg([{ pct: 60, color: LEVEL_COLORS.ok }], 73.3)
  expect(under).not.toContain(YELLOW)
  expect(under).not.toContain(ORANGE)
  expect(under).not.toContain('#f43f5e')
  // up to 5 past it the cells keep their own colours (0.9.48): the same
  // cells as a bar with no line, none of the run
  const lit = (s: string) => [...s.matchAll(/z" fill="(#[0-9a-f]{6})"\/>/g)].map(m => m[1])
  const plain = lit(barSvg([{ pct: 100, color: LEVEL_COLORS.ok }], null))
  const four = barSvg([{ pct: 64, color: LEVEL_COLORS.ok }], 60)
  expect(four).not.toMatch(RUN_HUE)
  expect(lit(four)).toEqual(plain.slice(0, lit(four).length))
  // further past: from yellow at the first cell past 5, red at the far end
  const far = barSvg([{ pct: 100, color: LEVEL_COLORS.ok }], 60)
  expect(lit(far).slice(0, 23)).toEqual(plain.slice(0, 23))
  expect(lit(far)[23]).toBe(overShade((23 + 0.5) / 36 * 100 - 60))
  expect(far).toContain('#f43f5e')
  // the loud bar (the per-model meter) has a scale of its own: its tag and
  // line calm when a little over, yellow from 20 over, red from 80
  expect(barSvg([{ pct: 76, color: LEVEL_COLORS.ok }], 73.3, 480, 34, true)).toContain('fill="' + HUD + '"/><text')
  expect(barSvg([{ pct: 100, color: LEVEL_COLORS.ok }], 70, 480, 34, true)).toContain('fill="' + YELLOW + '"/><text')
  expect(barSvg([{ pct: 100, color: LEVEL_COLORS.ok }], 20, 480, 34, true)).toContain('fill="#f43f5e"/><text')
  // the dial: none of the run in the ring under the line or up to 5 past
  // it; further past, from yellow to red
  expect(reactorSvg(50, LEVEL_COLORS.ok, 73)).not.toMatch(RUN_HUE)
  expect(reactorSvg(54, LEVEL_COLORS.ok, 50)).not.toMatch(RUN_HUE)
  expect(reactorSvg(100, LEVEL_COLORS.ok, 50)).toContain(overShade((26 + 0.5) / 48 * 100 - 50))
  expect(reactorSvg(100, LEVEL_COLORS.ok, 50)).toContain('#f43f5e')
})

test('the pane\'s texts by points over: the week 3 over and Fable 4 over in their normal colours; the week 10 over orange-red, Fable 40 over yellow', () => {
  const base = { all: 50, line: 60, level: 'ok', premiumLabel: 'Fable 5.2' }
  const texts = (j: any) => nodes(paneView(TABLE, paneModel({ j }), { surface: 'desktop' })).filter(n => n.type === 'Text')
  const colorOf = (j: any, what: string) => { const n = texts(j).find(n => String(n.props.children).includes(what)); return n && n.props.color }
  // a little over: the level text and the time stay normal, Fable's words plain
  const little = { ...base, all: 63, level: 'over', weekLevel: 'over', premium: 64 }
  expect(colorOf(little, 'Over the budget line')).toBe('success')
  expect(colorOf(little, 'points over its budget line')).toBe(undefined)
  // over by 10: the week's words orange toward red; Fable's plain (its own scale)
  const ten = { ...base, all: 70, level: 'throttle', weekLevel: 'throttle', premium: 70 }
  expect(colorOf(ten, 'Far over the budget line')).toBe(overShade(10))
  expect(colorOf(ten, 'points over its budget line')).toBe(undefined)
  expect(colorOf(ten, '70%')).toBe(overShade(10))
  // Fable 40 over: on its own scale, yellow
  expect(colorOf({ ...base, premium: 100 }, 'points over its budget line')).toBe(YELLOW)
})

test('Fable\'s own colours: normal up to 20 over, yellow to 40, orange by 60, red from 80; the weekly meter keeps its scale', () => {
  expect([PREM_CALM, PREM_YELLOW, PREM_RED]).toEqual([20, 40, 80])
  expect(premText(null)).toBe(null)
  expect(premText(10)).toBe(null)
  expect(premText(20)).toBe(null)
  expect(premText(21)).toBe(YELLOW)
  expect(premShade(30)).toBe(YELLOW)
  expect(premShade(40)).toBe(YELLOW)
  expect([YELLOW, ORANGE, '#f43f5e']).not.toContain(premShade(50))
  expect(premShade(60)).toBe(ORANGE)
  expect([YELLOW, ORANGE, '#f43f5e']).not.toContain(premShade(70))
  expect(premShade(80)).toBe('#f43f5e')
  expect(premShade(95)).toBe('#f43f5e')
  const run = [YELLOW, ORANGE, '#f43f5e']
  // the pane, Fable `by` points over a line at 5 while the week is calm
  const at = (by: number) => {
    const j = { all: 4, line: 5, level: 'ok', weekLevel: 'ok', premium: 5 + by, premiumHeld: true, premiumLabel: 'Fable 5.2' }
    const view = nodes(paneView(TABLE, paneModel({ j }), { surface: 'desktop' }))
    const texts = view.filter(n => n.type === 'Text')
    const figure = texts.filter(n => n.props.children === Math.round(5 + by) + '%').pop()
    const note = texts.find(n => String(n.props.children).includes('points over its budget line'))
    const svg = view.find(n => n.type === 'Svg' && String(n.props.alt).startsWith('Fable 5.2')).props.source
    return { figure: figure.props.color, note, svg }
  }
  // 10 over: calm everywhere, the tag and line in HUD, no cell of the run
  const ten = at(10)
  expect(ten.svg).toContain('>OVER +10<')
  expect(ten.svg).toContain('fill="' + HUD + '"/><text')
  for (const c of run) expect(ten.svg).not.toContain(c)
  expect(run).not.toContain(ten.figure)
  expect(ten.note.props.color).toBe(undefined)
  expect(ten.note.props.weight).toBe(undefined)
  expect(String(ten.note.props.children).startsWith('▲')).toBe(false)
  // 30 over: yellow
  const thirty = at(30)
  expect(thirty.figure).toBe(YELLOW)
  expect(thirty.note.props.color).toBe(YELLOW)
  expect(thirty.note.props.weight).toBe('semibold')
  expect(thirty.svg).toContain('fill="' + YELLOW + '"/><text')
  // 50: between yellow and orange; 60: orange; 70: between orange and red
  expect(at(50).figure).toBe(premShade(50))
  expect(run).not.toContain(at(50).figure)
  expect(at(60).figure).toBe(ORANGE)
  expect(at(60).svg).toContain('fill="' + ORANGE + '"/><text')
  expect(at(70).figure).toBe(premShade(70))
  expect(run).not.toContain(at(70).figure)
  // 80 and 95: red
  expect(at(80).figure).toBe('#f43f5e')
  expect(at(80).svg).toContain('fill="#f43f5e"/><text')
  expect(at(95).note.props.color).toBe('#f43f5e')
  // the weekly meter keeps its own scale: 10 over is overShade(10)
  const week = nodes(paneView(TABLE, paneModel({ j: { all: 70, line: 60, level: 'throttle', weekLevel: 'throttle' } }), { surface: 'desktop' }))
  expect(week.find(n => n.type === 'Text' && n.props.children === '70%').props.color).toBe(overShade(10))
  // (the bar, 480 wide; the dial's alt starts with Weekly too)
  expect(week.find(n => n.type === 'Svg' && String(n.props.alt).startsWith('Weekly') && String(n.props.source).includes('width="480"')).props.source).toContain(overShade((23 + 0.5) / 36 * 100 - 60))
})

test('the week up to 5 over its line keeps its colours in the pane: the bar, the dial, the figure and the words; 6 over starts yellow', () => {
  const view = (all: number, level: string, dial?: string) => nodes(paneView(TABLE, paneModel({ j: { all, line: 60, level, weekLevel: level } }), { surface: 'desktop', dial }))
  const svgs = (v: any[]) => v.filter(n => n.type === 'Svg' && /^Weekly/.test(String(n.props.alt))).map(n => String(n.props.source))
  const texts = (v: any[]) => v.filter(n => n.type === 'Text' && typeof n.props.color === 'string').map(n => n.props.color)
  // 5 over: the dial (in the level 'over') and the bar draw none of the run;
  // no text takes a run colour
  const five = view(65, 'over')
  expect(svgs(five).length).toBe(2)
  for (const s of svgs(five)) expect(s).not.toMatch(RUN_HUE)
  for (const c of texts(five)) expect(c).not.toMatch(RUN_HUE)
  // the other dials too: the week's own colour run, not the level's yellow
  for (const d of ['ring', 'gauge', 'level']) expect(svgs(view(65, 'over', d))[0]).not.toContain(LEVEL_COLORS.over)
  // 6 over: the figure and the words start yellow
  const six = view(66, 'throttle')
  expect(texts(six)).toContain(overShade(6))
})

test('the 5-hour window: a bar under the per-model meter, with when it resets, when it fills first, and from 85% that heavy work waits', () => {
  const now = Date.parse('2026-11-27T10:00:00Z')
  const j = { all: 50, line: 60, level: 'ok', premium: 40, premiumLabel: 'Fable 5.2', five: 42, fiveReset: '2026-11-27T12:30:00Z' }
  const m = paneModel({ j, now })
  expect(m.meters.map(x => x.label)).toEqual(['Weekly', 'Fable 5.2', '5-hour'])
  expect(m.meters[2]).toEqual({ label: '5-hour', pct: 42, line: null, five: true, note: 'resets in 2h 30m' })
  expect(paneModel({ j: { ...j, fiveFull: '2026-11-27T11:20:00Z' }, now }).meters[2].note).toBe('resets in 2h 30m · full in 1h 20m at this pace')
  expect(FIVE_HOLD).toBe(85)
  expect(paneModel({ j: { ...j, five: 88 }, now }).meters[2].note).toBe('resets in 2h 30m · heavy work waits for the reset')
  // once its reset has passed: 0 until the next reading
  expect(paneModel({ j, now: Date.parse('2026-11-27T13:00:00Z') }).meters[2]).toEqual({ label: '5-hour', pct: 0, line: null, five: true, note: 'started over; the figure comes with the next reading' })
  // no figure, no bar
  expect(paneModel({ j: { ...j, five: null }, now }).meters.map(x => x.label)).toEqual(['Weekly', 'Fable 5.2'])
  // drawn: a bar with no line, and its words
  const view = nodes(paneView(TABLE, m, { surface: 'desktop' }))
  expect(view.some(n => n.type === 'Svg' && String(n.props.alt).startsWith('5-hour 42% used'))).toBe(true)
  expect(view.some(n => n.type === 'Text' && n.props.children === 'resets in 2h 30m')).toBe(true)
})

test('a change of level is a short toast: the change and one step, never the whole advice', () => {
  const was = { level: 'over' }
  const j = { level: 'throttle', levelBy: 'premium', premiumLabel: 'Fable 5.2', premiumHeld: true, recommend: { label: 'Opus 5.5', effort: 'high' },
    do: 'Fable 5.2\'s meter is at throttle: this session belongs on Opus 5.5 high now, and Fable 5.2 is kept for judgment work; the Switch row offers it. no manual change now: the session dispatches everything to Opus 5.5 medium subagents and does itself only what they would get wrong.' }
  const text = levelToastText(was, j)
  expect(text.endsWith('over budget -> far over budget (Fable\'s meter). Fable 5.2 is kept for hard tasks; the Switch row offers Opus 5.5 high.')).toBe(true)
  expect(text.length).toBeLessThan(130)
  expect(levelStepText({ level: 'throttle', tierNames: { 2: 'Opus 5.5 medium' } })).toBe('Most work goes to Opus 5.5 medium subagents.')
  expect(levelStepText({ level: 'stop', do: 'the week is nearly used; from 100 % the work is charged to extra usage, so go on only with the user\'s word' })).toBe('The week is nearly used; past 100% it is charged to extra usage.')
  // below throttle no toast is due, so no step either
  expect(levelStepText({ level: 'ahead' })).toBe('')
  expect(levelStepText({ level: 'over', premiumOut: true, premiumLabel: 'Fable 5.2', recommend: { label: 'Opus 5.5', effort: 'high' } })).toBe('Fable 5.2 is out until the reset; the Switch row offers Opus 5.5 high.')
})

// ---- Claude Code's auto-compact window ----

// the engine beneath for /autocompact: a start, the breakdown with the
// window Claude Code has (`has`: its source and window), the model's context
// window (`window`, 1M unless given), config.json's text, the model, and
// what ran and was toasted
const autoEngine = (on: any, opts: { store?: Record<string, unknown>; config?: () => string; has?: () => { autocompactSource: string; rawMaxTokens: number } | null; window?: number; model?: () => string; answer?: () => any; run?: (argv: string[]) => any } = {}) => {
  const seen = { runs: [] as string[], toasts: [] as string[], scripts: [] as string[][], usage: 0, store: opts.store ?? {} as Record<string, unknown> }
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('store.get', (_: unknown, e: any) => ({ value: seen.store[e.key] }))
  on('store.set', (_: unknown, e: any) => { seen.store[e.key] = e.value; return { value: undefined } })
  on('store.delete', (_: unknown, e: any) => { delete seen.store[e.key]; return { value: undefined } })
  on('command.register', (_: unknown, e: any) => ({ value: { command: e.name } }))
  on('session.usage', () => {
    seen.usage++
    const has = opts.has ? opts.has() : { autocompactSource: 'auto', rawMaxTokens: 1000000 }
    return { value: { startedAt: 0, context: { window: opts.window ?? 1000000, tokens: 1000, percent: 0, ...(has ? { breakdown: { ...BREAKDOWN, ...has, maxTokens: has.rawMaxTokens } } : {}) }, rateLimits: [] } }
  })
  on('session.model', () => ({ value: opts.model ? opts.model() : 'claude-opus-5-5' }))
  on('env.get', (_: unknown, e: any) => ({ value: e.name === 'USERPROFILE' ? '/home/test' : undefined }))
  on('fs.read', (_: unknown, e: any) => ({ value: /config\.json$/.test(String(e.path)) && opts.config ? opts.config() : '{}' }))
  on('process.run', (_: unknown, e: any) => (seen.scripts.push([...e.argv]), { value: (opts.run && opts.run([...e.argv])) || answer('ahead', 10) }))
  on('command.run', (_: unknown, e: any) => (seen.runs.push('/' + e.command + ' ' + e.args), opts.answer ? opts.answer() : { text: '' }))
  on('ui.toast', (_: unknown, e: any) => (seen.toasts.push(e.text), { value: undefined }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  return seen
}

test('at a start: /autocompact 783000 where Claude Code has another window; nothing where it has it, and no toast either way', async ($, on) => {
  engine(on)
  const clock = mock.clock(on, { now: T0 })
  let has = { autocompactSource: 'auto', rawMaxTokens: 1000000 }
  const seen = autoEngine(on, { has: () => has })
  await start($)
  await clock.settle()
  expect(seen.runs).toEqual(['/autocompact 783000'])
  // once per start: a turn's end on the same model runs nothing
  await $.turn.complete(turn('claude-opus-5-5', 1))
  await clock.settle()
  expect(seen.runs).toEqual(['/autocompact 783000'])
  // a start where the settings have it already: nothing
  has = { autocompactSource: 'settings', rawMaxTokens: 783000 }
  await start($)
  await clock.settle()
  expect(seen.runs).toEqual(['/autocompact 783000'])
  // a window from CLAUDE_CODE_AUTO_COMPACT_WINDOW: /autocompact could not change it
  has = { autocompactSource: 'env', rawMaxTokens: 400000 }
  await start($)
  await clock.settle()
  expect(seen.runs).toEqual(['/autocompact 783000'])
  expect(seen.toasts).toEqual([])
  expect(AUTO_COMPACT_DEFAULT).toBe(750000)
})

test('the figure is where it compacts: the window set is that much higher, by the breakdown own buffer, no more than 1M', () => {
  expect(AUTO_COMPACT_BUFFER).toBe(33000)
  // the breakdown's 'Autocompact buffer' row, else the default
  expect(autoCompactBuffer(BREAKDOWN)).toBe(33000)
  expect(autoCompactBuffer({ categories: [{ name: 'Autocompact buffer', tokens: 32000, kind: 'buffer' }] })).toBe(32000)
  expect(autoCompactBuffer({ categories: [] })).toBe(33000)
  expect(autoCompactBuffer(null)).toBe(33000)
  expect(autoCompactWindow(750000)).toBe(783000)
  expect(autoCompactWindow(400000, 32000)).toBe(432000)
  expect(autoCompactWindow(1000000)).toBe(1000000)
  expect(autoCompactWindow(980000)).toBe(1000000)
  // had: the window set is the figure plus the buffer, or the model's window where that is smaller
  expect(autoCompactHas({ ...BREAKDOWN, autocompactSource: 'settings', rawMaxTokens: 783000 }, 750000)).toBe(true)
  expect(autoCompactHas({ ...BREAKDOWN, autocompactSource: 'settings', rawMaxTokens: 750000 }, 750000)).toBe(false)
  expect(autoCompactHas({ ...BREAKDOWN, autocompactSource: 'settings', rawMaxTokens: 200000 }, 750000, 200000)).toBe(true)
})

test('the setting: a number of its own, auto where the settings set a window, nothing at all when off', async ($, on) => {
  engine(on)
  const clock = mock.clock(on, { now: T0 })
  let config = '{"autoCompact":600000}'
  let has = { autocompactSource: 'settings', rawMaxTokens: 750000 }
  const seen = autoEngine(on, { config: () => config, has: () => has })
  await start($)
  await clock.settle()
  expect(seen.runs).toEqual(['/autocompact 633000'])
  // (config.json is kept for a moment: each start below reads it again after it)
  config = '{"autoCompact":"auto"}'
  await clock.advance(CONFIG_FRESH)
  await start($)
  await clock.settle()
  expect(seen.runs).toEqual(['/autocompact 633000', '/autocompact auto'])
  // auto where the settings set none: nothing
  has = { autocompactSource: 'model-default', rawMaxTokens: 400000 }
  await start($)
  await clock.settle()
  expect(seen.runs.length).toBe(2)
  // off: nothing runs, where the window differs from every value
  config = '{"autoCompact":"off"}'
  has = { autocompactSource: 'settings', rawMaxTokens: 300000 }
  await clock.advance(CONFIG_FRESH)
  await start($)
  await clock.settle()
  expect(seen.runs.length).toBe(2)
  // a value config.mjs would refuse is the default
  expect(autoCompactOf({ autoCompact: 50 })).toBe(750000)
  expect(autoCompactOf({ autoCompact: 'off' })).toBe('off')
  expect(autoCompactOf(null)).toBe(750000)
})

test('a new model, or the setting changed in a turn: checked again at that turn\'s end; the same model and setting are not', async ($, on) => {
  engine(on)
  const clock = mock.clock(on, { now: T0 })
  let config = '{}'
  let has = { autocompactSource: 'settings', rawMaxTokens: 783000 }
  const seen = autoEngine(on, { config: () => config, has: () => has })
  await start($)
  await clock.settle()
  expect(seen.runs).toEqual([])
  // the other model keeps its own window: Claude Code's default there
  has = { autocompactSource: 'auto', rawMaxTokens: 1000000 }
  await $.turn.complete(turn('claude-fable-5-2', 1))
  await clock.settle()
  expect(seen.runs).toEqual(['/autocompact 783000'])
  await $.turn.complete(turn('claude-fable-5-2', 1))
  await clock.settle()
  expect(seen.runs).toEqual(['/autocompact 783000'])
  // `/pacing autocompact 500k` in a turn
  config = '{"autoCompact":500000}'
  await $.turn.complete(turn('claude-fable-5-2', 1))
  await clock.settle()
  expect(seen.runs).toEqual(['/autocompact 783000', '/autocompact 533000'])
  // a /model that ran: checked for the model it set
  has = { autocompactSource: 'auto', rawMaxTokens: 1000000 }
  await $.command.run({ command: 'model', args: 'claude-sonnet-5-5' } as any)
  await clock.settle()
  expect(seen.runs).toEqual(['/autocompact 783000', '/autocompact 533000', '/model claude-sonnet-5-5', '/autocompact 533000'])
})

test('a model with a smaller window than the setting: Claude Code measures against the window, and once set the check finds nothing to do', async ($, on) => {
  engine(on)
  const clock = mock.clock(on, { now: T0 })
  // a model with a 200k window; Claude Code keeps 750 000 but shows min(window, value)
  let has = { autocompactSource: 'auto', rawMaxTokens: 200000 }
  const seen = autoEngine(on, { has: () => has, window: 200000, model: () => 'claude-sonnet-5-5', answer: () => (has = { autocompactSource: 'settings', rawMaxTokens: 200000 }, { text: '' }) })
  await start($)
  await clock.settle()
  expect(seen.runs).toEqual(['/autocompact 783000'])
  await $.turn.complete(turn('claude-sonnet-5-5', 1))
  await clock.settle()
  // the next session's start: set already
  await start($)
  await clock.settle()
  expect(seen.runs).toEqual(['/autocompact 783000'])
  expect(seen.toasts).toEqual([])
})

test('a refused /autocompact at a start is one toast, at most one per load; the session goes on', async ($, on) => {
  engine(on)
  const clock = mock.clock(on, { now: T0 })
  const seen = autoEngine(on, { answer: () => ({ text: 'Unknown command: autocompact', exitCode: 1 }) })
  await start($)
  await clock.settle()
  expect(seen.runs).toEqual(['/autocompact 783000'])
  expect(seen.toasts).toEqual(['❌ Claude Code\'s auto-compact was not set to 750k: Unknown command: autocompact. /autocompact 783000 sets it.'])
  await start($)
  await clock.settle()
  expect(seen.runs.length).toBe(2)
  expect(seen.toasts.length).toBe(1)
  expect(autoCompactFailedText('auto', '')).toBe('❌ Claude Code\'s auto-compact was not set to its default. /autocompact auto sets it.')
})

test('the pane\'s auto-compact rows: the switch for Claude Code\'s own first, then its words with − and + by 50k; none past the bounds; one dim line when off', () => {
  expect(AUTO_COMPACT_STEP).toBe(50000)
  expect(AUTO_COMPACT_OWN_LABEL).toBe('Use Claude Auto Compact')
  expect(AUTO_COMPACT_OWN_NOTE).toBe('It compacts near the end of the window.')
  expect(paneModel({}).autoCompact).toBe(null)
  expect(AUTO_COMPACT_OFF_TEXT).toBe('Auto-compact: pacing leaves it alone (/pacing autocompact 750k or auto turns it back on)')
  expect(paneModel({ autoCompact: 'off' }).autoCompact).toEqual({ text: AUTO_COMPACT_OFF_TEXT, off: true })
  expect(paneModel({ autoCompact: 750000 }).autoCompact).toEqual({ text: 'Compact at 750k', own: false, less: 700000, more: 800000 })
  // Claude Code's own: no − and +, the note, and the count the toggle returns to (the last kept, else the default)
  expect(paneModel({ autoCompact: 'auto' }).autoCompact).toEqual({ text: 'Auto-compact: Claude Code\'s default', own: true, note: AUTO_COMPACT_OWN_NOTE, back: 750000 })
  expect(paneModel({ autoCompact: 'auto', autoCompactLast: 600000 }).autoCompact.back).toBe(600000)
  expect(paneModel({ autoCompact: 'auto', autoCompactLast: 50 }).autoCompact.back).toBe(750000)
  expect(autoCompactLastOf(undefined)).toBe(750000)
  expect(paneModel({ autoCompact: 100000 }).autoCompact).toEqual({ text: 'Compact at 100k', own: false, less: null, more: 150000 })
  expect(paneModel({ autoCompact: 1000000 }).autoCompact).toEqual({ text: 'Compact at 1M', own: false, less: 950000, more: null })
  // off the 50k grid: the next step on it
  expect(paneModel({ autoCompact: 120000 }).autoCompact).toEqual({ text: 'Compact at 120k', own: false, less: 100000, more: 150000 })
  const bd = { totalTokens: 100000, maxTokens: 1000000, percentage: 10, categories: [] }
  const keys = (m: any, surface: string) => nodes(paneView(TABLE, m, { surface })).filter(n => n.type === 'Button').map(n => n.props.key + ': ' + (n.props.label ?? [n.props.children].flat().map((c: any) => (c && c.props ? c.props.children : c)).join('')))
  // − and + first, the switch at the section's bottom (its row: the words left, the switch at the right end)
  expect(keys(paneModel({ bd, autoCompact: 750000 }), 'desktop')).toEqual(['pacing-pane-autocompact-less: −', 'pacing-pane-autocompact-more: +', 'pacing-pane-autocompact-auto:       ', 'pacing-pane-refresh: Refresh'])
  // on: the switch alone, the value and − and + hidden
  expect(keys(paneModel({ bd, autoCompact: 'auto' }), 'desktop')).toEqual(['pacing-pane-autocompact-auto:       ', 'pacing-pane-refresh: Refresh'])
  expect(keys(paneModel({ autoCompact: 1000000 }), 'desktop')).toEqual(['pacing-pane-autocompact-less: −', 'pacing-pane-autocompact-auto:       ', 'pacing-pane-refresh: Refresh'])
  // the switch: the drawn pill, blue with the knob right when on, grey with it left when off; over it a Button of blank text with no label (a desktop draws a label over its children), both clipped to the pill
  const knobOf = (m: any, surface: string) => nodes(paneView(TABLE, m, { surface })).find(n => n.props && n.props.key === 'pacing-pane-autocompact-auto')
  const pic = (m: any) => { const b = knobOf(m, 'desktop'); const svg = nodes(paneView(TABLE, m, { surface: 'desktop' })).find(n => n.type === 'Svg' && String(n.props.alt).startsWith('Use Claude Auto Compact')); return [b.props.plain, b.props.label, svg.props.alt, svg.props.source.includes(m.autoCompact.own ? '#3b82f6' : '#4b5563'), svg.props.source.includes(m.autoCompact.own ? 'cx="33"' : 'cx="13"')] }
  expect(pic(paneModel({ bd, autoCompact: 750000 }))).toEqual([true, undefined, 'Use Claude Auto Compact: off', true, true])
  expect(pic(paneModel({ bd, autoCompact: 'auto' }))).toEqual([true, undefined, 'Use Claude Auto Compact: on', true, true])
  const over = nodes(paneView(TABLE, paneModel({ bd, autoCompact: 750000 }), { surface: 'desktop' })).find(n => n.type === 'Box' && n.props.position === 'absolute')
  expect([over.props.width, over.props.height, over.props.overflow, nodes(over).some((n: any) => n.props && n.props.key === 'pacing-pane-autocompact-auto')]).toEqual([46, 26, 'hidden', true])
  // the switch's row spans the section: the words left, the switch right; the limit's row the same, on a line of its own
  const rowOf = (m: any, key: string) => nodes(paneView(TABLE, m, { surface: 'desktop' })).find(n => n.type === 'Box' && n.props.justifyContent === 'space-between' && nodes(n).some((c: any) => c && c.props && c.props.key === key))
  const sw = rowOf(paneModel({ bd, autoCompact: 750000 }), 'pacing-pane-autocompact-auto')
  expect([sw.props.justifyContent, sw.props.children[0].props.children]).toEqual(['space-between', 'Use Claude Auto Compact'])
  const limits = nodes(paneView(TABLE, paneModel({ bd, autoCompact: 750000 }), { surface: 'desktop' })).find(n => n.type === 'Box' && n.props.justifyContent === 'space-between' && [n.props.children].flat().some((c: any) => c && c.props && c.props.children === 'Compact at 750k'))
  expect(limits).toBeTruthy()
  expect(limits === sw).toBe(false)
  const words = (m: any, surface: string) => nodes(paneView(TABLE, m, { surface })).filter(n => n.type === 'Text').map(n => n.props.children)
  expect(words(paneModel({ bd, autoCompact: 750000 }), 'desktop')).toContain('Compact at 750k')
  expect(words(paneModel({ bd, autoCompact: 'auto' }), 'desktop')).toContain('It compacts near the end of the window.')
  expect(words(paneModel({ bd, autoCompact: 'auto' }), 'desktop').some((w: any) => String(w).startsWith('Compact at'))).toBe(false)
  // the switch's press: 'auto' when off, the count to return to when on; the same on the terminal
  const pressOf = (m: any, surface = 'desktop') => { const got: any[] = []; const b = nodes(paneView(TABLE, m, { surface, onAutoCompact: (v: any) => got.push(v) })).find(n => n.props && n.props.key === 'pacing-pane-autocompact-auto'); b.props.onPress(); return got }
  expect(pressOf(paneModel({ bd, autoCompact: 750000 }))).toEqual(['auto'])
  expect(pressOf(paneModel({ bd, autoCompact: 'auto', autoCompactLast: 450000 }))).toEqual([450000])
  expect(pressOf(paneModel({ bd, autoCompact: 750000 }), 'terminal')).toEqual(['auto'])
  // the terminal: the switch reads ○ off or ◉ on
  expect(keys(paneModel({ bd, autoCompact: 750000 }), 'terminal')).toEqual(['pacing-pane-autocompact-less: −', 'pacing-pane-autocompact-more: +', 'pacing-pane-autocompact-auto: ○ off', 'pacing-pane-refresh: Refresh'])
  expect(keys(paneModel({ bd, autoCompact: 'auto' }), 'terminal')).toEqual(['pacing-pane-autocompact-auto: ◉ on', 'pacing-pane-refresh: Refresh'])
  expect(words(paneModel({ bd, autoCompact: 750000 }), 'terminal')).toContain('Compact at 750k')
  // off: one dim line, the same on both surfaces, and no button
  const texts = (m: any, surface: string) => nodes(paneView(TABLE, m, { surface })).filter(n => n.type === 'Text' && String(n.props.children).includes('Auto-compact'))
  for (const surface of ['desktop', 'terminal']) {
    expect(keys(paneModel({ bd, autoCompact: 'off' }), surface)).toEqual(['pacing-pane-refresh: Refresh'])
    expect(texts(paneModel({ bd, autoCompact: 'off' }), surface).map(n => [n.props.children, n.props.dimColor, n.props.size])).toEqual([[AUTO_COMPACT_OFF_TEXT, true, 'caption']])
  }
})

test('a press on −, + or the toggle in the pane: config.mjs stores it, then /autocompact runs with it, and the row shows it; off again returns to the last count', async ($, on) => {
  engine(on)
  const clock = mock.clock(on, { now: T0 })
  let config = '{}'
  // config.mjs stands for itself: the file holds what it was run with
  const seen = autoEngine(on, { config: () => config, has: () => ({ autocompactSource: 'settings', rawMaxTokens: 783000 }), run: argv => {
    if (argv[2] !== 'autocompact') return null
    const v = argv[3]
    config = JSON.stringify({ autoCompact: v === 'auto' || v === 'off' ? v : Number(v) })
    return { exitCode: 0, stdout: 'auto-compact window: ...\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
  } })
  await start($)
  await clock.settle()
  expect(seen.runs).toEqual([])
  const texts = async (ui: any) => (await ui.findAll({ type: 'Text' })).map((t: any) => t.text)
  let ui = await $.ui.mount(PANE)
  expect(await texts(ui)).toContain('Compact at 750k')
  await ui.press({ key: 'pacing-pane-autocompact-less' })
  await clock.settle()
  await ui.unmount()
  const stored = seen.scripts.filter(a => a[2] === 'autocompact')
  expect(stored.map(a => a.slice(2))).toEqual([['autocompact', '700000']])
  expect(stored[0][1].endsWith('/skills/pacing/scripts/config.mjs')).toBe(true)
  expect(seen.runs).toEqual(['/autocompact 733000'])
  ui = await $.ui.mount(PANE)
  expect(await texts(ui)).toContain('Compact at 700k')
  await ui.press({ key: 'pacing-pane-autocompact-auto' })
  await clock.settle()
  await ui.unmount()
  expect(seen.runs).toEqual(['/autocompact 733000', '/autocompact auto'])
  // the count left is kept
  expect(seen.store[AUTO_COMPACT_LAST]).toBe(700000)
  ui = await $.ui.mount(PANE)
  // on: the toggle and the note, no value and no − or +
  expect(await texts(ui)).toContain('It compacts near the end of the window.')
  expect((await texts(ui)).some((t: any) => String(t).startsWith('Auto-compact'))).toBe(false)
  const buttons = (await ui.findAll({ type: 'Button' })).map((b: any) => b.key ?? b.props?.key)
  expect(buttons).toContain('pacing-pane-autocompact-auto')
  expect(buttons).not.toContain('pacing-pane-autocompact-less')
  expect(buttons).not.toContain('pacing-pane-autocompact-more')
  // off again: back to 700k, saved and run
  await ui.press({ key: 'pacing-pane-autocompact-auto' })
  await clock.settle()
  await ui.unmount()
  expect(seen.scripts.filter(a => a[2] === 'autocompact').map(a => a[3])).toEqual(['700000', 'auto', '700000'])
  expect(seen.runs).toEqual(['/autocompact 733000', '/autocompact auto', '/autocompact 733000'])
  ui = await $.ui.mount(PANE)
  expect(await texts(ui)).toContain('Compact at 700k')
  await ui.press({ key: 'pacing-pane-autocompact-more' })
  await clock.settle()
  await ui.unmount()
  expect(seen.runs).toEqual(['/autocompact 733000', '/autocompact auto', '/autocompact 733000', '/autocompact 783000'])
  // the turn's end after a press has nothing more to run
  await $.turn.complete(turn('claude-opus-5-5', 1))
  await clock.settle()
  expect(seen.runs.length).toBe(4)
  // a success says nothing
  expect(seen.toasts).toEqual([])
})

test('toggled off with no count kept: the default, saved and run', async ($, on) => {
  engine(on)
  const clock = mock.clock(on, { now: T0 })
  let config = '{"autoCompact":"auto"}'
  const seen = autoEngine(on, { config: () => config, has: () => ({ autocompactSource: 'auto', rawMaxTokens: 1000000 }), run: argv => {
    if (argv[2] !== 'autocompact') return null
    const v = argv[3]
    config = JSON.stringify({ autoCompact: v === 'auto' || v === 'off' ? v : Number(v) })
    return { exitCode: 0, stdout: 'auto-compact window: ...\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
  } })
  await start($)
  await clock.settle()
  expect(seen.runs).toEqual([])
  let ui = await $.ui.mount(PANE)
  await ui.press({ key: 'pacing-pane-autocompact-auto' })
  await clock.settle()
  await ui.unmount()
  expect(seen.scripts.filter(a => a[2] === 'autocompact').map(a => a[3])).toEqual(['750000'])
  expect(seen.runs).toEqual(['/autocompact 783000'])
  expect(seen.store[AUTO_COMPACT_LAST]).toBe(750000)
  ui = await $.ui.mount(PANE)
  const texts = (await ui.findAll({ type: 'Text' })).map((t: any) => t.text)
  expect(texts).toContain('Compact at 750k')
  expect(texts).not.toContain('It compacts near the end of the window.')
  await ui.unmount()
})

// ---- the agents' rows in the pane: model tags, step bars, output ----

test('an agent\'s row: its model as a tag, ↑ or ↓ against the session\'s; a bar of its steps, or of its time against the estimate, or none', () => {
  // the bar's shape
  expect(stepBarOf({ part: { done: 2, total: 4 }, startedAt: T0 }, T0 + 60000)).toEqual({ done: 2, total: 4 })
  expect(stepBarOf({ part: { done: 0, total: 3 }, startedAt: T0 }, T0 + 60000)).toEqual({ done: 0, total: 3 })
  // no steps: the time run against the usual run (10m: 2m 30s run is a quarter)
  expect(stepBarOf({ startedAt: T0, runs: [600000, 600000, 600000] }, T0 + 150000)).toEqual({ frac: 0.25 })
  // neither: none
  expect(stepBarOf({ startedAt: T0 }, T0 + 1000)).toBe(null)
  expect(stepBarOf({ startedAt: T0, runs: [60000, 60000, 60000] }, T0 + 120000)).toBe(null)
  // drawn: a segment a step, done lit, the one at work half lit, the rest a
  // dim track edged in the colour; STEPS_H tall (twice what it was)
  const steps = stepsSvg({ done: 2, total: 4 }, '#a78bfa')
  expect(STEPS_H).toBe(24)
  expect(steps).toContain('height="24" viewBox="0 0 480 24"')
  expect(steps.split('<path').length - 1).toBe(4)
  expect(steps.split('fill="#a78bfa"/>').length - 1).toBe(2)
  expect(steps.split('fill="#a78bfa" fill-opacity="0.55"/>').length - 1).toBe(1)
  expect(steps.split('fill="#a78bfa" fill-opacity="0.14" stroke="#a78bfa" stroke-opacity="0.45"').length - 1).toBe(1)
  // the time: one bar 15 high, lit by its share, on its track
  expect(stepsSvg({ frac: 0.25 }, '#a78bfa')).toContain('width="119.75" height="15" rx="4" fill="#a78bfa"')
  // past STEPS_MAX steps: the one bar
  expect(stepsSvg({ done: 15, total: STEPS_MAX * 2 }, '#a78bfa')).toContain('width="149.69" height="15"')
  // the terminal: full blocks, two a step up to 12 steps, one past that
  expect(stepsText({ done: 2, total: 4 })).toBe('████▓▓░░')
  expect(stepsText({ done: 4, total: 4 })).toBe('████████')
  expect(stepsText({ done: 1, total: 14 })).toBe('█▓░░░░░░░░░░░░')
  expect(stepsText({ frac: 0.5 })).toBe('████████████░░░░░░░░░░░░')
  // the tag: by price against the session's model
  expect(modelArrow('claude-haiku-5-5', 'claude-opus-5-5[1m]', PRICES)).toBe('↓')
  expect(modelArrow('haiku', 'claude-opus-5-5', PRICES)).toBe('↓')
  expect(modelArrow('claude-fable-5-2', 'claude-opus-5-5', PRICES)).toBe('↑')
  expect(modelArrow('claude-opus-5-5', 'claude-opus-5-5', PRICES)).toBe('')
  expect(modelArrow('gpt', 'claude-opus-5-5', PRICES)).toBe('')
  expect(modelIdOf('opus', PRICES)).toBe('claude-opus-5-5')
  // the rows paneModel makes
  const m = paneModel({ j: { all: 50, line: 73.3, level: 'ok', prices: PRICES, }, session: { model: 'claude-opus-5-5', effort: 'high' }, running: [
    { id: 'a1', text: 'reader: logs 2m', model: 'claude-haiku-5-5', effort: 'medium', on: 'Haiku 5.5 medium', bar: { frac: 0.5 } },
    { id: 'a2', text: 'implementer: step 2 of 4 4m', model: 'claude-opus-5-5', effort: 'high', on: 'Opus 5.5 high', bar: { done: 2, total: 4 } },
    { id: null, text: 'side session 1m', model: null, effort: null, on: '', bar: null },
    'verifier is running 40s',
  ] as any })
  expect(m.running).toEqual([
    { id: 'a1', text: 'reader: logs 2m', tag: '↓ Haiku 5.5 medium', bar: { frac: 0.5 }, out: null },
    { id: 'a2', text: 'implementer: step 2 of 4 4m', tag: 'Opus 5.5 high', bar: { done: 2, total: 4 }, out: null },
    { id: null, text: 'side session 1m', tag: '', bar: null, out: null },
    'verifier is running 40s',
  ])
  // no reading: the tag without an arrow
  expect(paneModel({ running: [{ id: 'a1', text: 'r', model: 'claude-haiku-5-5', effort: 'medium', on: 'Haiku 5.5 medium', bar: null }] as any }).running).toEqual([{ id: 'a1', text: 'r', tag: 'Haiku 5.5 medium', bar: null, out: null }])
  // drawn: the tag and the bar under the words
  const tree = nodes(paneView(TABLE, m, { surface: 'desktop', onAgent: () => {} }))
  const tags = tree.filter(n => n.type === 'Text' && n.props.mono && n.props.size === 'caption').map(n => n.props.children)
  expect(tags).toContain('↓ Haiku 5.5 medium')
  expect(tags).toContain('Opus 5.5 high')
  expect(tree.filter(n => n.type === 'Svg' && /^(Step|About)/.test(n.props.alt)).map(n => n.props.alt)).toEqual(['About 50% of its time', 'Step 2 of 4'])
  // the bar right under the words, above the tag
  const column = tree.find(n => n.type === 'Box' && [n.props.children].flat().some((c: any) => c && c.type === 'Svg' && c.props.alt === 'Step 2 of 4'))
  expect(column.props.children.map((c: any) => c.type === 'Svg' ? 'bar' : c.type === 'Button' ? 'words' : c.props.children)).toEqual(['words', 'bar', 'Opus 5.5 high'])
  // the terminal: the tag after the words, the steps under them in the agent's colour
  const term = nodes(paneView(TABLE, m, { surface: 'terminal', onAgent: () => {} }))
  expect(term.filter(n => n.type === 'Button' && n.props.plain).map(n => n.props.label)).toEqual(['🤖 reader: logs 2m (↓ Haiku 5.5 medium)', '🤖 implementer: step 2 of 4 4m (Opus 5.5 high)'])
  const bar = term.find(n => n.type === 'Text' && n.props.children === '   ████▓▓░░')
  expect(bar.props.color).toBeTruthy()
  expect(bar.props.dimColor).toBe(undefined)
})

test('the output helpers: the first line of a text, a command without its cd and assignments, the first lines of a report without their marks, a finished row', () => {
  expect(outLine('\n  \nAll   tests pass.\nMore.')).toBe('All tests pass.')
  expect(outLine('')).toBe('')
  expect(outLine('x'.repeat(200))).toHaveLength(OUT_CHARS)
  expect(commandWhat('cd /x/pacing/pacing; git diff')).toBe('git diff')
  expect(commandWhat('A=1; B=\'x y\'; cd /a && node t.js')).toBe('node t.js')
  expect(commandWhat('FOO=1 npm test')).toBe('FOO=1 npm test')
  expect(commandWhat('npm test')).toBe('npm test')
  expect(OUT_LINES).toBe(3)
  expect(reportLines('## Report\n\n- First point\n- Second **bold** `code`\n1. Third\nFourth')).toEqual(['Report', 'First point', 'Second bold code'])
  expect(finishedText({ type: 'pacing:reader', description: 'read the logs' }, 'done', 185000)).toBe('reader: read the logs ✓ done · 3m')
  expect(finishedText({ type: 'implementer', description: '' }, 'failed', 40000)).toBe('implementer ✗ failed · 40s')
})

test('the box\'s main tasks: the files it changes, a test, check, build or lint run with its outcome, how it ended; no narration, reads or plain commands', () => {
  const ok = (text: string) => ({ result: {}, text })
  expect([OUT_MAIN, OUT_MAIN_CHARS]).toEqual([2, 60])
  expect(changedLine([])).toBe('')
  expect(changedLine(['pane.mjs'])).toBe('Changing pane.mjs')
  expect(changedLine(['readings.mjs', 'pane.mjs'])).toBe('Changing readings.mjs and pane.mjs')
  expect(changedLine(['a.mjs', 'b.mjs', 'c.mjs', 'd.mjs'], 'Changed')).toBe('Changed c.mjs, d.mjs and 2 more')
  expect(changedLine(['x'.repeat(100) + '.mjs'])).toHaveLength(OUT_MAIN_CHARS)
  expect(changedFile({ tool: 'Write', file_path: 'C:\\x\\GUIDE.md' }, ok(''))).toBe('GUIDE.md')
  expect(changedFile({ tool: 'Edit', file_path: '/a/b.mjs' }, { deny: 'no' })).toBe(null)
  expect(changedFile({ tool: 'Edit', file_path: '/a/b.mjs' }, { result: {}, text: 'no match', isError: true })).toBe(null)
  expect(changedFile({ tool: 'Read', file_path: '/a/b.mjs' }, ok('x'))).toBe(null)
  // what is a run: by its description first, else its command; reads and listings never
  expect(runKind({ tool: 'Bash', command: 'npm test' })).toBe('Tests')
  expect(runKind({ tool: 'Bash', command: 'node scripts/release.mjs test', description: 'Run all checks' })).toBe('Checks')
  expect(runKind({ tool: 'PowerShell', command: 'npm run build' })).toBe('Build')
  expect(runKind({ tool: 'Bash', command: 'npx eslint .' })).toBe('Lint')
  expect(runKind({ tool: 'Bash', command: 'npx tsc --noEmit' })).toBe('Checks')
  expect(runKind({ tool: 'Bash', command: 'cd /x && grep -n test a.ts', description: 'Check imports in test file' })).toBe(null)
  expect(runKind({ tool: 'Bash', command: 'git diff --stat', description: 'Check the diff' })).toBe(null)
  expect(runKind({ tool: 'Bash', command: 'node "/p/scripts/config.mjs" part 1 2', description: 'Mark test part' })).toBe(null)
  expect(runKind({ tool: 'Bash', command: 'node x.js' })).toBe(null)
  expect(runKind({ tool: 'Read', file_path: 'test.ts' })).toBe(null)
  // its outcome
  expect(runLine({ tool: 'Bash', command: 'npm test' }, ok('TAP\n# tests 449\n# pass 448\n# fail 0\n# duration_ms 3'))).toBe('Tests: 448 pass')
  expect(runLine({ tool: 'Bash', command: 'node scripts/release.mjs test', description: 'Run all checks' }, ok('ok   node tests (455 pass), 63 s\nok   kit tests (216 pass), 40 s\nok   validation, 4 s'))).toBe('Checks: 455 pass')
  expect(runLine({ tool: 'Bash', command: 'node scripts/release.mjs test', description: 'Run all checks' }, ok('ok   node tests (455 pass), 63 s\nfail kit tests (214 pass, 2 fail), 40 s'))).toBe('Checks failed: 2 fail')
  expect(runLine({ tool: 'Bash', command: 'npm run build' }, { result: {}, text: 'Error: boom\nat x', isError: true })).toBe('Build failed: Error: boom')
  expect(runLine({ tool: 'Bash', command: 'npm run lint' }, ok(''))).toBe('Lint: ok')
  // output that says neither pass nor fail: finished, not a guessed ok
  expect(runLine({ tool: 'Bash', command: 'npm test' }, ok(['Running 12 suites', 'See the report'].join(String.fromCharCode(10))))).toBe('Tests: finished')
  expect(runLine({ tool: 'Bash', command: 'npm run build' }, ok('Build succeeded in 3s'))).toBe('Build: ok')
  expect(runLine({ tool: 'Bash', command: 'npm test' }, { deny: 'no' })).toBe('')
  expect(runLine({ tool: 'Bash', command: 'ls' }, ok('a'))).toBe('')
  // the box: the newest main task first, a kind once, no text twice, at most two
  let list: any[] = []
  for (const [k, t] of [['run', 'Tests: 1 pass'], ['files', 'Changing x'], ['run', ''], ['run', 'Tests: 2 pass'], ['files', 'Tests: 2 pass']]) list = noteMeaning(list, k, t)
  expect(list.map((x: any) => x.text)).toEqual(['Tests: 2 pass'])
  const a: any = {}
  expect(meaningOf(a, { tool: 'Grep', pattern: 'x' }, ok('1'))).toBe(false)
  expect(a.out).toEqual([])
  expect(meaningOf(a, { tool: 'Edit', file_path: '/a/pane.mjs' }, ok(''))).toBe(true)
  expect(meaningOf(a, { tool: 'Edit', file_path: '/a/pane.mjs' }, ok(''))).toBe(false)
  expect(meaningOf(a, { tool: 'Bash', command: 'npm test' }, ok('# pass 3'))).toBe(true)
  expect(a.out).toEqual(['Tests: 3 pass', 'Changing pane.mjs'])
  // how it ended: its report's first clause, a leading "Done." left out; then its newest main task
  expect(doneLine('done', '## Logs read\n- 3 failures')).toBe('Done: Logs read')
  expect(doneLine('done', 'Done. Fable\'s meter now has its own scale; the week keeps its own.')).toBe('Done: Fable\'s meter now has its own scale')
  expect(doneLine('failed', 'The suite would not start: no node')).toBe('Failed: The suite would not start')
  expect(doneLine('done', '')).toBe('')
  expect(doneLine('done', 'x'.repeat(200))).toHaveLength(OUT_MAIN_CHARS)
  expect(finishedOut(a, 'done', 'Done. The band row waits for the turn.')).toEqual(['Done: The band row waits for the turn', 'Tests: 3 pass'])
  expect(finishedOut({ mean: [{ kind: 'files', text: 'Changing a.mjs' }], files: ['a.mjs'] }, 'done', '')).toEqual(['Changed a.mjs'])
  expect(finishedOut({}, 'stopped', '')).toEqual([])
})

test('Agents at work never draws past the pane: every Box gives way, the words wrap with long runs made breakable, tags and output lines cut, the step bar scales', () => {
  const LONG = 'x'.repeat(200)
  expect(BREAK_AT).toBe(24)
  expect(breakable('short words stay as they are')).toBe('short words stay as they are')
  expect(breakable('X:/pacing/pacing/hooks/readings.mjs')).toBe('X:/\u200bpacing/\u200bpacing/\u200bhooks/\u200breadings.\u200bmjs')
  expect(breakable(LONG).split('\u200b').every(p => p.length <= BREAK_AT)).toBe(true)
  expect(breakable(LONG).replace(/\u200b/g, '')).toBe(LONG)
  const m = paneModel({ running: [
    { id: 'a1', text: 'implementer: rework the whole settings page so every toggle is saved at once, step 2 of 7 · 14m', model: null, on: 'Sonnet 5.5 medium', bar: { done: 2, total: 7 }, out: ['Changed X:/pacing/pacing/hooks/readings.mjs and X:/pacing/pacing/hooks/pane.mjs', LONG], outAt: 30 },
    { id: 'a2', text: 'researcher: https://example.com/a/very/long/url/that/goes/on/and/on/index.html · 3m', model: null, on: 'Fable 5.2 xhigh with a very long model tag that will not fit', bar: { frac: 0.3 } },
    { id: 'a3', text: 'reader: ' + LONG, model: null, on: 'Haiku 5.5', bar: { done: 30, total: 40 } },
    { id: null, text: 'side session 1m, ' + LONG, model: null, on: '', bar: null },
    { id: 'a5', done: true, text: 'verifier: the docs ✓ done · 9m', model: null, on: 'Sonnet 5.5 medium', bar: null, out: ['https://example.com/' + LONG, LONG, LONG], outAt: 40 },
    ...Array.from({ length: 6 }, (_, i) => ({ id: 'b' + i, text: 'tester ' + i, model: null, on: 'Haiku 5.5 low', bar: { frac: 0.5 } })),
  ] as any })
  const view = paneView(TABLE, m, { surface: 'desktop', onAgent: () => {} })
  // the agents' section: the panel whose rows hold the heading
  const all = nodes(view)
  const section = all.find(n => n.type === 'Box' && [n.props.children].flat().some((c: any) => c && c.type === 'Box' && [c.props.children].flat().some((h: any) => h && h.type === 'Text' && h.props.children === '▸ AGENTS AT WORK')))
  expect(section).toBeTruthy()
  const inside = nodes(section)
  const boxes = inside.filter(n => n.type === 'Box')
  expect(boxes.length).toBeGreaterThan(20)
  for (const b of boxes) expect(b.props.minWidth).toBe(0)
  for (const n of inside.filter(n => n.type === 'Text')) {
    expect(['wrap', 'truncate-end']).toContain(n.props.wrap ?? (n.props.children === '▸ AGENTS AT WORK' ? 'wrap' : undefined))
    // a text that wraps has no run longer than BREAK_AT without a break
    if (n.props.wrap === 'wrap') expect(String(n.props.children).split(/[\s\u200b]/).every(p => [...p].length <= BREAK_AT + 1)).toBe(true)
  }
  // the tags and the output lines are cut, not wrapped
  expect(inside.filter(n => n.type === 'Text' && String(n.props.children).startsWith('Fable 5.2 xhigh')).map(n => n.props.wrap)).toEqual(['truncate-end'])
  expect(inside.filter(n => n.type === 'Box' && n.props.backgroundColor === OUT_FILL).every(b => b.props.overflow === 'hidden' && b.props.children.every((t: any) => t.props.wrap === 'truncate-end'))).toBe(true)
  // a drawing with a set width is the robot alone (36); the frames and step bars take the slot's width
  for (const s of inside.filter(n => n.type === 'Svg')) expect(s.props.width === undefined || (s.props.width === 36 && s.props.alt === 'An agent at work')).toBe(true)
  // the Button keeps the whole words as its label
  expect(inside.find(n => n.type === 'Button' && n.props.key === 'pacing-agent-a3').props.label).toBe('reader: ' + LONG)
  // the terminal: the output lines cut, no zero-width spaces
  const term = nodes(paneView(TABLE, m, { surface: 'terminal' })).filter(n => n.type === 'Text')
  expect(term.filter(n => String(n.props.children).startsWith('   │ ')).every(n => n.props.wrap === 'truncate-end')).toBe(true)
  expect(term.some(n => String(n.props.children).includes('\u200b'))).toBe(false)
})

test('a kept agent sent its next task by SendMessage: the row shows the summary, not the first task; by id or by its name; an unknown recipient changes nothing', async ($, on) => {
  engine(on)
  big(on)
  const clock = mock.clock(on, { now: T0 })
  let n = 0
  on('agent.spawn', (_: unknown, e: any) => ({ model: 'claude-opus-5-5', agentId: e.resume ? e.resume.agentId : 'ag' + (++n) }))
  let live = ['ag1', 'ag2']
  on('agent.list', () => ({ value: live.map(id => ({ id, status: 'running', description: '', type: 'x' })) }))
  on('fs.read', () => ({ value: '{}' }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.panes', () => ({ value: [{ id: PANE_ID, title: PANE_TITLE, isShown: true, isFocused: false, isPlaced: true }] }))
  on('tool.call', () => ({ result: {}, text: 'sent' }))
  const rows = async () => {
    const ui = await $.ui.mount(PANE)
    const texts = [...(await ui.findAll({ type: 'Text' })).map((t: any) => t.text), ...(await ui.findAll({ type: 'Button' })).map((b: any) => b.label ?? b.props?.label)]
    await ui.unmount()
    return texts.filter((s: any) => typeof s === 'string' && /^(implementer|reviewer)/.test(s))
  }
  await $.session.measure(measure(10))
  await $.agent.spawn({ prompt: 'p', description: 'Dim line for auto-compact', subagentType: 'pacing:implementer', model: 'opus', background: true } as any)
  await $.agent.spawn({ prompt: 'p', description: 'Read the diff', subagentType: 'pacing:reviewer', model: 'opus', background: true, name: 'rev' } as any)
  expect((await rows()).some((s: string) => s.startsWith('implementer') && s.includes(': Dim line for auto-compact'))).toBe(true)
  // the first ends; the session sends it its next task, and the engine resumes it
  await clock.advance(60000)
  await $.turn.complete({ ...turn('claude-opus-5-5', 0.01, 'ag1'), answer: 'done' })
  await clock.settle()
  live = ['ag1', 'ag2']
  await $.tool.call({ tool: 'SendMessage', to: 'ag1', summary: 'The auto-compact switch', message: 'Next task ...' } as any)
  await $.agent.spawn({ prompt: 'Next task ...', description: 'Dim line for auto-compact', subagentType: 'pacing:implementer', resume: { agentId: 'ag1' } } as any)
  let texts = await rows()
  expect(texts.some((s: string) => s.startsWith('implementer') && s.includes(': The auto-compact switch'))).toBe(true)
  expect(texts.some((s: string) => s.startsWith('implementer') && s.includes(': Dim line for auto-compact') && !s.includes('done'))).toBe(false)
  // a running one addressed by its name: its row changes at once
  await $.tool.call({ tool: 'SendMessage', to: 'rev', summary: 'Check the switch too', message: '...' } as any)
  texts = await rows()
  expect(texts.some((s: string) => s.startsWith('reviewer') && s.includes(': Check the switch too'))).toBe(true)
  // a recipient the module does not know, a message with no summary, an agent's own SendMessage: nothing changes
  await $.tool.call({ tool: 'SendMessage', to: 'someone', summary: 'Elsewhere', message: '...' } as any)
  await $.tool.call({ tool: 'SendMessage', to: 'ag1', message: 'no summary' } as any)
  await $.tool.call({ tool: 'SendMessage', to: 'main', summary: 'Part one done', message: '...', agentId: 'ag1' } as any)
  texts = await rows()
  expect(texts.some((s: string) => s.startsWith('implementer') && s.includes(': The auto-compact switch'))).toBe(true)
  expect(texts.some((s: string) => s.startsWith('reviewer') && s.includes(': Check the switch too'))).toBe(true)
  expect(texts.some((s: string) => s.includes('Elsewhere') || s.includes('Part one done'))).toBe(false)
})

test('the output box shows for the two agents with the newest output alone; drawn as a small dim box under the row, on the terminal as lines', () => {
  const m = paneModel({ running: [
    { id: 'a1', text: 'reviewer 6m', model: null, on: '', bar: null, out: ['Read pane.mjs → 737 lines'], outAt: 10 },
    { id: 'a2', text: 'implementer 4m', model: null, on: '', bar: { done: 2, total: 4 }, out: ['Edit readings.mjs → saved', 'Bash npm test → # pass 448'], outAt: 30 },
    { id: 'a3', text: 'reader 2m', model: null, on: '', bar: null, out: [], outAt: 0 },
    { id: 'a4', done: true, text: 'researcher: the hooks API ✓ done · 3m', model: null, on: '', bar: null, out: ['turn.complete carries the report.'], outAt: 20 },
  ] as any })
  expect(m.running.map((x: any) => x.out)).toEqual([null, ['Edit readings.mjs → saved', 'Bash npm test → # pass 448'], null, ['turn.complete carries the report.']])
  expect(m.running[3].done).toBe(true)
  expect(OUT_SHOWN).toBe(2)
  const tree = nodes(paneView(TABLE, m, { surface: 'desktop' }))
  const boxes = tree.filter(n => n.type === 'Box' && n.props.backgroundColor === OUT_FILL)
  expect(boxes.length).toBe(2)
  expect(boxes[0].props.children.map((t: any) => [t.props.children, t.props.dimColor, t.props.wrap])).toEqual([['Edit readings.mjs → saved', true, 'truncate-end'], ['Bash npm test → # pass 448', true, 'truncate-end']])
  const term = nodes(paneView(TABLE, m, { surface: 'terminal' })).filter(n => n.type === 'Text').map(n => n.props.children)
  expect(term).toContain('   │ Bash npm test → # pass 448')
  expect(term).toContain('   │ turn.complete carries the report.')
  expect(term).not.toContain('   │ Read pane.mjs → 737 lines')
})

test('an agent\'s box in the pane from what the engine hands the module: the files it changes and its last run; no narration, reads, searches or listings; once ended, how it ended for a minute', async ($, on) => {
  engine(on)
  big(on)
  const clock = mock.clock(on, { now: T0 })
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'ag1' }))
  let live = true
  on('agent.list', () => ({ value: live ? [{ id: 'ag1', status: 'running', description: '', type: 'x' }] : [] }))
  on('fs.read', () => ({ value: '{}' }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.panes', () => ({ value: [{ id: PANE_ID, title: PANE_TITLE, isShown: true, isFocused: false, isPlaced: true }] }))
  const answers: Record<string, string> = {
    'npm test': 'TAP\n# tests 449\n# pass 448\n# fail 0\n# duration_ms 32400\n',
    'cd /x/pacing && node scripts/release.mjs test': 'ok   node tests (455 pass), 63 s\nfail kit tests (214 pass, 2 fail), 40 s\n',
    'pane.mjs': 'a\nb\nc' }
  on('tool.call', (_: unknown, e: any) => ({ result: {}, text: answers[e.command] || answers[String(e.file_path || '').split('/').pop()] || '' }))
  let say = ''
  on('turn.step', async function* (_: unknown, e: any) { return { turnId: e.turnId, index: e.index, answer: say, toolUses: [], stopReason: 'end_turn', usage: null } as any })
  const paneTexts = async () => {
    const ui = await $.ui.mount(PANE)
    // (a row's words are its Button's label)
    const texts = [...(await ui.findAll({ type: 'Text' })).map((t: any) => t.text), ...(await ui.findAll({ type: 'Button' })).map((b: any) => b.label ?? b.props?.label)]
    await ui.unmount()
    return texts
  }
  // the box's lines: the Texts between the agent's model tag and the next section
  const box = async () => { const t = await paneTexts(); return t.slice(t.indexOf('Haiku 5.5') + 1, t.indexOf('▸ CONTEXT')) }
  const step = async (text: string) => { say = text; for await (const _ of ($.turn as any).step({ turnId: 't', index: 0, messageCount: 1, model: 'claude-haiku-5-5', agentId: 'ag1' })) { /* drained */ } }
  await $.session.measure(measure(10))
  await spawn($, 'pacing:reader', 'haiku', true, 'read the logs')
  // reads, searches, a listing, a grep run as a shell "check", the step call: no line
  await $.tool.call({ tool: 'Read', file_path: '/a/pane.mjs', agentId: 'ag1' } as any)
  await $.tool.call({ tool: 'Grep', pattern: 'stepBarOf', agentId: 'ag1' } as any)
  await $.tool.call({ tool: 'Glob', pattern: '**/*.mjs', agentId: 'ag1' } as any)
  await $.tool.call({ tool: 'Bash', command: 'ls hooks', description: 'List the hooks', agentId: 'ag1' } as any)
  await $.tool.call({ tool: 'Bash', command: 'cd /x && grep -n "test" readings.test.ts', description: 'Check imports in test file', agentId: 'ag1' } as any)
  await $.tool.call({ tool: 'Bash', command: 'node "/p/scripts/config.mjs" part 1 2', agentId: 'ag1' } as any)
  expect(await box()).toEqual([])
  // its own words: not shown either
  await step('\nI will look at the band row first. Then the tests.')
  expect(await box()).toEqual([])
  // an edit, a test run: the newest first
  await $.tool.call({ tool: 'Edit', file_path: '/a/readings.mjs', agentId: 'ag1' } as any)
  await $.tool.call({ tool: 'Bash', command: 'npm test', description: 'Run the tests', agentId: 'ag1' } as any)
  await step('All tests pass. The band row is next.')
  // the main thread's own step says nothing in the box
  say = 'the session talks'
  for await (const _ of ($.turn as any).step({ turnId: 'm', index: 0, messageCount: 1, model: 'claude-fable-5-2' })) { /* drained */ }
  expect(await box()).toEqual(['Tests: 448 pass', 'Changing readings.mjs'])
  // a read, a second file and a failing run of the checks: each kind keeps one line
  await $.tool.call({ tool: 'Read', file_path: '/a/pane.mjs', agentId: 'ag1' } as any)
  await $.tool.call({ tool: 'Edit', file_path: '/a/pane.mjs', agentId: 'ag1' } as any)
  await $.tool.call({ tool: 'Bash', command: 'cd /x/pacing && node scripts/release.mjs test', description: 'Run all checks', agentId: 'ag1' } as any)
  expect(await box()).toEqual(['Checks failed: 2 fail', 'Changing readings.mjs and pane.mjs'])
  // the same file again: no new name, its line first again
  await $.tool.call({ tool: 'Edit', file_path: '/a/readings.mjs', agentId: 'ag1' } as any)
  expect(await box()).toEqual(['Changing pane.mjs and readings.mjs', 'Checks failed: 2 fail'])
  let texts = await paneTexts()
  expect(texts).not.toContain('the session talks')
  expect(texts.some((s: string) => /config\.mjs|Read |Grep |Bash |→|band row/.test(s))).toBe(false)
  // it ends: its row stays with how it ended, its report's first clause and its newest main task
  await clock.advance(60000)
  await $.turn.complete({ ...turn('claude-haiku-5-5', 0.01, 'ag1'), answer: '## Logs read\n- 3 failures in the band tests\n- all from one timeout\n- the rest pass' })
  await clock.settle()
  live = false
  texts = await paneTexts()
  expect(texts.some((s: string) => s.startsWith('reader: read the logs ✓ done · '))).toBe(true)
  expect(await box()).toEqual(['Done: Logs read', 'Changed pane.mjs and readings.mjs'])
  expect(texts).not.toContain('3 failures in the band tests')
  // its minute over: gone
  await clock.advance(TASK_DONE_FOR)
  await clock.settle()
  texts = await paneTexts()
  expect(texts.some((s: string) => s.startsWith('reader: read the logs'))).toBe(false)
  expect(texts).not.toContain('Done: Logs read')
})
