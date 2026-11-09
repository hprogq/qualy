import { describe, expect, it } from 'vitest'
import {
  distanceOf,
  reviewWindowOf,
  turnOf,
  type WindowStage,
} from '../src/client/review/review-window.ts'

const T = (day: number) => `2026-11-${String(day).padStart(2, '0')}T10:00:00.000Z`
const ms = (day: number) => Date.parse(T(day))

const stage = (
  displayName: string,
  status: WindowStage['status'],
  reviewing: boolean,
  day: number | null,
): WindowStage => ({
  displayName,
  status,
  reviewing,
  entry:
    day === null
      ? { kind: 'pending', at: null }
      : { kind: status === 'future' ? 'planned' : 'entered', at: T(day) },
})

describe('the review window on a timeline', () => {
  it('closes where the next stage does not open reviewing', () => {
    expect(
      reviewWindowOf([
        stage('申报期', 'ended', false, 1),
        stage('初审期', 'current', true, 5),
        stage('公示期', 'future', false, 20),
      ]),
    ).toEqual({ kind: 'closes', stage: '初审期', since: ms(5), at: ms(20), reopens: null })
  })

  it('runs through consecutive reviewing stages to the first that does not', () => {
    expect(
      reviewWindowOf([
        stage('初审期', 'ended', true, 3),
        stage('复审期', 'current', true, 10),
        stage('终审期', 'future', true, 15),
        stage('公示期', 'future', false, 25),
      ]),
    ).toEqual({ kind: 'closes', stage: '复审期', since: ms(3), at: ms(25), reopens: null })
  })

  it('says when a window that closes opens again', () => {
    const window = reviewWindowOf([
      stage('初审期', 'current', true, 3),
      stage('公示期', 'future', false, 10),
      stage('申诉复查期', 'future', true, 15),
    ])
    expect(window).toMatchObject({ kind: 'closes', at: ms(10), reopens: ms(15) })
  })

  it('stays open when no stage ahead closes it', () => {
    expect(
      reviewWindowOf([stage('申报期', 'ended', false, 1), stage('审核期', 'current', true, 3)]),
    ).toEqual({ kind: 'stays-open', stage: '审核期' })
  })

  it('names the last reviewing stage when its end time is unknown', () => {
    expect(
      reviewWindowOf([
        stage('初审期', 'current', true, 3),
        stage('复审期', 'future', true, 6),
        stage('公示期', 'future', false, null),
      ]),
    ).toEqual({ kind: 'closes-with', stage: '初审期', endStage: '复审期' })
  })

  it('opens at the first stage ahead that opens reviewing', () => {
    expect(
      reviewWindowOf([
        stage('申报期', 'current', false, 1),
        stage('补报期', 'future', false, 8),
        stage('审核期', 'future', true, 12),
      ]),
    ).toEqual({ kind: 'opens', at: ms(12) })
    expect(
      reviewWindowOf([stage('申报期', 'current', false, 1), stage('审核期', 'future', true, null)]),
    ).toEqual({ kind: 'opens-with', opener: '审核期' })
  })

  it('opens at the first reviewing stage of a round not yet started', () => {
    expect(
      reviewWindowOf([stage('申报期', 'future', false, 4), stage('审核期', 'future', true, 9)]),
    ).toEqual({ kind: 'opens', at: ms(9) })
  })

  it('tells a window that has ended from one that never was', () => {
    expect(
      reviewWindowOf([stage('审核期', 'ended', true, 1), stage('公示期', 'current', false, 9)]),
    ).toEqual({ kind: 'ended' })
    expect(
      reviewWindowOf([stage('申报期', 'ended', false, 1), stage('公示期', 'current', false, 9)]),
    ).toEqual({ kind: 'none' })
  })

  it('turns only at an instant the timeline knows', () => {
    expect(turnOf({ kind: 'opens', at: ms(9) })).toBe(ms(9))
    expect(turnOf({ kind: 'stays-open', stage: '审核期' })).toBeNull()
  })
})

describe('how far off a turn is', () => {
  const now = ms(10)
  it('counts whole days, then whole hours, then under an hour', () => {
    expect(distanceOf(now + 3.5 * 86_400_000, now)).toEqual({ unit: 'day', count: 3 })
    expect(distanceOf(now + 5.2 * 3_600_000, now)).toEqual({ unit: 'hour', count: 5 })
    expect(distanceOf(now + 20 * 60_000, now)).toEqual({ unit: 'soon' })
  })

  it('says nothing once the turn has passed', () => {
    expect(distanceOf(now, now)).toBeNull()
    expect(distanceOf(now - 1, now)).toBeNull()
  })
})
