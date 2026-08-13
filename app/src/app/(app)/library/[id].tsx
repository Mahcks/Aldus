import type {
  Library,
  LibrarySource,
  ImportProposal,
  Membership,
  SourceEntry,
  SourceScan,
  User,
  Work,
} from '../../../generated/api';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { WorkCard } from '../../../features/bookshelf';
import { useAuth } from '../../../features/auth/AuthProvider';
import { Button, Field, Loading, Notice, Page, Row, colors, shared } from '../../../features/ui';
import { api, errorMessage } from '../../../lib/api';
import { goBackOr } from '../../../lib/navigation';

type Availability = { epub: boolean; audio: boolean; synced: boolean };
type Panel = 'work' | 'members' | 'settings' | 'sources' | null;

export default function LibraryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const auth = useAuth();
  const [library, setLibrary] = useState<Library>();
  const [works, setWorks] = useState<Work[]>([]);
  const [members, setMembers] = useState<Membership[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [sources, setSources] = useState<LibrarySource[]>([]);
  const [sourceScans, setSourceScans] = useState<Record<string, SourceScan[]>>({});
  const [sourceEntries, setSourceEntries] = useState<Record<string, SourceEntry[]>>({});
  const [proposals, setProposals] = useState<ImportProposal[]>([]);
  const [proposalEdits, setProposalEdits] = useState<
    Record<string, { title: string; author: string }>
  >({});
  const [availability, setAvailability] = useState<Record<string, Availability>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [panel, setPanel] = useState<Panel>(null);
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [memberID, setMemberID] = useState('');
  const [role, setRole] = useState('reader');
  const [sourceName, setSourceName] = useState('');
  const [sourceRoot, setSourceRoot] = useState('');
  async function load() {
    if (!id) return;
    try {
      const [nextLibrary, nextWorks, nextMembers, nextUsers] = await Promise.all([
        api.library(id),
        api.works(id),
        api.members(id),
        auth.user?.admin ? api.users() : Promise.resolve([]),
      ]);
      const mayScan = Boolean(
        auth.user?.admin || nextLibrary.role === 'owner' || nextLibrary.role === 'editor',
      );
      const nextSources = mayScan ? await api.sources(id) : [];
      const details = await Promise.all(
        nextWorks.map(async (work) => {
          const [representations, jobs] = await Promise.all([
            api.representations(work.id),
            api.alignmentJobs(work.id),
          ]);
          const revisions = (
            await Promise.all(
              representations.map((representation) => api.media(id, representation.id)),
            )
          ).flat();
          return [
            work.id,
            {
              epub: revisions.some((item) => item.kind === 'epub'),
              audio: revisions.some((item) => item.kind === 'audio' || item.kind === 'audiobook'),
              synced: jobs.some((item) => item.state === 'ready'),
            },
          ] as const;
        }),
      );
      setLibrary(nextLibrary);
      setName(nextLibrary.name);
      setWorks(nextWorks);
      setMembers(nextMembers);
      setUsers(nextUsers);
      setSources(nextSources);
      if (mayScan) {
        const [scans, entries, nextProposals] = await Promise.all([
          Promise.all(nextSources.map((source) => api.sourceScans(id, source.id))),
          Promise.all(nextSources.map((source) => api.sourceEntries(id, source.id))),
          api.importProposals(id),
        ]);
        setSourceScans(
          Object.fromEntries(nextSources.map((source, index) => [source.id, scans[index]])),
        );
        setSourceEntries(
          Object.fromEntries(nextSources.map((source, index) => [source.id, entries[index]])),
        );
        setProposals(nextProposals);
        setProposalEdits(
          Object.fromEntries(
            nextProposals.map((proposal) => [
              proposal.id,
              proposalEdits[proposal.id] ?? { title: proposal.title, author: proposal.author },
            ]),
          ),
        );
      }
      setAvailability(Object.fromEntries(details));
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
  if (loading) return <Loading />;
  if (!library)
    return (
      <Page title="Library">
        <Notice danger>{error || 'Library unavailable.'}</Notice>
      </Page>
    );
  const canEdit = Boolean(
    auth.user?.admin || library.role === 'owner' || library.role === 'editor',
  );
  const canManage = Boolean(auth.user?.admin || library.role === 'owner');
  async function createWork() {
    try {
      const work = await api.createWork(id, { title, author });
      setPanel(null);
      setTitle('');
      setAuthor('');
      router.push(`/work/${work.id}?libraryId=${id}&role=${library?.role || ''}`);
    } catch (value) {
      setError(errorMessage(value));
    }
  }
  async function saveName() {
    try {
      await api.updateLibrary(id, { name });
      setPanel(null);
      await load();
    } catch (value) {
      setError(errorMessage(value));
    }
  }
  async function saveMember() {
    try {
      await api.setMember(id, memberID, role);
      setMemberID('');
      await load();
    } catch (value) {
      setError(errorMessage(value));
    }
  }
  async function createSource() {
    try {
      await api.createSource(id, { name: sourceName, root_path: sourceRoot });
      setSourceName('');
      setSourceRoot('');
      await load();
    } catch (value) {
      setError(errorMessage(value));
    }
  }
  async function toggleSource(source: LibrarySource) {
    try {
      await api.updateSource(id, source.id, {
        name: source.name,
        root_path: source.root_path,
        enabled: !source.enabled,
      });
      await load();
    } catch (value) {
      setError(errorMessage(value));
    }
  }
  async function startSourceScan(sourceID: string) {
    try {
      await api.startSourceScan(id, sourceID);
      await load();
    } catch (value) {
      setError(errorMessage(value));
    }
  }
  async function acceptProposal(proposal: ImportProposal, workID = '') {
    try {
      const edit = proposalEdits[proposal.id] ?? proposal;
      await api.acceptImportProposal(id, proposal.id, {
        expected_revision: proposal.revision,
        work_id: workID,
        title: edit.title,
        author: edit.author,
        items: proposal.items.map((item) => ({
          source_entry_id: item.source_entry_id,
          kind: item.kind,
          label: item.label,
        })),
      });
      await load();
    } catch (value) {
      setError(errorMessage(value));
      await load();
    }
  }
  async function ignoreProposal(proposal: ImportProposal) {
    try {
      await api.ignoreImportProposal(id, proposal.id, proposal.revision);
      await load();
    } catch (value) {
      setError(errorMessage(value));
      await load();
    }
  }

  return (
    <Page
      title={library.name}
      back={<Button label="Libraries" kind="quiet" onPress={() => goBackOr('/libraries')} />}
      actions={
        <Row>
          {canManage ? (
            <Button label="Manage members" kind="quiet" onPress={() => setPanel('members')} />
          ) : null}
          {canEdit ? (
            <Button label="Sources" kind="quiet" onPress={() => setPanel('sources')} />
          ) : null}
          {canManage ? (
            <Button label="Library settings" kind="quiet" onPress={() => setPanel('settings')} />
          ) : null}
          {canEdit ? (
            <Button label="+ Add work" kind="primary" onPress={() => setPanel('work')} />
          ) : null}
        </Row>
      }
    >
      {error ? <Notice danger>{error}</Notice> : null}
      <View style={styles.libraryMeta}>
        <Text style={styles.count}>
          {works.length} {works.length === 1 ? 'work' : 'works'} · {members.length}{' '}
          {members.length === 1 ? 'member' : 'members'}
        </Text>
      </View>
      {works.length === 0 ? (
        <View style={styles.empty}>
          <View style={styles.emptyBooks}>
            <View style={styles.emptyBook} />
            <View style={[styles.emptyBook, styles.emptyBookTall]} />
            <View style={[styles.emptyBook, styles.emptyBookRust]} />
          </View>
          <Text style={styles.emptyTitle}>Your library is empty</Text>
          <Text style={styles.emptyText}>
            Add a book or audiobook to start building this shelf.
          </Text>
          {canEdit ? (
            <Button label="Add your first work" kind="primary" onPress={() => setPanel('work')} />
          ) : null}
        </View>
      ) : (
        <View style={styles.grid}>
          {works.map((work) => {
            const available = availability[work.id];
            const badges = [
              available?.epub ? 'EPUB' : '',
              available?.audio ? 'Audio' : '',
              available?.synced ? 'Synced' : '',
            ].filter(Boolean);
            return (
              <WorkCard
                key={work.id}
                title={work.title}
                author={work.author}
                badges={badges}
                onPress={() => router.push(`/work/${work.id}?libraryId=${id}&role=${library.role}`)}
              />
            );
          })}
        </View>
      )}
      <Dialog visible={panel === 'work'} title="Add work" onClose={() => setPanel(null)}>
        <View style={shared.form}>
          <Field label="Title" autoFocus value={title} onChangeText={setTitle} />
          <Field label="Author" value={author} onChangeText={setAuthor} />
          <Row>
            <Button label="Cancel" onPress={() => setPanel(null)} />
            <Button
              label="Create work"
              kind="primary"
              disabled={!title.trim()}
              onPress={createWork}
            />
          </Row>
        </View>
      </Dialog>
      <Dialog visible={panel === 'members'} title="Manage members" onClose={() => setPanel(null)}>
        <ScrollView style={styles.dialogScroll}>
          {members.map((member) => (
            <View key={member.user_id} style={styles.member}>
              <View style={styles.memberName}>
                <Text style={shared.itemTitle}>{member.display_name || member.username}</Text>
                <Text style={shared.itemMeta}>@{member.username}</Text>
              </View>
              <RoleControl
                value={member.role}
                onChange={async (next) => {
                  try {
                    await api.setMember(id, member.user_id, next);
                    await load();
                  } catch (value) {
                    setError(errorMessage(value));
                  }
                }}
              />
              <Button
                label="Remove"
                kind="danger"
                onPress={() =>
                  Alert.alert(
                    'Remove member?',
                    `${member.display_name || member.username} will lose access to this library.`,
                    [
                      { text: 'Cancel' },
                      {
                        text: 'Remove',
                        style: 'destructive',
                        onPress: async () => {
                          try {
                            await api.removeMember(id, member.user_id);
                            await load();
                          } catch (value) {
                            setError(errorMessage(value));
                          }
                        },
                      },
                    ],
                  )
                }
              />
            </View>
          ))}
          {auth.user?.admin ? (
            <View style={styles.addMember}>
              <Text style={styles.dialogHeading}>Add member</Text>
              <View style={styles.userChoices}>
                {users
                  .filter(
                    (user) =>
                      !user.disabled && !members.some((member) => member.user_id === user.id),
                  )
                  .map((user) => (
                    <Pressable
                      accessibilityRole="radio"
                      accessibilityState={{ checked: memberID === user.id }}
                      key={user.id}
                      onPress={() => setMemberID(user.id)}
                      style={[styles.userChoice, memberID === user.id && styles.userChoiceSelected]}
                    >
                      <Text style={shared.itemTitle}>{user.display_name || user.username}</Text>
                      <Text style={shared.itemMeta}>@{user.username}</Text>
                    </Pressable>
                  ))}
              </View>
              <RoleControl value={role} onChange={setRole} />
              <Button label="Add member" kind="primary" disabled={!memberID} onPress={saveMember} />
            </View>
          ) : (
            <Notice>
              Only a global administrator can add a new account. You can change roles or remove
              existing members here.
            </Notice>
          )}
        </ScrollView>
      </Dialog>
      <Dialog visible={panel === 'sources'} title="Library sources" onClose={() => setPanel(null)}>
        <ScrollView style={styles.dialogScroll}>
          {sources.map((source) => (
            <View key={source.id} style={shared.listItem}>
              <Text style={shared.itemTitle}>{source.name}</Text>
              <Text style={shared.itemMeta}>{source.root_path}</Text>
              {auth.user?.admin ? (
                <Button
                  label={source.enabled ? 'Disable' : 'Enable'}
                  kind={source.enabled ? 'danger' : 'secondary'}
                  onPress={() => void toggleSource(source)}
                />
              ) : null}
              <Button
                label="Scan now"
                kind="primary"
                disabled={!source.enabled || sourceScans[source.id]?.[0]?.state === 'scanning'}
                onPress={() => void startSourceScan(source.id)}
              />
              {sourceScans[source.id]?.[0] ? (
                <Text style={shared.itemMeta}>
                  {sourceScans[source.id][0].state} · {sourceScans[source.id][0].supported}{' '}
                  supported · {sourceScans[source.id][0].new} new ·{' '}
                  {sourceScans[source.id][0].changed} changed · {sourceScans[source.id][0].missing}{' '}
                  missing · {sourceScans[source.id][0].problems} problems
                </Text>
              ) : null}
              {(sourceEntries[source.id] ?? []).map((entry) => (
                <Text key={entry.id} style={shared.itemMeta}>
                  {entry.relative_path} · {entry.kind || 'problem'} · {entry.state}
                </Text>
              ))}
            </View>
          ))}
          {proposals.map((proposal) => (
            <View key={proposal.id} style={shared.listItem}>
              <Text style={shared.itemTitle}>{proposal.title || 'Untitled proposal'}</Text>
              <Text style={shared.itemMeta}>
                {proposal.author || 'Unknown author'} · {proposal.confidence} confidence ·{' '}
                {proposal.state}
              </Text>
              <Field
                label="Work title"
                value={proposalEdits[proposal.id]?.title ?? proposal.title}
                onChangeText={(title) =>
                  setProposalEdits((current) => ({
                    ...current,
                    [proposal.id]: {
                      title,
                      author: current[proposal.id]?.author ?? proposal.author,
                    },
                  }))
                }
              />
              <Field
                label="Work author"
                value={proposalEdits[proposal.id]?.author ?? proposal.author}
                onChangeText={(author) =>
                  setProposalEdits((current) => ({
                    ...current,
                    [proposal.id]: {
                      title: current[proposal.id]?.title ?? proposal.title,
                      author,
                    },
                  }))
                }
              />
              {proposal.reasons.map((reason) => (
                <Text key={reason} style={shared.itemMeta}>
                  {reason}
                </Text>
              ))}
              {proposal.items.map((item) => (
                <Text key={`${item.relative_path}-${item.sha256}`} style={shared.itemMeta}>
                  {item.label} · {item.relative_path}
                  {item.duplicate ? ' · exact duplicate' : ''}
                </Text>
              ))}
              <Row>
                <Button
                  label="Create new work"
                  kind="primary"
                  onPress={() => void acceptProposal(proposal)}
                />
                {proposal.existing_work_id ? (
                  <Button
                    label="Attach to matching work"
                    kind="secondary"
                    onPress={() => void acceptProposal(proposal, proposal.existing_work_id)}
                  />
                ) : null}
                {works
                  .filter((work) => work.id !== proposal.existing_work_id)
                  .map((work) => (
                    <Button
                      key={work.id}
                      label={`Attach to ${work.title}`}
                      kind="secondary"
                      onPress={() => void acceptProposal(proposal, work.id)}
                    />
                  ))}
                <Button
                  label="Ignore"
                  kind="danger"
                  onPress={() => void ignoreProposal(proposal)}
                />
              </Row>
            </View>
          ))}
          {auth.user?.admin ? (
            <View style={shared.form}>
              <Field label="Source name" value={sourceName} onChangeText={setSourceName} />
              <Field
                label="Authorized absolute path"
                autoCapitalize="none"
                value={sourceRoot}
                onChangeText={setSourceRoot}
              />
              <Button
                label="Add source"
                kind="primary"
                disabled={!sourceName.trim() || !sourceRoot.trim()}
                onPress={createSource}
              />
            </View>
          ) : null}
        </ScrollView>
      </Dialog>
      <Dialog
        visible={panel === 'settings'}
        title="Library settings"
        onClose={() => setPanel(null)}
      >
        <View style={shared.form}>
          <Field label="Library name" value={name} onChangeText={setName} />
          <Button label="Save changes" kind="primary" disabled={!name.trim()} onPress={saveName} />
          <View style={styles.dangerZone}>
            <Text style={styles.dialogHeading}>Delete library</Text>
            <Text style={shared.itemMeta}>
              The library must contain no Works before it can be deleted.
            </Text>
            <Button
              label="Delete library"
              kind="danger"
              onPress={() =>
                Alert.alert('Delete library?', 'This cannot be undone.', [
                  { text: 'Cancel' },
                  {
                    text: 'Delete',
                    style: 'destructive',
                    onPress: async () => {
                      try {
                        await api.deleteLibrary(id);
                        router.replace('/libraries');
                      } catch (value) {
                        setError(errorMessage(value));
                      }
                    },
                  },
                ])
              }
            />
          </View>
        </View>
      </Dialog>
    </Page>
  );
}

function Dialog({
  visible,
  title,
  onClose,
  children,
}: React.PropsWithChildren<{ visible: boolean; title: string; onClose: () => void }>) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable accessibilityRole="none" style={styles.dialog} onPress={() => {}}>
          <View style={styles.dialogHeader}>
            <Text accessibilityRole="header" style={styles.dialogTitle}>
              {title}
            </Text>
            <Button label="Close" kind="quiet" onPress={onClose} />
          </View>
          {children}
        </Pressable>
      </Pressable>
    </Modal>
  );
}
function RoleControl({ value, onChange }: { value: string; onChange: (role: string) => void }) {
  return (
    <View accessibilityRole="radiogroup" style={styles.roles}>
      {['owner', 'editor', 'reader'].map((item) => (
        <Pressable
          accessibilityRole="radio"
          accessibilityState={{ checked: value === item }}
          key={item}
          onPress={() => onChange(item)}
          style={[styles.role, value === item && styles.roleSelected]}
        >
          <Text style={[styles.roleText, value === item && styles.roleTextSelected]}>{item}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  libraryMeta: { marginTop: -12 },
  count: { color: colors.muted, fontSize: 14 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 24 },
  empty: { minHeight: 420, alignItems: 'center', justifyContent: 'center', gap: 12 },
  emptyBooks: {
    height: 100,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 5,
    marginBottom: 8,
  },
  emptyBook: { width: 25, height: 74, backgroundColor: '#48594b' },
  emptyBookTall: { height: 94, backgroundColor: '#8a6237' },
  emptyBookRust: { height: 82, backgroundColor: colors.accent },
  emptyTitle: { color: colors.ink, fontSize: 22, fontWeight: '800' },
  emptyText: { color: colors.muted, fontSize: 14, textAlign: 'center', marginBottom: 4 },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(41,35,29,.42)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 18,
  },
  dialog: {
    width: '100%',
    maxWidth: 620,
    maxHeight: '88%',
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 8,
    padding: 20,
    gap: 18,
  },
  dialogHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dialogTitle: { color: colors.ink, fontSize: 21, fontWeight: '800' },
  dialogScroll: { maxHeight: 580 },
  dialogHeading: { color: colors.ink, fontSize: 15, fontWeight: '800' },
  member: { paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: colors.line, gap: 10 },
  memberName: { flex: 1 },
  roles: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  role: {
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 5,
  },
  roleSelected: { borderColor: colors.accent, backgroundColor: '#f1dfd6' },
  roleText: { color: colors.muted, fontSize: 12, fontWeight: '700', textTransform: 'capitalize' },
  roleTextSelected: { color: colors.accent },
  addMember: { paddingTop: 22, gap: 12 },
  userChoices: { gap: 4 },
  userChoice: { padding: 10, borderWidth: 1, borderColor: colors.line, borderRadius: 5 },
  userChoiceSelected: { borderColor: colors.accent, backgroundColor: '#f7ebe5' },
  dangerZone: {
    marginTop: 18,
    paddingTop: 18,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    alignItems: 'flex-start',
    gap: 10,
  },
});
