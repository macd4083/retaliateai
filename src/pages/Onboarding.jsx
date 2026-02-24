import React, { useState } from 'react';
import { useAuth } from '../lib/AuthContext';
import { supabase } from '../lib/supabase/client';

export default function Onboarding({ onComplete }) {
  const { user } = useAuth();
  const [step, setStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [name, setName] = useState('');
  const [age, setAge] = useState('');

  const handleBasicInfoSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim() || !age) {
      alert('Please fill in both fields');
      return;
    }

    setIsSubmitting(true);
    try {
      const { error } = await supabase
        .from('user_profiles')
        .update({
          display_name: name.trim(),
          age: parseInt(age),
        })
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

  const handleLifeAreasComplete = () => {
    setStep(3);
  };

  const handleGoalsComplete = async () => {
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

  return (
    <div className="min-h-screen bg-red-50 flex items-center justify-center p-6">
      <div className="w-full max-w-2xl">
        <div className="mb-8">
          <div className="flex items-center justify-center gap-2 mb-2">
            <div className={`h-2 w-2 rounded-full ${step >= 1 ? 'bg-red-600' : 'bg-slate-300'}`} />
            <div className={`h-2 w-2 rounded-full ${step >= 2 ? 'bg-red-600' : 'bg-slate-300'}`} />
            <div className={`h-2 w-2 rounded-full ${step >= 3 ? 'bg-red-600' : 'bg-slate-300'}`} />
          </div>
          <p className="text-center text-sm text-slate-600">Step {step} of 3</p>
        </div>

        {step === 1 && (
          <div className="bg-white rounded-lg shadow-lg p-8">
            <h1 className="text-3xl font-bold text-slate-900 mb-2">Welcome to Retaliate AI!</h1>
            <p className="text-slate-600 mb-8">Let's get to know you a little better.</p>

            <form onSubmit={handleBasicInfoSubmit} className="space-y-6">
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

        {step === 2 && (
          <div className="bg-white rounded-lg shadow-lg p-8">
            <h1 className="text-3xl font-bold text-slate-900 mb-2">What matters to you?</h1>
            <p className="text-slate-600 mb-8">
              Let's identify the areas of life that are most important to you right now.
            </p>

            <div className="space-y-4 mb-8">
              <p className="text-slate-700">
                <strong>Coming soon:</strong> Interactive exercise to identify your key life areas
                (Career, Health, Relationships, Personal Growth, etc.)
              </p>
              <p className="text-slate-600 text-sm">
                For now, click continue to proceed with setup.
              </p>
            </div>

            <button
              onClick={handleLifeAreasComplete}
              className="w-full bg-red-600 text-white py-3 rounded-lg font-medium hover:bg-red-700 transition-colors"
            >
              Continue
            </button>
          </div>
        )}

        {step === 3 && (
          <div className="bg-white rounded-lg shadow-lg p-8">
            <h1 className="text-3xl font-bold text-slate-900 mb-2">Let's set some goals</h1>
            <p className="text-slate-600 mb-8">
              Based on what's important to you, let's define your goals in each area.
            </p>

            <div className="space-y-4 mb-8">
              <p className="text-slate-700">
                <strong>Coming soon:</strong> Guided goal-setting exercise based on your life areas
              </p>
              <p className="text-slate-600 text-sm">
                For now, you can set goals later from the Goals tab.
              </p>
            </div>

            <button
              onClick={handleGoalsComplete}
              disabled={isSubmitting}
              className="w-full bg-red-600 text-white py-3 rounded-lg font-medium hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? 'Completing setup...' : 'Complete Setup'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}