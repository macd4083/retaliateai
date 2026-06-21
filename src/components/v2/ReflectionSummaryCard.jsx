import React from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * ReflectionSummaryCard
 *
 * Shared summary card shown at the end of a reflection session.
 * Extracted from ReflectionV2 so it can be composed into the post-session
 * conversion page without duplicating markup or logic.
 *
 * Props:
 *   data               – extracted session data (win_text, miss_text, tomorrow_commitment, …)
 *   streak             – current reflection streak count
 *   followThroughStats – { kept, total, trajectory } or null
 *   showInsightsLink   – whether to render the "→ View Insights" button (default: true)
 */
export default function ReflectionSummaryCard({ data, streak, followThroughStats, showInsightsLink = true }) {
  const navigate = useNavigate();

  let followThroughLine = null;
  let followThroughEmoji = null;
  if (followThroughStats && followThroughStats.total >= 3) {
    const { kept, total, trajectory } = followThroughStats;
    const rate = kept / total;
    if (rate >= 0.7) {
      followThroughLine = `You've kept ${kept} of your last ${total} commitments. That's your highest stretch yet.`;
      followThroughEmoji = '✅';
    } else if (trajectory === 'improving') {
      followThroughLine = `${kept} of ${total} this week. You're trending up — keep it going.`;
      followThroughEmoji = '📈';
    } else if (rate >= 0.4) {
      followThroughLine = `${kept} of ${total} this week. You're in a building phase — that's real.`;
      followThroughEmoji = '📈';
    } else {
      followThroughLine = `${kept} of ${total} this week. Let's make the next one smaller and easier to nail.`;
      followThroughEmoji = '🎯';
    }
  }

  return (
    <div className="bg-zinc-800 border border-zinc-600 rounded-2xl p-5 my-2 shadow-lg">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-lg">🎯</span>
        <span className="text-white font-semibold">Tonight's Takeaways</span>
      </div>
      <div className="border-t border-zinc-600 pt-4 space-y-3">
        {data.win_text && (
          <div className="flex items-start gap-2">
            <span className="text-green-400 mt-0.5">✅</span>
            <div>
              <span className="text-zinc-400 text-xs">Win</span>
              <p className="text-white text-sm">{data.win_text}</p>
            </div>
          </div>
        )}
        {data.miss_text && (
          <div className="flex items-start gap-2">
            <span className="text-yellow-400 mt-0.5">💡</span>
            <div>
              <span className="text-zinc-400 text-xs">Honest truth</span>
              <p className="text-white text-sm">{data.miss_text}</p>
            </div>
          </div>
        )}
        {data.tomorrow_commitment && (
          <>
            {!data.commitment_minimum && !data.commitment_stretch && (
              <div className="flex items-start gap-2">
                <span className="text-blue-400 mt-0.5">📋</span>
                <div>
                  <span className="text-zinc-400 text-xs">Tomorrow</span>
                  <p className="text-white text-sm">{data.tomorrow_commitment}</p>
                </div>
              </div>
            )}
          </>
        )}
        {data.commitment_minimum && (
          <div className="flex items-start gap-2">
            <span className="text-blue-400 mt-0.5">🎯</span>
            <div>
              <span className="text-zinc-400 text-xs">Minimum</span>
              <p className="text-white text-sm">{data.commitment_minimum}</p>
            </div>
          </div>
        )}
        {data.commitment_stretch && (
          <div className="flex items-start gap-2">
            <span className="text-purple-400 mt-0.5">🚀</span>
            <div>
              <span className="text-zinc-400 text-xs">Stretch</span>
              <p className="text-white text-sm">{data.commitment_stretch}</p>
            </div>
          </div>
        )}
        {streak > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-red-400">🔥</span>
            <p className="text-white text-sm font-medium">
              {streak} night{streak !== 1 ? 's' : ''} in a row
            </p>
          </div>
        )}
        {followThroughStats && followThroughStats.total >= 3 && followThroughLine && (
          <div className="flex items-center gap-2">
            <span>{followThroughEmoji}</span>
            <p className="text-white text-sm">{followThroughLine}</p>
          </div>
        )}
      </div>
      <p className="text-zinc-500 text-xs mt-4 text-center italic">
        You're building the identity of someone who shows up.
      </p>
      {showInsightsLink && (
        <div className="flex sm:justify-end justify-center mt-3">
          <button
            onClick={() => navigate('/insights')}
            className="text-sm text-zinc-400 hover:text-white border border-zinc-700 hover:border-zinc-500 rounded-lg px-3 py-1.5 transition-colors"
          >
            → View Insights
          </button>
        </div>
      )}
    </div>
  );
}
