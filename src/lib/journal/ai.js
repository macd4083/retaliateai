export async function generateSummary(content, moodRating, tags) {
  try {
    const response = await fetch('/api/generate-summary', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        content,
        mood_rating: moodRating,
        tags,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to generate summary');
    }

    const data = await response.json();
    return data.summary;
  } catch (error) {
    console.error('Error generating summary:', error);
    throw error;
  }
}

export async function processNewEntry(entry) {
  try {
    const summary = await generateSummary(
      entry.content,
      entry.mood_rating,
      entry.tags
    );
    return { ...entry, summary };
  } catch (error) {
    console.error('Error processing entry:', error);
    // Return entry without summary if AI fails
    return entry;
  }
}