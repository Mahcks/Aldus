import { router, type Href } from 'expo-router';

export function goBackOr(fallback: Href) {
  if (router.canGoBack()) {
    router.back();
    return;
  }
  router.replace(fallback);
}
