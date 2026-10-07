import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PICTURES } from '../pictures.ts'
import { SECONDARY_ACTIVITIES } from '../seed/secondary-activities.ts'

const activities = SECONDARY_ACTIVITIES.flatMap((group) => group.activities)

describe('the second college evidence pairs', () => {
  it('gives every activity its own initial evidence and matching requested material', () => {
    expect(activities).toHaveLength(12)
    const assets = activities.flatMap((activity) => [activity.proof, activity.ask.asset])
    expect(new Set(assets).size).toBe(24)
    for (const activity of activities) {
      expect(activity.ask.instructions).toContain(activity.name)
      expect(activity.ask.asset).not.toBe(activity.proof)
      for (const asset of [activity.proof, activity.ask.asset]) {
        const html = PICTURES[asset]
        expect(html, asset).toBeDefined()
        expect(html, asset).toContain(activity.name)
        expect(html, asset).toContain('英语学院')
        expect(html, asset).not.toContain('返家乡')
        expect(html, asset).not.toContain('软件学院')
        expect(fs.existsSync(new URL(`../assets/${asset}.jpg`, import.meta.url)), asset).toBe(true)
        // Both secondary semesters share these assets; no single-semester date may contradict either.
        expect(html, asset).not.toMatch(/\d{4}-\d{2}-\d{2}|二〇[〇一二三四五六七八九]{2}年/)
      }
    }
  })

  it('answers an activity notice request with a readable notice containing its recognition basis', () => {
    for (const activity of activities.filter((one) => one.kind === 'culture')) {
      const html = PICTURES[activity.ask.asset]!
      expect(activity.ask.file).toBe('活动通知')
      expect(html).toContain(`<h2>${activity.name}活动通知</h2>`)
      expect(html).toContain('参与认定依据')
      expect(html).toContain(activity.work)
      expect(html).not.toContain('荣誉证书')
      expect(html).not.toContain('filter:blur')
    }
  })

  it('answers a competition request with an English-college award row matching the certificate', () => {
    for (const activity of activities.filter((one) => one.kind === 'competition')) {
      const html = PICTURES[activity.ask.asset]!
      expect(activity.ask.file).toBe('获奖名单')
      expect(activity.award).toBeTruthy()
      expect(html).toContain(`<h2>${activity.name}获奖名单</h2>`)
      expect(html).toContain(`<td>英语学院</td><td>DEMO-EN-001</td><td>${activity.award}</td>`)
      expect(PICTURES[activity.proof]).toContain(`获得${activity.award}`)
    }
  })

  it('answers a service request with a stamped opinion stating the same activity and duties', () => {
    for (const activity of activities.filter((one) => one.kind === 'service')) {
      const html = PICTURES[activity.ask.asset]!
      expect(activity.ask.file).toBe('实践鉴定意见')
      expect(html).toContain('实践鉴定意见')
      expect(html).toContain(`具体职责为${activity.work}`)
      expect(html).toContain('演示专用章')
      expect(PICTURES[activity.proof]).toContain('服务参与证明')
    }
  })
})
