/**
 * In-page hash navigation helpers.
 *
 * Next.js client navigation updates the URL fragment with the History API,
 * which does not emit a native `hashchange` event. Sidebar deep links
 * (e.g. /settings#branding) therefore notify listeners explicitly, while
 * native `hashchange` / `popstate` still cover direct loads, manual fragment
 * edits, reloads and browser back/forward.
 */

export const HASH_NAVIGATION_EVENT = 'agencyos:hash-navigation';

/** Extract the `#fragment` (including `#`) from a nav href. */
export function hashFromHref(href: string): string {
  const index = href.indexOf('#');
  return index === -1 ? '' : href.slice(index);
}

/** Announce an in-page fragment navigation to listening views. */
export function notifyHashNavigation(hash: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<string>(HASH_NAVIGATION_EVENT, { detail: hash }));
}

/**
 * Read the fragment for an event: the explicit target for sidebar-triggered
 * navigation (the URL may not have been updated yet), otherwise the live URL.
 */
export function hashFromEvent(event: Event): string {
  const detail = (event as CustomEvent<string | undefined>).detail;
  return typeof detail === 'string' ? detail : window.location.hash;
}
