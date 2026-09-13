import { useEffect } from 'react';
import { AppState } from 'react-native';
import type { Work } from '@/generated/api';
import { api } from '@/lib/api';

export function useReadingActivity(work: Work | undefined, mode: 'read' | 'listen') {
  useEffect(() => {
    if (!work) return;
    let sessionID = '';
    let activeSeconds = 0;
    let stopped = false;
    void api
      .startActivity(work.id, { mode })
      .then((session) => {
        sessionID = session.id;
        if (stopped)
          void api.updateActivity(session.id, { active_seconds: activeSeconds, ended: true });
      })
      .catch(() => {});
    const timer = setInterval(() => {
      if (AppState.currentState !== 'active') return;
      activeSeconds += 15;
      if (sessionID)
        void api.updateActivity(sessionID, { active_seconds: activeSeconds, ended: false });
    }, 15_000);
    return () => {
      stopped = true;
      clearInterval(timer);
      if (sessionID)
        void api.updateActivity(sessionID, { active_seconds: activeSeconds, ended: true });
    };
  }, [work, mode]);
}
