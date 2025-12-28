import { openai, MODELS } from './openai';

export const embeddingHelpers = {
  /**
   * Generate embedding for text
   * @param {string} text - The text to embed
   * @returns {Promise<number[]>} - The embedding vector
   */
  async generateEmbedding(text) {
    if (!openai) {
      throw new Error('OpenAI client not initialized');
    }

    if (!text || text.trim().length === 0) {
      throw new Error('Text cannot be empty');
    }

    try {
      const response = await openai.embeddings.create({
        model: MODELS.EMBEDDING,
        input: text. trim(),
      });

      return response.data[0].embedding;
    } catch (error) {
      console.error('Error generating embedding:', error);
      throw error;
    }
  },

  /**
   * Generate embeddings for multiple texts in batch
   * @param {string[]} texts - Array of texts to embed
   * @returns {Promise<number[][]>} - Array of embedding vectors
   */
  async generateEmbeddingsBatch(texts) {
    if (!openai) {
      throw new Error('OpenAI client not initialized');
    }

    const validTexts = texts.filter(t => t && t.trim().length > 0);

    if (validTexts.length === 0) {
      throw new Error('No valid texts to embed');
    }

    try {
      const response = await openai.embeddings.create({
        model: MODELS.EMBEDDING,
        input: validTexts.map(t => t.trim()),
      });

      return response. data. map(item => item.embedding);
    } catch (error) {
      console.error('Error generating embeddings batch:', error);
      throw error;
    }
  },

  /**
   * Calculate cosine similarity between two embeddings
   * @param {number[]} a - First embedding
   * @param {number[]} b - Second embedding
   * @returns {number} - Similarity score (0-1)
   */
  cosineSimilarity(a, b) {
    if (a.length !== b.length) {
      throw new Error('Embeddings must have same length');
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  },
};