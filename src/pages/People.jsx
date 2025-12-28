import React from 'react';
import { Users } from 'lucide-react';

export default function People() {
  return (
    <div className='p-8'>
      <div className='max-w-4xl mx-auto'>
        <div className='flex items-center gap-3 mb-6'>
          <Users className='w-8 h-8 text-purple-600' />
          <h1 className='text-3xl font-bold text-slate-900'>People</h1>
        </div>
        <div className='bg-white rounded-xl p-8 border border-slate-200'>
          <p className='text-slate-600'>People management coming soon! Track relationships and interactions with important people in your life.</p>
        </div>
      </div>
    </div>
  );
}