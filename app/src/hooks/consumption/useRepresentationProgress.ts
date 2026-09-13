import { useEffect, useRef, type RefObject } from 'react';
import { Platform } from 'react-native';
import type { RepresentationState, Work } from '@/generated/api';
import type { MediaChoice } from '@/lib/consumption/consumption';
import { APIError, api, errorMessage } from '@/lib/api';
import { activeStorageScope } from '@/lib/storage-scope';
import {
  offlineWork,
  acknowledgeOfflineRepresentationState,
  reconcileOfflineRepresentationStates,
  updateOfflineRepresentationState,
  type RepresentationConflict,
} from '@/lib/offline-library';

export function useRepresentationProgress({
  work,
  selectedEPUB,
  selectedAudio,
  epubState,
  audioState,
  setEPUBState,
  setAudioState,
  readerLayout,
  defaultPlaybackSpeed,
  readerScope,
  isCurrentReader,
  editionConflictRef,
  showEditionConflict,
  setNotice,
}: {
  work: Work | undefined;
  selectedEPUB: MediaChoice | undefined;
  selectedAudio: MediaChoice | undefined;
  epubState: RepresentationState | null;
  audioState: RepresentationState | null;
  setEPUBState: (state: RepresentationState) => void;
  setAudioState: (state: RepresentationState) => void;
  readerLayout: 'paginated' | 'scrolled';
  defaultPlaybackSpeed: number;
  readerScope: ReturnType<typeof activeStorageScope>;
  isCurrentReader: () => boolean;
  editionConflictRef: RefObject<RepresentationConflict | undefined>;
  showEditionConflict: (conflict: RepresentationConflict) => void;
  setNotice: (notice: string) => void;
}) {
  const epubStateRef = useRef<RepresentationState | null>(null);
  const audioStateRef = useRef<RepresentationState | null>(null);
  useEffect(() => {
    epubStateRef.current = epubState;
  }, [epubState]);

  useEffect(() => {
    audioStateRef.current = audioState;
  }, [audioState]);

  async function saveRepresentation(
    kind: 'epub' | 'audio',
    value: unknown,
    playbackSpeed = defaultPlaybackSpeed || 1,
  ): Promise<'saved' | 'offline' | 'error'> {
    const selected = kind === 'epub' ? selectedEPUB : selectedAudio;
    const saveScope = readerScope;
    if (!selected || !isCurrentReader()) return 'error';
    if (editionConflictRef.current) return 'error';
    // Replay uses the same saved revision as foreground saves. Wait for it and
    // adopt only our acknowledged local cache, never an arbitrary server revision.
    if (Platform.OS !== 'web' && work) {
      try {
        const conflicts = await reconcileOfflineRepresentationStates(work.id);
        if (!isCurrentReader()) return 'error';
        const conflict = conflicts.find((item) => item.kind === kind);
        if (conflict) {
          showEditionConflict(conflict);
          return 'error';
        }
        const stored = await offlineWork(work.id);
        if (!isCurrentReader()) return 'error';
        const cached = kind === 'epub' ? stored?.epub_state : stored?.audio_state;
        const current = kind === 'epub' ? epubStateRef.current : audioStateRef.current;
        if (
          cached?.representation_id === selected.representation.id &&
          cached.revision >= (current?.revision ?? 0)
        ) {
          if (kind === 'epub') epubStateRef.current = cached;
          else audioStateRef.current = cached;
        }
      } catch (error) {
        if (isCurrentReader()) setNotice(errorMessage(error));
        return 'error';
      }
    }
    const state = kind === 'epub' ? epubStateRef.current : audioStateRef.current;
    const local: RepresentationState = {
      ...state,
      representation_id: selected.representation.id,
      revision: state?.revision ?? 0,
      updated_at: new Date().toISOString(),
      ...(kind === 'epub'
        ? { epub_locator: value, reader_layout: readerLayout }
        : { audio_timestamp_ms: value as number, playback_speed: playbackSpeed }),
    };
    let staged = false;
    try {
      if (Platform.OS !== 'web' && work) {
        staged = await updateOfflineRepresentationState(work.id, kind, local, true, saveScope);
        if (!isCurrentReader()) return 'error';
      }
      const next = await api.updateRepresentationState(
        selected.representation.id,
        kind === 'epub'
          ? {
              epub_locator: value,
              reader_layout: readerLayout,
              expected_revision: local.revision,
            }
          : {
              audio_timestamp_ms: value as number,
              playback_speed: playbackSpeed,
              expected_revision: local.revision,
            },
      );
      if (!isCurrentReader()) return 'error';
      if (kind === 'epub') {
        epubStateRef.current = next;
        setEPUBState(next);
      } else {
        audioStateRef.current = next;
        setAudioState(next);
      }
      if (work) {
        if (staged) {
          await acknowledgeOfflineRepresentationState(work.id, kind, local, next, true, saveScope);
        } else {
          await updateOfflineRepresentationState(work.id, kind, next, false, saveScope).catch(
            () => false,
          );
        }
      }
      return 'saved';
    } catch (error) {
      if (error instanceof APIError && error.status === 409 && work && isCurrentReader()) {
        try {
          const remote = await api.representationState(selected.representation.id);
          if (!isCurrentReader() || !remote) return 'error';
          if (!staged) {
            await updateOfflineRepresentationState(work.id, kind, local, true, saveScope).catch(
              () => false,
            );
          }
          showEditionConflict({ workID: work.id, kind, local, remote });
        } catch (refreshError) {
          setNotice(errorMessage(refreshError));
        }
        return 'error';
      }
      if (error instanceof APIError && error.status === 0 && work && isCurrentReader()) {
        const stored =
          staged ||
          (await updateOfflineRepresentationState(work.id, kind, local, true, saveScope).catch(
            () => false,
          ));
        if (stored) {
          if (kind === 'epub') {
            epubStateRef.current = local;
            setEPUBState(local);
          } else {
            audioStateRef.current = local;
            setAudioState(local);
          }
          return 'offline';
        }
      } else setNotice(errorMessage(error));
      return 'error';
    }
  }

  return { epubStateRef, audioStateRef, saveRepresentation };
}
