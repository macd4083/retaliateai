import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { Brain, Target, TrendingUp, Sparkles, ArrowRight, CheckCircle } from 'lucide-react';

export default function Landing() {
  const navigate = useNavigate();
  const { user } = useAuth();

  // If user is already logged in, redirect to app
  React.useEffect(() => {
    if (user) {
      navigate('/Journal');
    }
  }, [user, navigate]);

  const handleGetStarted = () => {
    navigate('/login'); // Changed from '/Journal' to '/login'
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-purple-50">
      {/* Hero Section */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg: px-8">
        {/* Header */}
        <header className="pt-8 pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Brain className="w-8 h-8 text-blue-600" />
              <span className="text-2xl font-bold text-slate-900">Retaliate AI</span>
            </div>
            <button
              onClick={handleGetStarted}
              className="px-4 py-2 text-blue-600 hover:text-blue-700 font-medium"
            >
              Sign In
            </button>
          </div>
        </header>

        {/* Hero */}
        <div className="pt-20 pb-32 text-center">
          <h1 className="text-5xl md:text-6xl font-bold text-slate-900 mb-6 leading-tight">
            Stop Just Writing. 
            <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-purple-600">
              Start Improving.  
            </span>
          </h1>
          <p className="text-xl text-slate-600 mb-8 max-w-2xl mx-auto">
            AI-powered journaling that detects patterns, tracks goals, and gives you actionable insights—not just a blank page.
          </p>
          <button
            onClick={handleGetStarted}
            className="px-8 py-4 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-semibold text-lg transition-all shadow-lg hover:shadow-xl flex items-center gap-2 mx-auto"
          >
            Start Journaling Free
            <ArrowRight className="w-5 h-5" />
          </button>
          <p className="text-sm text-slate-500 mt-4">No credit card required  •  Setup in 30 seconds</p>
        </div>

        {/* Features */}
        <div className="grid md:grid-cols-3 gap-8 pb-20">
          <FeatureCard
            icon={<Sparkles className="w-6 h-6" />}
            title="AI Insights"
            description="Get intelligent analysis of your thoughts, emotions, and patterns—automatically."
          />
          <FeatureCard
            icon={<Target className="w-6 h-6" />}
            title="Goal Tracking"
            description="AI auto-detects when you're working on goals and tracks your progress without manual updates."
          />
          <FeatureCard
            icon={<TrendingUp className="w-6 h-6" />}
            title="Pattern Detection"
            description="See what's holding you back and what's working—backed by data from your journal."
          />
        </div>

        {/* How It Works */}
        <div className="pb-20">
          <h2 className="text-3xl font-bold text-center text-slate-900 mb-12">How It Works</h2>
          <div className="grid md:grid-cols-3 gap-8">
            <StepCard
              number="1"
              title="Write Freely"
              description="Journal naturally—no tags, no checkboxes, just write."
            />
            <StepCard
              number="2"
              title="AI Analyzes"
              description="Our AI detects patterns, emotions, and progress automatically."
            />
            <StepCard
              number="3"
              title="Take Action"
              description="Get clear insights and next steps to actually improve."
            />
          </div>
        </div>

        {/* Benefits */}
        <div className="bg-white rounded-2xl shadow-xl p-12 mb-20">
          <h2 className="text-3xl font-bold text-center text-slate-900 mb-8">
            Built for People Who Want Results
          </h2>
          <div className="grid md:grid-cols-2 gap-6 max-w-3xl mx-auto">
            <BenefitItem text="No more staring at a blank page" />
            <BenefitItem text="Track goals without manual updates" />
            <BenefitItem text="See patterns you'd never notice alone" />
            <BenefitItem text="Get accountability from AI insights" />
            <BenefitItem text="Understand yourself faster" />
            <BenefitItem text="Turn reflection into action" />
          </div>
        </div>

        {/* CTA */}
        <div className="text-center pb-20">
          <h2 className="text-4xl font-bold text-slate-900 mb-4">
            Ready to Start Improving?
          </h2>
          <p className="text-xl text-slate-600 mb-8">
            Join hundreds of people using AI to turn journaling into results.
          </p>
          <button
            onClick={handleGetStarted}
            className="px-8 py-4 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-semibold text-lg transition-all shadow-lg hover:shadow-xl flex items-center gap-2 mx-auto"
          >
            Start Free Now
            <ArrowRight className="w-5 h-5" />
          </button>
        </div>

        {/* Footer */}
        <footer className="border-t border-slate-200 py-8">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <p className="text-slate-600 text-sm">
              © 2025 Retaliate AI. All rights reserved.
            </p>
            <div className="flex gap-6 text-sm text-slate-600">
              <a href="#" className="hover:text-slate-900">Privacy Policy</a>
              <a href="#" className="hover:text-slate-900">Terms of Service</a>
              <a href="#" className="hover:text-slate-900">Contact</a>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}

function FeatureCard({ icon, title, description }) {
  return (
    <div className="bg-white rounded-xl p-6 shadow-md hover:shadow-lg transition-shadow">
      <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center text-blue-600 mb-4">
        {icon}
      </div>
      <h3 className="text-xl font-semibold text-slate-900 mb-2">{title}</h3>
      <p className="text-slate-600">{description}</p>
    </div>
  );
}

function StepCard({ number, title, description }) {
  return (
    <div className="text-center">
      <div className="w-16 h-16 bg-gradient-to-br from-blue-600 to-purple-600 text-white rounded-full flex items-center justify-center text-2xl font-bold mx-auto mb-4">
        {number}
      </div>
      <h3 className="text-xl font-semibold text-slate-900 mb-2">{title}</h3>
      <p className="text-slate-600">{description}</p>
    </div>
  );
}

function BenefitItem({ text }) {
  return (
    <div className="flex items-center gap-3">
      <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0" />
      <span className="text-slate-700">{text}</span>
    </div>
  );
}