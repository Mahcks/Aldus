import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import type { AudioPlayer } from 'expo-audio';
import {
  sleepTimerDeadline as deadlineForSleepTimer,
  sleepTimerRemainingSeconds,
} from '@/lib/consumption/consumption';

export function useSleepTimer(
  player: AudioPlayer,
  currentTime: number,
  setNotice: (message: string) => void,
) {
  const [sleepTimerOpen, setSleepTimerOpen] = useState(false);
  const [sleepTimerDeadline, setSleepTimerDeadline] = useState<number>();
  const [sleepTimerRemaining, setSleepTimerRemaining] = useState<number>();
  const [sleepTimerMinutes, setSleepTimerMinutes] = useState<number>();
  const sleepTimerExpired = useRef(false);
  const finishSleepTimer = useCallback(() => {
    if (sleepTimerExpired.current) return;
    sleepTimerExpired.current = true;
    player.pause();
    setSleepTimerDeadline(undefined);
    setSleepTimerRemaining(undefined);
    setSleepTimerMinutes(undefined);
    setSleepTimerOpen(false);
    setNotice('Sleep timer ended.');
  }, [player, setNotice]);

  useEffect(() => {
    if (sleepTimerDeadline == null) return;

    function updateSleepTimer() {
      const remaining = sleepTimerRemainingSeconds(sleepTimerDeadline);
      setSleepTimerRemaining(remaining);
      if (remaining === 0) finishSleepTimer();
    }

    const timer = setInterval(updateSleepTimer, 1_000);
    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') updateSleepTimer();
    });
    return () => {
      clearInterval(timer);
      appStateSubscription.remove();
    };
  }, [finishSleepTimer, sleepTimerDeadline]);

  useEffect(() => {
    if (sleepTimerDeadline == null || sleepTimerRemainingSeconds(sleepTimerDeadline) !== 0) return;
    const timer = setTimeout(finishSleepTimer, 0);
    return () => clearTimeout(timer);
  }, [finishSleepTimer, sleepTimerDeadline, currentTime]);

  function setSleepTimer(minutes?: number) {
    sleepTimerExpired.current = false;
    setSleepTimerDeadline(deadlineForSleepTimer(minutes));
    setSleepTimerRemaining(minutes == null ? undefined : minutes * 60);
    setSleepTimerMinutes(minutes);
    setSleepTimerOpen(false);
  }
  return {
    sleepTimerOpen,
    setSleepTimerOpen,
    sleepTimerDeadline,
    sleepTimerRemaining,
    sleepTimerMinutes,
    setSleepTimer,
  };
}
