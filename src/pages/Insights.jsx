import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import InsightCard from '@/components/insights/InsightCard';
import { Loader2, Sparkles, RefreshCw, TrendingUp, AlertTriangle, Target, Lightbulb } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export default function Insights() {
  const [isGenerating, setIsGenerating] = useState(false);
  const [activeTab, setActiveTab] = useState('all');
  const queryClient = useQueryClient();

  const { data: insights = [], isLoading } = useQuery({
    queryKey: ['insights'],
    queryFn: async () => {
      const user = await base44.auth.me();
      return base44.entities.AIInsight.filter({ is_active: true, created_by: user.email }, '-created_date', 50);
    },
  });

  const { data: entries = [] } = useQuery({
    queryKey: ['entries'],
    queryFn: async () => {
      const user = await base44.auth.me();
      return base44.entities.JournalEntry.filter({ created_by: user.email }, '-created_date', 50);
    },
  });

  const { data: goals = [] } = useQuery({
    queryKey: ['goals'],
    queryFn: async () => {
      const user = await base44.auth.me();
      return base44.entities.Goal.filter({ status: 'active', created_by: user.email });
    },
  });

  const generateNewInsights = async () => {
    if (entries.length < 3) return;
    
    setIsGenerating(true);
    
    const prompt = `Analyze these journal entries and identify meaningful patterns, habits, common mistakes, progress on goals, and recommendations:

Recent Entries:
${entries.slice(0, 20).map(e => `[${e.created_date.split('T')[0]}] ${e.mood ? `Mood: ${e.mood}. ` : ''}${e.content.substring(0, 300)}`).join('\n\n')}

Active Goals: ${goals.map(g => g.title).join(', ')}

Existing Insights (avoid duplicates): ${insights.slice(0, 10).map(i => i.title).join(', ')}

Provide 2-3 NEW insights that are:
1. Specific and based on actual patterns in the entries
2. Genuinely helpful and actionable
3. Honest but kind - point out areas for improvement with compassion
4. Different from existing insights`;

    const result = await base44.integrations.Core.InvokeLLM({
      prompt,
      response_json_schema: {
        type: "object",
        properties: {
          insights: {
            type: "array",
            items: {
              type: "object",
              properties: {
                type: { type: "string", enum: ["pattern", "habit", "mistake", "progress", "recommendation"] },
                title: { type: "string" },
                description: { type: "string" },
                confidence: { type: "number" }
              }
            }
          }
        }
      }
    });

    for (const insight of result.insights) {
      await base44.entities.AIInsight.create({
        ...insight,
        is_active: true,
        first_detected: new Date().toISOString().split('T')[0]
      });
    }

    queryClient.invalidateQueries({ queryKey: ['insights'] });
    setIsGenerating(false);
  };

  const filteredInsights = activeTab === 'all' 
    ? insights 
    : insights.filter(i => i.type === activeTab);

  const typeCounts = {
    all: insights.length,
    pattern: insights.filter(i => i.type === 'pattern').length,
    habit: insights.filter(i => i.type === 'habit').length,
    mistake: insights.filter(i => i.type === 'mistake').length,
    progress: insights.filter(i => i.type === 'progress').length,
    recommendation: insights.filter(i => i.type === 'recommendation').length,
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-violet-600 rounded-xl">
              <Sparkles className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900">AI Insights</h1>
              <p className="text-slate-500 text-sm">Patterns & discoveries from your journal</p>
            </div>
          </div>
          
          <Button
            onClick={generateNewInsights}
            disabled={isGenerating || entries.length < 3}
            className="bg-violet-600 hover:bg-violet-700 rounded-xl"
          >
            {isGenerating ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Analyzing...
              </>
            ) : (
              <>
                <RefreshCw className="w-4 h-4 mr-2" />
                Generate Insights
              </>
            )}
          </Button>
        </div>

        {entries.length < 3 ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center">
            <Sparkles className="w-12 h-12 text-slate-300 mx-auto mb-4" />
            <h3 className="font-semibold text-slate-700 mb-2">Not enough data yet</h3>
            <p className="text-slate-500">
              Write at least 3 journal entries to start receiving AI-powered insights about your patterns and habits.
            </p>
          </div>
        ) : (
          <>
            <Tabs value={activeTab} onValueChange={setActiveTab} className="mb-6">
              <TabsList className="bg-white border border-slate-200 p-1 rounded-xl">
                <TabsTrigger value="all" className="rounded-lg data-[state=active]:bg-slate-900 data-[state=active]:text-white">
                  All ({typeCounts.all})
                </TabsTrigger>
                <TabsTrigger value="pattern" className="rounded-lg data-[state=active]:bg-blue-600 data-[state=active]:text-white">
                  Patterns ({typeCounts.pattern})
                </TabsTrigger>
                <TabsTrigger value="habit" className="rounded-lg data-[state=active]:bg-emerald-600 data-[state=active]:text-white">
                  Habits ({typeCounts.habit})
                </TabsTrigger>
                <TabsTrigger value="mistake" className="rounded-lg data-[state=active]:bg-amber-500 data-[state=active]:text-white">
                  Areas ({typeCounts.mistake})
                </TabsTrigger>
                <TabsTrigger value="recommendation" className="rounded-lg data-[state=active]:bg-rose-500 data-[state=active]:text-white">
                  Tips ({typeCounts.recommendation})
                </TabsTrigger>
              </TabsList>
            </Tabs>

            <div className="space-y-4">
              {filteredInsights.map((insight) => (
                <InsightCard key={insight.id} insight={insight} />
              ))}
              
              {filteredInsights.length === 0 && (
                <div className="text-center py-12 text-slate-400">
                  No insights in this category yet
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}