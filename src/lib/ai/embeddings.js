export const embeddingHelpers = {
  async generateEmbedding(content) {
    const response = await fetch('/api/generate-embedding', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to generate embedding');
    }

    const data = await response.json();
    return data.embedding;
  },
};