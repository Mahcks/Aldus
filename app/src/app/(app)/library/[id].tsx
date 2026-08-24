import type {
  AcquisitionPolicy,
  Library,
  LibrarySource,
  Membership,
  User,
  WorkSummary,
} from '../../../generated/api';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { useWindowDimensions } from 'react-native';
import { BrowseControls, WorkGrid } from '../../../features/browse';
import {
  formatSizeLimit,
  parseFormats,
  parseSizeLimit,
  validFormats,
  validPolicyToken,
} from '../../../features/acquisition-policy-form';
import { useAuth } from '../../../features/auth/AuthProvider';
import { AppIcon, type AppIconName } from '../../../features/icons';
import { Pressable, Text, View } from '../../../features/tw';
import {
  Button,
  Checkbox,
  colors,
  ConfirmDialog,
  Dialog,
  EmptyState,
  Field,
  IconButton,
  Loading,
  Notice,
  Page,
  Radio,
  resolvePressStateClass,
  Row,
  SearchField,
  Select,
  shared,
} from '../../../features/ui';
import { APIError, api, errorMessage } from '../../../lib/api';
import { goBackOr } from '../../../lib/navigation';
import {
  offlineLibraries,
  offlineWorkSummaries,
  rememberOfflineLibraries,
} from '../../../lib/offline-library';

type Panel = 'work' | 'members' | 'policy' | 'settings' | null;
type Role = 'owner' | 'editor' | 'reader';

const roles: Role[] = ['owner', 'editor', 'reader'];

/** Quiet row inside the compact mobile "Library management" sheet. */
/**
 * A flat divider row, not `IconRow`'s bordered card — this sits inside the
 * "Library management" Dialog, and giving each row its own card border would
 * nest a card inside a card. Uses the same icon-badge treatment as IconRow
 * for visual consistency without the nesting.
 */
function ManagementRow({
  icon,
  label,
  onPress,
}: {
  icon: AppIconName;
  label: string;
  onPress: () => void;
}) {
  const [focused, setFocused] = useState(false);
  const [pressed, setPressed] = useState(false);
  const stateClass = resolvePressStateClass({ focused, pressed });

  return (
    <Pressable
      accessibilityRole="button"
      onBlur={() => setFocused(false)}
      onFocus={() => setFocused(true)}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      onPress={onPress}
      className={`min-h-11 flex-row items-center gap-3 border-b border-line-subtle py-3 ${stateClass}`}
    >
      <View className="h-10 w-10 items-center justify-center rounded-full bg-accent-soft">
        <AppIcon name={icon} size={18} color={colors.accent} />
      </View>
      <Text className="flex-1 text-base font-sans-semibold text-ink">{label}</Text>
      <AppIcon name="chevron" size={18} color={colors.subtle} />
    </Pressable>
  );
}

export default function LibraryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const auth = useAuth();
  const compact = useWindowDimensions().width < 600;
  const [library, setLibrary] = useState<Library>();
  const [works, setWorks] = useState<WorkSummary[]>([]);
  const [members, setMembers] = useState<Membership[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('recent');
  const [availability, setAvailability] = useState('all');
  const [hasMore, setHasMore] = useState(false);
  const [loadingWorks, setLoadingWorks] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [panel, setPanel] = useState<Panel>(null);
  const [manageOpen, setManageOpen] = useState(false);
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [memberID, setMemberID] = useState('');
  const [role, setRole] = useState<Role>('reader');
  const [canRequestAcquisitions, setCanRequestAcquisitions] = useState(false);
  const [canBypassAcquisitionApproval, setCanBypassAcquisitionApproval] = useState(false);
  const [canAdvancedAcquisitionRequest, setCanAdvancedAcquisitionRequest] = useState(false);
  const [sources, setSources] = useState<LibrarySource[]>([]);
  const [policy, setPolicy] = useState<AcquisitionPolicy>();
  const [ebookSourceID, setEbookSourceID] = useState('');
  const [audiobookSourceID, setAudiobookSourceID] = useState('');
  const [ebookSize, setEbookSize] = useState('');
  const [audiobookSize, setAudiobookSize] = useState('');
  const [ebookFormats, setEbookFormats] = useState('');
  const [audiobookFormats, setAudiobookFormats] = useState('');
  const [preferredLanguage, setPreferredLanguage] = useState('');
  const [allowAbridged, setAllowAbridged] = useState(false);
  const [maxActiveRequests, setMaxActiveRequests] = useState('');
  const [policyLoading, setPolicyLoading] = useState(true);
  const [policyBusy, setPolicyBusy] = useState(false);
  const [policyError, setPolicyError] = useState('');
  const [policySaved, setPolicySaved] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<Membership | null>(null);
  const [removingMember, setRemovingMember] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deletingLibrary, setDeletingLibrary] = useState(false);
  const [offline, setOffline] = useState(false);

  async function load() {
    if (!id) return;
    try {
      const [nextLibrary, nextMembers, nextUsers] = await Promise.all([
        api.library(id),
        api.members(id),
        auth.user?.admin ? api.users() : Promise.resolve([]),
      ]);
      setLibrary(nextLibrary);
      await rememberOfflineLibraries([nextLibrary]).catch(() => {});
      setName(nextLibrary.name);
      setMembers(nextMembers);
      setUsers(nextUsers);
    } catch (value) {
      if (!(value instanceof APIError && value.status === 0)) {
        setError(errorMessage(value));
        return;
      }
      const saved = (await offlineLibraries()).find((item) => item.id === id);
      if (saved) {
        setLibrary(saved);
        setName(saved.name);
        setOffline(true);
      } else setError(errorMessage(value));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (
      !id ||
      !library ||
      offline ||
      !(auth.user?.admin || library.role === 'owner' || library.role === 'editor')
    )
      return;
    let active = true;
    Promise.all([api.sources(id), api.acquisitionPolicy(id)])
      .then(([nextSources, nextPolicy]) => {
        if (!active) return;
        setSources(nextSources.filter((source) => source.enabled));
        setPolicy(nextPolicy);
        setEbookSourceID(nextPolicy.default_ebook_source_id ?? '');
        setAudiobookSourceID(nextPolicy.default_audiobook_source_id ?? '');
        setEbookSize(formatSizeLimit(nextPolicy.max_ebook_bytes));
        setAudiobookSize(formatSizeLimit(nextPolicy.max_audiobook_bytes));
        setEbookFormats(nextPolicy.allowed_ebook_extensions.join(', '));
        setAudiobookFormats(nextPolicy.allowed_audiobook_extensions.join(', '));
        setPreferredLanguage(nextPolicy.preferred_language);
        setAllowAbridged(nextPolicy.allow_abridged);
        setMaxActiveRequests(String(nextPolicy.max_active_requests));
      })
      .catch((value: unknown) => {
        if (active) setPolicyError(errorMessage(value));
      })
      .finally(() => {
        if (active) setPolicyLoading(false);
      });
    return () => {
      active = false;
    };
  }, [id, library, offline, auth.user?.admin]);

  async function loadWorks(offset = 0) {
    if (!id) return;
    setLoadingWorks(true);
    try {
      const page = await api.browseWorks({
        libraryID: id,
        q: query,
        sort,
        availability,
        limit: 24,
        offset,
      });
      setWorks((current) => (offset ? [...current, ...page.items] : page.items));
      setHasMore(page.has_more);
    } catch (value) {
      if (!(value instanceof APIError && value.status === 0)) {
        setError(errorMessage(value));
        return;
      }
      const saved = await offlineWorkSummaries(id);
      const normalizedQuery = query.trim().toLocaleLowerCase();
      const filtered = saved.filter((work) => {
        if (
          normalizedQuery &&
          !`${work.title} ${work.author ?? ''}`.toLocaleLowerCase().includes(normalizedQuery)
        )
          return false;
        if (availability === 'readable') return work.readable;
        if (availability === 'listenable') return work.listenable;
        if (availability === 'synchronized') return work.synchronized;
        return true;
      });
      setWorks(filtered);
      setHasMore(false);
      setOffline(filtered.length > 0 || saved.length > 0);
      if (!saved.length) setError(errorMessage(value));
    } finally {
      setLoadingWorks(false);
    }
  }

  useEffect(() => {
    const timer = setTimeout(() => void loadWorks(), 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, query, sort, availability]);

  if (loading) return <Loading label="Loading your library…" />;
  if (!library)
    return (
      <Page title="Library">
        <Notice danger>{error || 'Library unavailable.'}</Notice>
      </Page>
    );

  const canEdit =
    !offline && Boolean(auth.user?.admin || library.role === 'owner' || library.role === 'editor');
  const canManage = !offline && Boolean(auth.user?.admin || library.role === 'owner');
  const hasManagementActions = canManage || canEdit;
  const filtersActive = Boolean(query || availability !== 'all');
  const availableUsers = users.filter(
    (user) => !user.disabled && !members.some((member) => member.user_id === user.id),
  );

  function closePanel() {
    setPanel(null);
  }

  function openPanelFromManage(next: Exclude<Panel, null>) {
    setManageOpen(false);
    setPanel(next);
  }

  function openSourcesFromManage() {
    setManageOpen(false);
    router.push(`/sources?libraryId=${id}`);
  }

  function clearFilters() {
    setQuery('');
    setAvailability('all');
  }

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
      await api.setMember(
        id,
        memberID,
        role,
        canRequestAcquisitions,
        canBypassAcquisitionApproval,
        canAdvancedAcquisitionRequest,
      );
      setMemberID('');
      setCanRequestAcquisitions(false);
      setCanBypassAcquisitionApproval(false);
      setCanAdvancedAcquisitionRequest(false);
      await load();
    } catch (value) {
      setError(errorMessage(value));
    }
  }

  async function changeMemberRole(member: Membership, next: Role) {
    try {
      await api.setMember(
        id,
        member.user_id,
        next,
        member.can_request_acquisitions,
        member.can_bypass_acquisition_approval,
        member.can_advanced_acquisition_request,
      );
      await load();
    } catch (value) {
      setError(errorMessage(value));
    }
  }

  async function toggleAcquisitionPermission(
    member: Membership,
    permission: 'request' | 'bypass' | 'advanced',
  ) {
    try {
      await api.setMember(
        id,
        member.user_id,
        member.role,
        permission === 'request'
          ? !member.can_request_acquisitions
          : member.can_request_acquisitions,
        permission === 'bypass'
          ? !member.can_bypass_acquisition_approval
          : member.can_bypass_acquisition_approval,
        permission === 'advanced'
          ? !member.can_advanced_acquisition_request
          : member.can_advanced_acquisition_request,
      );
      await load();
    } catch (value) {
      setError(errorMessage(value));
    }
  }

  async function savePolicy() {
    if (!id) return;
    const maxEbookBytes = parseSizeLimit(ebookSize);
    const maxAudiobookBytes = parseSizeLimit(audiobookSize);
    const allowedEbookExtensions = parseFormats(ebookFormats);
    const allowedAudiobookExtensions = parseFormats(audiobookFormats);
    const activeRequests = Number(maxActiveRequests);
    if (!ebookSourceID || !audiobookSourceID) {
      setPolicyError('Choose a default source for ebooks and audiobooks.');
      return;
    }
    if (!maxEbookBytes || !maxAudiobookBytes) {
      setPolicyError('Enter download limits with MB or GB, for example 200 MB or 5 GB.');
      return;
    }
    if (!validFormats(allowedEbookExtensions) || !validFormats(allowedAudiobookExtensions)) {
      setPolicyError('Enter one or more valid formats separated by commas.');
      return;
    }
    if (!validPolicyToken(preferredLanguage.trim().toLowerCase())) {
      setPolicyError('Use a language code such as en or en-us.');
      return;
    }
    if (!Number.isInteger(activeRequests) || activeRequests < 1 || activeRequests > 100) {
      setPolicyError('Active requests must be a whole number from 1 to 100.');
      return;
    }
    setPolicyBusy(true);
    setPolicyError('');
    setPolicySaved(false);
    try {
      const saved = await api.updateAcquisitionPolicy(id, {
        default_ebook_source_id: ebookSourceID,
        default_audiobook_source_id: audiobookSourceID,
        max_ebook_bytes: maxEbookBytes,
        max_audiobook_bytes: maxAudiobookBytes,
        allowed_ebook_extensions: allowedEbookExtensions,
        allowed_audiobook_extensions: allowedAudiobookExtensions,
        preferred_language: preferredLanguage.trim().toLowerCase(),
        allow_abridged: allowAbridged,
        max_active_requests: activeRequests,
      });
      setPolicy(saved);
      setEbookSize(formatSizeLimit(saved.max_ebook_bytes));
      setAudiobookSize(formatSizeLimit(saved.max_audiobook_bytes));
      setEbookFormats(saved.allowed_ebook_extensions.join(', '));
      setAudiobookFormats(saved.allowed_audiobook_extensions.join(', '));
      setPolicySaved(true);
    } catch (value) {
      setPolicyError(errorMessage(value));
    } finally {
      setPolicyBusy(false);
    }
  }

  async function confirmRemoveMember() {
    if (!removeTarget) return;
    setRemovingMember(true);
    try {
      await api.removeMember(id, removeTarget.user_id);
      setRemoveTarget(null);
      await load();
    } catch (value) {
      setError(errorMessage(value));
    } finally {
      setRemovingMember(false);
    }
  }

  async function confirmDeleteLibrary() {
    setDeletingLibrary(true);
    try {
      await api.deleteLibrary(id);
      router.replace('/libraries');
    } catch (value) {
      setError(errorMessage(value));
      setDeletingLibrary(false);
    }
  }

  return (
    <Page
      title={library.name}
      back={
        <Button label="Libraries" icon="back" kind="quiet" onPress={() => goBackOr('/libraries')} />
      }
      actions={
        compact ? undefined : (
          <Row>
            {canManage ? (
              <Button label="Members" kind="quiet" onPress={() => setPanel('members')} />
            ) : null}
            {canEdit ? (
              <Button
                label="Sources"
                kind="quiet"
                onPress={() => router.push(`/sources?libraryId=${id}`)}
              />
            ) : null}
            {canEdit ? (
              <Button label="Acquisition policy" kind="quiet" onPress={() => setPanel('policy')} />
            ) : null}
            {canManage ? (
              <IconButton
                icon="settings"
                label="Library settings"
                kind="quiet"
                onPress={() => setPanel('settings')}
              />
            ) : null}
            {canEdit ? (
              <Button label="Add work" icon="add" kind="primary" onPress={() => setPanel('work')} />
            ) : null}
          </Row>
        )
      }
    >
      {offline ? <Notice>Offline · showing downloads on this device.</Notice> : null}
      {error ? <Notice danger>{error}</Notice> : null}
      <View>
        <View className="flex-row items-center justify-between gap-3">
          <Text className="flex-1 text-sm text-muted">
            {works.length} {works.length === 1 ? 'work' : 'works'} shown · {members.length}{' '}
            {members.length === 1 ? 'member' : 'members'}
          </Text>
          {compact && hasManagementActions ? (
            <IconButton
              icon="more"
              label="Library management"
              kind="quiet"
              onPress={() => setManageOpen(true)}
            />
          ) : null}
        </View>
        <View className="mt-4 gap-3">
          <View className="w-full max-w-[760px]">
            <SearchField label="Search title or author" value={query} onChangeText={setQuery} />
          </View>
          <BrowseControls
            sort={sort}
            availability={availability}
            onSortChange={setSort}
            onAvailabilityChange={setAvailability}
          />
        </View>
        <View className="mt-6">
          {loadingWorks && works.length === 0 ? (
            <Loading label="Finding books…" />
          ) : works.length === 0 && filtersActive ? (
            <EmptyState
              icon="search"
              title="No matching works"
              action={<Button label="Clear search and filters" onPress={clearFilters} />}
            >
              Try another title, author, or availability filter.
            </EmptyState>
          ) : works.length === 0 ? (
            <EmptyState
              icon="read"
              title="Your library is empty"
              action={
                canEdit ? (
                  <Button
                    label="Add your first work"
                    kind="primary"
                    onPress={() => setPanel('work')}
                  />
                ) : undefined
              }
            >
              Add a book or audiobook to start building this shelf.
            </EmptyState>
          ) : (
            <View className="items-start gap-6">
              <WorkGrid
                works={works}
                onOpen={(work) =>
                  router.push(`/work/${work.id}?libraryId=${id}&role=${library.role}`)
                }
              />
              {hasMore ? (
                <Button
                  label={loadingWorks ? 'Loading…' : 'Load more'}
                  disabled={loadingWorks}
                  onPress={() => void loadWorks(works.length)}
                />
              ) : null}
            </View>
          )}
        </View>
      </View>
      <Dialog visible={manageOpen} title="Library management" onClose={() => setManageOpen(false)}>
        <View>
          {canEdit ? (
            <ManagementRow
              icon="add"
              label="Add work"
              onPress={() => openPanelFromManage('work')}
            />
          ) : null}
          {canManage ? (
            <ManagementRow
              icon="users"
              label="Members"
              onPress={() => openPanelFromManage('members')}
            />
          ) : null}
          {canEdit ? (
            <ManagementRow icon="folder" label="Sources" onPress={openSourcesFromManage} />
          ) : null}
          {canEdit ? (
            <ManagementRow
              icon="acquire"
              label="Acquisition policy"
              onPress={() => openPanelFromManage('policy')}
            />
          ) : null}
          {canManage ? (
            <ManagementRow
              icon="settings"
              label="Library settings"
              onPress={() => openPanelFromManage('settings')}
            />
          ) : null}
        </View>
      </Dialog>
      <Dialog visible={panel === 'work'} title="Add work" onClose={closePanel}>
        <View className={shared.form}>
          <Field label="Title" autoFocus value={title} onChangeText={setTitle} />
          <Field label="Author" value={author} onChangeText={setAuthor} />
          <Row>
            <Button label="Cancel" onPress={closePanel} />
            <Button
              label="Create work"
              kind="primary"
              disabled={!title.trim()}
              onPress={createWork}
            />
          </Row>
        </View>
      </Dialog>
      <Dialog visible={panel === 'members'} title="Manage members" onClose={closePanel} wide>
        <View className="gap-1">
          <Notice>
            Guided requests always follow the owner’s download rules. Skip approval starts a guided
            request automatically. Advanced release choice may bypass those rules.
          </Notice>
          {members.map((member) => (
            <View
              key={member.user_id}
              className="flex-row flex-wrap items-center justify-between gap-3 border-b border-line py-3.5"
            >
              <View className="min-w-[160px] flex-1 gap-1">
                <Text className={shared.itemTitle}>{member.display_name || member.username}</Text>
                <Text className={shared.itemMeta}>@{member.username}</Text>
              </View>
              <RoleControl
                value={member.role as Role}
                onChange={(next) => void changeMemberRole(member, next)}
              />
              {member.role === 'reader' ? (
                <View className="min-w-[220px] gap-1">
                  <Checkbox
                    label="Can request"
                    checked={member.can_request_acquisitions}
                    onPress={() => void toggleAcquisitionPermission(member, 'request')}
                  />
                  <Checkbox
                    label="Skip approval"
                    checked={member.can_bypass_acquisition_approval}
                    onPress={() => void toggleAcquisitionPermission(member, 'bypass')}
                  />
                  <Checkbox
                    label="Advanced release choice"
                    checked={member.can_advanced_acquisition_request}
                    onPress={() => void toggleAcquisitionPermission(member, 'advanced')}
                  />
                </View>
              ) : (
                <Text className="text-xs text-muted">Request access included with this role</Text>
              )}
              <Button label="Remove" kind="danger" onPress={() => setRemoveTarget(member)} />
            </View>
          ))}
          {auth.user?.admin ? (
            <View className="gap-3 pt-6">
              <Text className="text-sm font-sans-bold text-ink">Add member</Text>
              <View className="gap-1">
                {availableUsers.map((user) => (
                  <Radio
                    key={user.id}
                    label={`${user.display_name || user.username} · @${user.username}`}
                    selected={memberID === user.id}
                    onPress={() => setMemberID(user.id)}
                  />
                ))}
              </View>
              <RoleControl value={role} onChange={setRole} />
              {role === 'reader' ? (
                <View className="gap-1">
                  <Checkbox
                    label="Can request"
                    checked={canRequestAcquisitions}
                    onPress={() => setCanRequestAcquisitions((current) => !current)}
                  />
                  <Checkbox
                    label="Skip approval"
                    checked={canBypassAcquisitionApproval}
                    onPress={() => setCanBypassAcquisitionApproval((current) => !current)}
                  />
                  <Checkbox
                    label="Advanced release choice"
                    checked={canAdvancedAcquisitionRequest}
                    onPress={() => setCanAdvancedAcquisitionRequest((current) => !current)}
                  />
                </View>
              ) : null}
              <Button label="Add member" kind="primary" disabled={!memberID} onPress={saveMember} />
            </View>
          ) : (
            <Notice>
              Only a global administrator can add a new account. You can change roles or remove
              existing members here.
            </Notice>
          )}
        </View>
      </Dialog>
      <Dialog visible={panel === 'policy'} title="Acquisition policy" onClose={closePanel} wide>
        {policyLoading ? (
          <Loading label="Loading acquisition policy…" />
        ) : (
          <View className="gap-5">
            <Notice>
              These rules are mandatory for guided requests, including requests that skip approval.
              Members with advanced release choice may bypass them.
            </Notice>
            {policyError ? <Notice danger>{policyError}</Notice> : null}
            {policySaved ? <Notice tone="success">Acquisition policy saved.</Notice> : null}
            {sources.length === 0 ? (
              <Notice tone="warning">
                Add and enable a source before choosing download destinations.
              </Notice>
            ) : (
              <View className="gap-4">
                <Select
                  label="Default ebook source"
                  options={sources.map((source) => ({ value: source.id, label: source.name }))}
                  value={ebookSourceID}
                  onChange={setEbookSourceID}
                />
                <Select
                  label="Default audiobook source"
                  options={sources.map((source) => ({ value: source.id, label: source.name }))}
                  value={audiobookSourceID}
                  onChange={setAudiobookSourceID}
                />
              </View>
            )}
            <View className="gap-4 sm:flex-row">
              <View className="min-w-0 flex-1">
                <Field
                  label="Maximum ebook size"
                  help="Use MB or GB, for example 200 MB."
                  error={
                    ebookSize && !parseSizeLimit(ebookSize)
                      ? 'Enter a size in MB or GB.'
                      : undefined
                  }
                  value={ebookSize}
                  onChangeText={setEbookSize}
                />
              </View>
              <View className="min-w-0 flex-1">
                <Field
                  label="Maximum audiobook size"
                  help="Use MB or GB, for example 5 GB."
                  error={
                    audiobookSize && !parseSizeLimit(audiobookSize)
                      ? 'Enter a size in MB or GB.'
                      : undefined
                  }
                  value={audiobookSize}
                  onChangeText={setAudiobookSize}
                />
              </View>
            </View>
            <View className="gap-4 sm:flex-row">
              <View className="min-w-0 flex-1">
                <Field
                  label="Allowed ebook formats"
                  help="Comma-separated, for example epub, pdf."
                  error={
                    ebookFormats && !validFormats(parseFormats(ebookFormats))
                      ? 'Use simple format names separated by commas.'
                      : undefined
                  }
                  value={ebookFormats}
                  autoCapitalize="none"
                  onChangeText={setEbookFormats}
                />
              </View>
              <View className="min-w-0 flex-1">
                <Field
                  label="Allowed audiobook formats"
                  help="Comma-separated, for example m4b, mp3."
                  error={
                    audiobookFormats && !validFormats(parseFormats(audiobookFormats))
                      ? 'Use simple format names separated by commas.'
                      : undefined
                  }
                  value={audiobookFormats}
                  autoCapitalize="none"
                  onChangeText={setAudiobookFormats}
                />
              </View>
            </View>
            <View className="gap-4 sm:flex-row">
              <View className="min-w-0 flex-1">
                <Field
                  label="Preferred language"
                  help="A language code such as en or en-us."
                  error={
                    preferredLanguage && !validPolicyToken(preferredLanguage.toLowerCase())
                      ? 'Use a language code such as en or en-us.'
                      : undefined
                  }
                  value={preferredLanguage}
                  autoCapitalize="none"
                  onChangeText={setPreferredLanguage}
                />
              </View>
              <View className="min-w-0 flex-1">
                <Field
                  label="Maximum active requests per member"
                  help="A whole number from 1 to 100."
                  error={
                    maxActiveRequests &&
                    (!Number.isInteger(Number(maxActiveRequests)) ||
                      Number(maxActiveRequests) < 1 ||
                      Number(maxActiveRequests) > 100)
                      ? 'Enter a whole number from 1 to 100.'
                      : undefined
                  }
                  value={maxActiveRequests}
                  keyboardType="number-pad"
                  onChangeText={setMaxActiveRequests}
                />
              </View>
            </View>
            <Checkbox
              label="Allow abridged audiobooks"
              checked={allowAbridged}
              onPress={() => setAllowAbridged((current) => !current)}
            />
            <View className="self-start">
              <Button
                label="Save acquisition policy"
                kind="primary"
                loading={policyBusy}
                disabled={!policy || sources.length === 0}
                onPress={() => void savePolicy()}
              />
            </View>
          </View>
        )}
      </Dialog>
      <Dialog visible={panel === 'settings'} title="Library settings" onClose={closePanel}>
        <View className={shared.form}>
          <Field label="Library name" value={name} onChangeText={setName} />
          <View className="self-start">
            <Button
              label="Save changes"
              kind="primary"
              disabled={!name.trim()}
              onPress={saveName}
            />
          </View>
          <View className="mt-4 gap-2 border-t border-line pt-4">
            <Text className="text-sm font-sans-bold text-ink">Delete library</Text>
            <Text className={shared.itemMeta}>
              The library must contain no works before it can be deleted.
            </Text>
            <View className="self-start">
              <Button
                label="Delete library"
                kind="danger"
                onPress={() => setConfirmingDelete(true)}
              />
            </View>
          </View>
        </View>
      </Dialog>
      <ConfirmDialog
        visible={Boolean(removeTarget)}
        onClose={() => setRemoveTarget(null)}
        onConfirm={() => void confirmRemoveMember()}
        title="Remove member?"
        description={`${
          removeTarget?.display_name || removeTarget?.username
        } will lose access to this library. They can be re-added later.`}
        confirmLabel="Remove"
        danger
        busy={removingMember}
      />
      <ConfirmDialog
        visible={confirmingDelete}
        onClose={() => setConfirmingDelete(false)}
        onConfirm={() => void confirmDeleteLibrary()}
        title="Delete library?"
        description="This cannot be undone. The library must contain no works before it can be deleted."
        confirmLabel="Delete"
        danger
        busy={deletingLibrary}
      />
    </Page>
  );
}

function RoleControl({ value, onChange }: { value: Role; onChange: (role: Role) => void }) {
  return (
    <View accessibilityRole="radiogroup" className="flex-row flex-wrap gap-1.5">
      {roles.map((item) => (
        <RolePill
          key={item}
          label={item}
          selected={value === item}
          onPress={() => onChange(item)}
        />
      ))}
    </View>
  );
}

function RolePill({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const [focused, setFocused] = useState(false);
  const [pressed, setPressed] = useState(false);
  const borderClass = selected ? 'border-accent bg-accent-soft' : 'border-line-strong bg-paper';
  const textClass = selected ? 'text-accent-strong' : 'text-muted';
  const stateClass = resolvePressStateClass({ focused, pressed });

  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={label}
      onBlur={() => setFocused(false)}
      onFocus={() => setFocused(true)}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      onPress={onPress}
      className={`min-h-11 items-center justify-center rounded-control border px-2.5 py-1.5 ${borderClass} ${stateClass}`}
    >
      <Text className={`text-xs font-sans-bold capitalize ${textClass}`}>{label}</Text>
    </Pressable>
  );
}
