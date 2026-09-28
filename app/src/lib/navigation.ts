import { router, type Href } from 'expo-router';

export function goBackOr(fallback: Href) {
  if (router.canGoBack()) {
    router.back();
    return;
  }
  router.replace(fallback);
}

/** A direct link still needs a useful escape route when no history exists. */
export function pageBackFallback(path: string): Href | undefined {
  const work = path.match(/^\/work\/([^/]+)\/manage$/);
  if (work) return `/work/${work[1]}`;
  if (path.startsWith('/work/')) return '/books';
  if (path.startsWith('/collection/')) return '/collections';
  if (path.startsWith('/library/')) return '/libraries';
  if (path.startsWith('/representation/')) return '/libraries';
  if (path === '/collections') return '/books';
  if (path === '/catalog') return '/books';
  if (path === '/account') return '/home';
  return undefined;
}

type LinkPressEvent = {
  preventDefault: () => void;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  button?: number;
};

/**
 * A `Link` press handler that runs `action` in place of the link's own
 * navigation on a plain click or Enter, while Cmd/Ctrl/Shift/middle clicks
 * still reach the browser and open a new tab or window.
 */
export function onPlainLinkPress(action: () => void) {
  return (event: LinkPressEvent) => {
    const newTab =
      event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || (event.button ?? 0) !== 0;
    if (newTab) return;
    event.preventDefault();
    action();
  };
}
