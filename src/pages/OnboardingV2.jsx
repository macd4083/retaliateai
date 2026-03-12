import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, ArrowLeft, Check } from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import { supabase } from '../lib/supabase/client';

const LIFE_AREA_OPTIONS = [
  { emoji: '💼', label: 'Career & Business' },
  { emoji: '🏋️', label: 'Health & Fitness' },
  { emoji: '❤️', label: 'Relationships' },
  { emoji: '🧠', label: 'Personal Growth' },
  { emoji: '💰', label: 'Money & Finance' },
  { emoji: '🎨', label: 'Creativity' },
  { emoji: '🙏', label: 'Spirituality' },
  { emoji: '🎓', label: 'Education' },
];

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

export default function OnboardingV2() {
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

  // Step 5
  const [selectedLifeAreas, setSelectedLifeAreas] = useState([]);

  // Step 6
  const [reflectionTime, setReflectionTime] = useState('21:00');
  const [timezone, setTimezone] = useState('America/New_York');

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

      // Upsert each blocker into reflection_patterns
      const today = new Date().toISOString().split('T')[0];
      for (const blocker of allBlockers) {
        try {
          const { data: existing } = await supabase
            .from('reflection_patterns')
            .select('id, occurrence_count')
            .eq('user_id', user.id)
            .eq('pattern_type', 'blocker')
            .eq('label', blocker)
            .maybeSingle();

          if (existing) {
            await supabase
              .from('reflection_patterns')
              .update({ occurrence_count: existing.occurrence_count + 1, last_seen_date: today })
              .eq('id', existing.id);
          } else {
            await supabase.from('reflection_patterns').insert({
              user_id: user.id,
              pattern_type: 'blocker',
              label: blocker,
              occurrence_count: 1,
              first_seen_date: today,
              last_seen_date: today,
            });
          }
        } catch (_e) {}
      }

      setStep(5);
    } catch (_e) {
      alert('Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleStep5 = async () => {
    if (selectedLifeAreas.length === 0) return;
    setSaving(true);
    try {
      await saveProfile({ life_areas: selectedLifeAreas, onboarding_step: 6 });

      // Read current why for goal creation
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('why')
        .eq('id', user.id)
        .maybeSingle();
      const why = profile?.why || '';

      // Create one goal per selected area
      for (const area of selectedLifeAreas) {
        try {
          await supabase.from('goals').insert({
            user_id: user.id,
            title: `${area} — from onboarding`,
            category: area,
            status: 'active',
            why_it_matters: why,
          });
        } catch (_e) {}
      }

      setStep(6);
    } catch (_e) {
      alert('Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleStep6 = async () => {
    setSaving(true);
    try {
      await saveProfile({
        preferred_reflection_time: reflectionTime,
        timezone,
        onboarding_step: 7,
      });
      setStep(7);
    } catch (_e) {
      alert('Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleComplete = async () => {
    setSaving(true);
    try {
      await saveProfile({ onboarding_completed: true, onboarding_step: 7 });
      navigate('/reflection');
    } catch (_e) {
      alert('Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const goBack = () => {
    if (step === 3 && whySubStep > 1) {
      setWhySubStep((s) => s - 1);
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
                  And why does <em>that</em> matter?
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
                  And at the deepest level — why?
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
            <div className="flex flex-wrap gap-2 mb-4">
              {BLOCKER_OPTIONS.map((b) => {
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

        {/* ── Step 5 ── Life Areas ── */}
        {step === 5 && (
          <div className="flex flex-col flex-1">
            <h2 className="text-2xl font-bold text-white mb-2">
              Which areas of life matter most to you right now?
            </h2>
            <p className="text-zinc-400 text-sm mb-6">Select all that apply.</p>
            <div className="grid grid-cols-2 gap-3 mb-auto">
              {LIFE_AREA_OPTIONS.map(({ emoji, label }) => {
                const selected = selectedLifeAreas.includes(label);
                return (
                  <button
                    key={label}
                    onClick={() => {
                      setSelectedLifeAreas((prev) =>
                        selected ? prev.filter((x) => x !== label) : [...prev, label]
                      );
                    }}
                    className={`flex flex-col items-center gap-2 p-4 rounded-2xl border transition-colors ${
                      selected
                        ? 'bg-red-900/40 border-red-600 text-white'
                        : 'bg-zinc-900 border-zinc-700 text-zinc-300 hover:border-zinc-500'
                    }`}
                  >
                    <span className="text-2xl">{emoji}</span>
                    <span className="text-xs text-center leading-tight">{label}</span>
                  </button>
                );
              })}
            </div>
            <button
              onClick={handleStep5}
              disabled={selectedLifeAreas.length === 0 || saving}
              className="w-full flex items-center justify-center gap-2 bg-red-600 hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold py-3.5 rounded-xl transition-colors mt-8"
            >
              {saving ? 'Saving...' : 'Continue'} <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        )}

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

        {/* ── Step 7 ── Identity Commitment + Complete ── */}
        {step === 7 && (
          <Step7Summary
            fullName={fullName}
            futureSelf={futureSelf}
            bigGoal={bigGoal}
            why={[why1, why2, why3].filter(Boolean).join(' → ')}
            selectedLifeAreas={selectedLifeAreas}
            onComplete={handleComplete}
            saving={saving}
          />
        )}
      </div>
    </div>
  );
}

function Step7Summary({ fullName, futureSelf, bigGoal, why, selectedLifeAreas, onComplete, saving }) {
  const areaEmoji = Object.fromEntries(
    [
      ['Career & Business', '💼'],
      ['Health & Fitness', '🏋️'],
      ['Relationships', '❤️'],
      ['Personal Growth', '🧠'],
      ['Money & Finance', '💰'],
      ['Creativity', '🎨'],
      ['Spirituality', '🙏'],
      ['Education', '🎓'],
    ]
  );

  const truncate = (text, len = 120) =>
    text && text.length > len ? text.slice(0, len) + '...' : text;

  return (
    <div className="flex flex-col flex-1">
      <h2 className="text-2xl font-bold text-white mb-2">You're ready.</h2>
      <p className="text-zinc-400 text-sm mb-6 italic">
        You're not starting from scratch. You're starting from <em>here</em>.
      </p>

      {/* Summary card */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-4 mb-auto">
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
                  {areaEmoji[area] || ''} {area}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

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
