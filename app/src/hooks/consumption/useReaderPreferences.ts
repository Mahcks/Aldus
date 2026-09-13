import { useCallback, useRef, useState } from 'react';
import type {
  ReaderPreferences as ReaderPreferencesDTO,
  RepresentationState,
} from '@/generated/api';
import {
  DEFAULT_READER_PREFERENCES,
  type ReaderPreferences,
} from '@/components/consumption/reader/EPUBReader';
import {
  readerPreferencesUpdate,
  readerSettingsFromDTO,
  readerSettingsFromState,
} from '@/lib/consumption/reader-settings-values';
import { APIError, api, errorMessage } from '@/lib/api';
import { cacheReaderPreferences } from '@/lib/reader-preferences-cache';

export function useReaderPreferences({
  representationID,
  epubState,
  setEPUBState,
  readerInteractionReady,
  setNotice,
}: {
  representationID: string | undefined;
  epubState: RepresentationState | null;
  setEPUBState: (state: RepresentationState | null) => void;
  readerInteractionReady: boolean;
  setNotice: (notice: string) => void;
}) {
  const [readerPreferences, setReaderPreferences] = useState<ReaderPreferences>(
    DEFAULT_READER_PREFERENCES,
  );
  const [readerDefaults, setReaderDefaults] = useState<ReaderPreferences>(
    DEFAULT_READER_PREFERENCES,
  );
  const readerDefaultsRef = useRef<ReaderPreferences>(DEFAULT_READER_PREFERENCES);
  const [readerDefaultsRevision, setReaderDefaultsRevision] = useState(0);
  const [readerCustomized, setReaderCustomized] = useState(false);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const applyReaderDefaults = useCallback((value: ReaderPreferencesDTO) => {
    const next = readerSettingsFromDTO(value);
    readerDefaultsRef.current = next;
    setReaderDefaults(next);
    setReaderDefaultsRevision(value.revision);
  }, []);

  const applyEditionPreferences = useCallback(
    (state: RepresentationState | null, updateCustomization = true) => {
      if (updateCustomization) setReaderCustomized(Boolean(state?.reader_preferences_override));
      setReaderPreferences(readerSettingsFromState(state, readerDefaultsRef.current));
    },
    [],
  );

  async function updateReaderPreferences(next: ReaderPreferences) {
    if (!readerInteractionReady || settingsBusy || (readerCustomized && !representationID)) return;
    setSettingsBusy(true);
    try {
      if (readerCustomized && representationID) {
        const state = await api.updateRepresentationState(representationID, {
          ...readerPreferencesUpdate(next, epubState?.revision ?? 0),
          reader_preferences_override: true,
        });
        setEPUBState(state);
      } else {
        const saved = await api.updateReaderPreferences(
          readerPreferencesUpdate(next, readerDefaultsRevision),
        );
        applyReaderDefaults(saved);
        void cacheReaderPreferences(saved).catch(() => {});
      }
      setReaderPreferences(next);
      setNotice('');
    } catch (error) {
      if (error instanceof APIError && error.status === 409) {
        if (readerCustomized && representationID) {
          const current = await api.representationState(representationID);
          setEPUBState(current);
          setReaderPreferences(readerSettingsFromState(current, readerDefaultsRef.current));
        } else {
          const current = await api.readerPreferences();
          applyReaderDefaults(current);
          setReaderPreferences(readerSettingsFromDTO(current));
          void cacheReaderPreferences(current).catch(() => {});
        }
        setNotice('Reader settings changed on another device. Reloaded the newer settings.');
      } else setNotice(errorMessage(error));
    } finally {
      setSettingsBusy(false);
    }
  }

  async function updateReaderCustomization(customized: boolean) {
    if (
      !readerInteractionReady ||
      !representationID ||
      settingsBusy ||
      customized === readerCustomized
    )
      return;
    setSettingsBusy(true);
    try {
      const state = await api.updateRepresentationState(representationID, {
        ...(customized ? readerPreferencesUpdate(readerPreferences, 0) : {}),
        reader_preferences_override: customized,
        expected_revision: epubState?.revision ?? 0,
      });
      setEPUBState(state);
      setReaderCustomized(customized);
      if (!customized) setReaderPreferences(readerDefaultsRef.current);
      setNotice('');
    } catch (error) {
      if (error instanceof APIError && error.status === 409) {
        const current = await api.representationState(representationID);
        setEPUBState(current);
        setReaderCustomized(Boolean(current?.reader_preferences_override));
        setReaderPreferences(readerSettingsFromState(current, readerDefaultsRef.current));
        setNotice('Reader settings changed on another device. Reloaded the newer settings.');
      } else setNotice(errorMessage(error));
    } finally {
      setSettingsBusy(false);
    }
  }

  return {
    readerPreferences,
    readerDefaults,
    readerCustomized,
    settingsBusy,
    applyReaderDefaults,
    applyEditionPreferences,
    updateReaderPreferences,
    updateReaderCustomization,
  };
}
