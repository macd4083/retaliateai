import React, { useState, useEffect } from 'react';
import { Sparkles, TrendingUp, TrendingDown, Minus, AlertCircle, CheckCircle2, Target } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';

export default function Insights() {
  const { user } = useAuth();
  const [patterns, setPatterns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState('');
  const [topActions, setTopActions] = useState([]);

  useEffect(() => {
    loadInsights();
  }, [user]);

  const loadInsights = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/detect-patterns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: user.id }),
      });

      const data = await response.json();
      setPatterns(data.patterns || []);
      setSummary(data.overall_summary || '');
      setTopActions(data.top_3_actions || []);
    } catch (error) {
      console.error('Failed to load insights:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-violet-600 mx-auto mb-4"></div>
          <p className="text-slate-600">Analyzing your patterns...</p>
        </div>
      </div>
    );
  }

  if (patterns.length === 0) {
    return (
      <div className="h-full overflow-y-auto bg-slate-50 p-8">
        <div className="max-w-4xl mx-auto">
          <div className="bg-white rounded-lg border border-slate-200 p-8 text-center">
            <Sparkles className="w-12 h-12 text-slate-400 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-slate-900 mb-2">Not enough data yet</h2>
            <p className="text-slate-600">Keep journaling!  We'll start detecting patterns after a few entries.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-slate-50">
      <div className="max-w-6xl mx-auto p-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-slate-900 flex items-center gap-3 mb-2">
            <Sparkles className="w-8 h-8 text-violet-600" />
            Insights
          </h1>
          <p className="text-slate-600">Patterns and recommendations from your journal</p>
        </div>

        {/* Overall Summary */}
        {summary && (
          <div className="bg-gradient-to-br from-violet-50 to-purple-50 border border-violet-200 rounded-xl p-6 mb-8">
            <h2 className="text-lg font-semibold text-violet-900 mb-2">Your Current State</h2>
            <p className="text-slate-700">{summary}</p>
          </div>
        )}

        {/* Top Actions */}
        {topActions.length > 0 && (
          <div className="bg-white rounded-xl border border-slate-200 p-6 mb-8">
            <div className="flex items-center gap-2 mb-4">
              <Target className="w-5 h-5 text-blue-600" />
              <h2 className="text-lg font-semibold text-slate-900">Top 3 Actions to Take</h2>
            </div>
            <div className="space-y-3">
              {topActions.map((action, i) => (
                <div key={i} className="flex items-start gap-3 p-3 bg-blue-50 rounded-lg">
                  <div className="w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center text-sm font-semibold flex-shrink-0">
                    {i + 1}
                  </div>
                  <p className="text-slate-800">{action}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Patterns Grid */}
        <div className="mb-6">
          <h2 className="text-xl font-semibold text-slate-900 mb-4">Detected Patterns</h2>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          {patterns.map((pattern, i) => (
            <PatternCard key={i} pattern={pattern} />
          ))}
        </div>
      </div>
    </div>
  );
}

function PatternCard({ pattern }) {
  const typeConfig = {
    theme: { color: 'blue', icon:  Sparkles, label: 'Theme' },
    emotion: { color: 'purple', icon:  Sparkles, label: 'Emotion' },
    behavior: { color: 'green', icon: CheckCircle2, label: 'Behavior' },
    blocker: { color: 'red', icon: AlertCircle, label:  'Blocker' },
    strength: { color: 'emerald', icon: CheckCircle2, label: 'Strength' },
  };

  const trendIcons = {
    increasing: TrendingUp,
    stable:  Minus,
    decreasing: TrendingDown,
  };

  const config = typeConfig[pattern.type] || typeConfig.theme;
  const TypeIcon = config.icon;
  const TrendIcon = trendIcons[pattern.trend] || Minus;

  const trendColors = {
    increasing: pattern.sentiment > 0 ? 'text-green-600' : 'text-red-600',
    stable: 'text-slate-600',
    decreasing:  pattern.sentiment > 0 ? 'text-red-600' : 'text-green-600',
  };

  return (
    <div className="bg-white rounded-lg border border-slate-200 p-6 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className={`p-2 bg-${config.color}-50 rounded-lg`}>
            <TypeIcon className={`w-5 h-5 text-${config.color}-600`} />
          </div>
          <div>
            <span className={`text-xs font-medium text-${config.color}-700`}>{config.label}</span>
            <h3 className="text-lg font-semibold text-slate-900 capitalize">
              {pattern.name. replace(/-/g, ' ')}
            </h3>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <TrendIcon className={`w-5 h-5 ${trendColors[pattern.trend]}`} />
          <span className="text-sm text-slate-600">{pattern.occurrence_count}x</span>
        </div>
      </div>

      <p className="text-sm text-slate-700 mb-4">{pattern. description}</p>

      {pattern.recommendation && (
        <div className="p-3 bg-slate-50 rounded-lg">
          <p className="text-xs font-semibold text-slate-700 mb-1">Recommendation:</p>
          <p className="text-sm text-slate-600">{pattern.recommendation}</p>
        </div>
      )}
    </div>
  );
}