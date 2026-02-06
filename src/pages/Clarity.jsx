import React from 'react';
import { Sparkles } from 'lucide-react';

export default function Clarity() {
  return (
    <div className="h-full flex items-center justify-center bg-gradient-to-br from-purple-50 to-blue-50">
      <div className="text-center max-w-2xl px-8">
        <div className="inline-flex items-center justify-center w-20 h-20 bg-purple-100 rounded-full mb-6">
          <Sparkles className="w-10 h-10 text-purple-600" />
        </div>
        <h1 className="text-4xl font-bold text-slate-900 mb-4">
          Clarity Workshop
        </h1>
        <p className="text-xl text-slate-600 mb-8">
          A deep-dive coaching session to discover your <span className="font-semibold text-purple-600">true goals</span> and <span className="font-semibold text-purple-600">why they matter</span>.
        </p>
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-8 text-left">
          <h2 className="text-lg font-semibold text-slate-900 mb-4">What you'll explore:</h2>
          <ul className="space-y-3 text-slate-700">
            <li className="flex items-start gap-3">
              <span className="text-purple-600 font-bold">🎯</span>
              <span><strong>Vision:</strong> What your ideal future looks like</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="text-orange-600 font-bold">🔥</span>
              <span><strong>Pain:</strong> What you're running from and why it matters</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="text-red-600 font-bold">❤️</span>
              <span><strong>Your Why:</strong> The emotional root driving you</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="text-blue-600 font-bold">🧬</span>
              <span><strong>Identity:</strong> Who you need to become</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="text-yellow-600 font-bold">🚧</span>
              <span><strong>Obstacles:</strong> What's really in your way</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="text-green-600 font-bold">📍</span>
              <span><strong>Roadmap:</strong> Clear milestones and next steps</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="text-indigo-600 font-bold">✅</span>
              <span><strong>Commitment:</strong> What you'll do this week</span>
            </li>
          </ul>
        </div>
        <button className="mt-8 px-8 py-4 bg-purple-600 text-white font-semibold rounded-lg hover:bg-purple-700 transition-colors shadow-lg">
          Start Clarity Session
        </button>
        <p className="text-sm text-slate-500 mt-4">
          Takes 15-20 minutes • Saved as a journal entry with AI insights
        </p>
      </div>
    </div>
  );
}