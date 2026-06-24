import { describe, expect, it } from 'vitest'
import {
  COMPLEXITY_THRESHOLDS,
  classifyTier,
  estimateComplexity,
  isLowComplexity
} from '../src/loop/router/complexity-estimator.js'
import { RoutingHistory, computeOverallQuality } from '../src/loop/router/routing-history.js'

describe('ComplexityEstimator', () => {
  it('scores simple queries as low complexity', () => {
    const result = estimateComplexity('hello')
    expect(result.tier).toBe('low')
    expect(result.score).toBeLessThanOrEqual(30)
  })

  it('scores simple Chinese questions as low complexity', () => {
    const result = estimateComplexity('\u73b0\u5728\u51e0\u70b9')
    expect(result.tier).toBe('low')
  })

  it('scores complex coding tasks as high complexity', () => {
    const input = '\u5b9e\u73b0\u4e00\u4e2a OAuth 2.0 \u4e2d\u95f4\u4ef6\uff0c\u9700\u8981\u652f\u6301 JWT token \u9a8c\u8bc1\u548c refresh token \u673a\u5236\uff0c\u8003\u8651\u5e76\u53d1\u5b89\u5168\u548c\u6570\u636e\u5e93\u8fde\u63a5\u6c60'
    const result = estimateComplexity(input)
    expect(result.tier).toBe('high')
  })

  it('scores real Chinese engineering tasks as high complexity', () => {
    const input = '\u5b9e\u73b0\u4e00\u4e2a OAuth \u4e2d\u95f4\u4ef6\uff0c\u9700\u8981\u652f\u6301 JWT \u9a8c\u8bc1\u3001refresh token\u3001\u5e76\u53d1\u5b89\u5168\u548c\u6570\u636e\u5e93\u8fde\u63a5\u6c60'
    const result = estimateComplexity(input)
    expect(result.tier).toBe('high')
  })

  it('scores multi-step reasoning tasks appropriately', () => {
    const input = '\u5206\u6790\u8fd9\u4e2a\u5206\u5e03\u5f0f\u7cfb\u7edf\u7684\u6027\u80fd\u74f6\u9888\uff0c\u6bd4\u8f83\u4e0d\u540c\u7684\u4f18\u5316\u65b9\u6848\uff0c\u8bc4\u4f30\u5404\u81ea\u7684 trade-off'
    const result = estimateComplexity(input)
    expect(result.score).toBeGreaterThan(30)
  })

  it('returns dimensions with signals', () => {
    const result = estimateComplexity('write a function to implement a binary search algorithm')
    expect(result.dimensions.length).toBe(5)
    expect(result.dimensions.some((d) => d.dimension === 'code_generation')).toBe(true)
    expect(result.dimensions.some((d) => d.dimension === 'multi_step_reasoning')).toBe(true)
  })

  it('completes in under 500ms', () => {
    const result = estimateComplexity('a'.repeat(10000))
    expect(result.durationMs).toBeLessThan(500)
  })

  it('classifies tiers correctly', () => {
    expect(classifyTier(0)).toBe('low')
    expect(classifyTier(30)).toBe('low')
    expect(classifyTier(31)).toBe('medium')
    expect(classifyTier(70)).toBe('medium')
    expect(classifyTier(71)).toBe('high')
    expect(classifyTier(100)).toBe('high')
  })

  it('isLowComplexity returns true for simple input', () => {
    expect(isLowComplexity('hi')).toBe(true)
    expect(isLowComplexity('\u5b9e\u73b0\u4e00\u4e2a\u5fae\u670d\u52a1\u67b6\u6784\u7684\u5206\u5e03\u5f0f\u4e8b\u52a1\u7cfb\u7edf\uff0c\u8981\u6c42\u652f\u6301 SAGA \u548c TCC \u4e24\u79cd\u6a21\u5f0f')).toBe(false)
  })

  it('has correct threshold constants', () => {
    expect(COMPLEXITY_THRESHOLDS.lowMax).toBe(30)
    expect(COMPLEXITY_THRESHOLDS.mediumMax).toBe(70)
  })
})

describe('RoutingHistory', () => {
  it('records routing decisions', () => {
    const history = new RoutingHistory()
    const assessment = estimateComplexity('test query')

    const decision = history.record({
      threadId: 't1',
      turnId: 'turn1',
      requestText: 'test query',
      complexity: assessment,
      tier: assessment.tier,
      selected: { model: 'deepseek-v4-flash' },
      reason: 'low complexity task',
      source: 'complexity-estimator'
    })

    expect(decision.id).toBe(1)
    expect(decision.tier).toBe('low')
    expect(decision.requestSummary).toBe('test query')
  })

  it('supports finish and quality recording', () => {
    const history = new RoutingHistory()
    const assessment = estimateComplexity('implement OAuth middleware')

    const decision = history.record({
      threadId: 't1',
      turnId: 'turn1',
      requestText: 'implement OAuth middleware',
      complexity: assessment,
      tier: assessment.tier,
      selected: { model: 'deepseek-v4-pro' },
      reason: 'complex coding task',
      source: 'complexity-estimator'
    })

    history.finish(decision)
    const quality = computeOverallQuality({ requirementCompletion: 8, outputQuality: 9, reasoningDepth: 7 })
    history.recordQuality(decision, quality)

    expect(decision.completedAt).toBeTruthy()
    expect(decision.quality?.overall).toBe(8)
  })

  it('returns snapshot in reverse order', () => {
    const history = new RoutingHistory()
    const a = estimateComplexity('a')

    history.record({
      threadId: 't1',
      turnId: 't1',
      requestText: 'a',
      complexity: a,
      tier: a.tier,
      selected: { model: 'm1' },
      reason: 'r',
      source: 'complexity-estimator'
    })
    history.record({
      threadId: 't1',
      turnId: 't2',
      requestText: 'b',
      complexity: a,
      tier: a.tier,
      selected: { model: 'm2' },
      reason: 'r',
      source: 'complexity-estimator'
    })

    const snapshot = history.snapshot()
    expect(snapshot.length).toBe(2)
    expect(snapshot[0]!.turnId).toBe('t2')
    expect(snapshot[1]!.turnId).toBe('t1')
  })

  it('finds decisions by turn', () => {
    const history = new RoutingHistory()
    const a = estimateComplexity('a')

    history.record({
      threadId: 't1',
      turnId: 'turn_a',
      requestText: 'a',
      complexity: a,
      tier: a.tier,
      selected: { model: 'm' },
      reason: 'r',
      source: 'complexity-estimator'
    })
    history.record({
      threadId: 't1',
      turnId: 'turn_b',
      requestText: 'b',
      complexity: a,
      tier: a.tier,
      selected: { model: 'm' },
      reason: 'r',
      source: 'complexity-estimator'
    })

    const found = history.findByTurn('t1', 'turn_b')
    expect(found?.requestSummary).toBe('b')
  })

  it('enforces capacity limit', () => {
    const history = new RoutingHistory()
    const a = estimateComplexity('a')

    for (let i = 0; i < 150; i += 1) {
      history.record({
        threadId: 't1',
        turnId: `t${i}`,
        requestText: `req${i}`,
        complexity: a,
        tier: a.tier,
        selected: { model: 'm' },
        reason: 'r',
        source: 'complexity-estimator'
      })
    }

    expect(history.snapshot().length).toBeLessThanOrEqual(100)
  })

  it('clears all history', () => {
    const history = new RoutingHistory()
    const a = estimateComplexity('a')
    history.record({
      threadId: 't1',
      turnId: 't1',
      requestText: 'a',
      complexity: a,
      tier: a.tier,
      selected: { model: 'm' },
      reason: 'r',
      source: 'complexity-estimator'
    })
    history.clear()
    expect(history.snapshot()).toEqual([])
  })
})

describe('computeOverallQuality', () => {
  it('computes average correctly', () => {
    const result = computeOverallQuality({ requirementCompletion: 8, outputQuality: 9, reasoningDepth: 7 })
    expect(result.overall).toBe(8)
    expect(result.requirementCompletion).toBe(8)
    expect(result.outputQuality).toBe(9)
    expect(result.reasoningDepth).toBe(7)
  })
})
