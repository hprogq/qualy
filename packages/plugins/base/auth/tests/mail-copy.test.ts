import { describe, expect, it } from 'vitest'
import { mailFor } from '../src/server/mail-copy.ts'

// The mail a person gets, in both of its parts: the plain one every client
// shows, and the laid-out one most do - which carries the same link, names
// the workspace it came from, and escapes whatever came from outside.

describe('the mail a link goes out in', () => {
  it('lays out the same message, with the link as a button and spelled out', () => {
    const link = 'https://qualy.example/reset-password#token=abc&x=1'
    const mail = mailFor('reset', 'zh-CN', link, { to: 'li@school.edu', workspace: '示范大学' })
    expect(mail.subject).toBe('重置你的密码')
    expect(mail.text).toContain(link)
    expect(mail.html).toContain('<h1')
    expect(mail.html).toContain('重置你的密码')
    expect(mail.html).toContain('设置新密码')
    expect(mail.html).toContain('示范大学')
    expect(mail.html).toContain('li@school.edu')
    // the button and the spelled-out address are the one link, escaped
    expect(mail.html.split('https://qualy.example/reset-password#token=abc&amp;x=1')).toHaveLength(3)
  })

  it('escapes a workspace name and an address that are not text', () => {
    const mail = mailFor('verify', 'en', 'https://qualy.example/confirm#token=t', {
      to: '"><script>alert(1)</script>',
      workspace: '<img src=x onerror=alert(1)>',
    })
    expect(mail.html).not.toContain('<script>')
    expect(mail.html).not.toContain('<img')
    expect(mail.html).toContain('&lt;img src=x onerror=alert(1)&gt;')
  })
})
