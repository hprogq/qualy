import * as stylex from '@stylexjs/stylex'

// The loading loop, as keyframes.
//
// Eight parts, each changing only its opacity; the tail also leans. Two
// polarities of the same timing: dark, where the ring is solid and a head
// of shadow goes round it, for the wordmark and the mark at 24px and above;
// light, where the ring is faint and a head of ink goes round it, for the
// small inline indicator. One round is 1400ms - 280ms on the tail, 160ms on
// each sector - and 0% is the moment the tail starts to lean, 40ms before
// the head reaches it, so an animation-delay of 400ms is the first screen's
// 400ms threshold. Each keyframe carries the value a part has at that
// moment; the interval to the next is eased fast then slow, so a part
// changes right after the head reaches it and then holds, except the tail
// after the head has left it, which recovers on a slow curve. Under reduced
// motion nothing loops and the tail breathes once every 2400ms instead.
//
// The numbers are data, written out by hand because the compiler needs to
// read them from the call itself. The rule they follow is in
// tools/brand/loop.ts and docs/brand.md, and tools/tests/brand-loop.test.ts
// holds these literals to it.

const darkTail = stylex.keyframes({
  '0%': { opacity: 1, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '2.857%': { opacity: 1, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '22.857%': { opacity: 0.32, animationTimingFunction: 'cubic-bezier(.4,0,.6,1)' },
  '34.286%': { opacity: 0.62, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '45.714%': { opacity: 0.85, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '57.143%': { opacity: 1, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '68.571%': { opacity: 1, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '80%': { opacity: 1, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '91.429%': { opacity: 1, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '100%': { opacity: 1 },
})

const dark1 = stylex.keyframes({
  '0%': { opacity: 1, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '2.857%': { opacity: 1, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '22.857%': { opacity: 1, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '34.286%': { opacity: 0.4, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '45.714%': { opacity: 0.62, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '57.143%': { opacity: 0.85, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '68.571%': { opacity: 1, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '80%': { opacity: 1, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '91.429%': { opacity: 1, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '100%': { opacity: 1 },
})

const dark2 = stylex.keyframes({
  '0%': { opacity: 1, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '2.857%': { opacity: 1, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '22.857%': { opacity: 1, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '34.286%': { opacity: 1, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '45.714%': { opacity: 0.4, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '57.143%': { opacity: 0.62, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '68.571%': { opacity: 0.85, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '80%': { opacity: 1, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '91.429%': { opacity: 1, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '100%': { opacity: 1 },
})

const dark3 = stylex.keyframes({
  '0%': { opacity: 1, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '2.857%': { opacity: 1, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '22.857%': { opacity: 1, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '34.286%': { opacity: 1, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '45.714%': { opacity: 1, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '57.143%': { opacity: 0.4, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '68.571%': { opacity: 0.62, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '80%': { opacity: 0.85, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '91.429%': { opacity: 1, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '100%': { opacity: 1 },
})

const dark4 = stylex.keyframes({
  '0%': { opacity: 1, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '2.857%': { opacity: 1, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '22.857%': { opacity: 1, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '34.286%': { opacity: 1, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '45.714%': { opacity: 1, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '57.143%': { opacity: 1, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '68.571%': { opacity: 0.4, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '80%': { opacity: 0.62, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '91.429%': { opacity: 0.85, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '100%': { opacity: 1 },
})

const dark5 = stylex.keyframes({
  '0%': { opacity: 0.85, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '2.857%': { opacity: 0.85, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '22.857%': { opacity: 1, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '34.286%': { opacity: 1, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '45.714%': { opacity: 1, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '57.143%': { opacity: 1, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '68.571%': { opacity: 1, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '80%': { opacity: 0.4, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '91.429%': { opacity: 0.62, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '100%': { opacity: 0.85 },
})

const dark6 = stylex.keyframes({
  '0%': { opacity: 0.62, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '2.857%': { opacity: 0.62, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '22.857%': { opacity: 0.85, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '34.286%': { opacity: 1, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '45.714%': { opacity: 1, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '57.143%': { opacity: 1, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '68.571%': { opacity: 1, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '80%': { opacity: 1, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '91.429%': { opacity: 0.4, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '100%': { opacity: 0.62 },
})

const dark7 = stylex.keyframes({
  '0%': { opacity: 0.4, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '2.857%': { opacity: 0.4, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '22.857%': { opacity: 0.62, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '34.286%': { opacity: 0.85, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '45.714%': { opacity: 1, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '57.143%': { opacity: 1, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '68.571%': { opacity: 1, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '80%': { opacity: 1, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '91.429%': { opacity: 1, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '100%': { opacity: 0.4 },
})

const lightTail = stylex.keyframes({
  '0%': { opacity: 0.12, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '2.857%': { opacity: 0.12, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '22.857%': { opacity: 1, animationTimingFunction: 'cubic-bezier(.4,0,.6,1)' },
  '34.286%': { opacity: 0.6, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '45.714%': { opacity: 0.36, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '57.143%': { opacity: 0.24, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '68.571%': { opacity: 0.17, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '80%': { opacity: 0.14, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '91.429%': { opacity: 0.13, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '100%': { opacity: 0.12 },
})

const light1 = stylex.keyframes({
  '0%': { opacity: 0.13, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '2.857%': { opacity: 0.13, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '22.857%': { opacity: 0.12, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '34.286%': { opacity: 1, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '45.714%': { opacity: 0.6, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '57.143%': { opacity: 0.36, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '68.571%': { opacity: 0.24, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '80%': { opacity: 0.17, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '91.429%': { opacity: 0.14, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '100%': { opacity: 0.13 },
})

const light2 = stylex.keyframes({
  '0%': { opacity: 0.14, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '2.857%': { opacity: 0.14, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '22.857%': { opacity: 0.13, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '34.286%': { opacity: 0.12, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '45.714%': { opacity: 1, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '57.143%': { opacity: 0.6, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '68.571%': { opacity: 0.36, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '80%': { opacity: 0.24, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '91.429%': { opacity: 0.17, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '100%': { opacity: 0.14 },
})

const light3 = stylex.keyframes({
  '0%': { opacity: 0.17, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '2.857%': { opacity: 0.17, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '22.857%': { opacity: 0.14, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '34.286%': { opacity: 0.13, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '45.714%': { opacity: 0.12, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '57.143%': { opacity: 1, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '68.571%': { opacity: 0.6, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '80%': { opacity: 0.36, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '91.429%': { opacity: 0.24, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '100%': { opacity: 0.17 },
})

const light4 = stylex.keyframes({
  '0%': { opacity: 0.24, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '2.857%': { opacity: 0.24, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '22.857%': { opacity: 0.17, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '34.286%': { opacity: 0.14, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '45.714%': { opacity: 0.13, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '57.143%': { opacity: 0.12, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '68.571%': { opacity: 1, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '80%': { opacity: 0.6, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '91.429%': { opacity: 0.36, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '100%': { opacity: 0.24 },
})

const light5 = stylex.keyframes({
  '0%': { opacity: 0.36, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '2.857%': { opacity: 0.36, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '22.857%': { opacity: 0.24, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '34.286%': { opacity: 0.17, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '45.714%': { opacity: 0.14, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '57.143%': { opacity: 0.13, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '68.571%': { opacity: 0.12, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '80%': { opacity: 1, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '91.429%': { opacity: 0.6, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '100%': { opacity: 0.36 },
})

const light6 = stylex.keyframes({
  '0%': { opacity: 0.6, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '2.857%': { opacity: 0.6, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '22.857%': { opacity: 0.36, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '34.286%': { opacity: 0.24, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '45.714%': { opacity: 0.17, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '57.143%': { opacity: 0.14, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '68.571%': { opacity: 0.13, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '80%': { opacity: 0.12, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '91.429%': { opacity: 1, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '100%': { opacity: 0.6 },
})

const light7 = stylex.keyframes({
  '0%': { opacity: 1, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '2.857%': { opacity: 1, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '22.857%': { opacity: 0.6, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '34.286%': { opacity: 0.36, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '45.714%': { opacity: 0.24, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '57.143%': { opacity: 0.17, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '68.571%': { opacity: 0.14, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '80%': { opacity: 0.13, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '91.429%': { opacity: 0.12, animationTimingFunction: 'cubic-bezier(.1,.9,.2,1)' },
  '100%': { opacity: 1 },
})

const lean = stylex.keyframes({
  '0%': { transform: 'translate(0px, 0px)', animationTimingFunction: 'cubic-bezier(.33,1,.68,1)' },
  '10%': {
    transform: 'translate(-3.394px, -3.394px)',
    animationTimingFunction: 'cubic-bezier(.65,0,.35,1)',
  },
  '25.714%': { transform: 'translate(0px, 0px)' },
  '100%': { transform: 'translate(0px, 0px)' },
})

const breathe = stylex.keyframes({
  '0%': { opacity: 1 },
  '50%': { opacity: 0.55 },
  '100%': { opacity: 1 },
})

export type Polarity = 'dark' | 'light'

const loop = stylex.create({
  darkTail: {
    animationName: {
      default: `${darkTail}, ${lean}`,
      '@media (prefers-reduced-motion: reduce)': breathe,
    },
    animationDuration: {
      default: '1400ms, 1400ms',
      '@media (prefers-reduced-motion: reduce)': '2400ms',
    },
    animationTimingFunction: {
      default: 'linear, linear',
      '@media (prefers-reduced-motion: reduce)': 'ease-in-out',
    },
    animationIterationCount: 'infinite',
  },
  dark1: {
    animationName: { default: dark1, '@media (prefers-reduced-motion: reduce)': 'none' },
    animationDuration: '1400ms',
    animationTimingFunction: 'linear',
    animationIterationCount: 'infinite',
  },
  dark2: {
    animationName: { default: dark2, '@media (prefers-reduced-motion: reduce)': 'none' },
    animationDuration: '1400ms',
    animationTimingFunction: 'linear',
    animationIterationCount: 'infinite',
  },
  dark3: {
    animationName: { default: dark3, '@media (prefers-reduced-motion: reduce)': 'none' },
    animationDuration: '1400ms',
    animationTimingFunction: 'linear',
    animationIterationCount: 'infinite',
  },
  dark4: {
    animationName: { default: dark4, '@media (prefers-reduced-motion: reduce)': 'none' },
    animationDuration: '1400ms',
    animationTimingFunction: 'linear',
    animationIterationCount: 'infinite',
  },
  dark5: {
    animationName: { default: dark5, '@media (prefers-reduced-motion: reduce)': 'none' },
    animationDuration: '1400ms',
    animationTimingFunction: 'linear',
    animationIterationCount: 'infinite',
  },
  dark6: {
    animationName: { default: dark6, '@media (prefers-reduced-motion: reduce)': 'none' },
    animationDuration: '1400ms',
    animationTimingFunction: 'linear',
    animationIterationCount: 'infinite',
  },
  dark7: {
    animationName: { default: dark7, '@media (prefers-reduced-motion: reduce)': 'none' },
    animationDuration: '1400ms',
    animationTimingFunction: 'linear',
    animationIterationCount: 'infinite',
  },
  lightTail: {
    animationName: {
      default: `${lightTail}, ${lean}`,
      '@media (prefers-reduced-motion: reduce)': breathe,
    },
    animationDuration: {
      default: '1400ms, 1400ms',
      '@media (prefers-reduced-motion: reduce)': '2400ms',
    },
    animationTimingFunction: {
      default: 'linear, linear',
      '@media (prefers-reduced-motion: reduce)': 'ease-in-out',
    },
    animationIterationCount: 'infinite',
  },
  light1: {
    animationName: { default: light1, '@media (prefers-reduced-motion: reduce)': 'none' },
    animationDuration: '1400ms',
    animationTimingFunction: 'linear',
    animationIterationCount: 'infinite',
  },
  light2: {
    animationName: { default: light2, '@media (prefers-reduced-motion: reduce)': 'none' },
    animationDuration: '1400ms',
    animationTimingFunction: 'linear',
    animationIterationCount: 'infinite',
  },
  light3: {
    animationName: { default: light3, '@media (prefers-reduced-motion: reduce)': 'none' },
    animationDuration: '1400ms',
    animationTimingFunction: 'linear',
    animationIterationCount: 'infinite',
  },
  light4: {
    animationName: { default: light4, '@media (prefers-reduced-motion: reduce)': 'none' },
    animationDuration: '1400ms',
    animationTimingFunction: 'linear',
    animationIterationCount: 'infinite',
  },
  light5: {
    animationName: { default: light5, '@media (prefers-reduced-motion: reduce)': 'none' },
    animationDuration: '1400ms',
    animationTimingFunction: 'linear',
    animationIterationCount: 'infinite',
  },
  light6: {
    animationName: { default: light6, '@media (prefers-reduced-motion: reduce)': 'none' },
    animationDuration: '1400ms',
    animationTimingFunction: 'linear',
    animationIterationCount: 'infinite',
  },
  light7: {
    animationName: { default: light7, '@media (prefers-reduced-motion: reduce)': 'none' },
    animationDuration: '1400ms',
    animationTimingFunction: 'linear',
    animationIterationCount: 'infinite',
  },
  /** how long the loop waits before it begins; the first screen's threshold is 400ms */
  delayed: (ms: number) => ({
    animationDelay: `${ms}ms`,
  }),
})

/** the style each part wears, by polarity and by part, the tail first */
export const loopStyles: Record<Polarity, readonly stylex.StyleXStyles[]> = {
  dark: [
    loop.darkTail,
    loop.dark1,
    loop.dark2,
    loop.dark3,
    loop.dark4,
    loop.dark5,
    loop.dark6,
    loop.dark7,
  ],
  light: [
    loop.lightTail,
    loop.light1,
    loop.light2,
    loop.light3,
    loop.light4,
    loop.light5,
    loop.light6,
    loop.light7,
  ],
}

export const delayed = loop.delayed
