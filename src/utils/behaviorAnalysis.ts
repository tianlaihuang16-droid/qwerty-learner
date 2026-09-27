/* Read-only analysis of imperfect historical spelling records. */
// Historical JSONL and IndexedDB rows span several schema versions.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>
type Input = { records: Row[]; logs?: Row[]; chapters?: Row[]; chapterLogs?: Row[]; reviewRecords?: Row[];
  trainingRuns?: Row[]; states?: Row[]; logQuality?: Row; unfinishedSessions?: Row[] }
type Identity = { scope: string; normalizedWord: string }
const valid = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0
const str = (s: unknown) => typeof s === 'string' ? s : ''
const proportion = (n: number, d: number) => d ? Math.round(n / d * 10000) / 10000 : null
const OUTLIER_MAD_THRESHOLD = 10
const OUTLIER_MIN_SAMPLES = 10
const BASELINE_MIN_SAMPLES = 5
const round = (n: number) => Math.round(n * 100) / 100
function valuePercentile(sorted: number[], value: number | null) {
  if (value === null || !sorted.length) return null
  let low = 0, high = sorted.length
  while (low < high) { const mid = (low + high) >>> 1; if (sorted[mid] <= value) low = mid + 1; else high = mid }
  return proportion(low, sorted.length)
}
function pct(data: number[], q: number): number | null {
  const a = data.filter(valid).sort((x, y) => x - y)
  if (!a.length) return null
  const x = (a.length - 1) * q, i = Math.floor(x)
  return Math.round((a[i] + (a[Math.ceil(x)] - a[i]) * (x - i)) * 100) / 100
}
function stats(data: number[]) {
  const a = data.filter(valid).sort((x, y) => x - y)
  return { count: a.length, mean: a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length * 100) / 100 : null,
    min: a[0] ?? null, p25: pct(a, .25), median: pct(a, .5), p75: pct(a, .75), p90: pct(a, .9), p95: pct(a, .95), max: a.at(-1) ?? null }
}
function robustReference(values: number[]) {
  const median = pct(values, .5)
  return { median, mad: median === null ? null : pct(values.map(n => Math.abs(n - median)), .5), sampleCount: values.length }
}
function timingOutlier(value: number | null, sorted: number[], reference: ReturnType<typeof robustReference>) {
  const deviation = value === null || reference.sampleCount < OUTLIER_MIN_SAMPLES || !reference.mad ? null :
    round(Math.abs(value - (reference.median ?? 0)) / reference.mad)
  return { value, personalValuePercentile: valuePercentile(sorted, value), robustDeviation: deviation,
    status: value === null ? 'unavailable' : deviation === null ? 'insufficient-evidence' :
      deviation > OUTLIER_MAD_THRESHOLD ? 'extreme' : 'normal' }
}
function compareMetric(current: number[], prior: number[]) {
  const recentMedian = pct(current, .5), historicalMedian = pct(prior, .5)
  return { recentMedian, historicalMedian, delta: recentMedian === null || historicalMedian === null ? null : round(recentMedian - historicalMedian),
    recentSampleCount: current.length, historicalSampleCount: prior.length }
}
function distance(a: string, b: string) {
  const rows = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm']
  const coord = (c: string) => { for (let y = 0; y < rows.length; y++) { const x = rows[y].indexOf(c.toLowerCase()); if (x >= 0) return [x + y * .5, y] } return null }
  const x = coord(a), y = coord(b)
  return x && y ? Math.round(Math.hypot(x[0] - y[0], x[1] - y[1]) * 100) / 100 : null
}
function timing(attempt: Row) {
  const keys: Row[] = Array.isArray(attempt.keys) ? attempt.keys : []
  const times = keys.map(k => k?.activeAtMs)
  const sound = times.every(valid) && times.every((t, i) => t <= 3600000 && (!i || t >= times[i - 1]))
  const intervals: number[] | null = sound ? times.slice(1).map((t, i) => t - times[i]) : null
  const first = valid(attempt.firstKeyDelayMs) && attempt.firstKeyDelayMs <= 3600000 ? attempt.firstKeyDelayMs : null
  const duration = valid(attempt.durationMs) && attempt.durationMs <= 3600000 ? attempt.durationMs : null
  const typingMs = sound && times.length ? Math.max(0, (duration ?? times.at(-1) ?? 0) - times[0]) : null
  const maxPause = intervals?.length ? Math.max(...intervals) : null
  const visible = keys.filter(k => k?.targetVisible === true || k?.visibility === 'full').map(k => k.position)
  const assisted = attempt.answerRevealed === true || visible.length > 0
  const known = typeof attempt.answerRevealed === 'boolean' || keys.length > 0 && keys.every(k =>
    typeof k?.targetVisible === 'boolean' || k?.visibility === 'full' || k?.visibility === 'hidden')
  const classification = !assisted && !known ? 'unavailable' : !assisted ? 'independent' : !visible.length ? 'reveal-timing-unknown' :
    visible.length === keys.length && keys.length ? 'reveal-before-typing' : 'reveal-during-typing'
  return { firstKeyDelayMs: first, durationMs: duration, typingDurationAfterFirstKeyMs: typingMs,
    timingVectorMs: sound ? times : null, interKeyIntervalsMs: intervals, interKey: stats(intervals ?? []),
    maxPauseMs: maxPause, maxPausePosition: maxPause === null || !intervals ? null : intervals.indexOf(maxPause) + 1,
    charactersPerSecond: typingMs && keys.length > 1 ? Math.round((keys.length - 1) * 100000 / typingMs) / 100 : null,
    invalidTiming: !sound || (times.length > 0 && duration !== null && duration < (times.at(-1) ?? 0)),
    assistance: { classification, answerRevealed: typeof attempt.answerRevealed === 'boolean' ? attempt.answerRevealed : null, visibleCharacterCount: visible.length,
      visibleCharacterRatio: proportion(visible.length, keys.length), visiblePositions: visible,
      beforeVisibleInput: keys.filter(k => !visible.includes(k.position)).map(k => str(k.key)).join(''),
      whileVisibleInput: keys.filter(k => visible.includes(k.position)).map(k => str(k.key)).join('') } }
}
function addError(map: Map<string, Row>, error: Row, evidence: Row) {
  const expected = str(error.expected), actual = str(error.actual), key = `${expected}\u0000${actual}`
  let entry = map.get(key)
  if (!entry) { const keyboardDistance = distance(expected, actual)
    entry = { expected, actual, type: !expected ? 'insertion' : !actual ? 'omission' : 'substitution', keyboardDistance,
      adjacentKey: keyboardDistance === null ? null : keyboardDistance <= 1.5, count: 0, evidence: [] }; map.set(key, entry) }
  entry.count++; entry.evidence.push(evidence)
}
const errorList = (map: Map<string, Row>) => Array.from(map.values()).sort((a, b) => b.count - a.count || a.expected.localeCompare(b.expected) || a.actual.localeCompare(b.actual))
function normalizedErrorPosition(error: Row, word: string) {
  const position = error.position
  if (!Number.isInteger(position) || position < 0 || position >= word.length || !str(error.expected) ||
    word[position].toLowerCase() !== str(error.expected).toLowerCase()) return null
  return word.length === 1 ? 0 : position / (word.length - 1)
}
const recent = (history: Row[]) => {
  const summarize = (part: Row[]) => ({ exposures: part.length, cleanCorrectRate: proportion(part.filter(e => e.classification === 'clean-correct').length, part.length),
    errorRate: proportion(part.filter(e => e.errorCount > 0).length, part.length), firstKeyMedianMs: pct(part.flatMap(e => e.attempts.map((a: Row) => a.firstKeyDelayMs).filter(valid)), .5),
    assistedRate: proportion(part.filter(e => e.assistance.classification !== 'unavailable' && e.assistance.classification !== 'independent').length,
      part.filter(e => e.assistance.classification !== 'unavailable').length) })
  const current = history.slice(-10), prior = history.slice(0, -10)
  const currentSummary = summarize(current), priorSummary = summarize(prior)
  const attempts = (part: Row[]) => part.flatMap(e => e.attempts)
  const metric = (extract: (part: Row[]) => number[]) => compareMetric(extract(current), extract(prior))
  return { basis: 'last-10-exposures', recentWindow: currentSummary, historicalBeforeWindow: priorSummary,
    changes: { firstKeyDelayMs: metric(part => attempts(part).map(a => a.firstKeyDelayMs).filter(valid)),
      typingSpeedCharactersPerSecond: metric(part => attempts(part).map(a => a.charactersPerSecond).filter(valid)),
      interKeyIntervalMs: metric(part => attempts(part).flatMap(a => a.interKeyIntervalsMs ?? [])),
      maxPauseMs: metric(part => attempts(part).map(a => a.maxPauseMs).filter(valid)),
      baselineRatio: metric(part => attempts(part).flatMap(a => (a.pauseRelativeToBaseline ?? []).map((p: Row) => p.ratio).filter(valid))),
      attemptsToSuccess: metric(part => part.map(e => e.attemptsToSuccess).filter(valid)),
      assistedRate: { recent: currentSummary.assistedRate, historical: priorSummary.assistedRate,
        delta: currentSummary.assistedRate === null || priorSummary.assistedRate === null ? null :
          round(currentSummary.assistedRate - priorSummary.assistedRate),
        recentSampleCount: current.filter(e => e.assistance.classification !== 'unavailable').length,
        historicalSampleCount: prior.filter(e => e.assistance.classification !== 'unavailable').length } } }
}
function delayBucket(minutes: number | null) {
  if (!valid(minutes)) return 'unavailable'
  if (minutes < 10) return '<10m'
  if (minutes < 60) return '10m-1h'
  if (minutes < 1440) return '1h-1d'
  if (minutes < 10080) return '1d-7d'
  if (minutes < 43200) return '7d-30d'
  return '>=30d'
}

export function analyzeBehavior(input: Input, identityOf: (dict: string, word: string) => Identity, generatedAt: string) {
  const records = input.records ?? [], logs = input.logs ?? [], chapters = [...(input.chapters ?? []), ...(input.chapterLogs ?? [])]
  const logById = new Map<number, Row>(), eventIds = new Set<string>(), dbById = new Map(records.filter(r => valid(r.id)).map(r => [r.id as number, r]))
  const logOnly: Row[] = []
  let duplicateEventIds = 0, duplicateRecordIds = 0, conflictingRecords = 0
  const sameRecord = (a: Row, b: Row) => a.word === b.word && a.dict === b.dict && a.timeStamp === b.timeStamp &&
    a.wrongCount === b.wrongCount && JSON.stringify(a.timing ?? []) === JSON.stringify(b.timing ?? []) &&
    (a.spelling?.exposureId ?? null) === (b.spelling?.exposureId ?? null)
  for (const event of logs) {
    if (str(event.eventId) && eventIds.has(event.eventId)) { duplicateEventIds++; continue }
    if (str(event.eventId)) eventIds.add(event.eventId)
    if (valid(event.recordId)) {
      if (logById.has(event.recordId)) { duplicateRecordIds++; continue }
      const dbRecord = dbById.get(event.recordId)
      if (dbRecord && !sameRecord(dbRecord, event)) { conflictingRecords++; logOnly.push(event); continue }
      logById.set(event.recordId, event)
    }
    if (!valid(event.recordId) || !dbById.has(event.recordId)) logOnly.push(event)
  }
  const combined: Row[] = [...records.map(r => {
    const log = logById.get(r.id)
    if (!log) return { ...r, recordId: r.id, source: 'indexeddb' }
    return { ...log, ...r, recordId: r.id, eventId: log.eventId, recordedAt: log.recordedAt,
      spacedReview: log.spacedReview, source: 'indexeddb+jsonl' }
  }), ...logOnly.map(r => ({ ...r, source: 'jsonl-only' }))]
  const knownExposureIds = new Set(combined.map(r => str(r.spelling?.exposureId)).filter(Boolean))
  let chapterInterruptedTraces = 0
  for (const chapter of chapters) {
    const traces: Row[] = Array.isArray(chapter.spellingSession?.interrupted) ? chapter.spellingSession.interrupted : []
    for (const trace of traces) {
      if (!str(trace.exposureId) || knownExposureIds.has(trace.exposureId) || !str(trace.word) || !str(chapter.dict)) continue
      knownExposureIds.add(trace.exposureId)
      const active = trace.activeAttempt && Array.isArray(trace.activeAttempt.keys) && trace.activeAttempt.keys.length ?
        [{ ...trace.activeAttempt, outcome: 'interrupted' }] : []
      combined.push({ word: trace.word, dict: chapter.dict, timeStamp: chapter.timeStamp ?? null,
        recordedAt: chapter.recordedAt ?? null, recordId: null, eventId: chapter.eventId ?? null,
        source: 'chapter-interrupted', timestampQuality: 'chapter-completion-proxy',
        spelling: { ...trace, outcome: 'interrupted', attempts: [...(Array.isArray(trace.attempts) ? trace.attempts : []), ...active] } })
      chapterInterruptedTraces++
    }
  }
  let unfinishedDrafts = 0
  for (const session of input.unfinishedSessions ?? []) {
    const draft = session.draft
    if (!draft || !str(draft.exposureId) || knownExposureIds.has(draft.exposureId) ||
      !str(draft.word) || !str(session.dictionaryId)) continue
    knownExposureIds.add(draft.exposureId)
    const active = draft.activeAttempt && Array.isArray(draft.activeAttempt.keys) && draft.activeAttempt.keys.length ?
      [{ ...draft.activeAttempt, outcome: 'interrupted' }] : []
    const savedAt = Date.parse(str(session.savedAt))
    combined.push({ word: draft.word, dict: session.dictionaryId,
      timeStamp: Number.isFinite(savedAt) ? Math.floor(savedAt / 1000) : null,
      recordedAt: session.savedAt ?? null, recordId: null, eventId: null,
      source: 'unfinished-session-draft', timestampQuality: 'snapshot-save-time-proxy',
      spelling: { ...draft, outcome: 'in-progress', attempts: [...(Array.isArray(draft.attempts) ? draft.attempts : []), ...active] } })
    unfinishedDrafts++
  }
  const all = combined.filter(r => str(r.word) && str(r.dict))
    .sort((a, b) => (a.timeStamp ?? 0) - (b.timeStamp ?? 0) || (a.recordId ?? 0) - (b.recordId ?? 0))
  const groups = new Map<string, Row>(), sessions = new Map<string, Row>(), globalErrors = new Map<string, Row>(), baseline = new Map<string, number[]>()
  const characterBaseline = new Map<string, number[]>(), cleanTypingSpeeds: number[] = []
  const firstKeys: number[] = [], interKeys: number[] = [], speeds: number[] = [], maxPauses: number[] = [], typingDurations: number[] = [], delays: number[] = []
  const dictionary = new Map<string, Row>(), errorPositions = new Map<number, number>(), normalizedPositions: number[] = []
  let totalAttempts = 0, clean = 0, assisted = 0, errors = 0, interrupted = 0, legacy = 0, invalidTiming = 0
  for (const r of all) {
    const identity = identityOf(r.dict, r.word), key = `${identity.scope}\u0000${identity.normalizedWord}`
    const group: Row = groups.get(key) ?? { ...identity, displayWords: [], dictionaries: [], history: [], confusion: new Map(), positions: new Map() }
    if (!groups.has(key)) groups.set(key, group)
    if (!group.displayWords.includes(r.word)) group.displayWords.push(r.word)
    if (!group.dictionaries.includes(r.dict)) group.dictionaries.push(r.dict)
    const trace = Array.isArray(r.spelling?.attempts) ? r.spelling : null, raw: Row[] = trace?.attempts ?? []
    const attempts = raw.map((a: Row) => {
      const t = timing(a); if (t.invalidTiming) invalidTiming++
      if (t.firstKeyDelayMs !== null) firstKeys.push(t.firstKeyDelayMs)
      if (t.interKeyIntervalsMs) interKeys.push(...t.interKeyIntervalsMs)
      if (t.charactersPerSecond !== null) speeds.push(t.charactersPerSecond)
      if (t.maxPauseMs !== null) maxPauses.push(t.maxPauseMs)
      if (t.typingDurationAfterFirstKeyMs !== null) typingDurations.push(t.typingDurationAfterFirstKeyMs)
      const error = a.error && valid(a.error.position) ? { ...a.error, normalizedPosition: normalizedErrorPosition(a.error, r.word) } : null
      const evidence = { eventId: r.eventId ?? null, recordId: r.recordId ?? null, sessionId: trace?.sessionId ?? null, attemptNumber: a.number ?? null }
      if (error) {
        addError(group.confusion, error, evidence); addError(globalErrors, error, evidence)
        errorPositions.set(error.position, (errorPositions.get(error.position) ?? 0) + 1)
        if (error.normalizedPosition !== null) normalizedPositions.push(error.normalizedPosition)
        const list = group.positions.get(error.position) ?? []
        list.push({ ...evidence, timeStamp: r.timeStamp ?? null, expected: error.expected, actual: error.actual,
          normalizedPosition: error.normalizedPosition }); group.positions.set(error.position, list)
      }
      return { number: a.number ?? null, input: str(a.input), outcome: str(a.outcome), error,
        keys: Array.isArray(a.keys) ? a.keys.map((k: Row) => ({ key: str(k.key), position: k.position ?? null,
          activeAtMs: valid(k.activeAtMs) ? k.activeAtMs : null, targetVisible: k.targetVisible ?? null,
          visibility: k.visibility ?? null })) : null,
        ...t, evidence }
    })
    const legacyMistakes: Row[] = []
    if (!trace && r.mistakes && typeof r.mistakes === 'object') {
      for (const [positionText, actuals] of Object.entries(r.mistakes)) {
        const position = Number(positionText)
        if (!Number.isInteger(position) || position < 0 || position >= str(r.word).length || !Array.isArray(actuals)) continue
        for (const actual of actuals) if (typeof actual === 'string') {
          const mistake = { position, expected: str(r.word)[position], actual }
          const normalizedPosition = normalizedErrorPosition(mistake, r.word)
          legacyMistakes.push({ ...mistake, normalizedPosition })
          const evidence = { eventId: r.eventId ?? null, recordId: r.recordId ?? null, sessionId: null,
            attemptNumber: null, quality: 'legacy-mistakes' }
          addError(group.confusion, mistake, evidence); addError(globalErrors, mistake, evidence)
          errorPositions.set(position, (errorPositions.get(position) ?? 0) + 1)
          if (normalizedPosition !== null) normalizedPositions.push(normalizedPosition)
          const list = group.positions.get(position) ?? []
          list.push({ ...evidence, timeStamp: r.timeStamp ?? null, expected: mistake.expected, actual, normalizedPosition })
          group.positions.set(position, list)
        }
      }
    }
    totalAttempts += attempts.length
    const correct = attempts.find((a: Row) => a.outcome === 'correct'), errorCount = attempts.filter((a: Row) => a.outcome === 'error').length
    const wasInterrupted = trace?.outcome === 'interrupted' || attempts.some((a: Row) => a.outcome === 'interrupted')
    const exposureAssistance = correct?.assistance ?? attempts.find((a: Row) =>
      a.assistance.classification !== 'independent' && a.assistance.classification !== 'unavailable')?.assistance ??
      (attempts.length && attempts.every((a: Row) => a.assistance.classification === 'independent') ? attempts[0].assistance :
        { classification: 'unavailable' })
    const isAssisted = correct && correct.assistance.classification !== 'independent' && correct.assistance.classification !== 'unavailable'
    const classification = r.source === 'unfinished-session-draft' ? 'unfinished' : !trace ? 'legacy' :
      wasInterrupted && !correct ? 'interrupted' : isAssisted ? 'assisted-correct' :
        correct?.assistance.classification === 'unavailable' ? 'assistance-unknown-correct' :
      correct && !errorCount ? 'clean-correct' : correct && errorCount === 1 ? 'one-error-then-correct' :
        correct ? 'multi-error-then-correct' : 'error-incomplete'
    if (!trace) legacy++; if (classification === 'clean-correct') clean++; if (isAssisted) assisted++
    if (errorCount || (!trace && r.wrongCount > 0)) errors++
    if (wasInterrupted && r.source !== 'unfinished-session-draft') interrupted++
    const errorSequence = attempts.filter((a: Row) => a.error).map((a: Row) => a.error.position)
    const exposure = { word: r.word, timeStamp: r.timeStamp ?? null, recordedAt: r.recordedAt ?? null, eventId: r.eventId ?? null,
      exposureId: trace?.exposureId ?? null, timestampQuality: r.timestampQuality ?? 'exposure-completion',
      recordId: r.recordId ?? null, source: r.source, dictionary: r.dict, sessionId: trace?.sessionId ?? null,
      sourceIndex: trace?.sourceIndex ?? null, kind: trace?.kind ?? null, retryNumber: trace?.retryNumber ?? null,
      quality: r.source === 'chapter-interrupted' ? 'partial-interrupted' :
        r.source === 'unfinished-session-draft' ? 'unfinished-draft' : trace ? 'observed' : 'legacy',
      classification, wrongCount: valid(r.wrongCount) ? r.wrongCount : null,
      attemptCount: attempts.length, attempts, attemptsToSuccess: correct ? attempts.indexOf(correct) + 1 : null,
      errorCount, errorPositions: errorSequence, firstFailurePosition: errorSequence[0] ?? null,
      failureFrontier: errorSequence.length ? Math.max(...errorSequence) : null,
      correctionTrajectory: errorSequence.map((p: number, i: number) => i ? p - errorSequence[i - 1] : null),
      veryFastRestart: attempts.slice(1).some((a: Row) => a.firstKeyDelayMs !== null && a.firstKeyDelayMs < 250),
      timing: { firstKeyDelayMs: attempts[0]?.firstKeyDelayMs ?? null, attempts: attempts.map((a: Row) => ({ number: a.number,
        firstKeyDelayMs: a.firstKeyDelayMs, durationMs: a.durationMs, typingDurationAfterFirstKeyMs: a.typingDurationAfterFirstKeyMs,
        charactersPerSecond: a.charactersPerSecond, timingVectorMs: a.timingVectorMs, interKeyIntervalsMs: a.interKeyIntervalsMs,
        interKey: a.interKey, maxPauseMs: a.maxPauseMs, maxPausePosition: a.maxPausePosition, invalidTiming: a.invalidTiming })) },
      assistance: exposureAssistance, legacyTimingMs: !trace && Array.isArray(r.timing) ? r.timing.filter(valid) : null,
      legacyMistakes: trace ? null : legacyMistakes,
      spacedReviewContext: r.spacedReview ?? null, retryRelation: null }
    group.history.push(exposure)
    if (trace?.sessionId) { let session = sessions.get(trace.sessionId)
      if (!session) { session = { sessionId: trace.sessionId, exposures: [] }; sessions.set(trace.sessionId, session) }
      session.exposures.push(exposure) }
    const ds = dictionary.get(r.dict) ?? { dictionary: r.dict, exposures: 0, errors: 0, cleanCorrect: 0, assisted: 0 }
    ds.exposures++; if (errorCount || r.wrongCount > 0) ds.errors++
    if (classification === 'clean-correct') ds.cleanCorrect++; if (isAssisted) ds.assisted++
    dictionary.set(r.dict, ds)
  }
  const timingSamples = { firstKeyDelayMs: firstKeys, interKeyIntervalMs: interKeys, maxPauseMs: maxPauses,
    typingDurationAfterFirstKeyMs: typingDurations, typingSpeedCharactersPerSecond: speeds }
  const sortedTimingSamples = Object.fromEntries(Object.entries(timingSamples).map(([name, values]) =>
    [name, [...values].sort((a, b) => a - b)])) as Record<string, number[]>
  const timingReferences = Object.fromEntries(Object.entries(timingSamples).map(([name, values]) => [name, robustReference(values)])) as Row
  let baselineRawIntervals = 0, baselineExcludedIntervals = 0, baselineRawSpeeds = 0, baselineExcludedSpeeds = 0
  for (const g of Array.from(groups.values())) for (const e of g.history) for (const a of e.attempts) {
    a.timingOutliers = {
      firstKeyDelayMs: timingOutlier(a.firstKeyDelayMs, sortedTimingSamples.firstKeyDelayMs, timingReferences.firstKeyDelayMs),
      interKeyIntervalsMs: (a.interKeyIntervalsMs ?? []).map((n: number) => timingOutlier(n, sortedTimingSamples.interKeyIntervalMs, timingReferences.interKeyIntervalMs)),
      maxPauseMs: timingOutlier(a.maxPauseMs, sortedTimingSamples.maxPauseMs, timingReferences.maxPauseMs),
      typingDurationAfterFirstKeyMs: timingOutlier(a.typingDurationAfterFirstKeyMs, sortedTimingSamples.typingDurationAfterFirstKeyMs, timingReferences.typingDurationAfterFirstKeyMs),
      typingSpeedCharactersPerSecond: timingOutlier(a.charactersPerSecond, sortedTimingSamples.typingSpeedCharactersPerSecond, timingReferences.typingSpeedCharactersPerSecond) }
    if (e.classification !== 'clean-correct' || e.attempts.length !== 1 || a.assistance.classification !== 'independent' ||
      a.invalidTiming || !a.interKeyIntervalsMs || !a.keys) continue
    const extremeDuration = a.timingOutliers.typingDurationAfterFirstKeyMs.status === 'extreme'
    const extremeSpeed = a.timingOutliers.typingSpeedCharactersPerSecond.status === 'extreme'
    if (a.charactersPerSecond !== null) {
      baselineRawSpeeds++
      if (extremeDuration || extremeSpeed || a.timingOutliers.interKeyIntervalsMs.some((item: Row) => item.status === 'extreme')) baselineExcludedSpeeds++
      else cleanTypingSpeeds.push(a.charactersPerSecond)
    }
    for (let i = 1; i < a.keys.length; i++) {
      const interval = a.interKeyIntervalsMs[i - 1]
      baselineRawIntervals++
      if (a.timingOutliers.interKeyIntervalsMs[i - 1]?.status === 'extreme' || interval > 10000) { baselineExcludedIntervals++; continue }
      const pair = `${str(a.keys[i - 1].key)}${str(a.keys[i].key)}`.toLowerCase()
      const values = baseline.get(pair) ?? []; values.push(interval); baseline.set(pair, values)
      const character = str(a.keys[i].key).toLowerCase(), characterValues = characterBaseline.get(character) ?? []
      characterValues.push(interval); characterBaseline.set(character, characterValues)
    }
  }
  const keyboardBaseline = Array.from(baseline.entries()).map(([bigram, values]) => {
    const median = pct(values, .5)
    return { bigram, ...stats(values), madMs: median === null ? null : pct(values.map((n: number) => Math.abs(n - median)), .5) }
  }).sort((a, b) => a.bigram.localeCompare(b.bigram))
  const baselineByPair = new Map(keyboardBaseline.map(b => [b.bigram, b]))
  const stateByWord = new Map((input.states ?? []).filter(s => str(s.scope) && str(s.normalizedWord))
    .map(s => [`${s.scope}\u0000${s.normalizedWord}`, s]))
  const sessionPosition = new Map<Row, number>()
  for (const session of Array.from(sessions.values())) session.exposures.forEach((exposure: Row, index: number) => sessionPosition.set(exposure, index))
  const chapterBySession = new Map(chapters.filter(c => str(c.spellingSession?.id)).map(c => [c.spellingSession.id as string, c.spellingSession]))
  const unfinishedBySession = new Map((input.unfinishedSessions ?? []).filter(s => str(s.sessionId)).map(s => [s.sessionId as string, s]))
  const words: Row[] = Array.from(groups.values()).map(g => {
    const history: Row[] = g.history.sort((a: Row, b: Row) => (a.timeStamp ?? 0) - (b.timeStamp ?? 0) || (a.recordId ?? 0) - (b.recordId ?? 0))
    const retryLinks: Row[] = []
    const precedingBySessionSource = new Map<string, Row>()
    for (let i = 0; i < history.length; i++) {
      const e = history[i], previous = history[i - 1]
      e.actualDelayMinutes = previous && valid(e.timeStamp) && valid(previous.timeStamp) ? Math.round((e.timeStamp - previous.timeStamp) / 60 * 100) / 100 : null
      if (valid(e.actualDelayMinutes)) delays.push(e.actualDelayMinutes)
      e.actualDelayBucket = delayBucket(e.actualDelayMinutes)
      for (const a of e.attempts) if (a.interKeyIntervalsMs) a.pauseRelativeToBaseline = a.interKeyIntervalsMs.map((pause: number, p: number) => {
        const bigram = `${str(a.keys?.[p]?.key)}${str(a.keys?.[p + 1]?.key)}`.toLowerCase(), b = baselineByPair.get(bigram), values = baseline.get(bigram) ?? []
        const baselineMedian = values.length >= BASELINE_MIN_SAMPLES ? b?.median ?? null : null
        const enough = valid(baselineMedian) && baselineMedian > 0
        return { position: p + 1, bigram, observedMs: pause, baselineMedianMs: enough ? baselineMedian : null,
          baselineMADMs: enough ? b?.madMs ?? null : null,
          ratio: enough ? round(pause / baselineMedian) : null,
          excessMs: enough ? round(pause - baselineMedian) : null,
          robustDeviation: enough && b?.madMs ? round((pause - baselineMedian) / b.madMs) : null,
          relativePercentile: enough ? proportion(values.filter(v => v <= pause).length, values.length) : null,
          baselineSampleCount: values.length }
      })
      if (e.kind === 'retry') {
        const origin = precedingBySessionSource.get(`${e.sessionId}\u0000${e.sourceIndex}`)
        if (origin && (origin.retryNumber ?? 0) < e.retryNumber) { const timeline: Row[] = sessions.get(e.sessionId)?.exposures ?? []
          const originIndex = sessionPosition.get(origin) ?? -1, retryIndex = sessionPosition.get(e) ?? -1
          const between = originIndex >= 0 && retryIndex > originIndex ? timeline.slice(originIndex + 1, retryIndex) : []
          const interveningWords = between.filter(p => p.sourceIndex !== e.sourceIndex).map(p => ({ word: p.word,
            dictionary: p.dictionary, sourceIndex: p.sourceIndex, recordId: p.recordId, eventId: p.eventId }))
          const link = { mainRecordId: origin.recordId, retryRecordId: e.recordId, sessionId: e.sessionId, sourceIndex: e.sourceIndex,
            retryNumber: e.retryNumber, mainError: origin.errorCount > 0,
            interveningWords, interveningDistinctWords: new Set(interveningWords.map(p => `${p.dictionary}\u0000${p.sourceIndex}`)).size,
            elapsedMs: valid(origin.timeStamp) && valid(e.timeStamp) ? (e.timeStamp - origin.timeStamp) * 1000 : null,
            retryCleanCorrect: e.classification === 'clean-correct', retryFirstKeyDelayMs: e.timing.firstKeyDelayMs,
            retentionEvidence: e.classification === 'clean-correct' ? 'clean-unassisted' :
              e.classification === 'assisted-correct' ? 'assisted' : e.errorCount > 0 ? 'error-then-correct-or-incomplete' :
                e.classification === 'interrupted' ? 'interrupted' : 'other-observation',
            repeatedErrorPositions: e.errorPositions.filter((p: number) => origin.errorPositions.includes(p)) }
          retryLinks.push(link); e.retryRelation = link; origin.retryRelation = link }
      }
      if ((e.kind === 'main' || e.kind === 'retry') && e.sessionId !== null && e.sourceIndex !== null)
        precedingBySessionSource.set(`${e.sessionId}\u0000${e.sourceIndex}`, e)
    }
    for (const e of history) {
      if (e.kind === 'main' && e.errorCount > 0 && !e.retryRelation) {
        const session = chapterBySession.get(e.sessionId) ?? unfinishedBySession.get(e.sessionId)
        const key = `${e.dictionary}\u0000${str(e.word).toLowerCase()}`
        e.retryAbsence = session?.pending?.some((p: Row) => p.index === e.sourceIndex) ? 'pending' :
          session?.activeRetry?.index === e.sourceIndex ? 'active' :
            session?.deferred?.includes(key) ? 'deferred' :
              session?.interrupted?.some((p: Row) => p.sourceIndex === e.sourceIndex) ? 'interrupted' :
                session ? 'not-recorded-in-session' : 'session-state-unavailable'
      }
    }
    const positions = Array.from((g.positions as Map<number, Row[]>).entries()).map(([position, evidence]) => ({ position,
      normalizedPosition: evidence[0]?.normalizedPosition ?? null, count: evidence.length,
      sessions: new Set(evidence.map(x => x.sessionId).filter(Boolean)).size,
      days: new Set(evidence.map(x => valid(x.timeStamp) ? new Date(x.timeStamp * 1000).toISOString().slice(0, 10) : null).filter(Boolean)).size,
      evidence })).sort((a, b) => a.position - b.position)
    let streak = 0, longest = 0
    for (const e of history) { streak = e.classification === 'clean-correct' ? streak + 1 : 0; longest = Math.max(longest, streak) }
    const first = (part: Row[]) => part.flatMap(e => e.attempts.map((a: Row) => a.firstKeyDelayMs).filter(valid))
    const current = first(history.slice(-10)), prior = first(history.slice(-20, -10))
    const firstKeyHistory = history.flatMap(e => e.attempts.map((a: Row) => ({ timeStamp: e.timeStamp,
      eventId: e.eventId, recordId: e.recordId, sessionId: e.sessionId, attemptNumber: a.number,
      firstKeyDelayMs: a.firstKeyDelayMs, outcome: a.outcome, assistance: a.assistance.classification })))
    const byPosition = new Map<number, Row>()
    for (const e of history) for (const a of e.attempts) {
      if (!a.interKeyIntervalsMs) continue
      for (let p = 0; p < a.interKeyIntervalsMs.length; p++) {
        const position = p + 1, entry = byPosition.get(position) ?? { position,
          expectedCharacter: str(g.normalizedWord)[position] ?? null, intervals: [], baselineRatios: [], evidence: [] }
        entry.intervals.push(a.interKeyIntervalsMs[p])
        const comparison = a.pauseRelativeToBaseline?.[p]
        if (valid(comparison?.ratio)) entry.baselineRatios.push(comparison.ratio)
        entry.evidence.push({ recordId: e.recordId, eventId: e.eventId, attemptNumber: a.number,
          actualCharacter: a.input[position] ?? null, intervalMs: a.interKeyIntervalsMs[p], baselineRatio: comparison?.ratio ?? null })
        byPosition.set(position, entry)
      }
    }
    const positionTimingProfile = Array.from(byPosition.values()).sort((a, b) => a.position - b.position)
      .map(entry => ({ position: entry.position, expectedCharacter: entry.expectedCharacter,
        interKey: stats(entry.intervals), baselineRatio: stats(entry.baselineRatios), evidence: entry.evidence }))
    const byDay = new Map<string, Row[]>()
    for (const e of history) if (valid(e.timeStamp)) {
      const day = new Date(e.timeStamp * 1000).toISOString().slice(0, 10), list = byDay.get(day) ?? []
      list.push(e); byDay.set(day, list)
    }
    const dailyHistory = Array.from(byDay.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([day, list]) => ({ day,
      exposures: list.length, errorExposures: list.filter(e => e.errorCount > 0 || (e.quality === 'legacy' && e.wrongCount > 0)).length,
      cleanCorrect: list.filter(e => e.classification === 'clean-correct').length,
      firstKeyMedianMs: pct(first(list), .5), maxPauseMedianMs: pct(list.flatMap(e => e.attempts.map((a: Row) => a.maxPauseMs).filter(valid)), .5),
      evidence: list.map(e => ({ recordId: e.recordId, eventId: e.eventId })) }))
    const stageHistory = history.filter(e => e.spacedReviewContext).map(e => ({ timeStamp: e.timeStamp,
      recordId: e.recordId, eventId: e.eventId, stage: e.spacedReviewContext.stage ?? null,
      scheduledNextIntervalMinutes: e.spacedReviewContext.intervalMinutes ?? null,
      lapses: e.spacedReviewContext.lapses ?? null, successStreak: e.spacedReviewContext.successStreak ?? null,
      totalReviews: e.spacedReviewContext.totalReviews ?? null, lastRating: e.spacedReviewContext.lastRating ?? null,
      actualDelayMinutes: e.actualDelayMinutes, classification: e.classification,
      firstKeyDelayMs: e.timing.firstKeyDelayMs }))
    const lapseTransitions = stageHistory.flatMap((item, index) => {
      if (!index || !valid(item.lapses) || !valid(stageHistory[index - 1].lapses) || item.lapses <= stageHistory[index - 1].lapses) return []
      return [{ fromLapses: stageHistory[index - 1].lapses, toLapses: item.lapses,
        before: stageHistory[index - 1], atLapse: item, nextObserved: stageHistory[index + 1] ?? null }]
    })
    const byDelay = new Map<string, Row[]>()
    for (const e of history) { const list = byDelay.get(e.actualDelayBucket) ?? []; list.push(e); byDelay.set(e.actualDelayBucket, list) }
    const actualDelayPerformance = Array.from(byDelay.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([bucket, list]) => ({ bucket,
      exposures: list.length, errorRate: proportion(list.filter(e => e.errorCount > 0).length, list.length),
      firstKeyMedianMs: pct(first(list), .5), maxPauseMedianMs: pct(list.flatMap(e => e.attempts.map((a: Row) => a.maxPauseMs).filter(valid)), .5) }))
    const wordAttempts = history.flatMap(e => e.attempts)
    const wordIntervals = wordAttempts.flatMap(a => a.interKeyIntervalsMs ?? [])
    const wordSpeeds = wordAttempts.map(a => a.charactersPerSecond).filter(valid)
    const wordPauses = wordAttempts.map(a => a.maxPauseMs).filter(valid)
    const baselineRatios = wordAttempts.flatMap(a => (a.pauseRelativeToBaseline ?? []).map((p: Row) => p.ratio).filter(valid))
    const ratioStats = stats(baselineRatios)
    return { scope: g.scope, normalizedWord: g.normalizedWord, displayWords: g.displayWords.sort(), dictionaries: g.dictionaries.sort(),
      exposures: history.length, attempts: history.reduce((n, e) => n + e.attemptCount, 0),
      correctExposures: history.filter(e => e.attemptsToSuccess !== null).length,
      errorExposures: history.filter(e => e.errorCount > 0 || (e.quality === 'legacy' && e.wrongCount > 0)).length,
      cleanFirstAttemptCorrect: history.filter(e => e.classification === 'clean-correct').length,
      errorThenCorrect: history.filter(e => e.classification.includes('error-then-correct')).length,
      interrupted: history.filter(e => e.classification === 'interrupted').length,
      assistedCorrect: history.filter(e => e.classification === 'assisted-correct').length,
      wrongCount: history.reduce((n, e) => n + (e.wrongCount ?? 0), 0), currentCleanStreak: streak, longestCleanStreak: longest,
      firstKeyDelay: { ...stats(first(history)), recentMedianMs: pct(current, .5), previousWindowMedianMs: pct(prior, .5),
        medianChangeMs: current.length && prior.length ? (pct(current, .5) ?? 0) - (pct(prior, .5) ?? 0) : null },
      firstKeyHistory, positionTimingProfile, dailyHistory, recentVsHistorical: recent(history),
      typingFluency: { interKeyIntervalMs: stats(wordIntervals), typingSpeedCharactersPerSecond: stats(wordSpeeds),
        maxPauseMs: stats(wordPauses), baselineRelativePause: { count: ratioStats.count, medianRatio: ratioStats.median,
          p90Ratio: ratioStats.p90, p95Ratio: ratioStats.p95, maxRatio: ratioStats.max } },
      spacedReview: { currentState: stateByWord.get(`${g.scope}\u0000${g.normalizedWord}`) ?? null,
        stageHistory, lapseTransitions, actualDelayPerformance, stageHistoryCoverage: proportion(stageHistory.length, history.length) },
      errors: { confusionMatrix: errorList(g.confusion), positions, repeatedPositions: positions.filter(p => p.count > 1), transpositions: 'insufficient-evidence' },
      retryLinks, history }
  }).sort((a, b) => a.scope.localeCompare(b.scope) || a.normalizedWord.localeCompare(b.normalizedWord))
  const sessionOutput = Array.from(sessions.values()).map(s => { const entries: Row[] = s.exposures.sort((a: Row, b: Row) => (a.timeStamp ?? 0) - (b.timeStamp ?? 0))
    const phases = [0, 1, 2].map(i => { const part = entries.slice(Math.floor(entries.length * i / 3), Math.floor(entries.length * (i + 1) / 3))
      return { phase: ['early', 'middle', 'late'][i], exposures: part.length, errorRate: proportion(part.filter(e => e.errorCount > 0).length, part.length),
        firstKeyMedianMs: pct(part.flatMap(e => e.attempts.map((a: Row) => a.firstKeyDelayMs).filter(valid)), .5),
        typingSpeedMedian: pct(part.flatMap(e => e.attempts.map((a: Row) => a.charactersPerSecond).filter(valid)), .5) } })
    const chapter = chapterBySession.get(s.sessionId)
    const sourceDictionaries = Array.from(new Set(entries.map(e => e.dictionary))).sort().map(dictionary => {
      const part = entries.filter(e => e.dictionary === dictionary)
      return { dictionary, exposures: part.length, errorRate: proportion(part.filter(e => e.errorCount > 0).length, part.length),
        cleanCorrectRate: proportion(part.filter(e => e.classification === 'clean-correct').length, part.length) }
    })
    return { sessionId: s.sessionId, firstTimeStamp: entries[0]?.timeStamp ?? null, lastTimeStamp: entries.at(-1)?.timeStamp ?? null,
      observedDurationSeconds: valid(entries[0]?.timeStamp) && valid(entries.at(-1)?.timeStamp) ? (entries.at(-1)?.timeStamp ?? 0) - entries[0].timeStamp : null,
      exposures: entries.length, attempts: entries.reduce((n, e) => n + e.attemptCount, 0),
      cleanCorrectRate: proportion(entries.filter(e => e.classification === 'clean-correct').length, entries.length),
      errorRate: proportion(entries.filter(e => e.errorCount > 0).length, entries.length),
      assistedRate: proportion(entries.filter(e => e.classification === 'assisted-correct').length, entries.length),
      retryExposures: entries.filter(e => e.kind === 'retry').length, interruptedExposures: entries.filter(e => e.classification === 'interrupted').length,
      sourceDictionaries,
      phases, descriptivePattern: phases[0].errorRate !== null && phases[2].errorRate !== null ?
        phases[2].errorRate > phases[0].errorRate ? 'late-error-rate-higher' : phases[2].errorRate < phases[0].errorRate ? 'late-error-rate-lower' : 'no-phase-difference' : 'insufficient-evidence',
      pendingRetryKeys: chapter?.pending?.map((p: Row) => p.key) ?? null, deferredRetryKeys: chapter?.deferred ?? null,
      evidence: entries.map(e => ({ eventId: e.eventId, recordId: e.recordId })) }
  }).sort((a, b) => a.sessionId.localeCompare(b.sessionId))
  const allBaselineRatios = words.flatMap(w => w.history.flatMap((e: Row) => e.attempts.flatMap((a: Row) =>
    (a.pauseRelativeToBaseline ?? []).map((p: Row) => p.ratio).filter(valid)))).sort((a, b) => a - b)
  for (const word of words) { const median = word.firstKeyDelay.median
    word.firstKeyDelay.personalPercentile = valuePercentile(sortedTimingSamples.firstKeyDelayMs, median)
    word.typingFluency.interKeyIntervalMs.personalValuePercentile = valuePercentile(sortedTimingSamples.interKeyIntervalMs, word.typingFluency.interKeyIntervalMs.median)
    word.typingFluency.typingSpeedCharactersPerSecond.personalValuePercentile = valuePercentile(sortedTimingSamples.typingSpeedCharactersPerSecond, word.typingFluency.typingSpeedCharactersPerSecond.median)
    word.typingFluency.maxPauseMs.personalValuePercentile = valuePercentile(sortedTimingSamples.maxPauseMs, word.typingFluency.maxPauseMs.median)
    word.typingFluency.baselineRelativePause.personalValuePercentile = valuePercentile(allBaselineRatios, word.typingFluency.baselineRelativePause.medianRatio) }
  const allHistory: Row[] = words.flatMap(w => w.history).sort((a, b) => (a.timeStamp ?? 0) - (b.timeStamp ?? 0) || (a.recordId ?? 0) - (b.recordId ?? 0))
  const allRetryLinks: Row[] = words.flatMap(w => w.retryLinks)
  const globalConfusion = errorList(globalErrors)
  const recentPart = allHistory.slice(-100), historicalPart = allHistory.slice(0, -100)
  const globalWindow = (part: Row[]) => ({ exposures: part.length,
    errorRate: proportion(part.filter(e => e.errorCount > 0 || (e.quality === 'legacy' && e.wrongCount > 0)).length, part.length),
    cleanCorrectRate: proportion(part.filter(e => e.classification === 'clean-correct').length, part.length),
    firstKeyMedianMs: pct(part.flatMap(e => e.attempts.map((a: Row) => a.firstKeyDelayMs).filter(valid)), .5) })
  const normalizedBuckets = ['0-20%', '20-40%', '40-60%', '60-80%', '80-100%'].map((label, index) =>
    ({ label, minInclusive: index / 5, max: (index + 1) / 5, maxInclusive: index === 4,
      count: normalizedPositions.filter(n => index === 4 ? n >= .8 && n <= 1 : n >= index / 5 && n < (index + 1) / 5).length }))
  return { schemaVersion: 1, analysisEngineVersion: '1.1.0', generatedAt,
    sourceBoundary: { wordRecordCount: records.length, maxWordRecordId: records.reduce((max, r) => valid(r.id) ? Math.max(max, r.id) : max, 0),
      jsonlEventCount: eventIds.size, maxRecordedAt: all.map(r => str(r.recordedAt)).sort().at(-1) ?? null },
    sourceCoverage: { wordRecords: records.length, jsonlWordEvents: logs.length, jsonlOnlyExposures: logOnly.length,
      chapterRecords: input.chapters?.length ?? 0, jsonlChapterEvents: input.chapterLogs?.length ?? 0,
      chapterInterruptedTraces, unfinishedDrafts,
      reviewRecords: { availableCount: input.reviewRecords?.length ?? 0, consumedCount: 0,
        status: 'queue-context-not-consumed', reason: 'Review records store selected word queues and progress, not completed typing exposures.' },
      trainingRuns: input.trainingRuns?.length ?? 0,
      currentWordStates: input.states?.length ?? 0,
      analyzedExposures: all.length, spellingTraces: all.length - legacy },
    dataQuality: { legacyRecords: legacy, duplicateEventIds, duplicateRecordIds, conflictingRecords,
      malformedJsonlLines: input.logQuality?.malformedLines ?? 0, partialJsonlFiles: input.logQuality?.partialFiles ?? 0,
       invalidTimingAttempts: invalidTiming,
       timingOutliers: { method: 'absolute-deviation-from-personal-median-divided-by-MAD', threshold: OUTLIER_MAD_THRESHOLD,
         minSamples: OUTLIER_MIN_SAMPLES, references: timingReferences },
      caveats: ['Missing fields remain unavailable; legacy timing does not imply first-key latency.',
        'Recorded timestamps are exposure completion times; elapsed retry time is approximate.',
        'Current spaced-review state is a derived cache, not full stage history.',
        'Phase patterns describe observed behavior only.'] },
    global: { uniqueWords: words.length, exposures: all.length, attempts: totalAttempts, cleanFirstAttemptCorrect: clean,
      cleanCorrectRate: proportion(clean, all.length), assistedCorrect: assisted, assistedRate: proportion(assisted, all.length),
      errorExposures: errors, interruptedExposures: interrupted, firstKeyDelay: stats(firstKeys), interKeyInterval: stats(interKeys),
       maxPause: stats(maxPauses), typingDurationAfterFirstKey: stats(typingDurations),
       typingSpeedCharactersPerSecond: stats(speeds), baselineRelativePause: stats(allBaselineRatios), actualExposureIntervalMinutes: stats(delays),
      scheduledIntervalMinutes: stats(words.flatMap(w => w.spacedReview.stageHistory.map((e: Row) => e.scheduledNextIntervalMinutes).filter(valid))),
      recentVsHistorical: { basis: 'last-100-exposures', recentWindow: globalWindow(recentPart), historicalBeforeWindow: globalWindow(historicalPart) },
      errorPositionDistribution: Array.from(errorPositions.entries()).map(([position, count]) => ({ position, count })).sort((a, b) => a.position - b.position),
       normalizedErrorPositionBuckets: normalizedBuckets,
      adjacentKeyErrors: globalConfusion.filter(e => e.adjacentKey).reduce((n, e) => n + e.count, 0),
      retryLinks: allRetryLinks.length,
      retryDelayMs: stats(allRetryLinks.map(e => e.elapsedMs).filter(valid)),
      retryRetention: { cleanUnassisted: allRetryLinks.filter(e => e.retentionEvidence === 'clean-unassisted').length,
        assisted: allRetryLinks.filter(e => e.retentionEvidence === 'assisted').length,
        errorOrIncomplete: allRetryLinks.filter(e => e.retentionEvidence === 'error-then-correct-or-incomplete').length,
        interrupted: allRetryLinks.filter(e => e.retentionEvidence === 'interrupted').length },
      sourceDictionaries: Array.from(dictionary.values()).sort((a, b) => a.dictionary.localeCompare(b.dictionary)) },
    keyboardBaseline: { method: 'unassisted-clean-single-attempt',
       outlierExclusion: { rawIntervalCount: baselineRawIntervals, includedIntervalCount: baselineRawIntervals - baselineExcludedIntervals,
         excludedIntervalCount: baselineExcludedIntervals, rawSpeedCount: baselineRawSpeeds,
         includedSpeedCount: baselineRawSpeeds - baselineExcludedSpeeds, excludedSpeedCount: baselineExcludedSpeeds },
      typingSpeedCharactersPerSecond: stats(cleanTypingSpeeds),
      characters: Array.from(characterBaseline.entries()).map(([character, values]) => {
        const center = pct(values, .5)
        return { character, ...stats(values), madMs: center === null ? null : pct(values.map(n => Math.abs(n - center)), .5) }
      })
        .sort((a, b) => a.character.localeCompare(b.character)), bigrams: keyboardBaseline },
    confusionMatrix: globalConfusion, sessions: sessionOutput, unfinishedSessions: input.unfinishedSessions ?? [], words }
}
