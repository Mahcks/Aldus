import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import type { AlignmentGpuStatus } from '@/generated/api';

export type { AlignmentGpuStatus } from '@/generated/api';
export type GpuTestState = AlignmentGpuStatus['gpuTest']['state'];
export type AlignmentReadiness = AlignmentGpuStatus['alignment']['readiness'];

const NOT_CHECKED: AlignmentGpuStatus = {
  accelerator: 'unknown',
  acceleratorLabel: 'Not checked',
  detectedGpu: 'Not checked',
  gpuTest: { state: 'not_checked' },
  alignment: { readiness: 'unknown', issues: [] },
  lastCheckedAt: null,
};

export function useAlignmentGpuStatus(enabled: boolean) {
  const [status, setStatus] = useState<AlignmentGpuStatus>(NOT_CHECKED);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const pending = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    const request = ++generation.current;
    void api
      .alignmentGpuStatus()
      .then((value) => {
        if (request === generation.current) setStatus(value);
      })
      .catch((value) => {
        if (request === generation.current) setError(errorMessage(value));
      });
    return () => {
      // Invalidate requests, including a test started after the initial fetch.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      generation.current++;
    };
  }, [enabled]);

  const testGpu = useCallback(async () => {
    if (!enabled || pending.current) return;
    pending.current = true;
    const request = ++generation.current;
    setChecking(true);
    setError('');
    try {
      const next = await api.testAlignmentGpu();
      if (request === generation.current) setStatus(next);
    } catch (value) {
      if (request === generation.current) setError(errorMessage(value));
    } finally {
      pending.current = false;
      if (request === generation.current) setChecking(false);
    }
  }, [enabled]);

  return {
    status: checking
      ? {
          ...status,
          gpuTest: { state: 'checking' as const },
          alignment: { readiness: 'unknown' as const, issues: [] },
        }
      : status,
    checking,
    error,
    testGpu,
  };
}
