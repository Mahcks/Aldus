import type { Media, Representation } from '../../../generated/api';
import * as DocumentPicker from 'expo-document-picker';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert } from 'react-native';
import { useAuth } from '../../../features/auth/AuthProvider';
import { TechnicalDetails } from '../../../features/sources/TechnicalDetails';
import { Text, View } from '../../../features/tw';
import {
  Button,
  Empty,
  Field,
  Loading,
  Notice,
  Page,
  Row,
  Section,
  shared,
} from '../../../features/ui';
import { api, errorMessage } from '../../../lib/api';
import { goBackOr } from '../../../lib/navigation';

export default function RepresentationScreen() {
  const {
    id,
    libraryId,
    role = '',
  } = useLocalSearchParams<{ id: string; libraryId: string; role?: string }>();
  const auth = useAuth();
  const [representation, setRepresentation] = useState<Representation>();
  const [media, setMedia] = useState<Media[]>([]);
  const [kind, setKind] = useState('');
  const [label, setLabel] = useState('');
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    if (!id || !libraryId) return;
    try {
      const [next, revisions] = await Promise.all([
        api.representation(id),
        api.media(libraryId, id),
      ]);
      setRepresentation(next);
      setKind(next.kind);
      setLabel(next.label);
      setMedia(revisions);
    } catch (value) {
      setError(errorMessage(value));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, libraryId]);

  if (loading) return <Loading />;
  if (!representation)
    return (
      <Page title="Representation">
        <Notice danger>{error || 'Representation unavailable.'}</Notice>
      </Page>
    );

  const canEdit = Boolean(auth.user?.admin || role === 'owner' || role === 'editor');

  async function upload() {
    const result = await DocumentPicker.getDocumentAsync({
      type: representation?.kind === 'epub' ? 'application/epub+zip' : 'audio/*',
      multiple: false,
    });
    if (result.canceled) return;
    setUploading(true);
    setError('');
    try {
      const asset = result.assets[0];
      const blob = await fetch(asset.uri).then((response) => response.blob());
      await api.uploadMedia(libraryId, id, blob, asset.name);
      await load();
    } catch (value) {
      setError(errorMessage(value));
    } finally {
      setUploading(false);
    }
  }

  async function saveRepresentation() {
    try {
      await api.updateRepresentation(id, { kind, label });
      await load();
    } catch (value) {
      setError(errorMessage(value));
    }
  }

  function confirmDeleteRepresentation() {
    Alert.alert(
      'Delete representation?',
      'Representations with uploaded media cannot be deleted.',
      [
        { text: 'Cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.deleteRepresentation(id);
              goBackOr('/libraries');
            } catch (value) {
              setError(errorMessage(value));
            }
          },
        },
      ],
    );
  }

  return (
    <Page
      title={representation.label}
      back={<Button label="Work" icon="back" kind="quiet" onPress={() => goBackOr('/libraries')} />}
    >
      {error ? <Notice danger>{error}</Notice> : null}
      <Section
        title="Media revisions"
        action={
          canEdit ? (
            <Button
              label={uploading ? 'Uploading…' : 'Upload revision'}
              kind="primary"
              disabled={uploading}
              onPress={upload}
            />
          ) : null
        }
      >
        {uploading ? (
          <Notice>Uploading and validating the selected file. Keep this screen open.</Notice>
        ) : null}
        {media.length === 0 ? (
          <Empty>No media uploaded.</Empty>
        ) : (
          media.map((item, index) => (
            <View key={item.id} className={shared.listItem}>
              <Text className={shared.itemTitle}>
                {item.original_filename || 'Unnamed upload'}
                {index === 0 ? ' · newest' : ''}
              </Text>
              <Text className={shared.itemMeta}>
                {formatBytes(item.size_bytes)} · {new Date(item.created_at).toLocaleString()}
              </Text>
              <TechnicalDetails
                rows={[
                  { label: 'SHA-256', value: item.sha256, copyable: true },
                  { label: 'Media ID', value: item.id, copyable: true },
                ]}
              />
            </View>
          ))
        )}
      </Section>
      {canEdit ? (
        <Section title="Representation settings">
          <View className={shared.form}>
            <Field label="Kind" value={kind} onChangeText={setKind} autoCapitalize="none" />
            <Field label="Label" value={label} onChangeText={setLabel} />
            <Row>
              <Button label="Save" onPress={() => void saveRepresentation()} />
              <Button
                label="Delete representation"
                kind="danger"
                onPress={confirmDeleteRepresentation}
              />
            </Row>
          </View>
        </Section>
      ) : null}
    </Page>
  );
}

function formatBytes(bytes: number) {
  return bytes < 1024 * 1024
    ? `${Math.round(bytes / 1024)} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
