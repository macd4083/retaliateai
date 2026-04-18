import React, { useEffect } from 'react';
import { Eye, FileCode2, Save, Plus } from 'lucide-react';
import AppShellV2 from '../components/v2/AppShellV2';
import { useDemoBuilder } from '../components/demo-builder/useDemoBuilder';
import DemoBuilderLayout from '../components/demo-builder/DemoBuilderLayout';
import StepList from '../components/demo-builder/StepList';
import StepEditor from '../components/demo-builder/StepEditor';
import TimelineEditor from '../components/demo-builder/TimelineEditor';
import DemoCanvas from '../components/demo-builder/DemoCanvas';
import PreviewMode from '../components/demo-builder/PreviewMode';
import EmbedPanel from '../components/demo-builder/EmbedPanel';

export default function DemoBuilder() {
  const {
    demo,
    steps,
    currentStepIndex,
    setCurrentStepIndex,
    selectedStep,
    isPreviewMode,
    setIsPreviewMode,
    activePanel,
    setActivePanel,
    addStep,
    updateStep,
    deleteStep,
    duplicateStep,
    reorderSteps,
    updateDemo,
    isSaved,
    saveToLocalStorage,
    loadFromLocalStorage,
    newDemo,
  } = useDemoBuilder();

  useEffect(() => {
    loadFromLocalStorage();
  }, [loadFromLocalStorage]);

  return (
    <AppShellV2 title="Demo Builder">
      <div className="relative h-full overflow-hidden px-4 py-4 space-y-3">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-3 flex flex-wrap items-center gap-2">
          <input
            value={demo.name}
            onChange={(event) => updateDemo({ name: event.target.value })}
            className="flex-1 min-w-[220px] rounded-lg bg-zinc-950 border border-zinc-700 px-3 py-2 text-sm text-zinc-100"
            placeholder="Demo name"
          />
          <button
            onClick={() => {
              setCurrentStepIndex(0);
              setIsPreviewMode(true);
            }}
            className="px-3 py-2 rounded-xl bg-zinc-800 border border-zinc-700 text-zinc-200 hover:bg-zinc-700 text-sm flex items-center gap-1.5"
          >
            <Eye className="w-4 h-4" />
            Preview
          </button>
          <button
            onClick={() => setActivePanel('embed')}
            className="px-3 py-2 rounded-xl bg-zinc-800 border border-zinc-700 text-zinc-200 hover:bg-zinc-700 text-sm flex items-center gap-1.5"
          >
            <FileCode2 className="w-4 h-4" />
            Export
          </button>
          <button
            onClick={saveToLocalStorage}
            className="px-3 py-2 rounded-xl bg-red-600 border border-red-700 text-white hover:bg-red-500 text-sm flex items-center gap-1.5"
          >
            <Save className="w-4 h-4" />
            Save
          </button>
          <button
            onClick={newDemo}
            className="px-3 py-2 rounded-xl bg-zinc-800 border border-zinc-700 text-zinc-300 hover:bg-zinc-700 text-sm flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" />
            New
          </button>
          <span className={`ml-auto text-xs ${isSaved ? 'text-emerald-400' : 'text-amber-400'}`}>
            {isSaved ? 'Saved' : 'Unsaved changes'}
          </span>
        </div>

        <DemoBuilderLayout
          left={(
            <StepList
              steps={steps}
              currentStepIndex={currentStepIndex}
              setCurrentStepIndex={setCurrentStepIndex}
              addStep={addStep}
              deleteStep={deleteStep}
              duplicateStep={duplicateStep}
              reorderSteps={reorderSteps}
            />
          )}
          center={(
            <DemoCanvas
              demo={demo}
              selectedStep={selectedStep}
              updateStep={updateStep}
              updateDemo={updateDemo}
              onAdvance={() => setCurrentStepIndex(currentStepIndex + 1)}
            />
          )}
          right={<StepEditor selectedStep={selectedStep} updateStep={updateStep} />}
          bottom={(
            <TimelineEditor
              steps={steps}
              currentStepIndex={currentStepIndex}
              setCurrentStepIndex={setCurrentStepIndex}
              setIsPreviewMode={setIsPreviewMode}
              updateStep={updateStep}
            />
          )}
        />

        {isPreviewMode && (
          <PreviewMode
            demo={demo}
            steps={steps}
            currentStepIndex={currentStepIndex}
            setCurrentStepIndex={setCurrentStepIndex}
            setIsPreviewMode={setIsPreviewMode}
          />
        )}

        {activePanel === 'embed' && <EmbedPanel demo={demo} onClose={() => setActivePanel('builder')} />}
      </div>
    </AppShellV2>
  );
}
