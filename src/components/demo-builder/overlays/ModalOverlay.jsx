import React from 'react';
import { motion } from 'framer-motion';

export default function ModalOverlay({ step, onAdvance }) {
  return (
    <div className="absolute inset-0 bg-black/50 flex items-center justify-center pointer-events-auto">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-md rounded-2xl border border-red-800 bg-zinc-900 p-6 shadow-2xl"
      >
        <h3 className="text-lg font-semibold text-white">{step?.config?.title || 'Modal title'}</h3>
        <p className="mt-2 text-sm text-zinc-300">{step?.config?.body || 'Modal body copy.'}</p>
        <button
          onClick={onAdvance}
          className="mt-4 px-4 py-2 rounded-lg bg-red-600 border border-red-700 text-white text-sm hover:bg-red-500"
        >
          {step?.config?.cta || 'Continue'}
        </button>
      </motion.div>
    </div>
  );
}
