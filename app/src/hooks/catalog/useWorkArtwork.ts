import type { CoverAsset, CoverCandidate, Representation, WorkDetail } from '@/generated/api';
import * as DocumentPicker from 'expo-document-picker';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import type { useWorkManagement } from './useWorkManagement';

export function useWorkArtwork(id: string, management: ReturnType<typeof useWorkManagement>) {
  const { load } = management;

  const [deletingCoverID, setDeletingCoverID] = useState('');
  const [coverFormat, setCoverFormat] = useState<'ebook' | 'audiobook'>('ebook');
  const coverSearchVersion = useRef(0);
  const galleryVersion = useRef(0);
  const initializedWork = useRef('');
  const canonicalDesign = useRef<WorkDetail | undefined>(undefined);
  const [galleryLoading, setGalleryLoading] = useState(true);
  const [galleryError, setGalleryError] = useState('');
  const [searchError, setSearchError] = useState('');
  const [artworkError, setArtworkError] = useState('');
  const [artworkMessage, setArtworkMessage] = useState('');
  const [refreshNeeded, setRefreshNeeded] = useState(false);
  const [coverSearched, setCoverSearched] = useState(false);
  const [coverSearchFormat, setCoverSearchFormat] = useState<'ebook' | 'audiobook'>('ebook');
  const [coverQuery, setCoverQuery] = useState('');
  const [coverCandidates, setCoverCandidates] = useState<CoverCandidate[]>([]);
  const [coverAssets, setCoverAssets] = useState<CoverAsset[]>([]);
  const [searchingCovers, setSearchingCovers] = useState(false);

  const [savingCover, setSavingCover] = useState('');
  const [generatedStyle, setGeneratedStyle] = useState<'classic' | 'minimal' | 'framed'>('classic');
  const [generatedTone, setGeneratedTone] = useState('-1');
  const [generatedLayout, setGeneratedLayout] = useState<'top' | 'center' | 'bottom'>('center');

  const refreshCoverAssets = useCallback(async () => {
    const version = ++galleryVersion.current;
    setGalleryLoading(true);
    setGalleryError('');
    try {
      const assets = await api.covers(id, coverFormat);
      if (version === galleryVersion.current) setCoverAssets(assets);
    } catch (value) {
      if (version === galleryVersion.current) setGalleryError(errorMessage(value));
    } finally {
      if (version === galleryVersion.current) setGalleryLoading(false);
    }
  }, [id, coverFormat]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshCoverAssets();
    return () => {
      galleryVersion.current += 1;
      coverSearchVersion.current += 1;
    };
  }, [refreshCoverAssets]);

  function changeCoverFormat(format: 'ebook' | 'audiobook') {
    if (savingCover || format === coverFormat) return;
    galleryVersion.current += 1;
    coverSearchVersion.current += 1;
    setCoverAssets([]);
    setGalleryLoading(true);
    setGalleryError('');
    setCoverCandidates([]);
    setCoverSearched(false);
    setSearchingCovers(false);
    setSearchError('');
    setArtworkError('');
    setArtworkMessage('');
    setCoverSearchFormat(format);
    setCoverFormat(format);
  }

  function discardCoverSettings() {
    const work = canonicalDesign.current;
    if (!work) return;
    setGeneratedStyle(work.generated_cover_style);
    setGeneratedTone(String(work.generated_cover_tone));
    setGeneratedLayout(work.generated_cover_layout);
  }

  function applyLoadedWork(nextWork: WorkDetail, nextRepresentations: Representation[]) {
    canonicalDesign.current = nextWork;
    if (initializedWork.current === id) return;
    initializedWork.current = id;
    coverSearchVersion.current += 1;
    setCoverCandidates([]);
    setCoverSearched(false);
    setSearchingCovers(false);
    setSearchError('');
    setArtworkError('');
    setArtworkMessage('');
    setCoverQuery(`${nextWork.title} ${nextWork.author || ''}`.trim());
    const format =
      !nextRepresentations.some((item) => item.kind === 'epub') &&
      nextRepresentations.some((item) => item.kind === 'audio' || item.kind === 'audiobook')
        ? 'audiobook'
        : 'ebook';
    changeCoverFormat(format);
    discardCoverSettings();
  }

  async function searchCovers(searchFormat = coverSearchFormat) {
    const version = ++coverSearchVersion.current;
    setCoverSearchFormat(searchFormat);
    setSearchError('');
    setSearchingCovers(true);
    setCoverCandidates([]);
    setCoverSearched(false);
    setArtworkError('');
    try {
      const candidates = await api.searchCovers(id, coverQuery, searchFormat);
      if (version !== coverSearchVersion.current) return;
      setCoverCandidates(
        candidates.filter(
          (candidate) =>
            candidate.source === 'open_library' &&
            (searchFormat !== 'audiobook' || candidate.format === 'audiobook'),
        ),
      );
      setCoverSearched(true);
    } catch (value) {
      if (version === coverSearchVersion.current) setSearchError(errorMessage(value));
    } finally {
      if (version === coverSearchVersion.current) setSearchingCovers(false);
    }
  }

  async function reloadArtwork() {
    management.setError('');
    const [freshWork] = await Promise.all([load(), refreshCoverAssets()]);
    setRefreshNeeded(!freshWork);
    setArtworkError(
      freshWork
        ? ''
        : 'Your change was saved, but the updated cover could not be loaded. Refresh to see it.',
    );
    return freshWork;
  }

  async function chooseCover(candidate: { source: string; source_id: string }) {
    setSavingCover(candidate.source_id);
    setArtworkError('');
    setArtworkMessage('');
    try {
      await api.selectCover(id, candidate.source, candidate.source_id, coverFormat);
      const freshWork = await reloadArtwork();
      if (!freshWork) return false;
      setArtworkMessage('Cover updated.');
      return true;
    } catch (value) {
      setArtworkError(errorMessage(value));
    } finally {
      setSavingCover('');
    }
  }

  async function restoreCover() {
    setSavingCover('restore');
    setArtworkError('');
    setArtworkMessage('');
    try {
      await api.restoreCover(id, coverFormat);
      if (!(await reloadArtwork())) return;
      setArtworkMessage('Automatic artwork restored.');
    } catch (value) {
      setArtworkError(errorMessage(value));
    } finally {
      setSavingCover('');
    }
  }

  async function saveCoverSettings() {
    setSavingCover('settings');
    setArtworkError('');
    setArtworkMessage('');
    try {
      await api.updateCoverSettings(id, {
        fit: 'contain',
        focal_x: 50,
        focal_y: 50,
        style: generatedStyle,
        tone: Number(generatedTone),
        layout: generatedLayout,
      });
      if (!(await reloadArtwork())) return;
      discardCoverSettings();
      setArtworkMessage('Generated design saved.');
    } catch (value) {
      setArtworkError(errorMessage(value));
    } finally {
      setSavingCover('');
    }
  }

  async function deleteCover(coverID: string) {
    setArtworkError('');
    setArtworkMessage('');
    setSavingCover(coverID);
    try {
      await api.deleteCover(id, coverID);
      setDeletingCoverID('');
      if (!(await reloadArtwork())) return;
    } catch (value) {
      setArtworkError(errorMessage(value));
    } finally {
      setSavingCover('');
    }
  }

  async function uploadCover() {
    setSavingCover('upload');
    setArtworkError('');
    setArtworkMessage('');
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: ['image/jpeg', 'image/png'] });
      if (result.canceled) return;
      const asset = result.assets[0];
      const blob = await fetch(asset.uri).then((response) => response.blob());
      await api.uploadCover(id, blob, asset.name, coverFormat);
      if (!(await reloadArtwork())) return;
      setArtworkMessage('Image uploaded and set as the cover.');
    } catch (value) {
      setArtworkError(errorMessage(value));
    } finally {
      setSavingCover('');
    }
  }
  return {
    deletingCoverID,
    setDeletingCoverID,
    coverFormat,
    changeCoverFormat,
    galleryLoading,
    galleryError,
    searchError,
    artworkError,
    artworkMessage,
    refreshNeeded,
    reloadArtwork,
    discardCoverSettings,
    setCoverSearchFormat,
    coverSearched,
    coverSearchFormat,
    setCoverSearched,
    coverQuery,
    setCoverQuery,
    coverCandidates,
    setCoverCandidates,
    coverAssets,
    setCoverAssets,
    searchingCovers,
    setSearchingCovers,
    savingCover,
    setSavingCover,
    generatedStyle,
    setGeneratedStyle,
    generatedTone,
    setGeneratedTone,
    generatedLayout,
    setGeneratedLayout,
    applyLoadedWork,
    searchCovers,
    refreshCoverAssets,
    chooseCover,
    restoreCover,
    saveCoverSettings,
    deleteCover,
    uploadCover,
  };
}
