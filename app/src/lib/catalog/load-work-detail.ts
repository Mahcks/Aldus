import { api } from '@/lib/api';

export async function loadWorkDetail(id: string) {
  const workRequest = api.work(id);
  const representationsRequest = api.representations(id);
  const libraryRequest = workRequest.then((work) => api.library(work.library_id));
  const revisionsRequest = Promise.all([workRequest, representationsRequest]).then(
    async ([work, representations]) =>
      (
        await Promise.all(
          representations.map(async (representation) =>
            (await api.media(work.library_id, representation.id)).map((item) => ({
              ...item,
              representation,
            })),
          ),
        )
      ).flat(),
  );
  const [nextWork, nextLibrary, nextRepresentations, nextJobs, progress, preference, revisions] =
    await Promise.all([
      workRequest,
      libraryRequest,
      representationsRequest,
      api.alignmentJobs(id),
      api.workProgress(id),
      api.workPreference(id),
      revisionsRequest,
    ]);
  return { nextWork, nextLibrary, nextRepresentations, nextJobs, progress, preference, revisions };
}
