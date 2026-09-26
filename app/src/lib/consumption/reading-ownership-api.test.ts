import { afterEach, describe, expect, it, mock } from 'bun:test';

mock.module('react-native', () => ({ Platform: { OS: 'web' } }));
const { api } = await import('../api');
const {
  bindReadingRepresentations,
  clearReadingProof,
  OwnershipSupersededError,
  registerReadingProof,
  subscribeOwnershipLost,
} = await import('./reading-proof');

const originalFetch = globalThis.fetch;

type Sent = { url: string; body: Record<string, unknown> };

function respond(status: number, body: unknown) {
  const sent: Sent[] = [];
  globalThis.fetch = (async (input, init) => {
    sent.push({
      url: String(input),
      body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {},
    });
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  }) as typeof fetch;
  return sent;
}

const progress = {
  alignment_id: 'alignment',
  segment_id: 's1',
  offset: 1,
  expected_revision: 0,
  source_device: 'web',
};

afterEach(() => {
  globalThis.fetch = originalFetch;
  clearReadingProof('work');
  clearReadingProof('other');
});

describe('reading ownership on saves', () => {
  it('stamps the proof on canonical progress saves for the open book only', async () => {
    registerReadingProof('work', { device_id: 'laptop', epoch: 4 });
    const sent = respond(200, { revision: 1 });

    await api.updateWorkProgress('work', progress);
    await api.updateWorkProgress('other', progress);

    expect(sent[0].body.ownership).toEqual({ device_id: 'laptop', epoch: 4 });
    expect(sent[1].body.ownership).toBeUndefined();
  });

  it('keeps an explicit proof rather than overwriting it', async () => {
    registerReadingProof('work', { device_id: 'laptop', epoch: 4 });
    const sent = respond(200, { revision: 1 });

    await api.updateWorkProgress('work', {
      ...progress,
      ownership: { device_id: 'phone', epoch: 9 },
    });

    expect(sent[0].body.ownership).toEqual({ device_id: 'phone', epoch: 9 });
  });

  it('fences position writes on the open book’s representations but not reader settings', async () => {
    registerReadingProof('work', { device_id: 'laptop', epoch: 4 });
    bindReadingRepresentations('work', ['audio-representation']);
    const sent = respond(200, { revision: 1 });

    await api.updateRepresentationState('audio-representation', {
      audio_timestamp_ms: 1000,
      expected_revision: 0,
    });
    await api.updateRepresentationState('audio-representation', {
      playback_speed: 1.25,
      expected_revision: 1,
    });
    await api.updateRepresentationState('someone-elses-representation', {
      audio_timestamp_ms: 1000,
      expected_revision: 0,
    });

    expect(sent[0].body.ownership).toEqual({ device_id: 'laptop', epoch: 4 });
    expect(sent[1].body.ownership).toBeUndefined();
    expect(sent[2].body.ownership).toBeUndefined();
  });

  it('sends nothing extra when this device holds no proof', async () => {
    const sent = respond(200, { revision: 1 });

    await api.updateWorkProgress('work', progress);

    expect('ownership' in sent[0].body).toBe(false);
  });
});

describe('losing the book on a save', () => {
  const owner = {
    work_id: 'work',
    device_id: 'phone',
    label: 'your iPhone',
    platform: 'ios',
    epoch: 5,
    updated_at: '2026-09-25T20:00:00Z',
    idle_seconds: 2,
  };

  it('raises a distinct error, not a revision conflict, and tells the open screen', async () => {
    registerReadingProof('work', { device_id: 'laptop', epoch: 4 });
    respond(409, { code: 'ownership_superseded', owner });
    const lost = mock(() => {});
    const unsubscribe = subscribeOwnershipLost(lost);

    const failure = await api.updateWorkProgress('work', progress).catch((error) => error);

    unsubscribe();
    expect(failure).toBeInstanceOf(OwnershipSupersededError);
    expect((failure as InstanceType<typeof OwnershipSupersededError>).owner?.device_id).toBe(
      'phone',
    );
    expect(lost).toHaveBeenCalledWith('work', owner);
  });

  it('leaves an ordinary revision conflict exactly as it was', async () => {
    registerReadingProof('work', { device_id: 'laptop', epoch: 4 });
    respond(409, { revision: 7 });
    const lost = mock(() => {});
    const unsubscribe = subscribeOwnershipLost(lost);

    const failure = await api.updateWorkProgress('work', progress).catch((error) => error);

    unsubscribe();
    expect(failure).not.toBeInstanceOf(OwnershipSupersededError);
    expect(failure).toMatchObject({ status: 409 });
    expect(lost).not.toHaveBeenCalled();
  });

  it('does not announce a loss for a takeover request', async () => {
    respond(409, { code: 'ownership_superseded', owner });
    const lost = mock(() => {});
    const unsubscribe = subscribeOwnershipLost(lost);

    const failure = await api
      .claimReadingSession('work', {
        device_id: 'laptop',
        label: 'Aldus on the web',
        platform: 'web',
        request_id: 'r',
        expected_epoch: 0,
      })
      .catch((error) => error);

    unsubscribe();
    expect(failure).toBeInstanceOf(OwnershipSupersededError);
    expect(lost).not.toHaveBeenCalled();
  });
});

it('blocks position writes while restoration is pending, including late callbacks after closure', async () => {
  const { pauseReadingProof } = await import('./reading-proof');
  registerReadingProof('work', { device_id: 'laptop', epoch: 4 }, false);
  bindReadingRepresentations('work', ['audio']);
  const sent = respond(200, {});
  await expect(api.updateWorkProgress('work', progress)).rejects.toThrow('paused');
  expect(() =>
    api.updateRepresentationState('audio', { audio_timestamp_ms: 1000, expected_revision: 0 }),
  ).toThrow('paused');
  registerReadingProof('work', { device_id: 'laptop', epoch: 4 });
  pauseReadingProof('work');
  await expect(api.updateWorkProgress('work', progress)).rejects.toThrow('paused');
  expect(sent).toHaveLength(0);
});

it('replays an explicit old credential without consulting the newly blocked registration', async () => {
  registerReadingProof('work', { device_id: 'laptop', epoch: 7 }, false);
  const sent = respond(409, { code: 'ownership_superseded', owner: null });
  await expect(
    api.updateWorkProgress('work', { ...progress, ownership: { device_id: 'laptop', epoch: 4 } }),
  ).rejects.toBeInstanceOf(OwnershipSupersededError);
  expect(sent[0].body.ownership).toEqual({ device_id: 'laptop', epoch: 4 });
});

it('keeps an old edition fenced after the selected representation changes', async () => {
  registerReadingProof('work', { device_id: 'laptop', epoch: 4 });
  bindReadingRepresentations('work', ['old-audio']);
  bindReadingRepresentations('work', ['new-audio']);
  const sent = respond(200, {});
  await api.updateRepresentationState('old-audio', {
    audio_timestamp_ms: 100,
    expected_revision: 1,
  });
  expect(sent[0].body.ownership).toEqual({ device_id: 'laptop', epoch: 4 });
});

it('a rejected old queued proof cannot pause the newer claim', async () => {
  registerReadingProof('work', { device_id: 'phone', epoch: 6 });
  const lost = mock(() => {});
  const unsubscribe = subscribeOwnershipLost(lost);
  try {
    respond(409, { code: 'ownership_superseded', owner: null });
    await expect(
      api.updateWorkProgress('work', { ...progress, ownership: { device_id: 'phone', epoch: 4 } }),
    ).rejects.toBeInstanceOf(OwnershipSupersededError);
    expect(lost).not.toHaveBeenCalled();
    const sent = respond(200, { revision: 2 });
    await api.updateWorkProgress('work', progress);
    expect(sent[0].body.ownership).toEqual({ device_id: 'phone', epoch: 6 });
  } finally {
    unsubscribe();
  }
});
