import React, { useState } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { aiWorkflows, insightsHelpers } from '@/lib/ai';
import { userProfileHelpers } from '@/lib/supabase/userProfile';

export default function AITest() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const testEntry = `Today was amazing! I finally completed my first 5K run.  
  I've been training for 3 months and it felt incredible to cross that finish line.  
  My legs are sore but my spirits are high.  I'm proud of myself for sticking with it.`;

  const handleTest = async () => {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      // Test the complete workflow
      const entry = await aiWorkflows.processNewEntry(user.id, {
        title: 'Test Entry - My First 5K',
        content: testEntry,
        mood_rating: 9,
        tags: ['achievement', 'fitness'],
      });

      setResult({
        success: true,
        entry,
        message: 'Entry saved with AI summary and embedding!',
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleGetInsights = async () => {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      // Get user profile
      const profile = await userProfileHelpers.getProfile(user. id);
      
      // Generate insights
      const insights = await insightsHelpers.generateInsights(
        user.id,
        profile?. summary_text || '',
        null
      );

      setResult({
        success: true,
        insights,
        message: 'Insights generated! ',
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleAskQuestion = async () => {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const profile = await userProfileHelpers.getProfile(user.id);
      
      const answer = await insightsHelpers.answerQuestion(
        user.id,
        profile?.summary_text || '',
        'What activities make me feel most accomplished?'
      );

      setResult({
        success: true,
        answer,
        message:  'Question answered!',
      });
    } catch (err) {
      setError(err. message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold text-slate-900 mb-6">AI Test Page</h1>

        <div className="space-y-4 mb-8">
          <button
            onClick={handleTest}
            disabled={loading}
            className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ?  'Processing...' : 'Test: Save Entry with AI'}
          </button>

          <button
            onClick={handleGetInsights}
            disabled={loading}
            className="px-6 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed ml-4"
          >
            {loading ? 'Processing...' : 'Test: Generate Insights'}
          </button>

          <button
            onClick={handleAskQuestion}
            disabled={loading}
            className="px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed ml-4"
          >
            {loading ? 'Processing...' : 'Test: Ask Question'}
          </button>
        </div>

        {error && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg mb-4">
            <p className="text-red-800 font-semibold">Error: </p>
            <p className="text-red-600">{error}</p>
          </div>
        )}

        {result && (
          <div className="p-6 bg-white border border-slate-200 rounded-lg">
            <p className="text-green-600 font-semibold mb-4">{result.message}</p>
            <pre className="bg-slate-50 p-4 rounded overflow-auto text-sm">
              {JSON.stringify(result, null, 2)}
            </pre>
          </div>
        )}

        <div className="mt-8 p-6 bg-slate-50 rounded-lg">
          <h2 className="font-semibold mb-2">Test Entry Content:</h2>
          <p className="text-slate-700">{testEntry}</p>
        </div>
      </div>
    </div>
  );
}