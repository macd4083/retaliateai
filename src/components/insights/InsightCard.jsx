import React from 'react';
import { Badge } from "@/components/ui/badge";
import { TrendingUp, RefreshCw, AlertTriangle, Target, Lightbulb } from "lucide-react";

const typeConfig = {
  pattern: { 
    icon: RefreshCw, 
    color: 'bg-blue-500', 
    lightColor: 'bg-blue-50 text-blue-700 border-blue-200',
    label: 'Pattern'
  },
  habit: { 
    icon: TrendingUp, 
    color: 'bg-emerald-500', 
    lightColor: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    label: 'Habit'
  },
  mistake: { 
    icon: AlertTriangle, 
    color: 'bg-amber-500', 
    lightColor: 'bg-amber-50 text-amber-700 border-amber-200',
    label: 'Area to Improve'
  },
  progress: { 
    icon: Target, 
    color: 'bg-violet-500', 
    lightColor: 'bg-violet-50 text-violet-700 border-violet-200',
    label: 'Progress'
  },
  recommendation: { 
    icon: Lightbulb, 
    color: 'bg-rose-500', 
    lightColor: 'bg-rose-50 text-rose-700 border-rose-200',
    label: 'Recommendation'
  },
};

export default function InsightCard({ insight }) {
  const config = typeConfig[insight.type] || typeConfig.pattern;
  const Icon = config.icon;

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 hover:shadow-md transition-shadow">
      <div className="flex items-start gap-4">
        <div className={`p-2.5 rounded-xl ${config.color} text-white shrink-0`}>
          <Icon className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <Badge className={`${config.lightColor} border font-medium`}>
              {config.label}
            </Badge>
            {insight.confidence >= 80 && (
              <span className="text-xs text-slate-400">High confidence</span>
            )}
          </div>
          <h3 className="font-semibold text-slate-900 mb-1">{insight.title}</h3>
          <p className="text-sm text-slate-600 leading-relaxed">{insight.description}</p>
        </div>
      </div>
    </div>
  );
}
