import type { Library, Media, Representation } from '../../../generated/api';
import * as DocumentPicker from 'expo-document-picker';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { useAuth } from '../../../features/auth/AuthProvider';
import { representationKinds } from '../../../features/source-administration';
import { TechnicalDetails } from '../../../features/sources/TechnicalDetails';
import { Text, View } from '../../../features/tw';
import {
  Button,
  ConfirmDialog,
  EmptyState,
  Field,
  Loading,
  Notice,
  Page,
  Row,
  Section,
  Select,
  shared,
} from '../../../features/ui';
import { api, errorMessage } from '../../../lib/api';
import { goBackOr } from '../../../lib/navigation';

export default function RepresentationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const auth = useAuth();
  const [representation, setRepresentation] = useState<Representation>();
  const [library, setLibrary] = useState<Library>();
  const [media, setMedia] = useState<Media[]>([]);
  const [kind, setKind] = useState('');
  const [label, setLabel] = useState('');
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function load() {
    if (!id) return;
    try {
      const next = await api.representation(id);
      const work = await api.work(next.work_id);
      const [nextLibrary, revisions] = await Promise.all([
        api.library(work.library_id),
        api.media(work.library_id, id),
      ]);
      setRepresentation(next);
      setLibrary(nextLibrary);
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
  }, [id]);

  if (loading)
    return (
      <Page title="Representation" editorial={false}>
        <Loading label="Loading representation…" />
      </Page>
    );
  if (!representation)
    return (
      <Page title="Representation" editorial={false}>
        <Notice danger>{error || 'Representation unavailable.'}</Notice>
      </Page>
    );

  const canEdit = Boolean(
    auth.user?.admin || library?.role === 'owner' || library?.role === 'editor',
  );

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
      if (!library) throw new Error('Library unavailable.');
      await api.uploadMedia(library.id, id, blob, asset.name);
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

  async function deleteRepresentation() {
    setDeleting(true);
    try {
      await api.deleteRepresentation(id);
      goBackOr('/libraries');
    } catch (value) {
      setError(errorMessage(value));
      setDeleting(false);
    }
  }

  return (
    <Page
      title={representation.label}
      back={<Button label="Work" icon="back" kind="quiet" onPress={() => goBackOr('/libraries')} />}
      editorial={false}
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
          <EmptyState icon="folder" title="No media uploaded">
            Upload a revision above to attach a file to this representation.
          </EmptyState>
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
            <Select label="Kind" options={representationKinds} value={kind} onChange={setKind} />
            <Field label="Label" value={label} onChangeText={setLabel} />
            <Row>
              <Button label="Save" kind="primary" onPress={() => void saveRepresentation()} />
              <Button
                label="Delete representation"
                kind="danger"
                onPress={() => setConfirmingDelete(true)}
              />
            </Row>
          </View>
        </Section>
      ) : null}

      <ConfirmDialog
        visible={confirmingDelete}
        onClose={() => setConfirmingDelete(false)}
        onConfirm={() => void deleteRepresentation()}
        title="Delete representation?"
        description="Representations with uploaded media cannot be deleted."
        confirmLabel="Delete"
        danger
        busy={deleting}
      />
    </Page>
  );
}

function formatBytes(bytes: number) {
  return bytes < 1024 * 1024
    ? `${Math.round(bytes / 1024)} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
