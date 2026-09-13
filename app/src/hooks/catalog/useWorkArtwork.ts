import type { CoverAsset, CoverCandidate, Representation, WorkDetail } from '@/generated/api';
import * as DocumentPicker from 'expo-document-picker';
import { useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import type { useWorkManagement } from './useWorkManagement';

export function useWorkArtwork(
  id: string,
  management: ReturnType<typeof useWorkManagement>,
  setMetadataMessage: (message: string) => void,
) {
  const { load, setError } = management;

  const [deletingCoverID, setDeletingCoverID] = useState('');
  const [coverFormat, setCoverFormat] = useState<'ebook' | 'audiobook'>('ebook');
  const coverSearchVersion = useRef(0);
  const [coverSearched, setCoverSearched] = useState(false);
  const [coverQuery, setCoverQuery] = useState('');
  const [coverCandidates, setCoverCandidates] = useState<CoverCandidate[]>([]);
  const [coverAssets, setCoverAssets] = useState<CoverAsset[]>([]);
  const [searchingCovers, setSearchingCovers] = useState(false);

  const [savingCover, setSavingCover] = useState('');
  const [generatedStyle, setGeneratedStyle] = useState<'classic' | 'minimal' | 'framed'>('classic');
  const [generatedTone, setGeneratedTone] = useState('-1');
  const [generatedLayout, setGeneratedLayout] = useState<'top' | 'center' | 'bottom'>('center');

  // Artwork is browsed per format — an ebook-only embedded cover has no
  // business showing up while choosing the audiobook cover. Re-fetching on
  // every `coverFormat` switch (not just once on load) is what keeps the
  // "Artwork library" gallery scoped to the active tab.
  useEffect(() => {
    if (!id) return;
    let canceled = false;
    void api
      .covers(id, coverFormat)
      .then((next) => {
        if (!canceled) setCoverAssets(next);
      })
      .catch((value) => {
        if (!canceled) setError(errorMessage(value));
      });
    return () => {
      canceled = true;
    };
  }, [id, coverFormat, setError]);
  function applyLoadedWork(nextWork: WorkDetail, nextRepresentations: Representation[]) {
    setCoverQuery((current) => current || `${nextWork.title} ${nextWork.author || ''}`.trim());
    if (
      !nextRepresentations.some((item) => item.kind === 'epub') &&
      nextRepresentations.some((item) => item.kind === 'audio' || item.kind === 'audiobook')
    )
      setCoverFormat('audiobook');
    setGeneratedStyle(nextWork.generated_cover_style);
    setGeneratedTone(String(nextWork.generated_cover_tone));
    setGeneratedLayout(nextWork.generated_cover_layout);
  }

  async function searchCovers() {
    const version = ++coverSearchVersion.current;
    setSearchingCovers(true);
    setCoverCandidates([]);
    setCoverSearched(false);
    setError('');
    try {
      const candidates = await api.searchCovers(id, coverQuery, coverFormat);
      if (version !== coverSearchVersion.current) return;
      setCoverCandidates(
        candidates.filter(
          (candidate) =>
            candidate.source === 'open_library' &&
            (coverFormat !== 'audiobook' || candidate.format === 'audiobook'),
        ),
      );
      setCoverSearched(true);
    } catch (value) {
      if (version === coverSearchVersion.current) setError(errorMessage(value));
    } finally {
      if (version === coverSearchVersion.current) setSearchingCovers(false);
    }
  }

  /** Re-fetch the artwork gallery for whichever format tab is active — every cover mutation needs this, `load()` alone does not touch it. */
  async function refreshCoverAssets() {
    setCoverAssets(await api.covers(id, coverFormat));
  }

  async function chooseCover(candidate: { source: string; source_id: string }) {
    setSavingCover(candidate.source_id);
    setError('');
    setMetadataMessage('');
    try {
      await api.selectCover(id, candidate.source, candidate.source_id, coverFormat);
      await Promise.all([load(), refreshCoverAssets()]);
      setMetadataMessage('Artwork selected.');
    } catch (value) {
      setError(errorMessage(value));
    } finally {
      setSavingCover('');
    }
  }

  async function restoreCover() {
    setSavingCover('restore');
    setError('');
    setMetadataMessage('');
    try {
      await api.restoreCover(id, coverFormat);
      await Promise.all([load(), refreshCoverAssets()]);
      setMetadataMessage('Automatic format artwork restored.');
    } catch (value) {
      setError(errorMessage(value));
    } finally {
      setSavingCover('');
    }
  }

  async function saveCoverSettings() {
    setSavingCover('settings');
    setError('');
    setMetadataMessage('');
    try {
      await api.updateCoverSettings(id, {
        fit: 'contain',
        focal_x: 50,
        focal_y: 50,
        style: generatedStyle,
        tone: Number(generatedTone),
        layout: generatedLayout,
      });
      await load();
      setMetadataMessage('Artwork settings saved.');
    } catch (value) {
      setError(errorMessage(value));
    } finally {
      setSavingCover('');
    }
  }

  async function deleteCover(coverID: string) {
    setSavingCover(coverID);
    try {
      await api.deleteCover(id, coverID);
      setDeletingCoverID('');
      await Promise.all([load(), refreshCoverAssets()]);
    } catch (value) {
      setError(errorMessage(value));
    } finally {
      setSavingCover('');
    }
  }

  async function uploadCover() {
    const result = await DocumentPicker.getDocumentAsync({ type: ['image/jpeg', 'image/png'] });
    if (result.canceled) return;
    setSavingCover('upload');
    setError('');
    setMetadataMessage('');
    try {
      const asset = result.assets[0];
      const blob = await fetch(asset.uri).then((response) => response.blob());
      await api.uploadCover(id, blob, asset.name, coverFormat);
      await Promise.all([load(), refreshCoverAssets()]);
      setMetadataMessage('Artwork uploaded.');
    } catch (value) {
      setError(errorMessage(value));
    } finally {
      setSavingCover('');
    }
  }
  return {
    deletingCoverID,
    setDeletingCoverID,
    coverFormat,
    setCoverFormat,
    coverSearchVersion,
    coverSearched,
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
