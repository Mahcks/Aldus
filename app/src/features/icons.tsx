import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { ComponentProps } from 'react';
import { colors } from './theme';

type MaterialName = ComponentProps<typeof MaterialCommunityIcons>['name'];

const names = {
  home: 'home-variant-outline',
  libraries: 'bookshelf',
  collections: 'bookmark-multiple-outline',
  activity: 'bell-outline',
  search: 'magnify',
  contents: 'format-list-bulleted',
  discover: 'compass-outline',
  read: 'book-open-page-variant-outline',
  listen: 'headphones',
  synced: 'link-variant',
  account: 'account-circle-outline',
  devices: 'cellphone-link',
  enabled: 'check-circle-outline',
  disabled: 'cancel',
  play: 'play',
  pause: 'pause',
  sleepTimer: 'timer-sand',
  skipBack: 'rewind-15',
  skipForward: 'fast-forward-15',
  back: 'arrow-left',
  previousPage: 'chevron-left',
  nextPage: 'chevron-right',
  moveUp: 'arrow-up',
  moveDown: 'arrow-down',
  chevron: 'chevron-right',
  add: 'plus',
  decrease: 'minus',
  scroll: 'format-align-justify',
  users: 'account-group-outline',
  system: 'server-outline',
  backup: 'database-arrow-up-outline',
  report: 'file-document-outline',
  support: 'lifebuoy',
  privacy: 'shield-lock-outline',
  settings: 'cog-outline',
  folder: 'folder-outline',
  scan: 'refresh',
  import: 'tray-arrow-down',
  acquire: 'download-box-outline',
  bookmark: 'bookmark-outline',
  copy: 'content-copy',
  filter: 'filter-variant',
  send: 'send-outline',
  upload: 'tray-arrow-up',
  edit: 'pencil-outline',
  delete: 'trash-can-outline',
  more: 'dots-horizontal',
  check: 'check',
  warning: 'alert-outline',
  error: 'alert-circle-outline',
  close: 'close',
  shelfLayout: 'view-day-outline',
  gridLayout: 'view-grid-outline',
} satisfies Record<string, MaterialName>;

export type AppIconName = keyof typeof names;

export function AppIcon({
  name,
  size = 20,
  color = colors.ink,
}: {
  name: AppIconName;
  size?: number;
  color?: string;
}) {
  return (
    <MaterialCommunityIcons
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      name={names[name]}
      size={size}
      color={color}
    />
  );
}
