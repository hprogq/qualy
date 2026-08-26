'use client'

import type * as React from 'react'
import * as stylex from '@stylexjs/stylex'
import { Breadcrumbs as MBreadcrumbs } from '@mantine/core'

import { tokens } from '../theme/tokens.stylex.ts'
import { seatOf } from '../lib/xstyle.ts'

// Where a screen sits in what contains it.
//
// The widget separates whatever it is given; the trail's own words, links
// and truncation stay with the screen that knows them. The crumb's own
// styling is bound to the widget's slot in here, which is the adapter's
// business - no consumer has needed to reach it.

const styles = stylex.create({
  trail: {
    minWidth: 0,
    fontSize: 12,
    color: tokens.mutedForeground,
  },
  crumb: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
})

interface BreadcrumbProps {
  children: React.ReactNode
  /** what stands between two crumbs */
  separator?: React.ReactNode
  /** the formal StyleX extension seat */
  xstyle?: stylex.StyleXStyles
  /** legacy interop hatch: utilities and third-party class strings */
  className?: string
  style?: React.CSSProperties
  'aria-label'?: string
}

function Breadcrumb({
  className,
  style,
  xstyle,
  separator = '/',
  children,
  ...rest
}: BreadcrumbProps) {
  return (
    <MBreadcrumbs
      data-slot="breadcrumb"
      separator={separator}
      separatorMargin="xs"
      classNames={{ breadcrumb: stylex.props(styles.crumb).className }}
      {...rest}
      {...seatOf(stylex.props(styles.trail, xstyle), className, style)}
    >
      {children}
    </MBreadcrumbs>
  )
}

export { Breadcrumb }
