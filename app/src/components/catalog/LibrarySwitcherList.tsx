import type { Library } from '@/generated/api';
import { IconButton, MenuSeparator, Notice } from '@/components/ui';
import { Pressable, Text, View } from '@/components/ui/tw';

/**
 * Content of the library switcher popover: every library with its role and
 * size, a star to choose the primary one, and a way to the full list.
 */
export function LibrarySwitcherList({
  libraries,
  currentID,
  error,
  settingPrimary,
  onSwitch,
  onSetPrimary,
  onManageAll,
}: {
  libraries: Library[];
  currentID: string;
  error: string;
  settingPrimary: boolean;
  onSwitch: (libraryID: string) => void;
  onSetPrimary: (libraryID: string) => void;
  onManageAll: () => void;
}) {
  return (
    <View className="gap-0.5">
      {error ? <Notice danger>{error}</Notice> : null}
      {libraries.map((item) => {
        const role = item.role || 'Administrator access';
        const books = `${item.work_count} ${item.work_count === 1 ? 'book' : 'books'}`;
        const current = item.id === currentID;

        return (
          <View
            key={item.id}
            className={`flex-row items-center gap-1 rounded-control pr-0.5 ${current ? 'bg-accent-soft' : ''}`}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${item.name}, ${role}`}
              accessibilityState={{ selected: current }}
              onPress={() => onSwitch(item.id)}
              className={`min-h-11 min-w-0 flex-1 justify-center rounded-control px-3 py-1.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus ${current ? '' : 'hover:bg-control'}`}
            >
              <Text
                numberOfLines={1}
                className={`text-base font-sans-semibold ${current ? 'text-accent-strong' : 'text-ink'}`}
              >
                {item.name}
              </Text>
              <Text numberOfLines={1} className="text-xs text-muted">
                {role} · {books}
              </Text>
            </Pressable>
            <IconButton
              icon={item.primary ? 'starFilled' : 'starOutline'}
              label={
                item.primary
                  ? `${item.name} is your primary library`
                  : `Make ${item.name} your primary library`
              }
              kind="quiet"
              disabled={settingPrimary}
              onPress={() => onSetPrimary(item.id)}
            />
          </View>
        );
      })}
      <MenuSeparator />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Manage all libraries"
        onPress={onManageAll}
        className="min-h-11 justify-center rounded-control px-3 hover:bg-control focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
      >
        <Text className="text-sm font-sans-semibold text-accent">Manage all libraries</Text>
      </Pressable>
    </View>
  );
}
