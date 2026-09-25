import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { Button, Dialog } from '@/components/ui';
import { Text, View } from '@/components/ui/tw';
import { api } from '@/lib/api';

/**
 * Shown only when someone presses Read along on a book that can't follow the
 * narration yet. The button stays where it always is, so an unsynced book
 * never carries a permanent warning; the reason and the way to fix it appear
 * on demand. Sync setup is offered only to people who can manage it.
 */
export function ReadAlongUnavailableSheet({
  visible,
  onClose,
  workID,
  libraryID,
  hasEbook,
}: {
  visible: boolean;
  onClose: () => void;
  workID: string;
  libraryID: string;
  hasEbook: boolean;
}) {
  const auth = useAuth();
  const admin = Boolean(auth.user?.admin);
  const [canManage, setCanManage] = useState(admin);

  useEffect(() => {
    if (!visible || admin) return;
    let current = true;
    api
      .library(libraryID)
      .then((library) => {
        if (current) setCanManage(library.role === 'owner' || library.role === 'editor');
      })
      .catch(() => {
        if (current) setCanManage(false);
      });
    return () => {
      current = false;
    };
  }, [visible, admin, libraryID]);

  function openManage(tab: 'sync' | 'files') {
    onClose();
    router.push(`/work/${workID}/manage?tab=${tab}`);
  }

  return (
    <Dialog
      sheet
      visible={visible}
      title="Read along needs a synced book"
      onClose={onClose}
      footer={
        <View className="flex-row flex-wrap gap-3">
          {canManage ? (
            <Button
              label={hasEbook ? 'Set up sync' : 'Add an ebook'}
              kind="primary"
              onPress={() => openManage(hasEbook ? 'sync' : 'files')}
            />
          ) : null}
          <Button label="Not now" kind="secondary" onPress={onClose} />
        </View>
      }
    >
      <View className="gap-3">
        <Text className="text-base leading-6 text-muted">
          {hasEbook
            ? 'This book has an ebook and an audiobook, but they haven’t been synced yet. Once they are, the text follows the narration here.'
            : 'Read along shows the book’s text while you listen, so it needs an ebook as well as this audiobook, synced together.'}
        </Text>
        {canManage ? null : (
          <Text className="text-sm leading-5 text-subtle">
            Ask an owner or editor of this library to set it up.
          </Text>
        )}
      </View>
    </Dialog>
  );
}
