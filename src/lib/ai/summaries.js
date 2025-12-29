export const summaryHelpers = {
  async summarizeEntry(content) {
    const response = await fetch('/api/generate-summary', {
      method:  'POST',
      headers:  { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to generate summary');
    }

    const data = await response.json();
    return data.summary;
  },

  async updateUserSummary(currentSummary, newEntry) {
    const response = await fetch('/api/update-user-summary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentSummary, newEntry }),
    });

    if (!response.ok) {
      const error = await response. json();
      throw new Error(error.error || 'Failed to update user summary');
    }

    return await response.json();
  },
};