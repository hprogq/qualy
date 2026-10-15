import { createLucideIcon } from 'lucide-react'
import { siGithub, siGitlab, type SimpleIcon } from 'simple-icons'

// The GitHub and GitLab marks as their owners draw them, for the sign-in
// doors that lead there. Lucide 1.0 dropped every brand icon; its own
// redrawings were altered logos anyway, which the brands' guidelines do not
// allow. Drawn through createLucideIcon so they size and label like the
// outlined icons beside them, but filled: GitHub's mark takes the text colour
// and so reads on either ground, GitLab's keeps its brand colour, which does
// too. The marks remain their owners' trademarks.

const mark = (icon: SimpleIcon, fill: string) =>
  createLucideIcon(icon.slug, [['path', { d: icon.path, fill, stroke: 'none', key: icon.slug }]])

export const GithubIcon = mark(siGithub, 'currentColor')
export const GitlabIcon = mark(siGitlab, `#${siGitlab.hex}`)
