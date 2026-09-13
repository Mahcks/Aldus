type Cleanup = () => Promise<unknown>;

export async function deleteAccountAndClearState(
  deleteFromServer: () => Promise<unknown>,
  cleanups: Cleanup[],
  finalize: () => void,
) {
  await deleteFromServer();

  const results = await Promise.allSettled(
    cleanups.map((cleanup) => Promise.resolve().then(cleanup)),
  );
  for (const result of results) {
    if (result.status === 'rejected') {
      console.warn('Failed to clear local data after account deletion.', result.reason);
    }
  }

  finalize();
  return results.every((result) => result.status === 'fulfilled');
}
