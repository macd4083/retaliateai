import React, { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import { supabase } from '../lib/supabase/client';
import AppShellV2 from '../components/v2/AppShellV2';

const TIMEZONES = [
  { label: 'Eastern (ET)', value: 'America/New_York' },
  { label: 'Central (CT)', value: 'America/Chicago' },
  { label: 'Mountain (MT)', value: 'America/Denver' },
  { label: 'Pacific (PT)', value: 'America/Los_Angeles' },
  { label: 'Alaska (AKT)', value: 'America/Anchorage' },
  { label: 'Hawaii (HT)', value: 'Pacific/Honolulu' },
  { label: 'UTC', value: 'UTC' },
];

const LIFE_AREA_EMOJI = {
  'Career & Business': '💼',
  'Health & Fitness': '🏋️',
  'Relationships': '❤️',
  'Mental Health': '🧠',
  'Personal Growth': '🌱',
  'Money & Finance': '💰',
  'Education': '🎓',
  'Gaming': '🎮',
  'Creativity': '🎨',
  'Spirituality': '🙏',
};

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

export default function SettingsV2() {
  const { user, signOut } = useAuth();

  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  // Editable fields
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState('');
  const [nameSaving, setNameSaving] = useState(false);

  const [editingTime, setEditingTime] = useState(false);
  const [timeValue, setTimeValue] = useState('21:00');
  const [tzValue, setTzValue] = useState('America/New_York');
  const [timeSaving, setTimeSaving] = useState(false);

  const [editingIdentity, setEditingIdentity] = useState(null);
  const [identityEditValue, setIdentityEditValue] = useState('');
  const [identitySaving, setIdentitySaving] = useState(false);

  const [editingLifeAreas, setEditingLifeAreas] = useState(false);
  const [lifeAreaDraft, setLifeAreaDraft] = useState([]);
  const [lifeAreaSaving, setLifeAreaSaving] = useState(false);

  useEffect(() => {
    if (!user?.id) return;
    loadProfile();
  }, [user?.id]);

  async function loadProfile() {
    setLoading(true);
    const { data } = await supabase
      .from('user_profiles')
      .select(
        'display_name, full_name, identity_statement, big_goal, why, future_self, life_areas, preferred_reflection_time, timezone, profile_updated_at, short_term_state'
      )
      .eq('id', user.id)
      .maybeSingle();
    setProfile(data);
    setNameValue(data?.display_name || data?.full_name || '');
    setTimeValue(data?.preferred_reflection_time || '21:00');
    setTzValue(data?.timezone || 'America/New_York');
    setLoading(false);
  }

  const saveProfile = async (updates) => {
    await supabase
      .from('user_profiles')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', user.id);
  };

  const handleSaveName = async () => {
    if (!nameValue.trim()) return;
    setNameSaving(true);
    try {
      await saveProfile({ display_name: nameValue.trim(), full_name: nameValue.trim() });
      setProfile((p) => ({ ...p, display_name: nameValue.trim(), full_name: nameValue.trim() }));
      setEditingName(false);
    } finally {
      setNameSaving(false);
    }
  };

  const handleSaveTime = async () => {
    setTimeSaving(true);
    try {
      await saveProfile({ preferred_reflection_time: timeValue, timezone: tzValue });
      setProfile((p) => ({ ...p, preferred_reflection_time: timeValue, timezone: tzValue }));
      setEditingTime(false);
    } finally {
      setTimeSaving(false);
    }
  };

  const handleSignOut = async () => {
    await signOut();
  };

  const handleSaveIdentityField = async (fieldName) => {
    if (!identityEditValue.trim()) return;
    setIdentitySaving(true);
    try {
      await saveProfile({ [fieldName]: identityEditValue.trim() });
      setProfile((p) => ({ ...p, [fieldName]: identityEditValue.trim() }));
      setEditingIdentity(null);
    } finally {
      setIdentitySaving(false);
    }
  };

  const handleSaveLifeAreas = async () => {
    if (lifeAreaDraft.length < 3 || lifeAreaDraft.length > 5) return;
    setLifeAreaSaving(true);
    try {
      const { error } = await supabase
        .from('user_profiles')
        .update({ life_areas: lifeAreaDraft })
        .eq('id', user.id);
      if (error) throw error;
      setProfile((p) => ({ ...p, life_areas: lifeAreaDraft }));
      setEditingLifeAreas(false);
    } catch (err) {
      console.error('Failed to save life areas:', err);
      alert('Failed to save. Please try again.');
    } finally {
      setLifeAreaSaving(false);
    }
  };

  if (loading) {
    return (
      <AppShellV2 title="Settings">
        <div className="h-full overflow-y-auto flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-zinc-700 border-t-red-500 rounded-full animate-spin" />
        </div>
      </AppShellV2>
    );
  }

  const displayName = profile?.display_name || profile?.full_name || 'You';

  return (
    <AppShellV2 title="Settings">
      <div className="h-full overflow-y-auto">
        <div className="max-w-md mx-auto px-4 py-6 space-y-6">

          {/* ── Profile ─────────────────────────────────────────────── */}
          <section className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
            <h2 className="text-white font-semibold text-sm uppercase tracking-wider mb-4">Profile</h2>

            {/* Name */}
            <div className="mb-4">
              <p className="text-zinc-500 text-xs mb-1">Name</p>
              {editingName ? (
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={nameValue}
                    onChange={(e) => setNameValue(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSaveName()}
                    autoFocus
                    className="flex-1 bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-red-600"
                  />
                  <button
                    onClick={handleSaveName}
                    disabled={nameSaving}
                    className="px-3 py-2 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors"
                  >
                    {nameSaving ? '...' : 'Save'}
                  </button>
                  <button
                    onClick={() => {
                      setNameValue(profile?.display_name || profile?.full_name || '');
                      setEditingName(false);
                    }}
                    className="px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 text-sm rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <p className="text-white font-medium">{displayName}</p>
                  <button
                    onClick={() => setEditingName(true)}
                    className="text-zinc-500 hover:text-white text-xs transition-colors"
                  >
                    Edit
                  </button>
                </div>
              )}
            </div>

            {/* Email */}
            <div>
              <p className="text-zinc-500 text-xs mb-1">Email</p>
              <p className="text-zinc-300 text-sm">{user?.email}</p>
            </div>
          </section>

          {/* ── Reflection Time ──────────────────────────────────────── */}
          <section className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
            <h2 className="text-white font-semibold text-sm uppercase tracking-wider mb-4">
              Reflection Time
            </h2>

            {editingTime ? (
              <div className="space-y-3">
                <div>
                  <label className="text-zinc-500 text-xs mb-1 block">Time</label>
                  <input
                    type="time"
                    value={timeValue}
                    onChange={(e) => setTimeValue(e.target.value)}
                    className="bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-red-600"
                  />
                </div>
                <div>
                  <label className="text-zinc-500 text-xs mb-1 block">Timezone</label>
                  <select
                    value={tzValue}
                    onChange={(e) => setTzValue(e.target.value)}
                    className="bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-red-600 appearance-none"
                  >
                    {TIMEZONES.map((tz) => (
                      <option key={tz.value} value={tz.value}>
                        {tz.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={handleSaveTime}
                    disabled={timeSaving}
                    className="px-4 py-2 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors"
                  >
                    {timeSaving ? 'Saving...' : 'Save'}
                  </button>
                  <button
                    onClick={() => {
                      setTimeValue(profile?.preferred_reflection_time || '21:00');
                      setTzValue(profile?.timezone || 'America/New_York');
                      setEditingTime(false);
                    }}
                    className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 text-sm rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-white font-medium">
                      {profile?.preferred_reflection_time || '9:00 PM'}
                    </p>
                    <p className="text-zinc-500 text-xs mt-0.5">
                      {profile?.timezone || 'America/New_York'}
                    </p>
                  </div>
                  <button
                    onClick={() => setEditingTime(true)}
                    className="text-zinc-500 hover:text-white text-xs transition-colors"
                  >
                    Edit
                  </button>
                </div>
                <p className="text-zinc-600 text-xs mt-3">Notifications coming soon.</p>
              </div>
            )}
          </section>

          {/* ── Your Why ────────────────────────────────────────────── */}
          <section className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
            <h2 className="text-white font-semibold text-sm uppercase tracking-wider mb-4">Your Why</h2>

            <div className="space-y-4">
              {/* Identity */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <p className="text-zinc-500 text-xs">Identity</p>
                  {editingIdentity !== 'identity_statement' && (
                    <button
                      onClick={() => { setEditingIdentity('identity_statement'); setIdentityEditValue(profile?.identity_statement || ''); }}
                      className="text-zinc-500 hover:text-white text-xs transition-colors"
                    >
                      Edit
                    </button>
                  )}
                </div>
                {editingIdentity === 'identity_statement' ? (
                  <div className="space-y-2">
                    <textarea
                      value={identityEditValue}
                      onChange={(e) => setIdentityEditValue(e.target.value)}
                      autoFocus
                      rows={2}
                      className="w-full bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-red-600 resize-none"
                    />
                    <div className="flex gap-2">
                      <button onClick={() => handleSaveIdentityField('identity_statement')} disabled={identitySaving} className="px-3 py-1.5 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-xs rounded-lg transition-colors">{identitySaving ? '...' : 'Save'}</button>
                      <button onClick={() => setEditingIdentity(null)} className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 text-xs rounded-lg transition-colors">Cancel</button>
                    </div>
                  </div>
                ) : (
                  <p className="text-zinc-200 text-sm italic">{profile?.identity_statement ? `"${profile.identity_statement}"` : <span className="text-zinc-600">Not set yet.</span>}</p>
                )}
              </div>

              {/* Big Goal */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <p className="text-zinc-500 text-xs">Big Goal</p>
                  {editingIdentity !== 'big_goal' && (
                    <button
                      onClick={() => { setEditingIdentity('big_goal'); setIdentityEditValue(profile?.big_goal || ''); }}
                      className="text-zinc-500 hover:text-white text-xs transition-colors"
                    >
                      Edit
                    </button>
                  )}
                </div>
                {editingIdentity === 'big_goal' ? (
                  <div className="space-y-2">
                    <textarea
                      value={identityEditValue}
                      onChange={(e) => setIdentityEditValue(e.target.value)}
                      autoFocus
                      rows={2}
                      className="w-full bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-red-600 resize-none"
                    />
                    <div className="flex gap-2">
                      <button onClick={() => handleSaveIdentityField('big_goal')} disabled={identitySaving} className="px-3 py-1.5 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-xs rounded-lg transition-colors">{identitySaving ? '...' : 'Save'}</button>
                      <button onClick={() => setEditingIdentity(null)} className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 text-xs rounded-lg transition-colors">Cancel</button>
                    </div>
                  </div>
                ) : (
                  <p className="text-zinc-200 text-sm">{profile?.big_goal || <span className="text-zinc-600">Not set yet.</span>}</p>
                )}
              </div>

              {/* Deep Why */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <p className="text-zinc-500 text-xs">Deep Why</p>
                  {editingIdentity !== 'why' && (
                    <button
                      onClick={() => { setEditingIdentity('why'); setIdentityEditValue(profile?.why || ''); }}
                      className="text-zinc-500 hover:text-white text-xs transition-colors"
                    >
                      Edit
                    </button>
                  )}
                </div>
                {editingIdentity === 'why' ? (
                  <div className="space-y-2">
                    <textarea
                      value={identityEditValue}
                      onChange={(e) => setIdentityEditValue(e.target.value)}
                      autoFocus
                      rows={2}
                      className="w-full bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-red-600 resize-none"
                    />
                    <div className="flex gap-2">
                      <button onClick={() => handleSaveIdentityField('why')} disabled={identitySaving} className="px-3 py-1.5 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-xs rounded-lg transition-colors">{identitySaving ? '...' : 'Save'}</button>
                      <button onClick={() => setEditingIdentity(null)} className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 text-xs rounded-lg transition-colors">Cancel</button>
                    </div>
                  </div>
                ) : (
                  <p className="text-zinc-200 text-sm">{profile?.why || <span className="text-zinc-600">Not set yet.</span>}</p>
                )}
              </div>

              {/* Future Self */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <p className="text-zinc-500 text-xs">Future Self</p>
                  {editingIdentity !== 'future_self' && (
                    <button
                      onClick={() => { setEditingIdentity('future_self'); setIdentityEditValue(profile?.future_self || ''); }}
                      className="text-zinc-500 hover:text-white text-xs transition-colors"
                    >
                      Edit
                    </button>
                  )}
                </div>
                {editingIdentity === 'future_self' ? (
                  <div className="space-y-2">
                    <textarea
                      value={identityEditValue}
                      onChange={(e) => setIdentityEditValue(e.target.value)}
                      autoFocus
                      rows={2}
                      className="w-full bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-red-600 resize-none"
                    />
                    <div className="flex gap-2">
                      <button onClick={() => handleSaveIdentityField('future_self')} disabled={identitySaving} className="px-3 py-1.5 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-xs rounded-lg transition-colors">{identitySaving ? '...' : 'Save'}</button>
                      <button onClick={() => setEditingIdentity(null)} className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 text-xs rounded-lg transition-colors">Cancel</button>
                    </div>
                  </div>
                ) : (
                  <p className="text-zinc-200 text-sm italic">{profile?.future_self ? `"${profile.future_self}"` : <span className="text-zinc-600">Not set yet.</span>}</p>
                )}
              </div>
            </div>

            {profile?.profile_updated_at && (
              <p className="text-zinc-600 text-xs text-center mt-4">
                Profile last evolved by AI on {new Date(profile.profile_updated_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
              </p>
            )}
          </section>

          {/* ── How the AI Sees You Right Now ─────────────────────────── */}
          {profile?.short_term_state && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
              <p className="text-zinc-500 text-xs uppercase tracking-widest mb-2">How The AI Sees You Right Now</p>
              <p className="text-zinc-300 text-sm leading-relaxed">{profile.short_term_state}</p>
            </div>
          )}

          {/* ── Focus Areas ─────────────────────────────────────────── */}
          <section className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-white font-semibold text-sm uppercase tracking-wider">
                Focus Areas
              </h2>
              {!editingLifeAreas && (
                <button
                  onClick={() => {
                    setLifeAreaDraft(profile?.life_areas || []);
                    setEditingLifeAreas(true);
                  }}
                  className="text-zinc-500 hover:text-white text-xs transition-colors"
                >
                  Update
                </button>
              )}
            </div>

            {editingLifeAreas ? (
              <div>
                <p className="text-zinc-400 text-xs mb-3">Pick 3–5 areas.</p>
                <div className="flex flex-wrap gap-2 mb-4">
                  {DEFAULT_LIFE_AREA_OPTIONS.map(({ emoji, label }) => {
                    const selected = lifeAreaDraft.includes(label);
                    const atMax = !selected && lifeAreaDraft.length >= 5;
                    return (
                      <button
                        key={label}
                        onClick={() => {
                          if (selected) {
                            setLifeAreaDraft((prev) => prev.filter((x) => x !== label));
                          } else if (!atMax) {
                            setLifeAreaDraft((prev) => [...prev, label]);
                          }
                        }}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                          selected
                            ? 'bg-red-900 border-red-600 text-white'
                            : atMax
                            ? 'bg-zinc-800 border-zinc-700 text-zinc-600 cursor-not-allowed'
                            : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:border-zinc-500'
                        }`}
                      >
                        {selected && <Check className="w-3 h-3" />}
                        {emoji} {label}
                      </button>
                    );
                  })}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleSaveLifeAreas}
                    disabled={lifeAreaDraft.length < 3 || lifeAreaDraft.length > 5 || lifeAreaSaving}
                    className="flex-1 py-2 rounded-xl bg-red-600 hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold transition-colors"
                  >
                    {lifeAreaSaving ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    onClick={() => {
                      setLifeAreaDraft(profile?.life_areas || []);
                      setEditingLifeAreas(false);
                    }}
                    className="flex-1 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-semibold transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : profile?.life_areas && profile.life_areas.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {profile.life_areas.map((area) => (
                  <span
                    key={area}
                    className="px-3 py-1.5 rounded-full bg-red-900/30 border border-red-800/50 text-red-300 text-xs"
                  >
                    {LIFE_AREA_EMOJI[area] || ''} {area}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-zinc-600 text-sm">
                Complete onboarding to set your focus areas.
              </p>
            )}
          </section>

          {/* ── Danger Zone ─────────────────────────────────────────── */}
          <section className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
            <h2 className="text-zinc-500 font-semibold text-sm uppercase tracking-wider mb-4">
              Account
            </h2>
            <button
              onClick={handleSignOut}
              className="w-full py-3 rounded-xl bg-red-950 border border-red-800 text-red-400 hover:bg-red-900 hover:text-red-300 transition-colors text-sm font-medium"
            >
              Sign Out
            </button>
          </section>

          {/* Bottom padding */}
          <div className="h-4" />
        </div>
      </div>
    </AppShellV2>
  );
}
