/**
 * Phones and tablets have hardware volume buttons, and iOS does not let a web
 * page change volume, so the in-app control exists only on web
 * (`VolumeControl.web.tsx`).
 */
export function VolumeControl(_props: { disabled?: boolean }) {
  return null;
}
