import React from 'react';
import { Sparkles } from 'lucide-react';

export default function Insights() {
  return (
    <div className='p-8'>
      <div className='max-w-4xl mx-auto'>
        <div className='flex items-center gap-3 mb-6'>
          <Sparkles className='w-8 h-8 text-violet-600' />
          <h1 className='text-3xl font-bold text-slate-900'>Insights</h1>
        </div>
        <div className='bg-white rounded-xl p-8 border border-slate-200'>
          <p className='text-slate-600'>AI-powered insights coming soon!  This will analyze your journal entries and provide meaningful insights.</p>
        </div>
      </div>
    </div>
  );
}
