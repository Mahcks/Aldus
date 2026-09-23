import { alignmentRunning, useAlignmentPolling } from '@/components/catalog/alignment-progress';
import type { AlignmentJob, GenreTag, Library, Representation, WorkDetail } from '@/generated/api';
import * as DocumentPicker from 'expo-document-picker';
import { useEffect, useState } from 'react';
import { choices, type MediaChoice } from '@/lib/consumption/consumption';
import { api, errorMessage } from '@/lib/api';
import { goBackOr } from '@/lib/navigation';

export function useWorkManagement(
  id: string,
  onLoaded: (work: WorkDetail, representations: Representation[], genres: GenreTag[]) => void,
) {
  const [work, setWork] = useState<WorkDetail>();
  const [library, setLibrary] = useState<Library>();
  const [representations, setRepresentations] = useState<Representation[]>([]);
  const [media, setMedia] = useState<MediaChoice[]>([]);
  const [jobs, setJobs] = useState<AlignmentJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deletingWork, setDeletingWork] = useState(false);
  const [addFileOpen, setAddFileOpen] = useState(false);
  const [addingFile, setAddingFile] = useState(false);
  const [alignmentBusy, setAlignmentBusy] = useState(false);
  const [cancelingJobID, setCancelingJobID] = useState('');
  const [kind, setKind] = useState('epub');
  const [label, setLabel] = useState('');
  const [epubID, setEPUBID] = useState('');
  const [audioID, setAudioID] = useState('');
  const epubs = media.filter((item) => item.kind === 'epub');
  const audio = media.filter((item) => item.kind === 'audio' || item.kind === 'audiobook');
  const selectedEPUB = epubs.find((item) => item.id === epubID);
  const selectedAudio = audio.find((item) => item.id === audioID);
  async function load() {
    if (!id) return;
    try {
      const nextWork = await api.work(id);
      const [nextLibrary, nextRepresentations, nextJobs, nextGenreTags] = await Promise.all([
        api.library(nextWork.library_id),
        api.representations(id),
        api.alignmentJobs(id),
        api.genreTags(),
      ]);
      const revisions = await loadRevisions(nextWork.library_id, nextRepresentations);
      setWork(nextWork);
      setLibrary(nextLibrary);
      setRepresentations(nextRepresentations);
      setMedia(revisions);
      setJobs(nextJobs);
      onLoaded(nextWork, nextRepresentations, nextGenreTags);
      setEPUBID((current) =>
        revisions.some((item) => item.id === current)
          ? current
          : (choices(nextRepresentations, revisions, ['epub'])[0]?.id ?? ''),
      );
      setAudioID((current) =>
        revisions.some((item) => item.id === current)
          ? current
          : (choices(nextRepresentations, revisions, ['audio', 'audiobook'])[0]?.id ?? ''),
      );
      return nextWork;
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

  const progressUnreachable = useAlignmentPolling(id || '', jobs.some(alignmentRunning), setJobs);

  async function addFile() {
    if (addingFile || !label.trim() || !library) return;
    const result = await DocumentPicker.getDocumentAsync({
      type: kind === 'epub' ? 'application/epub+zip' : 'audio/*',
      multiple: false,
    });
    if (result.canceled) return;
    setAddingFile(true);
    setError('');
    let representation: Representation | undefined;
    try {
      representation = await api.createRepresentation(id, { kind, label: label.trim() });
      const asset = result.assets[0];
      const blob = await fetch(asset.uri).then((response) => response.blob());
      await api.uploadMedia(library.id, representation.id, blob, asset.name);
      setLabel('');
      setAddFileOpen(false);
      await load();
    } catch (value) {
      if (representation) {
        try {
          await api.deleteRepresentation(representation.id);
        } catch {
          // The upload may have succeeded before the response was interrupted; keep its data.
        }
      }
      setError(errorMessage(value));
    } finally {
      setAddingFile(false);
    }
  }

  async function enqueue() {
    if (!selectedEPUB || !selectedAudio || alignmentBusy) return;
    setAlignmentBusy(true);
    setError('');
    try {
      const job = await api.enqueueAlignment({
        epub_media_id: selectedEPUB.id,
        epub_sha256: selectedEPUB.sha256,
        audio_media_id: selectedAudio.id,
        audio_sha256: selectedAudio.sha256,
      });
      setJobs((current) => [job, ...current.filter((item) => item.id !== job.id)]);
    } catch (value) {
      setError(errorMessage(value));
    } finally {
      setAlignmentBusy(false);
    }
  }

  async function cancelJob(jobID: string) {
    if (cancelingJobID) return;
    setCancelingJobID(jobID);
    try {
      await api.cancelAlignment(jobID);
      const update = await api.alignmentJob(jobID);
      setJobs((current) => current.map((item) => (item.id === update.id ? update : item)));
    } catch (value) {
      setError(errorMessage(value));
    } finally {
      setCancelingJobID('');
    }
  }

  async function deleteWork() {
    if (!work) return;
    setDeletingWork(true);
    try {
      await api.deleteWork(id);
      goBackOr(`/library/${work.library_id}`);
    } catch (value) {
      setError(errorMessage(value));
      setDeletingWork(false);
    }
  }
  return {
    work,
    setWork,
    library,
    setLibrary,
    representations,
    setRepresentations,
    media,
    setMedia,
    jobs,
    setJobs,
    loading,
    setLoading,
    error,
    setError,
    deletingWork,
    setDeletingWork,
    addFileOpen,
    setAddFileOpen,
    addingFile,
    setAddingFile,
    alignmentBusy,
    setAlignmentBusy,
    cancelingJobID,
    setCancelingJobID,
    kind,
    setKind,
    label,
    setLabel,
    epubID,
    setEPUBID,
    audioID,
    setAudioID,
    epubs,
    audio,
    selectedEPUB,
    selectedAudio,
    progressUnreachable,
    load,
    addFile,
    enqueue,
    cancelJob,
    deleteWork,
  };
}
async function loadRevisions(libraryId: string, representations: Representation[]) {
  const grouped = await Promise.all(
    representations.map(async (representation) =>
      (await api.media(libraryId, representation.id)).map((item) => ({
        ...item,
        representation,
      })),
    ),
  );
  return grouped.flat();
}
