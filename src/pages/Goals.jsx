import React from 'react';
import { Target } from 'lucide-react';

export default function Goals() {
  return (
    <div className='p-8'>
      <div className='max-w-4xl mx-auto'>
        <div className='flex items-center gap-3 mb-6'>
          <Target className='w-8 h-8 text-blue-600' />
          <h1 className='text-3xl font-bold text-slate-900'>Goals</h1>
        </div>
        <div className='bg-white rounded-xl p-8 border border-slate-200'>
          <p className='text-slate-600'>Goals feature coming soon!  This will help you track and achieve your personal goals.</p>
        </div>
      </div>
    </div>
  );
}
