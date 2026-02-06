import React from 'react';
import { Heart } from 'lucide-react';

export default function Gratitude() {
  return (
    <div className="h-full flex items-center justify-center bg-gradient-to-br from-pink-50 to-orange-50">
      <div className="text-center max-w-2xl px-8">
        <div className="inline-flex items-center justify-center w-20 h-20 bg-pink-100 rounded-full mb-6">
          <Heart className="w-10 h-10 text-pink-600" />
        </div>
        <h1 className="text-4xl font-bold text-slate-900 mb-4">
          Gratitude Practice
        </h1>
        <p className="text-xl text-slate-600 mb-8">
          Build appreciation as a <span className="font-semibold text-pink-600">daily muscle</span>. What we appreciate, appreciates.
        </p>
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-8">
          <p className="text-slate-700 text-left">
            Coming soon: A guided practice to help you cultivate genuine gratitude for the people, moments, and opportunities in your life.
          </p>
        </div>
      </div>
    </div>
  );
}