import React from 'react';
import { UserCog } from 'lucide-react';

export default function Users() {
  return (
    <div className='p-8'>
      <div className='max-w-4xl mx-auto'>
        <div className='flex items-center gap-3 mb-6'>
          <UserCog className='w-8 h-8 text-orange-600' />
          <h1 className='text-3xl font-bold text-slate-900'>Users</h1>
        </div>
        <div className='bg-white rounded-xl p-8 border border-slate-200'>
          <p className='text-slate-600'>User management coming soon! Admin features for managing application users.</p>
        </div>
      </div>
    </div>
  );
}
