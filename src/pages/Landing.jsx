import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { Brain, Target, TrendingUp, Sparkles, ArrowRight, CheckCircle, Zap, Award, Users } from 'lucide-react';

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
    navigate('/login');
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
              className="px-4 py-2 text-blue-600 hover:text-blue-700 font-medium transition-colors"
            >
              Sign In
            </button>
          </div>
        </header>

        {/* Hero */}
        <div className="pt-20 pb-32 text-center">
          <div className="inline-block mb-4">
            <span className="px-4 py-2 bg-blue-100 text-blue-700 rounded-full text-sm font-semibold">
              AI-Powered Self-Improvement
            </span>
          </div>
          <h1 className="text-5xl md:text-6xl lg:text-7xl font-bold text-slate-900 mb-6 leading-tight">
            Stop Just Writing. 
            <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600">
              Start Improving. 
            </span>
          </h1>
          <p className="text-xl md:text-2xl text-slate-600 mb-10 max-w-3xl mx-auto leading-relaxed">
            AI-powered journaling that detects patterns, tracks goals, and gives you actionable insights—not just a blank page.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <button
              onClick={handleGetStarted}
              className="px-8 py-4 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-semibold text-lg transition-all shadow-lg hover:shadow-xl flex items-center gap-2"
            >
              Start Journaling Free
              <ArrowRight className="w-5 h-5" />
            </button>
          </div>
          <p className="text-sm text-slate-500 mt-4">No credit card required • Setup in 30 seconds • Free forever</p>
        </div>

        {/* Social Proof */}
        <div className="pb-20">
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8">
            <div className="grid md:grid-cols-3 gap-8 text-center">
              <div>
                <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-3">
                  <Users className="w-6 h-6 text-blue-600" />
                </div>
                <div className="text-3xl font-bold text-slate-900 mb-1">500+</div>
                <div className="text-slate-600">Active Users</div>
              </div>
              <div>
                <div className="w-12 h-12 bg-purple-100 rounded-full flex items-center justify-center mx-auto mb-3">
                  <Zap className="w-6 h-6 text-purple-600" />
                </div>
                <div className="text-3xl font-bold text-slate-900 mb-1">10k+</div>
                <div className="text-slate-600">Insights Generated</div>
              </div>
              <div>
                <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
                  <Award className="w-6 h-6 text-green-600" />
                </div>
                <div className="text-3xl font-bold text-slate-900 mb-1">95%</div>
                <div className="text-slate-600">User Satisfaction</div>
              </div>
            </div>
          </div>
        </div>

        {/* Features */}
        <div className="pb-20">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold text-slate-900 mb-4">
              Your Personal AI Growth Coach
            </h2>
            <p className="text-xl text-slate-600 max-w-2xl mx-auto">
              Stop guessing.  Start knowing. Let AI reveal patterns you'd never spot alone.
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            <FeatureCard
              icon={<Sparkles className="w-6 h-6" />}
              title="AI Insights"
              description="Get intelligent analysis of your thoughts, emotions, and behavioral patterns—automatically after every entry."
              badge="Powered by GPT-4"
            />
            <FeatureCard
              icon={<Target className="w-6 h-6" />}
              title="Smart Goal Tracking"
              description="AI auto-detects when you're working on goals and tracks your progress without manual checkboxes."
              badge="Zero Effort"
            />
            <FeatureCard
              icon={<TrendingUp className="w-6 h-6" />}
              title="Pattern Detection"
              description="See what's holding you back and what's working—backed by real data from your journal over time."
              badge="Data-Driven"
            />
          </div>
        </div>

        {/* How It Works */}
        <div className="pb-20">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold text-slate-900 mb-4">
              Three Steps to Self-Awareness
            </h2>
            <p className="text-xl text-slate-600">
              It's embarrassingly simple. That's the point. 
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            <StepCard
              number="1"
              title="Write Freely"
              description="Journal naturally—no tags, no mood sliders, no checkboxes. Just write whatever is on your mind."
            />
            <StepCard
              number="2"
              title="AI Analyzes"
              description="Our AI detects patterns, emotions, and progress automatically. No manual work required."
            />
            <StepCard
              number="3"
              title="Take Action"
              description="Get clear, actionable insights and next steps. Turn reflection into real improvement."
            />
          </div>
        </div>

        {/* Benefits */}
        <div className="pb-20">
          <div className="bg-gradient-to-br from-blue-600 to-purple-600 rounded-3xl shadow-2xl p-8 md:p-12 text-white">
            <div className="max-w-4xl mx-auto">
              <h2 className="text-3xl md:text-4xl font-bold text-center mb-4">
                Built for People Who Want Results
              </h2>
              <p className="text-xl text-blue-100 text-center mb-10">
                Not another productivity hack.  Actual self-improvement backed by AI.
              </p>
              <div className="grid md:grid-cols-2 gap-6">
                <BenefitItem text="No more staring at a blank page" light />
                <BenefitItem text="Track goals without manual updates" light />
                <BenefitItem text="See patterns you'd never notice alone" light />
                <BenefitItem text="Get accountability from AI insights" light />
                <BenefitItem text="Understand yourself faster" light />
                <BenefitItem text="Turn reflection into action" light />
              </div>
            </div>
          </div>
        </div>

        {/* Testimonials */}
        <div className="pb-20">
          <div className="text-center mb-12">
            <h2 className="text-3xl md: text-4xl font-bold text-slate-900 mb-4">
              What People Are Saying
            </h2>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            <TestimonialCard
              quote="This app actually changed how I think about my goals. The AI caught patterns I completely missed."
              author="Sarah M."
              role="Product Manager"
            />
            <TestimonialCard
              quote="I've tried journaling apps before.  This one actually keeps me accountable. The insights are scary accurate."
              author="James K."
              role="Entrepreneur"
            />
            <TestimonialCard
              quote="Finally, a journal that doesn't just store my thoughts—it helps me understand them. Game changer."
              author="Emily R."
              role="Designer"
            />
          </div>
        </div>

        {/* Final CTA */}
        <div className="pb-20">
          <div className="bg-white rounded-3xl shadow-xl border border-slate-200 p-8 md:p-12 text-center">
            <h2 className="text-3xl md:text-4xl font-bold text-slate-900 mb-4">
              Ready to Start Improving?
            </h2>
            <p className="text-xl text-slate-600 mb-8 max-w-2xl mx-auto">
              Join hundreds of people using AI to turn journaling into real results.
            </p>
            <button
              onClick={handleGetStarted}
              className="px-8 py-4 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-semibold text-lg transition-all shadow-lg hover:shadow-xl flex items-center gap-2 mx-auto"
            >
              Start Free Now
              <ArrowRight className="w-5 h-5" />
            </button>
            <p className="text-sm text-slate-500 mt-4">
              Free forever • No credit card • Cancel anytime
            </p>
          </div>
        </div>

        {/* Footer */}
        <footer className="border-t border-slate-200 py-8">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <Brain className="w-5 h-5 text-blue-600" />
              <p className="text-slate-600 text-sm">
                © 2025 Retaliate AI. All rights reserved.
              </p>
            </div>
            <div className="flex gap-6 text-sm text-slate-600">
              <button 
                onClick={() => navigate('/privacy')} 
                className="hover:text-slate-900 transition-colors"
              >
                Privacy Policy
              </button>
              <button 
                onClick={() => navigate('/terms')} 
                className="hover:text-slate-900 transition-colors"
              >
                Terms of Service
              </button>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}

function FeatureCard({ icon, title, description, badge }) {
  return (
    <div className="bg-white rounded-xl p-6 shadow-md hover:shadow-xl transition-all border border-slate-200 group">
      <div className="flex items-start justify-between mb-4">
        <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center text-blue-600 group-hover:scale-110 transition-transform">
          {icon}
        </div>
        {badge && (
          <span className="px-2 py-1 bg-blue-50 text-blue-700 text-xs font-semibold rounded-full">
            {badge}
          </span>
        )}
      </div>
      <h3 className="text-xl font-semibold text-slate-900 mb-2">{title}</h3>
      <p className="text-slate-600 leading-relaxed">{description}</p>
    </div>
  );
}

function StepCard({ number, title, description }) {
  return (
    <div className="text-center group">
      <div className="w-16 h-16 bg-gradient-to-br from-blue-600 to-purple-600 text-white rounded-full flex items-center justify-center text-2xl font-bold mx-auto mb-4 shadow-lg group-hover:scale-110 transition-transform">
        {number}
      </div>
      <h3 className="text-xl font-semibold text-slate-900 mb-2">{title}</h3>
      <p className="text-slate-600 leading-relaxed">{description}</p>
    </div>
  );
}

function BenefitItem({ text, light }) {
  return (
    <div className="flex items-center gap-3">
      <CheckCircle className={`w-5 h-5 flex-shrink-0 ${light ? 'text-blue-200' : 'text-green-600'}`} />
      <span className={light ? 'text-white' : 'text-slate-700'}>{text}</span>
    </div>
  );
}

function TestimonialCard({ quote, author, role }) {
  return (
    <div className="bg-white rounded-xl p-6 shadow-md border border-slate-200">
      <div className="mb-4">
        <div className="flex gap-1 mb-3">
          {[...Array(5)].map((_, i) => (
            <svg key={i} className="w-5 h-5 text-yellow-400 fill-current" viewBox="0 0 20 20">
              <path d="M10 15l-5.878 3.09 1.123-6.545L.489 6.91l6.572-.955L10 0l2.939 5.955 6.572.955-4.756 4.635 1.123 6.545z" />
            </svg>
          ))}
        </div>
        <p className="text-slate-700 leading-relaxed italic">"{quote}"</p>
      </div>
      <div className="border-t border-slate-200 pt-4">
        <p className="font-semibold text-slate-900">{author}</p>
        <p className="text-sm text-slate-600">{role}</p>
      </div>
    </div>
  );
}