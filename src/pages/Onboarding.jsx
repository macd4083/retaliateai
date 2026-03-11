import React, { useState } from 'react';
import { useAuth } from '../lib/AuthContext';
import { supabase } from '../lib/supabase/client';

const LIFE_AREAS = [
  { id: 'career', label: 'Career & Work', emoji: '💼', description: 'Building your path forward' },
  { id: 'health', label: 'Health & Fitness', emoji: '💪', description: 'Body and physical energy' },
  { id: 'relationships', label: 'Relationships', emoji: '❤️', description: 'Family, friends, love' },
  { id: 'growth', label: 'Personal Growth', emoji: '🧠', description: 'Skills, learning, mindset' },
  { id: 'finance', label: 'Finance', emoji: '💰', description: 'Money, security, freedom' },
  { id: 'creativity', label: 'Creativity', emoji: '🎨', description: 'Expression, art, ideas' },
  { id: 'mental_health', label: 'Mental Health', emoji: '🧘', description: 'Peace, balance, clarity' },
  { id: 'spirituality', label: 'Purpose & Meaning', emoji: '✨', description: 'Values, impact, legacy' },
];

const REMINDER_PRESETS = [
  { label: 'Morning', time: '08:00', emoji: '🌅', description: '7-9am' },
  { label: 'Midday', time: '12:30', emoji: '☀️', description: '12-1pm' },
  { label: 'Evening', time: '19:00', emoji: '🌆', description: '7-9pm' },
  { label: 'Night', time: '21:30', emoji: '🌙', description: '9-11pm' },
  { label: 'Custom', time: 'custom', emoji: '⏰', description: 'Pick your time' },
];

const JOURNALING_GOALS = [
  'Help me process my emotions',
  'Track progress toward my goals',
  'Build deeper self-awareness',
  'Stay accountable to myself',
  'Connect to my future self',
  'Something else...',
];

const TOTAL_STEPS = 6;
const DEFAULT_REMINDER_TIME = '21:00';

export default function Onboarding({ onComplete }) {
  const { user } = useAuth();
  const [step, setStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Step 1
  const [name, setName] = useState('');
  const [age, setAge] = useState('');

  // Step 2
  const [selectedAreas, setSelectedAreas] = useState([]);
  const [primaryArea, setPrimaryArea] = useState('');

  // Step 3
  const [futureVision, setFutureVision] = useState('');

  // Step 4
  const [coreWhy, setCoreWhy] = useState('');
  const [identityStatement, setIdentityStatement] = useState('');

  // Step 5
  const [journalingGoal, setJournalingGoal] = useState('');
  const [customGoal, setCustomGoal] = useState('');
  const [reminderTime, setReminderTime] = useState(DEFAULT_REMINDER_TIME);
  const [reminderEnabled, setReminderEnabled] = useState(true);
  const [customTime, setCustomTime] = useState('');
  const [showCustomTime, setShowCustomTime] = useState(false);

  const handleStep1Submit = async (e) => {
    e.preventDefault();
    if (!name.trim() || !age) {
      alert('Please fill in both fields');
      return;
    }
    setIsSubmitting(true);
    try {
      const { error } = await supabase
        .from('user_profiles')
        .update({ display_name: name.trim(), age: parseInt(age) })
        .eq('id', user.id);
      if (error) throw error;
      setStep(2);
    } catch (error) {
      console.error('Error saving basic info:', error);
      alert('Failed to save. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStep2Submit = async () => {
    if (selectedAreas.length === 0) {
      alert('Please select at least one life area.');
      return;
    }
    if (!primaryArea) {
      alert('Please tap your most important life area.');
      return;
    }
    setIsSubmitting(true);
    try {
      const { error } = await supabase
        .from('user_profiles')
        .update({ life_areas: selectedAreas, primary_life_area: primaryArea })
        .eq('id', user.id);
      if (error) throw error;
      setStep(3);
    } catch (error) {
      console.error('Error saving life areas:', error);
      alert('Failed to save. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStep3Submit = async () => {
    const trimmedVision = futureVision.trim();
    if (!trimmedVision || trimmedVision.split(/\s+/).length < 10) {
      alert('Please write at least a couple of sentences about your future self.');
      return;
    }
    setIsSubmitting(true);
    try {
      const { error } = await supabase
        .from('user_profiles')
        .update({ future_self_vision: trimmedVision })
        .eq('id', user.id);
      if (error) throw error;
      setStep(4);
    } catch (error) {
      console.error('Error saving future vision:', error);
      alert('Failed to save. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStep4Submit = async () => {
    if (!coreWhy.trim()) {
      alert('Please share your core why.');
      return;
    }
    if (!identityStatement.trim()) {
      alert('Please complete the identity statement.');
      return;
    }
    setIsSubmitting(true);
    try {
      const { error } = await supabase
        .from('user_profiles')
        .update({ core_why: coreWhy.trim(), identity_statement: identityStatement.trim() })
        .eq('id', user.id);
      if (error) throw error;
      setStep(5);
    } catch (error) {
      console.error('Error saving core why:', error);
      alert('Failed to save. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStep5Submit = async () => {
    const finalGoal = journalingGoal === 'Something else...' ? customGoal.trim() : journalingGoal;
    if (!finalGoal) {
      alert('Please select or enter your journaling goal.');
      return;
    }
    const finalTime = showCustomTime ? customTime || DEFAULT_REMINDER_TIME : reminderTime;
    setIsSubmitting(true);
    try {
      const { error } = await supabase
        .from('user_profiles')
        .update({
            journaling_goal: finalGoal,
            preferred_reminder_time: finalTime,
            reminder_enabled: reminderEnabled,
            onboarding_why_data: {
              life_areas: selectedAreas,
              primary_life_area: primaryArea,
              future_self_vision: futureVision,
              core_why: coreWhy,
              identity_statement: identityStatement,
              journaling_goal: finalGoal,
            },
          })
        .eq('id', user.id);
      if (error) throw error;
      setStep(6);
    } catch (error) {
      console.error('Error saving journaling goal:', error);
      alert('Failed to save. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStep6Complete = async () => {
    setIsSubmitting(true);
    try {
      const { error } = await supabase
        .from('user_profiles')
        .update({ onboarding_completed: true })
        .eq('id', user.id);
      if (error) throw error;
      onComplete();
    } catch (error) {
      console.error('Error completing onboarding:', error);
      alert('Failed to complete setup. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const primaryAreaData = LIFE_AREAS.find((a) => a.id === primaryArea);

  return (
    <div className="min-h-screen bg-red-50 flex items-center justify-center p-6">
      <div className="w-full max-w-2xl">
        {/* Progress dots */}
        <div className="mb-8">
          <div className="flex items-center justify-center gap-2 mb-2">
            {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
              <div
                key={i}
                className={`h-2 w-2 rounded-full transition-colors ${
                  step >= i + 1 ? 'bg-red-600' : 'bg-slate-300'
                }`}
              />
            ))}
          </div>
          <p className="text-center text-sm text-slate-600">Step {step} of {TOTAL_STEPS}</p>
        </div>

        {/* Step 1 — Welcome & Name/Age */}
        {step === 1 && (
          <div className="bg-white rounded-lg shadow-lg p-8">
            <h1 className="text-3xl font-bold text-slate-900 mb-2">Welcome to Retaliate AI</h1>
            <p className="text-slate-600 mb-8">
              This app works because it knows you. Let's start there.
            </p>

            <form onSubmit={handleStep1Submit} className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  What's your name?
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Enter your name"
                  className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none"
                  disabled={isSubmitting}
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  How old are you?
                </label>
                <input
                  type="number"
                  value={age}
                  onChange={(e) => setAge(e.target.value)}
                  placeholder="Enter your age"
                  min="13"
                  max="120"
                  className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none"
                  disabled={isSubmitting}
                  required
                />
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full bg-red-600 text-white py-3 rounded-lg font-medium hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting ? 'Saving...' : 'Continue'}
              </button>
            </form>
          </div>
        )}

        {/* Step 2 — Life Areas */}
        {step === 2 && (
          <div className="bg-white rounded-lg shadow-lg p-8">
            <h1 className="text-3xl font-bold text-slate-900 mb-2">What matters most to you?</h1>
            <p className="text-slate-600 mb-2">
              Which areas of life matter most to you right now? Pick the ones that resonate.
            </p>
            {selectedAreas.length > 0 && (
              <p className="text-sm text-red-600 font-medium mb-6">
                Now tap your single most important area to highlight it.
              </p>
            )}
            {selectedAreas.length === 0 && <div className="mb-6" />}

            <div className="grid grid-cols-2 gap-3 mb-6">
              {LIFE_AREAS.map((area) => {
                const isSelected = selectedAreas.includes(area.id);
                const isPrimary = primaryArea === area.id;
                return (
                  <button
                    key={area.id}
                    type="button"
                    onClick={() => {
                      if (!isSelected) {
                        // Not selected: select it and set as primary
                        setSelectedAreas((prev) => [...prev, area.id]);
                        setPrimaryArea(area.id);
                      } else if (isSelected && !isPrimary) {
                        // Selected but not primary: promote to primary
                        setPrimaryArea(area.id);
                      } else {
                        // Is primary: deselect and clear primary
                        setSelectedAreas((prev) => prev.filter((a) => a !== area.id));
                        setPrimaryArea('');
                      }
                    }}
                    className={`relative flex flex-col items-start p-4 rounded-lg border-2 text-left transition-all ${
                      isPrimary
                        ? 'border-red-600 bg-red-50 ring-2 ring-red-300'
                        : isSelected
                        ? 'border-red-400 bg-red-50'
                        : 'border-slate-200 bg-white hover:border-slate-300'
                    }`}
                  >
                    {isPrimary && (
                      <span className="absolute top-2 right-2 text-xs bg-red-600 text-white px-2 py-0.5 rounded-full">
                        Primary
                      </span>
                    )}
                    <span className="text-2xl mb-1">{area.emoji}</span>
                    <span className={`font-medium text-sm ${isSelected ? 'text-red-700' : 'text-slate-800'}`}>
                      {area.label}
                    </span>
                    <span className="text-xs text-slate-500 mt-0.5">{area.description}</span>
                  </button>
                );
              })}
            </div>

            <button
              onClick={handleStep2Submit}
              disabled={isSubmitting}
              className="w-full bg-red-600 text-white py-3 rounded-lg font-medium hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? 'Saving...' : 'Continue'}
            </button>
          </div>
        )}

        {/* Step 3 — Future Self Vision */}
        {step === 3 && (
          <div className="bg-white rounded-lg shadow-lg p-8">
            <p className="text-xs font-semibold text-red-600 uppercase tracking-wider mb-3">
              Why Builder · Part 1
            </p>
            <h1 className="text-3xl font-bold text-slate-900 mb-2">Who are you becoming?</h1>
            <p className="text-slate-600 mb-6">
              The best journalers aren't just writing. They're building themselves. Let's figure out
              who you're becoming.
            </p>

            <div className="mb-6">
              <label className="block text-sm font-medium text-slate-700 mb-2">
                In 1 year, if you showed up every day, who would you be? Paint the picture.
              </label>
              <textarea
                value={futureVision}
                onChange={(e) => setFutureVision(e.target.value)}
                placeholder="I would be someone who..."
                rows={5}
                className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none resize-none"
                disabled={isSubmitting}
              />
              <p className="text-xs text-slate-400 mt-2">
                Think about how you'd feel, what you'd be doing, who'd notice the difference.
              </p>
            </div>

            <button
              onClick={handleStep3Submit}
              disabled={isSubmitting}
              className="w-full bg-red-600 text-white py-3 rounded-lg font-medium hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? 'Saving...' : 'Continue'}
            </button>
          </div>
        )}

        {/* Step 4 — The Core Why */}
        {step === 4 && (
          <div className="bg-white rounded-lg shadow-lg p-8">
            <p className="text-xs font-semibold text-red-600 uppercase tracking-wider mb-3">
              Why Builder · Part 2
            </p>
            <h1 className="text-3xl font-bold text-slate-900 mb-4">What's the real reason?</h1>

            {futureVision && (
              <blockquote className="border-l-4 border-red-400 pl-4 py-2 bg-red-50 rounded-r-lg mb-6">
                <p className="text-slate-700 italic text-sm leading-relaxed">
                  "{futureVision.length > 200 ? futureVision.slice(0, 200) + '…' : futureVision}"
                </p>
              </blockquote>
            )}

            <div className="mb-6">
              <label className="block text-sm font-medium text-slate-700 mb-2">
                What's the real reason this matters to you? Go deeper than the obvious answer.
              </label>
              <textarea
                value={coreWhy}
                onChange={(e) => setCoreWhy(e.target.value)}
                placeholder="Not 'I want to be healthy' — but 'I want to be someone my kids look up to.'"
                rows={4}
                className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none resize-none"
                disabled={isSubmitting}
              />
            </div>

            <div className="mb-8">
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Complete this sentence:
              </label>
              <div className="flex items-center gap-2 border border-slate-300 rounded-lg px-4 py-3 focus-within:ring-2 focus-within:ring-red-500 focus-within:border-red-500">
                <span className="text-slate-500 whitespace-nowrap">I am someone who</span>
                <input
                  type="text"
                  value={identityStatement}
                  onChange={(e) => setIdentityStatement(e.target.value)}
                  placeholder="shows up every day"
                  className="flex-1 outline-none text-slate-900 min-w-0"
                  disabled={isSubmitting}
                />
              </div>
            </div>

            <button
              onClick={handleStep4Submit}
              disabled={isSubmitting}
              className="w-full bg-red-600 text-white py-3 rounded-lg font-medium hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? 'Saving...' : 'Continue'}
            </button>
          </div>
        )}

        {/* Step 5 — Journaling Goal + Reminder Time */}
        {step === 5 && (
          <div className="bg-white rounded-lg shadow-lg p-8">
            <h1 className="text-3xl font-bold text-slate-900 mb-2">Make it stick</h1>
            <p className="text-slate-600 mb-6">
              The habit only works if it fits your life.
            </p>

            <div className="mb-6">
              <label className="block text-sm font-medium text-slate-700 mb-3">
                What do you want journaling to do for you?
              </label>
              <div className="flex flex-wrap gap-2">
                {JOURNALING_GOALS.map((goal) => (
                  <button
                    key={goal}
                    type="button"
                    onClick={() => setJournalingGoal(goal)}
                    className={`px-4 py-2 rounded-full border text-sm transition-all ${
                      journalingGoal === goal
                        ? 'bg-red-600 text-white border-red-600'
                        : 'bg-white text-slate-700 border-slate-300 hover:border-red-400'
                    }`}
                  >
                    {goal}
                  </button>
                ))}
              </div>
              {journalingGoal === 'Something else...' && (
                <input
                  type="text"
                  value={customGoal}
                  onChange={(e) => setCustomGoal(e.target.value)}
                  placeholder="Tell us what you're looking for..."
                  className="mt-3 w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none"
                  disabled={isSubmitting}
                />
              )}
            </div>

            <div className="mb-8">
              <label className="block text-sm font-medium text-slate-700 mb-3">
                When is the best time for you to reflect each day?
              </label>
              <div className="grid grid-cols-3 gap-2 mb-3">
                {REMINDER_PRESETS.map((preset) => {
                  const isActive =
                    preset.time === 'custom'
                      ? showCustomTime
                      : reminderTime === preset.time && !showCustomTime;
                  return (
                    <button
                      key={preset.time}
                      type="button"
                      onClick={() => {
                        if (preset.time === 'custom') {
                          setShowCustomTime(true);
                        } else {
                          setShowCustomTime(false);
                          setReminderTime(preset.time);
                        }
                      }}
                      className={`flex flex-col items-center p-3 rounded-lg border-2 text-sm transition-all ${
                        isActive
                          ? 'border-red-600 bg-red-50 text-red-700'
                          : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                      }`}
                    >
                      <span className="text-xl mb-1">{preset.emoji}</span>
                      <span className="font-medium">{preset.label}</span>
                      <span className="text-xs text-slate-500">{preset.description}</span>
                    </button>
                  );
                })}
              </div>
              {showCustomTime && (
                <input
                  type="time"
                  value={customTime}
                  onChange={(e) => setCustomTime(e.target.value)}
                  className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none bg-white text-slate-900"
                  style={{ colorScheme: 'light' }}
                  disabled={isSubmitting}
                />
              )}
            </div>

            <button
              onClick={handleStep5Submit}
              disabled={isSubmitting}
              className="w-full bg-red-600 text-white py-3 rounded-lg font-medium hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? 'Saving...' : 'Continue'}
            </button>
          </div>
        )}

        {/* Step 6 — The Commitment */}
        {step === 6 && (
          <div className="bg-white rounded-lg shadow-lg p-8">
            <h1 className="text-3xl font-bold text-slate-900 mb-2">Here's what you've told us</h1>
            <p className="text-slate-600 mb-6">You've done the hard part. Now it's about showing up.</p>

            {/* Summary card */}
            <div className="bg-red-50 border border-red-100 rounded-xl p-6 mb-6 space-y-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-red-600 flex items-center justify-center text-white font-bold text-lg">
                  {name ? name[0].toUpperCase() : '?'}
                </div>
                <div>
                  <p className="font-semibold text-slate-900">{name || 'You'}</p>
                  {primaryAreaData && (
                    <p className="text-sm text-slate-500">
                      {primaryAreaData.emoji} Focused on {primaryAreaData.label}
                    </p>
                  )}
                </div>
              </div>

              {futureVision && (
                <div>
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">
                    Your future self
                  </p>
                  <p className="text-slate-700 text-sm leading-relaxed line-clamp-2">
                    {futureVision}
                  </p>
                </div>
              )}

              {coreWhy && (
                <div>
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">
                    Your core why
                  </p>
                  <p className="text-slate-700 text-sm leading-relaxed">{coreWhy}</p>
                </div>
              )}

              {identityStatement && (
                <div className="bg-white rounded-lg px-4 py-3 border border-red-200">
                  <p className="text-slate-600 text-sm">
                    <span className="text-slate-400">I am someone who </span>
                    <span className="font-semibold text-slate-900">{identityStatement}</span>
                  </p>
                </div>
              )}
            </div>

            <p className="text-slate-600 mb-3">
              The hardest part isn't the writing. It's showing up on the days when you don't want to.
            </p>
            <p className="text-xl font-bold text-slate-900 mb-8">
              Every time you journal, you're voting for the person you described above.
            </p>

            <button
              onClick={handleStep6Complete}
              disabled={isSubmitting}
              className="w-full bg-red-600 text-white py-4 rounded-lg font-semibold text-lg hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? 'Setting up your profile...' : "I'm ready. Let's build."}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}