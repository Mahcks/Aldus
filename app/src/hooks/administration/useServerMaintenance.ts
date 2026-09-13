import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import type { BackupArchive, SystemDiagnostics } from '@/generated/api';
import { api, errorMessage } from '@/lib/api';

export function useServerMaintenance() {
  const [report, setReport] = useState<SystemDiagnostics>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [backups, setBackups] = useState<BackupArchive[]>([]);
  const [backupError, setBackupError] = useState('');
  const [backupMessage, setBackupMessage] = useState('');
  const [backupsLoading, setBackupsLoading] = useState(true);
  const [creatingBackup, setCreatingBackup] = useState(false);
  const [deletingBackup, setDeletingBackup] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<BackupArchive>();

  async function refresh() {
    setLoading(true);
    setError('');
    try {
      const [nextReport, nextBackups] = await Promise.all([api.systemDiagnostics(), api.backups()]);
      setReport(nextReport);
      setBackups(nextBackups);
      setBackupError('');
    } catch (value) {
      setError(errorMessage(value));
    } finally {
      setLoading(false);
      setBackupsLoading(false);
    }
  }

  async function createBackup() {
    setCreatingBackup(true);
    setBackupError('');
    setBackupMessage('');
    try {
      const archive = await api.createBackup();
      setBackups((current) => [archive, ...current]);
      setBackupMessage('Backup created and verified.');
    } catch (value) {
      setBackupError(errorMessage(value));
    } finally {
      setCreatingBackup(false);
    }
  }

  async function downloadBackup(archive: BackupArchive) {
    setBackupError('');
    try {
      saveBlob(await api.downloadBackup(archive.name), archive.name);
    } catch (value) {
      setBackupError(errorMessage(value));
    }
  }

  async function deleteBackup() {
    if (!deleteTarget) return;
    setDeletingBackup(true);
    setBackupError('');
    try {
      await api.deleteBackup(deleteTarget.name);
      setBackups((current) => current.filter((archive) => archive.name !== deleteTarget.name));
      setDeleteTarget(undefined);
    } catch (value) {
      setBackupError(errorMessage(value));
    } finally {
      setDeletingBackup(false);
    }
  }

  function downloadDiagnostics() {
    if (!report || Platform.OS !== 'web') return;
    const date = new Date().toISOString().slice(0, 10);
    saveBlob(
      new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }),
      `aldus-diagnostics-${date}.json`,
    );
  }

  useEffect(() => {
    let active = true;
    void api
      .systemDiagnostics()
      .then((value) => active && setReport(value))
      .catch((value) => active && setError(errorMessage(value)))
      .finally(() => active && setLoading(false));
    void api
      .backups()
      .then((value) => active && setBackups(value))
      .catch((value) => active && setBackupError(errorMessage(value)))
      .finally(() => active && setBackupsLoading(false));
    return () => {
      active = false;
    };
  }, []);

  return {
    report,
    loading,
    error,
    backups,
    backupError,
    backupMessage,
    backupsLoading,
    creatingBackup,
    deletingBackup,
    deleteTarget,
    setDeleteTarget,
    refresh,
    createBackup,
    downloadBackup,
    deleteBackup,
    downloadDiagnostics,
  };
}

function saveBlob(blob: Blob, filename: string) {
  if (Platform.OS !== 'web') return;
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
