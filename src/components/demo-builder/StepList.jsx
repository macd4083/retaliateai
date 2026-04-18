import React, { useState } from 'react';
import { Copy, Plus, Trash2, ChevronUp, ChevronDown } from 'lucide-react';
import { STEP_TYPES } from '../../utils/demoSchema';

export default function StepList({
  steps,
  currentStepIndex,
  setCurrentStepIndex,
  addStep,
  deleteStep,
  duplicateStep,
  reorderSteps,
}) {
  const [showPicker, setShowPicker] = useState(false);

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">Steps</h3>
        <span className="text-xs text-zinc-500">{steps.length}</span>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {steps.map((step, index) => {
          const typeMeta = STEP_TYPES.find((type) => type.id === step.type);
          const Icon = typeMeta?.icon;
          const isActive = currentStepIndex === index;
          return (
            <div
              key={step.id}
              className={`group rounded-xl border p-2 transition-colors ${
                isActive
                  ? 'border-red-800 bg-red-900/20'
                  : 'border-zinc-800 bg-zinc-950 hover:bg-zinc-800/60'
              }`}
            >
              <button
                onClick={() => setCurrentStepIndex(index)}
                className="w-full text-left flex items-start gap-2"
              >
                <div className="h-7 w-7 rounded-lg bg-zinc-800 border border-zinc-700 grid place-items-center mt-0.5">
                  {Icon ? <Icon className="w-4 h-4 text-red-400" /> : null}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-zinc-500">Step {index + 1}</p>
                  <p className="text-sm text-zinc-100 truncate">{step.label || 'Untitled step'}</p>
                </div>
              </button>

              <div className="mt-2 flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => reorderSteps(index, index - 1)}
                  disabled={index === 0}
                  className="p-1.5 rounded-md text-zinc-400 hover:text-white hover:bg-zinc-700 disabled:opacity-40"
                >
                  <ChevronUp className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => reorderSteps(index, index + 1)}
                  disabled={index === steps.length - 1}
                  className="p-1.5 rounded-md text-zinc-400 hover:text-white hover:bg-zinc-700 disabled:opacity-40"
                >
                  <ChevronDown className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => duplicateStep(step.id)}
                  className="p-1.5 rounded-md text-zinc-400 hover:text-white hover:bg-zinc-700"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => deleteStep(step.id)}
                  className="p-1.5 rounded-md text-zinc-500 hover:text-red-400 hover:bg-red-900/30"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="p-3 border-t border-zinc-800 space-y-2">
        <button
          onClick={() => setShowPicker((value) => !value)}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-zinc-800 border border-zinc-700 text-zinc-200 hover:bg-zinc-700 hover:text-white text-sm transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add Step
        </button>

        {showPicker && (
          <div className="grid grid-cols-2 gap-2">
            {STEP_TYPES.map((type) => {
              const Icon = type.icon;
              return (
                <button
                  key={type.id}
                  onClick={() => {
                    addStep(type.id);
                    setShowPicker(false);
                  }}
                  className="text-left rounded-lg border border-zinc-700 bg-zinc-950 p-2 hover:bg-zinc-800 transition-colors"
                >
                  <div className="flex items-center gap-1.5 text-zinc-100 text-xs font-medium">
                    <Icon className="w-3.5 h-3.5 text-red-400" />
                    {type.label}
                  </div>
                  <p className="text-[11px] text-zinc-500 mt-1">{type.description}</p>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
