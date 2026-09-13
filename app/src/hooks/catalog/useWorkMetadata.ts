import { seriesPositionError } from '@/lib/catalog/catalog-metadata';
import type { GenreTag, WorkDetail } from '@/generated/api';
import { useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import type { useWorkManagement } from './useWorkManagement';

export function useWorkMetadata(
  id: string,
  management: ReturnType<typeof useWorkManagement>,
  refreshCoverAssets: () => Promise<void>,
  setMetadataMessage: (message: string) => void,
) {
  const { work, setWork, load, setError } = management;

  const [savingDetails, setSavingDetails] = useState(false);
  const [savingGenres, setSavingGenres] = useState(false);
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [description, setDescription] = useState('');
  const [isbn, setISBN] = useState('');
  const [publishYear, setPublishYear] = useState('');
  const [series, setSeries] = useState('');
  const [seriesPosition, setSeriesPosition] = useState('');
  const [publisher, setPublisher] = useState('');
  const [language, setLanguage] = useState('');
  const [subjects, setSubjects] = useState('');
  const [allGenreTags, setAllGenreTags] = useState<GenreTag[]>([]);
  const [genreMode, setGenreMode] = useState<'automatic' | 'manual'>('automatic');
  const [selectedGenreIDs, setSelectedGenreIDs] = useState<string[]>([]);
  const [refreshingMetadata, setRefreshingMetadata] = useState(false);
  const detailsDirty = Boolean(
    work &&
    (title !== work.title ||
      author !== (work.author || '') ||
      description !== (work.description || '') ||
      isbn !== (work.isbn || '') ||
      publisher !== (work.publisher || '') ||
      language !== (work.language || '') ||
      publishYear !== (work.first_publish_year ? String(work.first_publish_year) : '') ||
      subjects !== (work.subject_values ?? []).join('\n') ||
      series !== (work.series || '') ||
      seriesPosition !== (work.series_position || '')),
  );
  function applyLoadedWork(nextWork: WorkDetail, nextGenreTags: GenreTag[]) {
    setTitle(nextWork.title);
    setAuthor(nextWork.author || '');
    setDescription(nextWork.description || '');
    setISBN(nextWork.isbn || '');
    setPublishYear(nextWork.first_publish_year ? String(nextWork.first_publish_year) : '');
    setPublisher(nextWork.publisher || '');
    setSeries(nextWork.series || '');
    setSeriesPosition(nextWork.series_position || '');
    setLanguage(nextWork.language || '');
    setSubjects((nextWork.subject_values ?? []).join('\n'));
    setAllGenreTags(nextGenreTags);
    setGenreMode(nextWork.genre_tags_manual ? 'manual' : 'automatic');
    setSelectedGenreIDs(nextWork.genre_tags.map((tag) => tag.id));
  }

  async function saveWorkSettings() {
    if (savingDetails || !title.trim()) return;
    const year = publishYear.trim() ? Number(publishYear) : 0;
    if (!Number.isInteger(year) || year < 0 || year > 9999) {
      setError('Publication year must be a four-digit year.');
      return;
    }
    if (seriesPositionError(seriesPosition)) return;
    setSavingDetails(true);
    setError('');
    setMetadataMessage('');
    try {
      await api.updateWork(id, {
        title,
        author,
        description,
        isbn,
        first_publish_year: year,
        publisher,
        language,
        ...(series !== (work?.series || '') || seriesPosition !== (work?.series_position || '')
          ? { series, series_position: seriesPosition }
          : {}),
        subjects: subjects
          .split('\n')
          .map((subject) => subject.trim())
          .filter(Boolean),
      });
      await load();
      setMetadataMessage('Book details saved.');
    } catch (value) {
      setError(errorMessage(value));
    } finally {
      setSavingDetails(false);
    }
  }

  async function saveGenres() {
    if (savingGenres) return;
    setSavingGenres(true);
    setError('');
    setMetadataMessage('');
    try {
      if (genreMode === 'manual') await api.setWorkGenreTags(id, selectedGenreIDs);
      else await api.resetWorkGenreTags(id);
      const nextWork = await api.work(id);
      setWork(nextWork);
      setGenreMode(nextWork.genre_tags_manual ? 'manual' : 'automatic');
      setSelectedGenreIDs(nextWork.genre_tags.map((tag) => tag.id));
      setMetadataMessage('Genres saved.');
    } catch (value) {
      setError(errorMessage(value));
    } finally {
      setSavingGenres(false);
    }
  }

  function toggleGenre(tagID: string) {
    setSelectedGenreIDs((current) =>
      current.includes(tagID) ? current.filter((id) => id !== tagID) : [...current, tagID],
    );
  }

  async function metadataApplied() {
    await load();
    setMetadataMessage('Selected book details updated.');
  }

  async function refreshMetadata() {
    setRefreshingMetadata(true);
    setMetadataMessage('');
    setError('');
    try {
      const nextWork = await api.refreshWorkMetadata(id);
      setWork(nextWork);
      setDescription(nextWork.description || '');
      setISBN(nextWork.isbn || '');
      setPublishYear(nextWork.first_publish_year ? String(nextWork.first_publish_year) : '');
      setPublisher(nextWork.publisher || '');
      setSeries(nextWork.series || '');
      setSeriesPosition(nextWork.series_position || '');
      setLanguage(nextWork.language || '');
      setSubjects((nextWork.subject_values ?? []).join('\n'));
      await refreshCoverAssets();
      setMetadataMessage('Missing details and artwork were refreshed.');
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setRefreshingMetadata(false);
    }
  }
  return {
    savingDetails,
    setSavingDetails,
    savingGenres,
    setSavingGenres,
    title,
    setTitle,
    author,
    setAuthor,
    description,
    setDescription,
    isbn,
    setISBN,
    publishYear,
    setPublishYear,
    series,
    setSeries,
    seriesPosition,
    setSeriesPosition,
    publisher,
    setPublisher,
    language,
    setLanguage,
    subjects,
    setSubjects,
    allGenreTags,
    setAllGenreTags,
    genreMode,
    setGenreMode,
    selectedGenreIDs,
    setSelectedGenreIDs,
    refreshingMetadata,
    setRefreshingMetadata,
    detailsDirty,
    applyLoadedWork,
    saveWorkSettings,
    saveGenres,
    toggleGenre,
    metadataApplied,
    refreshMetadata,
  };
}
