// A third party's plugin as it is PUBLISHED: compiled javascript under
// dist/, a package.json that says where each module is, and no sources.
// Nothing here is relative to this repository, and nothing under src/ exists
// to fall back to - which is the whole point of the fixture.
import { Plugin } from '@qualy/plugin-kit'
import { Browser } from '@qualy/plugin-kit/browser'
import { Ui } from '@qualy/plugin-ui-registry/plugin'
import { APP_SHELL, PUBLIC } from '@qualy/ui-contract'

export default Plugin.define(
  '@acme/qualy-dist-probe',
  { dependsOn: ['@qualy/plugin-ui-registry'] },
  Ui.page({
    id: 'acme/probe',
    path: '/acme/probe',
    component: Ui.react('./client/ProbePage'),
    layout: APP_SHELL,
    visibility: PUBLIC,
  }),
  Ui.i18n('./client/i18n'),
  Browser.module('./client/boot'),
)
