const API_BASE = import.meta.env.VITE_EXPORT_API_URL || 'http://localhost:3001';

async function parseResponse(response) {
  if (!response.ok) {
    let error = 'Request failed';
    try {
      const data = await response.json();
      error = data.error || error;
    } catch {
      // No-op
    }
    throw new Error(error);
  }

  return response.json();
}

export const videoExportApi = {
  startExport: async (config) => {
    const response = await fetch(`${API_BASE}/api/video-export/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });

    return parseResponse(response);
  },

  getJobs: async () => {
    const response = await fetch(`${API_BASE}/api/video-export/jobs`);
    return parseResponse(response);
  },

  deleteJob: async (jobId) => {
    const response = await fetch(`${API_BASE}/api/video-export/jobs/${jobId}`, {
      method: 'DELETE',
    });

    return parseResponse(response);
  },

  createProgressStream: (jobId, onMessage, onError) => {
    const es = new EventSource(`${API_BASE}/api/video-export/progress/${jobId}`);

    es.onmessage = (event) => {
      onMessage(JSON.parse(event.data));
    };

    es.onerror = onError;

    return es;
  },
};
