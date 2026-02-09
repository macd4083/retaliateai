import React, { useState } from 'react';
import { Sparkles, ArrowRight, Check, Loader2, Download } from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import { aiWorkflows } from '../lib/ai/workflows';

const STAGES = [
  { id: 'vision', name: 'Vision', emoji: '🎯', color: 'purple' },
  { id: 'pain', name: 'Pain', emoji: '🔥', color: 'orange' },
  { id: 'why', name: 'Why', emoji: '❤️', color: 'red' },
  { id: 'identity', name: 'Identity', emoji: '🧬', color: 'blue' },
  { id: 'obstacles', name: 'Obstacles', emoji: '🚧', color: 'yellow' },
  { id: 'roadmap', name: 'Roadmap', emoji: '📍', color: 'green' },
  { id: 'commitment', name: 'Commitment', emoji: '✅', color: 'indigo' },
];

const STAGE_QUESTIONS = {
  vision: [
    "Imagine it's 12 months from now and you've achieved this goal. What does your life look like? Describe a specific day.",
    "What would this achievement allow you to feel or become that you don't feel now?"
  ],
  pain: [
    "If nothing changes in the next 6 months, what will you regret? What's the real cost of staying where you are?",
    "Who else is affected by you staying stuck here?"
  ],
  why: [
    "Why is this goal important to you?",
    "And why is that important?",
    "And why does that matter?"
  ],
  identity: [
    "To achieve this, who do you need to become? Not what you need to do—but who you need to BE.",
    "What does that version of you do daily? What habits would they never tolerate?"
  ],
  obstacles: [
    "Be brutally honest: What's the biggest obstacle between you and your goal? What's really in the way?",
    "If that obstacle disappeared tomorrow, what would be the next thing in your way?"
  ],
  roadmap: [
    "What does success look like in measurable terms? How will you KNOW you've achieved this?",
    "What are the 3 major milestones between here and there? Break it down."
  ],
  commitment: [
    "What will you commit to doing THIS WEEK to move toward this? Be specific—what, when, where.",
    "What's your plan if you fall off track? What will you do to get back on?"
  ],
};

export default function Clarity() {
  const { user } = useAuth();
  const [started, setStarted] = useState(false);
  const [goal, setGoal] = useState('');
  const [currentStage, setCurrentStage] = useState(0);
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [answer, setAnswer] = useState('');
  const [stageResponses, setStageResponses] = useState([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [attempt, setAttempt] = useState(1);
  const [followUpQuestion, setFollowUpQuestion] = useState(null);
  const [completed, setCompleted] = useState(false);
  const [clarityMap, setClarityMap] = useState(null);
  const [saving, setSaving] = useState(false);

  const handleStart = () => {
    if (!goal.trim()) {
      alert('Please enter a goal first');
      return;
    }
    setStarted(true);
  };

  const handleSubmitAnswer = async () => {
    if (!answer.trim()) {
      alert('Please write something');
      return;
    }

    setAnalyzing(true);
    const stage = STAGES[currentStage].id;
    const question = STAGE_QUESTIONS[stage][currentQuestion];

    try {
      // Call AI to analyze depth
      const response = await fetch('/api/analyze-clarity-stage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: user.id,
          goal_text: goal,
          stage,
          question,
          user_answer: answer,
          attempt,
          previous_stages: stageResponses,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to analyze answer');
      }

      const analysis = await response.json();

      if (analysis.should_advance) {
        // Deep enough! Save response and move on
        const newResponse = {
          stage,
          question,
          answer,
          attempt,
        };
        
        const updatedResponses = [...stageResponses, newResponse];
        setStageResponses(updatedResponses);

        // Move to next question or stage
        const questions = STAGE_QUESTIONS[stage];
        if (currentQuestion + 1 < questions.length) {
          // Next question in same stage
          setCurrentQuestion(currentQuestion + 1);
          setAnswer('');
          setAttempt(1);
          setFollowUpQuestion(null);
        } else if (currentStage + 1 < STAGES.length) {
          // Next stage
          setCurrentStage(currentStage + 1);
          setCurrentQuestion(0);
          setAnswer('');
          setAttempt(1);
          setFollowUpQuestion(null);
        } else {
          // ALL DONE! Save clarity session
          await saveClaritySession(updatedResponses);
        }
      } else {
        // Not deep enough - show follow-up
        setFollowUpQuestion(analysis.follow_up_question);
        setAttempt(attempt + 1);
      }
    } catch (error) {
      console.error('Error analyzing answer:', error);
      alert('Something went wrong. Please try again.');
    } finally {
      setAnalyzing(false);
    }
  };

  const saveClaritySession = async (responses) => {
    setSaving(true);
    try {
      const result = await aiWorkflows.processClaritySession(user.id, {
        goal_text: goal,
        goal_id: null,
        stage_responses: responses,
      });

      setClarityMap(result.clarity_map);
      setCompleted(true);
    } catch (error) {
      console.error('Error saving clarity session:', error);
      alert('Failed to save session. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const downloadClarityMap = () => {
    const content = `
CLARITY MAP
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🎯 YOUR GOAL:
${clarityMap.goal}

💭 YOUR VISION:
${clarityMap.future_vision}

🔥 WHAT YOU'RE RUNNING FROM:
${clarityMap.pain_points.join(', ')}

❤️ YOUR REAL WHY:
${clarityMap.core_why}

🧬 WHO YOU'RE BECOMING:
${clarityMap.identity_statement}

🚧 YOUR BIGGEST OBSTACLE:
${clarityMap.primary_obstacle}

📍 YOUR MILESTONES:
${clarityMap.milestones.map((m, i) => `${i + 1}. ${m}`).join('\n')}

✅ THIS WEEK'S COMMITMENT:
${clarityMap.this_week_commitment}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    `.trim();

    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `clarity-map-${new Date().toISOString().split('T')[0]}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Completion View
  if (completed && clarityMap) {
    return (
      <div className="h-full overflow-y-auto bg-gradient-to-br from-purple-50 to-blue-50 p-8">
        <div className="max-w-4xl mx-auto">
          <div className="bg-white rounded-2xl shadow-lg border border-purple-200 p-8">
            <div className="text-center mb-8">
              <div className="inline-flex items-center justify-center w-20 h-20 bg-green-100 rounded-full mb-4">
                <Check className="w-10 h-10 text-green-600" />
              </div>
              <h1 className="text-3xl font-bold text-slate-900 mb-2">
                Clarity Session Complete!
              </h1>
              <p className="text-slate-600">
                Your insights have been saved to your journal
              </p>
            </div>

            <div className="space-y-6">
              <div className="bg-purple-50 rounded-xl p-6">
                <h2 className="text-lg font-semibold text-purple-900 mb-2 flex items-center gap-2">
                  🎯 Your Goal
                </h2>
                <p className="text-slate-700">{clarityMap.goal}</p>
              </div>

              <div className="bg-blue-50 rounded-xl p-6">
                <h2 className="text-lg font-semibold text-blue-900 mb-2 flex items-center gap-2">
                  💭 Your Vision
                </h2>
                <p className="text-slate-700">{clarityMap.future_vision}</p>
              </div>

              <div className="bg-red-50 rounded-xl p-6">
                <h2 className="text-lg font-semibold text-red-900 mb-2 flex items-center gap-2">
                  ❤️ Your Real Why
                </h2>
                <p className="text-slate-700">{clarityMap.core_why}</p>
              </div>

              <div className="bg-indigo-50 rounded-xl p-6">
                <h2 className="text-lg font-semibold text-indigo-900 mb-2 flex items-center gap-2">
                  🧬 Who You're Becoming
                </h2>
                <p className="text-slate-700">{clarityMap.identity_statement}</p>
              </div>

              <div className="bg-green-50 rounded-xl p-6">
                <h2 className="text-lg font-semibold text-green-900 mb-2 flex items-center gap-2">
                  ✅ This Week's Commitment
                </h2>
                <p className="text-slate-700">{clarityMap.this_week_commitment}</p>
              </div>
            </div>

            <div className="flex gap-4 mt-8">
              <button
                onClick={downloadClarityMap}
                className="flex-1 px-6 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors font-medium flex items-center justify-center gap-2"
              >
                <Download className="w-5 h-5" />
                Download Clarity Map
              </button>
              <button
                onClick={() => window.location.reload()}
                className="flex-1 px-6 py-3 bg-white border-2 border-purple-600 text-purple-600 rounded-lg hover:bg-purple-50 transition-colors font-medium"
              >
                Start New Session
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Main Clarity Session View
  if (started) {
    const stage = STAGES[currentStage];
    const questions = STAGE_QUESTIONS[stage.id];
    const question = questions[currentQuestion];
    const progress = ((currentStage * 100) / STAGES.length).toFixed(0);

    return (
      <div className="h-full overflow-y-auto bg-gradient-to-br from-purple-50 to-blue-50 p-8">
        <div className="max-w-3xl mx-auto">
          {/* Progress */}
          <div className="mb-8">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-slate-600">
                Stage {currentStage + 1} of {STAGES.length}: {stage.name}
              </span>
              <span className="text-sm font-medium text-slate-600">{progress}%</span>
            </div>
            <div className="h-2 bg-white rounded-full overflow-hidden">
              <div 
                className="h-full bg-purple-600 transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>

          {/* Stage Indicator */}
          <div className="flex justify-center gap-3 mb-8">
            {STAGES.map((s, i) => (
              <div
                key={s.id}
                className={`w-12 h-12 rounded-full flex items-center justify-center text-xl transition-all ${
                  i < currentStage
                    ? 'bg-green-100 opacity-50'
                    : i === currentStage
                    ? `bg-${s.color}-100 scale-110`
                    : 'bg-gray-100 opacity-30'
                }`}
              >
                {i < currentStage ? <Check className="w-6 h-6 text-green-600" /> : s.emoji}
              </div>
            ))}
          </div>

          {/* Question Card */}
          <div className="bg-white rounded-2xl shadow-lg border border-slate-200 p-8 mb-6">
            <div className="flex items-start gap-4 mb-6">
              <div className={`p-3 bg-${stage.color}-100 rounded-xl flex-shrink-0`}>
                <span className="text-3xl">{stage.emoji}</span>
              </div>
              <div className="flex-1">
                <h2 className="text-2xl font-bold text-slate-900 mb-2">
                  {stage.name}
                </h2>
                <p className="text-lg text-slate-700 leading-relaxed">
                  {followUpQuestion || question}
                </p>
                {followUpQuestion && (
                  <p className="text-sm text-purple-600 mt-2 font-medium">
                    Let's go deeper... (Attempt {attempt}/3)
                  </p>
                )}
              </div>
            </div>

            <textarea
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder="Take your time. Be honest. Be specific."
              className="w-full h-48 px-4 py-3 border-2 border-slate-200 rounded-xl resize-none focus:border-purple-500 focus:ring-2 focus:ring-purple-200 transition-colors"
              disabled={analyzing || saving}
            />

            <button
              onClick={handleSubmitAnswer}
              disabled={!answer.trim() || analyzing || saving}
              className="w-full mt-4 px-6 py-4 bg-purple-600 text-white rounded-xl hover:bg-purple-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors font-semibold text-lg flex items-center justify-center gap-2"
            >
              {analyzing ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Analyzing your response...
                </>
              ) : saving ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Saving your clarity session...
                </>
              ) : (
                <>
                  Continue
                  <ArrowRight className="w-5 h-5" />
                </>
              )}
            </button>
          </div>

          {/* Hint */}
          <div className="text-center text-sm text-slate-500">
            Press Enter while holding Shift to create a new line
          </div>
        </div>
      </div>
    );
  }

  // Welcome / Goal Input View
  return (
    <div className="h-full overflow-y-auto bg-gradient-to-br from-purple-50 to-blue-50 py-12 px-8">
      <div className="text-center max-w-2xl mx-auto">
        <div className="inline-flex items-center justify-center w-20 h-20 bg-purple-100 rounded-full mb-6">
          <Sparkles className="w-10 h-10 text-purple-600" />
        </div>
        <h1 className="text-4xl font-bold text-slate-900 mb-4">
          Clarity Workshop
        </h1>
        <p className="text-xl text-slate-600 mb-8">
          A deep-dive coaching session to discover your <span className="font-semibold text-purple-600">true goals</span> and <span className="font-semibold text-purple-600">why they matter</span>.
        </p>
        
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-8 text-left mb-8">
          <h2 className="text-lg font-semibold text-slate-900 mb-4">What you'll explore:</h2>
          <ul className="space-y-3 text-slate-700">
            {STAGES.map(stage => (
              <li key={stage.id} className="flex items-start gap-3">
                <span className={`text-${stage.color}-600 font-bold text-xl`}>{stage.emoji}</span>
                <span><strong>{stage.name}:</strong> Deep questions about your path forward</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-6">
          <label className="block text-left text-sm font-medium text-slate-700 mb-2">
            What goal do you want clarity on?
          </label>
          <input
            type="text"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="e.g., Launch my startup, Get in shape, Build better relationships"
            className="w-full px-4 py-3 border-2 border-slate-200 rounded-lg focus:border-purple-500 focus:ring-2 focus:ring-purple-200 transition-colors"
            onKeyPress={(e) => e.key === 'Enter' && handleStart()}
          />
        </div>

        <button 
          onClick={handleStart}
          disabled={!goal.trim()}
          className="px-8 py-4 bg-purple-600 text-white font-semibold rounded-lg hover:bg-purple-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors shadow-lg flex items-center gap-2 mx-auto"
        >
          Start Clarity Session
          <ArrowRight className="w-5 h-5" />
        </button>
        <p className="text-sm text-slate-500 mt-4">
          Takes 15-20 minutes • Saved as a journal entry with AI insights
        </p>
      </div>
    </div>
  );
}