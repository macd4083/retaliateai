import { randomUUID } from 'crypto';

const jobs = new Map();

export function createJob(config) {
  const job = {
    id: randomUUID(),
    status: 'queued',
    progress: 0,
    message: 'Queued',
    outputUrl: null,
    createdAt: new Date().toISOString(),
    config,
  };

  jobs.set(job.id, job);
  return job;
}

export function getJob(id) {
  return jobs.get(id) || null;
}

export function updateJob(id, patch) {
  const existing = jobs.get(id);
  if (!existing) return null;

  const updated = { ...existing, ...patch };
  jobs.set(id, updated);
  return updated;
}

export function getAllJobs() {
  return Array.from(jobs.values()).sort((a, b) => {
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}

export function deleteJob(id) {
  return jobs.delete(id);
}
