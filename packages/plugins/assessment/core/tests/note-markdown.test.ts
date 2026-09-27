import { describe, expect, it } from 'vitest'
import { parseInline, parseNote } from '../src/client/batch/note-markdown.ts'

// A batch note is written by the batch's managers and read by everybody in
// the round, so what its markup may become is fixed here: paragraphs, lists,
// bold and links to the web or a mailbox, and every other thing as the text
// it was typed as.

describe('the batch note markup', () => {
  it('reads paragraphs with their line breaks, and both kinds of list', () => {
    expect(
      parseNote('第一段\n第一段第二行\n\n- 身份证\n- 成绩单\n  (盖章)\n\n3. 填报\n4. 提交'),
    ).toEqual([
      {
        kind: 'paragraph',
        lines: [[{ kind: 'text', text: '第一段' }], [{ kind: 'text', text: '第一段第二行' }]],
      },
      {
        kind: 'list',
        ordered: false,
        start: 1,
        items: [
          [[{ kind: 'text', text: '身份证' }]],
          [[{ kind: 'text', text: '成绩单' }], [{ kind: 'text', text: '(盖章)' }]],
        ],
      },
      {
        kind: 'list',
        ordered: true,
        start: 3,
        items: [[[{ kind: 'text', text: '填报' }]], [[{ kind: 'text', text: '提交' }]]],
      },
    ])
  })

  it('makes bold and links, and links only to the web or a mailbox', () => {
    expect(parseInline('请于**十月前**阅读[学校通知](https://example.edu/notice.pdf)')).toEqual([
      { kind: 'text', text: '请于' },
      { kind: 'strong', children: [{ kind: 'text', text: '十月前' }] },
      { kind: 'text', text: '阅读' },
      {
        kind: 'link',
        href: 'https://example.edu/notice.pdf',
        children: [{ kind: 'text', text: '学校通知' }],
      },
    ])
    expect(parseInline('[写信](mailto:office@example.edu)')[0]).toMatchObject({
      kind: 'link',
      href: 'mailto:office@example.edu',
    })
    for (const unsafe of [
      '[点我](javascript:alert(1))',
      '[点我](data:text/html,x)',
      '[点我](//evil.example)',
      '[点我](/assessment/batches)',
    ]) {
      expect(parseInline(unsafe), unsafe).toEqual([{ kind: 'text', text: unsafe }])
    }
  })

  it('turns an address typed on its own into a link, without the punctuation after it', () => {
    expect(parseInline('详见 https://example.edu/a?b=1，截止十月。')).toEqual([
      { kind: 'text', text: '详见 ' },
      {
        kind: 'link',
        href: 'https://example.edu/a?b=1',
        children: [{ kind: 'text', text: 'https://example.edu/a?b=1' }],
      },
      { kind: 'text', text: '，截止十月。' },
    ])
    expect(parseInline('see https://example.edu/x.')[1]).toMatchObject({
      href: 'https://example.edu/x',
    })
  })

  it('leaves an image, a heading, raw markup and an unclosed mark as they were typed', () => {
    for (const typed of [
      '![海报](https://example.edu/p.png)',
      '# 标题',
      '<b>不是标记</b><script>alert(1)</script>',
      '**没有收尾',
      '\\*\\*不加粗\\*\\*',
    ]) {
      const [first] = parseInline(typed)
      expect(first?.kind, typed).toBe('text')
    }
    expect(parseInline('\\*\\*不加粗\\*\\*')).toEqual([{ kind: 'text', text: '**不加粗**' }])
  })
})
