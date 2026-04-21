import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, ArrowLeft, Check } from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import { supabase } from '../lib/supabase/client';
import { subscribeToPush, isMobile, isStandalone } from '../lib/pushNotifications';

const DEFAULT_LIFE_AREA_OPTIONS = [
  { emoji: '💼', label: 'Career & Business' },
  { emoji: '🏋️', label: 'Health & Fitness' },
  { emoji: '❤️', label: 'Relationships' },
  { emoji: '🧠', label: 'Mental Health' },
  { emoji: '🌱', label: 'Personal Growth' },
  { emoji: '💰', label: 'Money & Finance' },
  { emoji: '🎓', label: 'Education' },
  { emoji: '🎮', label: 'Gaming' },
  { emoji: '🎨', label: 'Creativity' },
  { emoji: '🙏', label: 'Spirituality' },
];

const GOAL_PLACEHOLDERS = {
  'Career & Business': 'Build and launch my SaaS app',
  'Health & Fitness': 'Run a 5K and exercise 4x a week',
  'Relationships': 'Deepen my closest friendships',
  'Mental Health': 'Build consistent self-care and therapy habits',
  'Personal Growth': 'Build a consistent morning routine',
  'Money & Finance': 'Save 3 months of living expenses',
  'Education': 'Complete an online course in my field',
  'Gaming': 'Hit a rank goal or grow my stream',
  'Creativity': 'Complete my first creative project',
  'Spirituality': 'Build a daily mindfulness practice',
};

const MIN_LIFE_AREAS = 3;
const MAX_LIFE_AREAS = 5;

const BLOCKER_OPTIONS = [
  'Procrastination',
  'Self-doubt',
  'Lack of focus',
  'Overwhelm',
  'Consistency',
  'Fear of failure',
  'Time management',
  'Comparison to others',
];

const AREA_TO_LIKELY_BLOCKERS = {
  'Career & Business': ['Procrastination', 'Fear of failure', 'Time management'],
  'Health & Fitness': ['Consistency', 'Lack of focus', 'Time management'],
  'Mental Health': ['Overwhelm', 'Self-doubt', 'Consistency'],
  'Personal Growth': ['Procrastination', 'Consistency', 'Self-doubt'],
  'Money & Finance': ['Procrastination', 'Fear of failure', 'Overwhelm'],
  'Relationships': ['Comparison to others', 'Self-doubt', 'Overwhelm'],
  'Education': ['Procrastination', 'Lack of focus', 'Time management'],
  'Gaming': ['Consistency', 'Time management'],
  'Creativity': ['Fear of failure', 'Procrastination', 'Self-doubt'],
  'Spirituality': ['Consistency', 'Overwhelm'],
};

const TIMEZONES = [
  { label: 'Eastern (ET)', value: 'America/New_York' },
  { label: 'Central (CT)', value: 'America/Chicago' },
  { label: 'Mountain (MT)', value: 'America/Denver' },
  { label: 'Pacific (PT)', value: 'America/Los_Angeles' },
  { label: 'Alaska (AKT)', value: 'America/Anchorage' },
  { label: 'Hawaii (HT)', value: 'Pacific/Honolulu' },
  { label: 'UTC', value: 'UTC' },
];

const TOTAL_STEPS = 7;

function ProgressDots({ step }) {
  return (
    <div className="flex items-center justify-center gap-2 mb-8">
      {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
        <div
          key={i}
          className={`rounded-full transition-all duration-300 ${
            i + 1 === step
              ? 'w-6 h-2 bg-red-600'
              : i + 1 < step
              ? 'w-2 h-2 bg-red-800'
              : 'w-2 h-2 bg-zinc-700'
          }`}
        />
      ))}
    </div>
  );
}

export default function OnboardingV2({ onOnboardingComplete } = {}) {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);

  // Step 1
  const [fullName, setFullName] = useState('');

  // Step 2
  const [futureSelf, setFutureSelf] = useState('');

  // Step 3
  const [bigGoal, setBigGoal] = useState('');
  const [why1, setWhy1] = useState('');
  const [why2, setWhy2] = useState('');
  const [why3, setWhy3] = useState('');
  const [whySubStep, setWhySubStep] = useState(1); // 1=bigGoal, 2=why1, 3=why2, 4=why3

  // Step 4
  const [selectedBlockers, setSelectedBlockers] = useState([]);
  const [customBlocker, setCustomBlocker] = useState('');

  // Step 5 — area selection
  const [lifeAreaOptions, setLifeAreaOptions] = useState(DEFAULT_LIFE_AREA_OPTIONS);
  const [selectedLifeAreas, setSelectedLifeAreas] = useState([]);
  const [customAreas, setCustomAreas] = useState([]);
  const [customAreaInput, setCustomAreaInput] = useState('');
  const [showCustomInput, setShowCustomInput] = useState(false);

  // Step 5b — per-area goal capture
  const [lifeAreaPhase, setLifeAreaPhase] = useState('select'); // 'select' | 'goals'
  const [areaGoalIndex, setAreaGoalIndex] = useState(0);
  const [areaGoals, setAreaGoals] = useState({});
  const [currentGoalTitle, setCurrentGoalTitle] = useState('');
  const [currentGoalWhy, setCurrentGoalWhy] = useState('');

  // Step 6
  const [reflectionTime, setReflectionTime] = useState('21:00');
  const [timezone, setTimezone] = useState('America/New_York');

  const why3Question = (() => {
    const w = (why1 || '').toLowerCase();
    if (w.includes('money') || w.includes('financial') || w.includes('income')) {
      return 'And beyond the financial side — what does that security actually give you?';
    }
    if (w.includes('family') || w.includes('kids') || w.includes('children') || w.includes('parent')) {
      return 'And what does this mean for the people you care about — at the deepest level?';
    }
    if (w.includes('free') || w.includes('freedom') || w.includes('independent')) {
      return 'And what would that freedom actually let you do or become?';
    }
    return 'And why does that matter?';
  })();

  const why4Question = (() => {
    const w = (why2 || '').toLowerCase();
    if (w.includes('prove') || w.includes('worth') || w.includes('enough')) {
      return 'What would it mean to finally feel like enough — what changes?';
    }
    if (w.includes('legacy') || w.includes('remembered') || w.includes('impact')) {
      return 'What legacy do you actually want to leave — in one sentence?';
    }
    return 'And at the deepest level — why?';
  })();

  const likelyBlockers = [...new Set(
    selectedLifeAreas.flatMap(area => AREA_TO_LIKELY_BLOCKERS[area] || [])
  )];

  const orderedBlockers = [
    ...likelyBlockers.filter((b) => BLOCKER_OPTIONS.includes(b)),
    ...BLOCKER_OPTIONS.filter((b) => !likelyBlockers.includes(b)),
  ];

  const saveProfile = async (updates) => {
    if (!user?.id) return;
    const { error } = await supabase
      .from('user_profiles')
      .upsert(
        { id: user.id, ...updates, updated_at: new Date().toISOString() },
        { onConflict: 'id' }
      );
    if (error) {
      console.error('saveProfile error:', error);
      throw error;
    }
  };

  // ── Step handlers ─────────────────────────────────────────────────────────

  const handleStep1 = async () => {
    if (!fullName.trim()) return;
    setSaving(true);
    try {
      await saveProfile({ full_name: fullName.trim(), display_name: fullName.trim(), onboarding_step: 2 });
      setStep(2);
    } catch (_e) {
      alert('Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleStep2 = async () => {
    if (!futureSelf.trim()) return;
    setSaving(true);
    try {
      await saveProfile({ future_self: futureSelf.trim(), onboarding_step: 3 });
      setStep(3);
    } catch (_e) {
      alert('Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleStep3 = async () => {
    // Navigate sub-steps
    if (whySubStep === 1) {
      if (!bigGoal.trim()) return;
      setWhySubStep(2);
      return;
    }
    if (whySubStep === 2) {
      if (!why1.trim()) return;
      setWhySubStep(3);
      return;
    }
    if (whySubStep === 3) {
      if (!why2.trim()) return;
      setWhySubStep(4);
      return;
    }
    // whySubStep === 4 — final why
    if (!why3.trim()) return;
    setSaving(true);
    try {
      const combinedWhy = [why1.trim(), why2.trim(), why3.trim()].filter(Boolean).join(' → ');
      const shortGoal = bigGoal.trim().split(' ').slice(0, 6).join(' ');
      const identityStatement = `I am someone who ${shortGoal.toLowerCase()}`;
      await saveProfile({
        big_goal: bigGoal.trim(),
        why: combinedWhy,
        identity_statement: identityStatement,
        onboarding_step: 4,
      });
      setStep(4);
      setWhySubStep(1);
    } catch (_e) {
      alert('Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleStep4 = async () => {
    const allBlockers = [...selectedBlockers];
    if (customBlocker.trim()) allBlockers.push(customBlocker.trim());
    setSaving(true);
    try {
      await saveProfile({ blockers: allBlockers, onboarding_step: 5 });
      setStep(5);
    } catch (_e) {
      alert('Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleAddCustomArea = () => {
    const trimmed = customAreaInput.trim();
    if (!trimmed || customAreas.length >= 2) return;
    const newOption = { emoji: '✨', label: trimmed };
    setLifeAreaOptions((prev) => [...prev, newOption]);
    setCustomAreas((prev) => [...prev, trimmed]);
    setSelectedLifeAreas((prev) =>
      prev.length < MAX_LIFE_AREAS ? [...prev, trimmed] : prev
    );
    setCustomAreaInput('');
    setShowCustomInput(false);
  };

  const handleStep5 = async () => {
    if (selectedLifeAreas.length < MIN_LIFE_AREAS) return;
    setSaving(true);
    try {
      await saveProfile({ life_areas: selectedLifeAreas, onboarding_step: 6 });
      setAreaGoalIndex(0);
      setCurrentGoalTitle('');
      setCurrentGoalWhy('');
      setAreaGoals({});
      setLifeAreaPhase('goals');
    } catch (_e) {
      alert('Failed to save life areas. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleAreaGoalsComplete = async (goals) => {
    const now = new Date().toISOString();
    setSaving(true);
    try {
      for (const [area, goal] of Object.entries(goals)) {
        try {
          await supabase.from('goals').insert({
            user_id: user.id,
            title: goal.title,
            whys: goal.why
              ? [{ text: goal.why, added_at: now, source: 'onboarding', motivation_signal: null }]
              : [],
            category: area,
            status: 'active',
          });
        } catch (err) {
          console.error('Failed to insert goal for area:', area, err);
        }
      }
      setLifeAreaPhase('select');
      setStep(6);
    } catch (_e) {
      alert('Failed to save goals. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleAreaGoalNext = () => {
    const currentArea = selectedLifeAreas[areaGoalIndex];
    const updatedGoals = { ...areaGoals };
    if (currentGoalTitle.trim()) {
      updatedGoals[currentArea] = {
        title: currentGoalTitle.trim(),
        why: currentGoalWhy.trim(),
      };
      setAreaGoals(updatedGoals);
    }
    const isLast = areaGoalIndex === selectedLifeAreas.length - 1;
    if (isLast) {
      handleAreaGoalsComplete(updatedGoals);
    } else {
      setAreaGoalIndex((i) => i + 1);
      setCurrentGoalTitle('');
      setCurrentGoalWhy('');
    }
  };

  const handleAreaGoalSkip = () => {
    const isLast = areaGoalIndex === selectedLifeAreas.length - 1;
    if (isLast) {
      handleAreaGoalsComplete(areaGoals);
    } else {
      setAreaGoalIndex((i) => i + 1);
      setCurrentGoalTitle('');
      setCurrentGoalWhy('');
    }
  };

  const handleStep6 = async () => {
    setSaving(true);
    try {
      await saveProfile({
        preferred_reflection_time: reflectionTime,
        timezone,
        onboarding_step: 8,
      });
      setStep(8);
    } catch (_e) {
      alert('Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleComplete = async () => {
    setSaving(true);
    try {
      await saveProfile({ onboarding_completed: true, onboarding_step: 8 });
      // Fire Meta Pixel conversion event
      if (typeof window !== 'undefined' && window.fbq) {
        window.fbq('track', 'CompleteRegistration');
      }
      // Signal parent (AuthGuardV2) that onboarding is done — avoids stale cache issue
      if (onOnboardingComplete) onOnboardingComplete();
      else navigate('/reflection');
      // Subscribe to push notifications silently after navigation
      if (user?.id) {
        subscribeToPush(user.id, supabase).catch(() => {});
      }
    } catch (_e) {
      alert('Failed to complete setup. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const goBack = () => {
    if (step === 3 && whySubStep > 1) {
      setWhySubStep((s) => s - 1);
      return;
    }
    if (step === 5 && lifeAreaPhase === 'goals') {
      if (areaGoalIndex > 0) {
        const prevIndex = areaGoalIndex - 1;
        const prevArea = selectedLifeAreas[prevIndex];
        setAreaGoalIndex(prevIndex);
        setCurrentGoalTitle(areaGoals[prevArea]?.title || '');
        setCurrentGoalWhy(areaGoals[prevArea]?.why || '');
      } else {
        setLifeAreaPhase('select');
      }
      return;
    }
    if (step > 1) setStep((s) => s - 1);
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-zinc-950 text-white flex flex-col">
      <div className="flex-1 flex flex-col max-w-md mx-auto w-full px-5 py-8">
        {/* Back arrow (hidden on step 1) */}
        <div className="flex items-center justify-between mb-6">
          <button
            onClick={goBack}
            className={`flex items-center gap-1 text-zinc-500 hover:text-white transition-colors text-sm ${
              step === 1 && whySubStep === 1 ? 'invisible' : ''
            }`}
          >
            <ArrowLeft className="w-4 h-4" /> Back
          </button>
          <span className="text-zinc-600 text-xs">
            {step}/{TOTAL_STEPS}
          </span>
        </div>

        <ProgressDots step={step} />

        {/* ── Step 1 ── */}
        {step === 1 && (
          <div className="flex flex-col flex-1">
            <h2 className="text-2xl font-bold text-white mb-2">Welcome. Let's get to know you.</h2>
            <p className="text-zinc-400 text-sm mb-8">What should we call you?</p>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleStep1()}
              placeholder="Your full name"
              autoFocus
              className="bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-3 text-white placeholder-zinc-500 text-sm focus:outline-none focus:border-red-600 transition-colors mb-auto"
            />
            <button
              onClick={handleStep1}
              disabled={!fullName.trim() || saving}
              className="w-full flex items-center justify-center gap-2 bg-red-600 hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold py-3.5 rounded-xl transition-colors mt-8"
            >
              {saving ? 'Saving...' : 'Continue'} <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* ── Step 2 ── */}
        {step === 2 && (
          <div className="flex flex-col flex-1">
            <h2 className="text-2xl font-bold text-white mb-2">Who do you want to be in 1 year?</h2>
            <p className="text-zinc-400 text-sm mb-8">
              Be specific. Not what you want to have — who you want to <em>be</em>.
            </p>
            <textarea
              value={futureSelf}
              onChange={(e) => setFutureSelf(e.target.value)}
              placeholder="In one year, I am someone who..."
              rows={5}
              autoFocus
              className="bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-3 text-white placeholder-zinc-500 text-sm focus:outline-none focus:border-red-600 transition-colors resize-none mb-auto"
            />
            <button
              onClick={handleStep2}
              disabled={!futureSelf.trim() || saving}
              className="w-full flex items-center justify-center gap-2 bg-red-600 hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold py-3.5 rounded-xl transition-colors mt-8"
            >
              {saving ? 'Saving...' : 'Continue'} <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* ── Step 3 ── Why Builder ── */}
        {step === 3 && (
          <div className="flex flex-col flex-1">
            {whySubStep === 1 && (
              <>
                <h2 className="text-2xl font-bold text-white mb-2">
                  What's the one thing you most want to change or achieve right now?
                </h2>
                <p className="text-zinc-400 text-sm mb-8">Your biggest goal, in one sentence.</p>
                <input
                  type="text"
                  value={bigGoal}
                  onChange={(e) => setBigGoal(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleStep3()}
                  placeholder="e.g. Build a successful app"
                  autoFocus
                  className="bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-3 text-white placeholder-zinc-500 text-sm focus:outline-none focus:border-red-600 transition-colors mb-auto"
                />
              </>
            )}
            {whySubStep === 2 && (
              <>
                <h2 className="text-2xl font-bold text-white mb-2">Why does that matter to you?</h2>
                <p className="text-zinc-400 text-sm mb-2 italic">"{bigGoal}"</p>
                <p className="text-zinc-500 text-sm mb-8">Go deeper than the surface answer.</p>
                <input
                  type="text"
                  value={why1}
                  onChange={(e) => setWhy1(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleStep3()}
                  placeholder="Because..."
                  autoFocus
                  className="bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-3 text-white placeholder-zinc-500 text-sm focus:outline-none focus:border-red-600 transition-colors mb-auto"
                />
              </>
            )}
            {whySubStep === 3 && (
              <>
                <h2 className="text-2xl font-bold text-white mb-2">
                  {why3Question}
                </h2>
                <p className="text-zinc-400 text-sm mb-2 italic">"{why1}"</p>
                <p className="text-zinc-500 text-sm mb-8">Keep going.</p>
                <input
                  type="text"
                  value={why2}
                  onChange={(e) => setWhy2(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleStep3()}
                  placeholder="Because..."
                  autoFocus
                  className="bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-3 text-white placeholder-zinc-500 text-sm focus:outline-none focus:border-red-600 transition-colors mb-auto"
                />
              </>
            )}
            {whySubStep === 4 && (
              <>
                <h2 className="text-2xl font-bold text-white mb-2">
                  {why4Question}
                </h2>
                <p className="text-zinc-400 text-sm mb-2 italic">"{why2}"</p>
                <p className="text-zinc-500 text-sm mb-8">
                  This is your real why. Make it count.
                </p>
                <input
                  type="text"
                  value={why3}
                  onChange={(e) => setWhy3(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleStep3()}
                  placeholder="Because..."
                  autoFocus
                  className="bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-3 text-white placeholder-zinc-500 text-sm focus:outline-none focus:border-red-600 transition-colors mb-auto"
                />
              </>
            )}
            <button
              onClick={handleStep3}
              disabled={
                (whySubStep === 1 && !bigGoal.trim()) ||
                (whySubStep === 2 && !why1.trim()) ||
                (whySubStep === 3 && !why2.trim()) ||
                (whySubStep === 4 && !why3.trim()) ||
                saving
              }
              className="w-full flex items-center justify-center gap-2 bg-red-600 hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold py-3.5 rounded-xl transition-colors mt-8"
            >
              {saving ? 'Saving...' : whySubStep === 4 ? 'Save My Why' : 'Next'}{' '}
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* ── Step 4 ── Blockers ── */}
        {step === 4 && (
          <div className="flex flex-col flex-1">
            <h2 className="text-2xl font-bold text-white mb-2">What usually gets in your way?</h2>
            <p className="text-zinc-400 text-sm mb-6">Select all that apply.</p>
            {likelyBlockers.length > 0 && (
              <p className="text-zinc-500 text-xs mb-2">Common for your goals:</p>
            )}
            <div className="flex flex-wrap gap-2 mb-4">
              {orderedBlockers.map((b) => {
                const selected = selectedBlockers.includes(b);
                return (
                  <button
                    key={b}
                    onClick={() =>
                      setSelectedBlockers((prev) =>
                        selected ? prev.filter((x) => x !== b) : [...prev, b]
                      )
                    }
                    className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                      selected
                        ? 'bg-red-600 border-red-500 text-white'
                        : 'bg-zinc-900 border-zinc-700 text-zinc-300 hover:border-zinc-500'
                    }`}
                  >
                    {selected && <Check className="w-3 h-3 inline mr-1" />}
                    {b}
                  </button>
                );
              })}
            </div>
            <div className="flex gap-2 mb-auto">
              <input
                type="text"
                value={customBlocker}
                onChange={(e) => setCustomBlocker(e.target.value)}
                placeholder="Add your own..."
                className="flex-1 bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-2.5 text-white placeholder-zinc-500 text-sm focus:outline-none focus:border-red-600 transition-colors"
              />
            </div>
            <button
              onClick={handleStep4}
              disabled={saving}
              className="w-full flex items-center justify-center gap-2 bg-red-600 hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold py-3.5 rounded-xl transition-colors mt-8"
            >
              {saving ? 'Saving...' : 'Continue'} <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* ── Step 5 ── Life Area Selection ── */}
        {step === 5 && lifeAreaPhase === 'select' && (
          <div className="flex flex-col flex-1">
            <h2 className="text-2xl font-bold text-white mb-2">
              Which areas of life matter most to you right now?
            </h2>
            <div className="flex items-center justify-between mb-6">
              <p className="text-zinc-400 text-sm">Pick {MIN_LIFE_AREAS}–{MAX_LIFE_AREAS} areas.</p>
              <span
                className={`text-sm font-medium tabular-nums ${
                  selectedLifeAreas.length >= MIN_LIFE_AREAS ? 'text-red-400' : 'text-zinc-500'
                }`}
              >
                {selectedLifeAreas.length}/{MAX_LIFE_AREAS}
              </span>
            </div>

            <div className="flex flex-wrap gap-2 mb-4">
              {lifeAreaOptions.map(({ emoji, label }) => {
                const selected = selectedLifeAreas.includes(label);
                const atMax = !selected && selectedLifeAreas.length >= MAX_LIFE_AREAS;
                return (
                  <button
                    key={label}
                    onClick={() => {
                      if (selected) {
                        setSelectedLifeAreas((prev) => prev.filter((x) => x !== label));
                      } else if (!atMax) {
                        setSelectedLifeAreas((prev) => [...prev, label]);
                      }
                    }}
                    className={`px-4 py-2 rounded-full text-sm font-medium border transition-all ${
                      selected
                        ? 'bg-red-900 border-red-600 text-white'
                        : atMax
                        ? 'bg-zinc-800 border-zinc-700 text-zinc-600 cursor-not-allowed'
                        : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:border-zinc-500'
                    }`}
                  >
                    {emoji} {label}
                  </button>
                );
              })}

              {customAreas.length < 2 && !showCustomInput && (
                <button
                  onClick={() => setShowCustomInput(true)}
                  className="px-4 py-2 rounded-full text-sm font-medium border border-dashed border-zinc-600 text-zinc-400 hover:border-red-600 hover:text-red-400 transition-all bg-zinc-900"
                >
                  + Add your own
                </button>
              )}
            </div>

            {showCustomInput && (
              <div className="flex gap-2 mb-4">
                <input
                  type="text"
                  value={customAreaInput}
                  onChange={(e) => setCustomAreaInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleAddCustomArea();
                    if (e.key === 'Escape') {
                      setShowCustomInput(false);
                      setCustomAreaInput('');
                    }
                  }}
                  placeholder="e.g. Meditation, Side Projects..."
                  autoFocus
                  className="flex-1 bg-zinc-900 border border-zinc-600 rounded-xl px-4 py-2.5 text-white placeholder-zinc-500 text-sm focus:outline-none focus:border-red-600 transition-colors"
                />
                <button
                  onClick={handleAddCustomArea}
                  disabled={!customAreaInput.trim()}
                  className="px-3 py-2 bg-red-600 hover:bg-red-500 disabled:opacity-40 rounded-xl text-white transition-colors"
                >
                  <Check className="w-4 h-4" />
                </button>
              </div>
            )}

            <div className="mb-auto" />

            <button
              onClick={handleStep5}
              disabled={selectedLifeAreas.length < MIN_LIFE_AREAS || saving}
              className="w-full flex items-center justify-center gap-2 bg-red-600 hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold py-3.5 rounded-xl transition-colors mt-8"
            >
              {saving ? 'Saving...' : 'Continue'} <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* ── Step 5b ── Per-Area Goal Capture ── */}
        {step === 5 && lifeAreaPhase === 'goals' && (() => {
          const currentAreaLabel = selectedLifeAreas[areaGoalIndex];
          const currentAreaOption =
            lifeAreaOptions.find((a) => a.label === currentAreaLabel) || {
              emoji: '✨',
              label: currentAreaLabel,
            };
          return (
            <div className="flex flex-col flex-1">
              {/* Progress bar */}
              <div className="flex items-center gap-1.5 mb-6">
                {selectedLifeAreas.map((_, i) => (
                  <div
                    key={i}
                    className={`h-1 flex-1 rounded-full transition-all ${
                      i < areaGoalIndex
                        ? 'bg-red-600'
                        : i === areaGoalIndex
                        ? 'bg-red-400'
                        : 'bg-zinc-700'
                    }`}
                  />
                ))}
              </div>

              <p className="text-zinc-500 text-xs uppercase tracking-wider mb-1">
                Area {areaGoalIndex + 1} of {selectedLifeAreas.length}
              </p>
              <h2 className="text-2xl font-bold text-white mb-6">
                {currentAreaOption.emoji} {currentAreaLabel}
              </h2>

              <label className="block text-zinc-400 text-xs uppercase tracking-wider mb-2">
                What's your #1 goal in this area?
              </label>
              <input
                type="text"
                value={currentGoalTitle}
                onChange={(e) => setCurrentGoalTitle(e.target.value)}
                placeholder={GOAL_PLACEHOLDERS[currentAreaLabel] || 'Set a meaningful goal'}
                autoFocus
                className="bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-3 text-white placeholder-zinc-500 text-sm focus:outline-none focus:border-red-600 transition-colors mb-4"
              />

              <label className="block text-zinc-400 text-xs uppercase tracking-wider mb-2">
                Why does this matter to you?{' '}
                <span className="text-zinc-600 normal-case">(optional)</span>
              </label>
              <input
                type="text"
                value={currentGoalWhy}
                onChange={(e) => setCurrentGoalWhy(e.target.value)}
                placeholder="Because..."
                className="bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-3 text-white placeholder-zinc-500 text-sm focus:outline-none focus:border-red-600 transition-colors mb-auto"
              />

              <div className="flex gap-3 mt-8">
                <button
                  onClick={handleAreaGoalSkip}
                  disabled={saving}
                  className="flex-1 py-3.5 rounded-xl border border-zinc-700 text-zinc-400 hover:text-white hover:border-zinc-500 disabled:opacity-40 transition-colors text-sm font-medium"
                >
                  Skip this area
                </button>
                <button
                  onClick={handleAreaGoalNext}
                  disabled={saving}
                  className="flex-1 flex items-center justify-center gap-2 bg-red-600 hover:bg-red-500 disabled:opacity-40 text-white font-semibold py-3.5 rounded-xl transition-colors text-sm"
                >
                  {saving
                    ? 'Saving...'
                    : areaGoalIndex === selectedLifeAreas.length - 1
                    ? 'Finish'
                    : 'Next'}{' '}
                  {!saving && <ArrowRight className="w-4 h-4" />}
                </button>
              </div>
            </div>
          );
        })()}

        {/* ── Step 6 ── Notification Time ── */}
        {step === 6 && (
          <div className="flex flex-col flex-1">
            <h2 className="text-2xl font-bold text-white mb-2">
              What time works best for your nightly reflection?
            </h2>
            <p className="text-zinc-400 text-sm mb-8">We'll remind you at this time every day.</p>

            <label className="block text-zinc-400 text-xs uppercase tracking-wider mb-2">
              Time
            </label>
            <input
              type="time"
              value={reflectionTime}
              onChange={(e) => setReflectionTime(e.target.value)}
              className="bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-red-600 transition-colors mb-4 [color-scheme:dark]"
            />

            <label className="block text-zinc-400 text-xs uppercase tracking-wider mb-2">
              Timezone
            </label>
            <select
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-red-600 transition-colors mb-auto appearance-none"
            >
              {TIMEZONES.map((tz) => (
                <option key={tz.value} value={tz.value}>
                  {tz.label}
                </option>
              ))}
            </select>

            <p className="text-zinc-600 text-xs mt-4">
              Notifications coming soon — we're storing your preference now.
            </p>

            <button
              onClick={handleStep6}
              disabled={saving}
              className="w-full flex items-center justify-center gap-2 bg-red-600 hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold py-3.5 rounded-xl transition-colors mt-8"
            >
              {saving ? 'Saving...' : 'Continue'} <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* ── Step 8 ── Identity Commitment + Complete ── */}
        {step === 8 && (
          <Step7Summary
            fullName={fullName}
            futureSelf={futureSelf}
            bigGoal={bigGoal}
            why={[why1, why2, why3].filter(Boolean).join(' → ')}
            selectedLifeAreas={selectedLifeAreas}
            lifeAreaMap={Object.fromEntries(lifeAreaOptions.map(({ emoji, label }) => [label, emoji]))}
            onComplete={handleComplete}
            saving={saving}
          />
        )}
      </div>
    </div>
  );
}

function Step7Summary({ fullName, futureSelf, bigGoal, why, selectedLifeAreas, lifeAreaMap = {}, onComplete, saving }) {
  const truncate = (text, len = 120) =>
    text && text.length > len ? text.slice(0, len) + '...' : text;

  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const onMobile = isMobile();
  const alreadyInstalled = isStandalone();
  const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);

  useEffect(() => {
    const handler = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstall = () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      deferredPrompt.userChoice.finally(() => setDeferredPrompt(null));
    }
  };

  return (
    <div className="flex flex-col flex-1">
      <h2 className="text-2xl font-bold text-white mb-2">You're ready.</h2>
      <p className="text-zinc-400 text-sm mb-6 italic">
        You're not starting from scratch. You're starting from <em>here</em>.
      </p>

      {/* Summary card */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-4">
        {fullName && (
          <div>
            <p className="text-zinc-500 text-xs uppercase tracking-wider mb-0.5">Name</p>
            <p className="text-white font-semibold">{fullName}</p>
          </div>
        )}
        {futureSelf && (
          <div>
            <p className="text-zinc-500 text-xs uppercase tracking-wider mb-0.5">
              Future Self Vision
            </p>
            <p className="text-zinc-200 text-sm italic">"{truncate(futureSelf)}"</p>
          </div>
        )}
        {bigGoal && (
          <div>
            <p className="text-zinc-500 text-xs uppercase tracking-wider mb-0.5">Big Goal</p>
            <p className="text-zinc-200 text-sm">{bigGoal}</p>
          </div>
        )}
        {why && (
          <div>
            <p className="text-zinc-500 text-xs uppercase tracking-wider mb-0.5">Deep Why</p>
            <p className="text-zinc-200 text-sm">{why}</p>
          </div>
        )}
        {selectedLifeAreas.length > 0 && (
          <div>
            <p className="text-zinc-500 text-xs uppercase tracking-wider mb-2">Focus Areas</p>
            <div className="flex flex-wrap gap-2">
              {selectedLifeAreas.map((area) => (
                <span
                  key={area}
                  className="px-2.5 py-1 rounded-full bg-red-900/40 border border-red-800 text-red-300 text-xs"
                >
                  {lifeAreaMap[area] || '✨'} {area}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* PWA install prompts */}
      {onMobile && !alreadyInstalled && (
        <div className="mt-5">
          {isIOS ? (
            <div className="bg-zinc-800 border border-zinc-700 rounded-xl p-4">
              <p className="text-zinc-300 text-sm">
                📲 <strong className="text-white">For nightly reminders</strong>, add Retaliate AI to your home screen — tap the{' '}
                <strong className="text-white">share icon</strong>, then{' '}
                <strong className="text-white">"Add to Home Screen"</strong>.
              </p>
            </div>
          ) : deferredPrompt ? (
            <button
              onClick={handleInstall}
              className="w-full flex items-center justify-center gap-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-white font-semibold py-3 rounded-xl transition-colors text-sm"
            >
              📲 Add to Home Screen for daily reminders
            </button>
          ) : null}
        </div>
      )}

      <div className="mb-auto" />

      <button
        onClick={onComplete}
        disabled={saving}
        className="w-full flex items-center justify-center gap-2 bg-red-600 hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold py-3.5 rounded-xl transition-colors mt-8 text-base"
      >
        {saving ? 'Starting...' : 'Start Reflecting'} <ArrowRight className="w-4 h-4" />
      </button>
    </div>
  );
}
