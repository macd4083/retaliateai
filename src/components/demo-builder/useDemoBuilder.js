import { useCallback, useMemo, useReducer } from 'react';
import { createDemoProject, createDemoStep } from '../../utils/demoSchema';
import { generateJSON } from '../../utils/embedGenerator';

const STORAGE_KEY = 'retaliateai_demo_builder';

function updateTimestamp(demo) {
  return {
    ...demo,
    updatedAt: new Date().toISOString(),
  };
}

function loadInitialDemo() {
  if (typeof window === 'undefined') {
    return createDemoProject();
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return createDemoProject();
    const parsed = JSON.parse(raw);
    return createDemoProject(parsed);
  } catch (_error) {
    return createDemoProject();
  }
}

function reducer(state, action) {
  switch (action.type) {
    case 'SET_DEMO':
      return {
        ...state,
        demo: updateTimestamp(createDemoProject(action.payload)),
        isSaved: false,
      };
    case 'UPDATE_DEMO':
      return {
        ...state,
        demo: updateTimestamp({
          ...state.demo,
          ...action.payload,
        }),
        isSaved: false,
      };
    case 'ADD_STEP': {
      const nextStep = createDemoStep(action.payload);
      const nextSteps = [...state.demo.steps, nextStep];
      return {
        ...state,
        demo: updateTimestamp({ ...state.demo, steps: nextSteps }),
        currentStepIndex: nextSteps.length - 1,
        isSaved: false,
      };
    }
    case 'UPDATE_STEP': {
      const nextSteps = state.demo.steps.map((step) => {
        if (step.id !== action.payload.id) return step;
        const patch = action.payload.patch || {};
        return {
          ...step,
          ...patch,
          config: {
            ...step.config,
            ...(patch.config || {}),
          },
        };
      });
      return {
        ...state,
        demo: updateTimestamp({ ...state.demo, steps: nextSteps }),
        isSaved: false,
      };
    }
    case 'DELETE_STEP': {
      const nextSteps = state.demo.steps.filter((step) => step.id !== action.payload);
      if (nextSteps.length === 0) {
        nextSteps.push(createDemoStep('highlight', { label: 'Step 1: Highlight' }));
      }
      const nextIndex = Math.min(state.currentStepIndex, nextSteps.length - 1);
      return {
        ...state,
        demo: updateTimestamp({ ...state.demo, steps: nextSteps }),
        currentStepIndex: Math.max(0, nextIndex),
        isSaved: false,
      };
    }
    case 'DUPLICATE_STEP': {
      const targetIndex = state.demo.steps.findIndex((step) => step.id === action.payload);
      if (targetIndex < 0) return state;
      const original = state.demo.steps[targetIndex];
      const duplicate = createDemoStep(original.type, {
        ...original,
        id: undefined,
        label: `${original.label} (Copy)`,
      });
      const nextSteps = [...state.demo.steps];
      nextSteps.splice(targetIndex + 1, 0, duplicate);
      return {
        ...state,
        demo: updateTimestamp({ ...state.demo, steps: nextSteps }),
        currentStepIndex: targetIndex + 1,
        isSaved: false,
      };
    }
    case 'REORDER_STEPS': {
      const { fromIndex, toIndex } = action.payload;
      if (fromIndex === toIndex) return state;
      const nextSteps = [...state.demo.steps];
      const [moved] = nextSteps.splice(fromIndex, 1);
      nextSteps.splice(toIndex, 0, moved);
      const selectedStep = state.demo.steps[state.currentStepIndex];
      const nextSelectedIndex = nextSteps.findIndex((step) => step.id === selectedStep?.id);
      return {
        ...state,
        demo: updateTimestamp({ ...state.demo, steps: nextSteps }),
        currentStepIndex: nextSelectedIndex >= 0 ? nextSelectedIndex : 0,
        isSaved: false,
      };
    }
    case 'SET_CURRENT_STEP_INDEX':
      return {
        ...state,
        currentStepIndex: action.payload,
      };
    case 'SET_PREVIEW_MODE':
      return {
        ...state,
        isPreviewMode: action.payload,
      };
    case 'SET_ACTIVE_PANEL':
      return {
        ...state,
        activePanel: action.payload,
      };
    case 'MARK_SAVED':
      return {
        ...state,
        isSaved: true,
      };
    case 'LOAD_DEMO':
      return {
        ...state,
        demo: createDemoProject(action.payload),
        currentStepIndex: 0,
        isSaved: true,
      };
    case 'NEW_DEMO':
      return {
        ...state,
        demo: createDemoProject(),
        currentStepIndex: 0,
        isSaved: false,
      };
    default:
      return state;
  }
}

export function useDemoBuilder() {
  const [state, rawDispatch] = useReducer(reducer, {
    demo: loadInitialDemo(),
    currentStepIndex: 0,
    isPreviewMode: false,
    activePanel: 'builder',
    isSaved: true,
  });
  const dispatch = /** @type {any} */ (rawDispatch);

  const selectedStep = useMemo(
    () => state.demo.steps[state.currentStepIndex] || null,
    [state.demo.steps, state.currentStepIndex],
  );

  const setDemo = (nextDemo) => dispatch({ type: 'SET_DEMO', payload: nextDemo });
  const setCurrentStepIndex = (index) => {
    const safeIndex = Math.max(0, Math.min(index, state.demo.steps.length - 1));
    dispatch({ type: 'SET_CURRENT_STEP_INDEX', payload: safeIndex });
  };
  const setIsPreviewMode = (value) => dispatch({ type: 'SET_PREVIEW_MODE', payload: value });
  const setActivePanel = (value) => dispatch({ type: 'SET_ACTIVE_PANEL', payload: value });

  const addStep = (type) => dispatch({ type: 'ADD_STEP', payload: type });
  const updateStep = (id, patch) => dispatch({ type: 'UPDATE_STEP', payload: { id, patch } });
  const deleteStep = (id) => dispatch({ type: 'DELETE_STEP', payload: id });
  const duplicateStep = (id) => dispatch({ type: 'DUPLICATE_STEP', payload: id });
  const reorderSteps = (fromIndex, toIndex) => {
    if (toIndex < 0 || toIndex >= state.demo.steps.length) return;
    dispatch({ type: 'REORDER_STEPS', payload: { fromIndex, toIndex } });
  };
  const updateDemo = (patch) => dispatch({ type: 'UPDATE_DEMO', payload: patch });

  const exportJSON = () => generateJSON(state.demo);

  const saveToLocalStorage = useCallback(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state.demo));
    dispatch({ type: 'MARK_SAVED' });
  }, [dispatch, state.demo]);

  const loadFromLocalStorage = useCallback(() => {
    if (typeof window === 'undefined') return;
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    try {
      dispatch({ type: 'LOAD_DEMO', payload: JSON.parse(raw) });
    } catch (error) {
      console.error('Unable to restore saved demo project', error);
    }
  }, [dispatch]);

  const newDemo = () => dispatch({ type: 'NEW_DEMO' });

  return {
    demo: state.demo,
    setDemo,
    steps: state.demo.steps,
    currentStepIndex: state.currentStepIndex,
    setCurrentStepIndex,
    selectedStep,
    isPreviewMode: state.isPreviewMode,
    setIsPreviewMode,
    activePanel: state.activePanel,
    setActivePanel,
    addStep,
    updateStep,
    deleteStep,
    duplicateStep,
    reorderSteps,
    updateDemo,
    exportJSON,
    isSaved: state.isSaved,
    saveToLocalStorage,
    loadFromLocalStorage,
    newDemo,
  };
}
