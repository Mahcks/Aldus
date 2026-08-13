import type { Library } from '../../generated/api';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { AppActions } from '../../features/shell/AppHeader';
import { Button, Empty, Field, Loading, Notice, Page, Section, shared } from '../../features/ui';
import { api, errorMessage } from '../../lib/api';

export default function Libraries() {
  const [items, setItems] = useState<Library[]>([]); const [name, setName] = useState(''); const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function load() { try { setItems(await api.libraries()); } catch (value) { setError(errorMessage(value)); } finally { setLoading(false); } }
  // Data loading is the external synchronization this effect owns.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, []);
  async function create() { setBusy(true); setError(''); try { const library = await api.createLibrary({ name }); setName(''); router.push(`/library/${library.id}`); } catch (value) { setError(errorMessage(value)); } finally { setBusy(false); } }
  return <Page title="Libraries" actions={<AppActions />}>{error ? <Notice danger>{error}</Notice> : null}<Section title="Your libraries">{loading ? <Loading /> : items.length === 0 ? <Empty>No libraries yet. Create one to begin.</Empty> : items.map((item) => <Pressable accessibilityRole="link" key={item.id} style={shared.listItem} onPress={() => router.push(`/library/${item.id}`)}><Text style={shared.itemTitle}>{item.name}</Text><Text style={shared.itemMeta}>{item.role || 'Administrator access'}</Text></Pressable>)}</Section><Section title="Create library"><View style={shared.form}><Field label="Library name" value={name} onChangeText={setName} onSubmitEditing={create} /><Button label={busy ? 'Creating…' : 'Create library'} kind="primary" disabled={busy || !name.trim()} onPress={create} /></View></Section></Page>;
}
