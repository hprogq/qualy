// What a browser addresses, and what it says when one of them fails.
//
// A surface is a product fact: the page `assessment/review`, the shell
// `workspace-shell/v1`, the item a plugin files under `layout/header-actions`.
// The module that implements it is a build fact, and the two used to be one
// string - `assessment/ReviewPage`, derived from the package name and the
// source file - which put the implementation on the wire, in the browser
// registry and in the console, and made two plugins of the same basename
// collide for no product reason.
//
// So the browser holds addresses and the build holds modules. Everything a
// browser resolves, reports or prints is one of these four; where the module
// behind one is genuinely wanted, the build writes the map beside the output
// (it never ships).

/**
 * The ids are plain strings on purpose.
 *
 * A page id and a layout contract are namespaced and the api schema checks
 * that where they enter - but an address is usually built FROM a manifest a
 * browser just decoded, and narrowing there would be a cast at every call
 * site that proves nothing the server did not already prove. A login
 * driver's type (`local`) is not namespaced at all.
 */
export type BrowserSurface =
  | { readonly kind: 'page'; readonly id: string }
  | { readonly kind: 'layout'; readonly id: string }
  | { readonly kind: 'slot'; readonly slot: string; readonly id: string }
  | { readonly kind: 'login'; readonly id: string }

export type BrowserSurfaceKind = BrowserSurface['kind']

/**
 * One surface as one string, for a console line, a report field or a key.
 *
 * `page:assessment/review`, `slot:layout/header-actions:auth/account-menu`.
 * Stable enough to group by and readable enough to search for, and it says
 * nothing a reader of the manifest could not already see.
 */
export const surfaceLabel = (surface: BrowserSurface): string =>
  surface.kind === 'slot' ? `slot:${surface.slot}:${surface.id}` : `${surface.kind}:${surface.id}`
