import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { Sparkles, Heart, Target, TrendingUp, ArrowRight, CheckCircle, Zap, Award, Users, Brain, Shield } from 'lucide-react';

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
    <div className="min-h-screen bg-black">
      {/* Animated red glow background */}
      <div className="fixed inset-0 bg-gradient-radial from-red-900/20 via-black to-black pointer-events-none" />
      
      {/* Content */}
      <div className="relative z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Header */}
          <header className="pt-8 pb-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <img 
                  src="/logo.png" 
                  alt="Retaliate AI" 
                  className="w-12 h-12 object-contain"
                />
                <span className="text-2xl font-bold tracking-tight text-white uppercase">
                  Retaliate AI
                </span>
              </div>
              <button
                onClick={handleGetStarted}
                className="px-6 py-2 text-red-500 hover:text-red-400 font-semibold transition-colors border border-red-900 hover:border-red-700 rounded"
              >
                Sign In
              </button>
            </div>
          </header>

          {/* Hero */}
          <div className="pt-20 pb-32 text-center">
            <div className="inline-block mb-6">
              <span className="px-6 py-2 bg-red-950/50 text-red-500 border border-red-900 rounded-full text-sm font-bold uppercase tracking-wider">
                AI-Powered Self-Improvement
              </span>
            </div>

            <h1 className="text-5xl md:text-6xl lg:text-7xl font-bold text-white mb-6 leading-[1.1] tracking-tight">
              Stop Just Writing.
              <br />
              <span className="text-red-600">
                Start Retaliating.
              </span>
            </h1>

            <p className="text-xl md:text-2xl text-gray-400 mb-12 max-w-3xl mx-auto leading-relaxed">
              Retaliate AI makes sure the steps you're taking are carrying you in a direction you want to go.
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <button
                onClick={handleGetStarted}
                className="px-10 py-5 bg-red-600 text-white rounded-lg hover:bg-red-700 font-bold text-lg transition-all shadow-2xl shadow-red-900/50 hover:shadow-red-900/70 flex items-center gap-3 uppercase tracking-wide group"
              >
                Start Free Now
                <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </button>
            </div>

            <p className="text-sm text-gray-600 mt-6 uppercase tracking-wider">
              No credit card required • Setup in 30 seconds • Free forever
            </p>
          </div>

          {/* Social Proof Stats */}
          <div className="pb-20">
            <div className="bg-gradient-to-b from-red-950/20 to-transparent border border-red-900/30 rounded-xl p-12 backdrop-blur-sm">
              <div className="grid md:grid-cols-3 gap-12 text-center">
                <div>
                  <div className="w-12 h-12 bg-red-900/50 rounded-full flex items-center justify-center mx-auto mb-3">
                    <Users className="w-6 h-6 text-red-500" />
                  </div>
                  <div className="text-5xl font-bold text-red-500 mb-2">500+</div>
                  <div className="text-gray-400 uppercase tracking-wider text-sm">Active Users</div>
                </div>
                <div>
                  <div className="w-12 h-12 bg-red-900/50 rounded-full flex items-center justify-center mx-auto mb-3">
                    <Zap className="w-6 h-6 text-red-500" />
                  </div>
                  <div className="text-5xl font-bold text-red-500 mb-2">10k+</div>
                  <div className="text-gray-400 uppercase tracking-wider text-sm">Insights Generated</div>
                </div>
                <div>
                  <div className="w-12 h-12 bg-red-900/50 rounded-full flex items-center justify-center mx-auto mb-3">
                    <Award className="w-6 h-6 text-red-500" />
                  </div>
                  <div className="text-5xl font-bold text-red-500 mb-2">95%</div>
                  <div className="text-gray-400 uppercase tracking-wider text-sm">Satisfaction Rate</div>
                </div>
              </div>
            </div>
          </div>

          {/* Features Grid */}
          <div className="pb-32">
            <div className="text-center mb-16">
              <h2 className="text-4xl md:text-5xl font-bold text-white mb-4 uppercase tracking-tight">
                Your Practices
              </h2>
              <p className="text-xl text-gray-400 max-w-2xl mx-auto">
                Stop guessing. Start knowing. Let AI reveal what you can't see.
              </p>
            </div>
            <div className="grid md:grid-cols-3 gap-8">
              <FeatureCard
                icon={<Brain className="w-7 h-7" />}
                title="AI Insights"
                description="Get intelligent analysis of your thoughts, emotions, and behavioral patterns—automatically after every entry."
              />
              <FeatureCard
                icon={<Sparkles className="w-7 h-7" />}
                title="Clarity"
                description="7-stage deep-dive session that interrogates your goals. No surface-level bullshit. Find what you're really after."
              />
              <FeatureCard
                icon={<Heart className="w-7 h-7" />}
                title="Gratitude"
                description="Build appreciation as a daily practice. What you focus on grows. Train your mind to see what's working."
              />
              <FeatureCard
                icon={<Target className="w-7 h-7" />}
                title="Goals"
                description="AI auto-detects when you're working toward something and tracks progress. No manual checkboxes."
              />
              <FeatureCard
                icon={<TrendingUp className="w-7 h-7" />}
                title="Pattern Detection"
                description="See what's holding you back and what's working—backed by real data from your journal over time."
              />
              <FeatureCard
                icon={<Shield className="w-7 h-7" />}
                title="Follow-Up Questions"
                description="AI asks deeper questions when you're avoiding the real issue. Forces you to go deeper until you hit truth."
              />
            </div>
          </div>

          {/* How It Works */}
          <div className="pb-32">
            <div className="text-center mb-16">
              <h2 className="text-4xl md:text-5xl font-bold text-white mb-4 uppercase tracking-tight">
                How It Works
              </h2>
              <p className="text-xl text-gray-400">
                Three steps. No complexity. Just results.
              </p>
            </div>
            <div className="grid md:grid-cols-3 gap-8">
              <StepCard
                number="1"
                title="Pick Your Practice"
                description="Journal freely, dig deep with Clarity, or reflect with Gratitude—choose what fits your goal today."
              />
              <StepCard
                number="2"
                title="AI Analyzes"
                description="Pattern recognition, emotion detection, goal tracking—all automatic. No manual work required."
              />
              <StepCard
                number="3"
                title="Take Action"
                description="Get clear, actionable insights and next steps. Turn reflection into real improvement."
              />
            </div>
          </div>

          {/* Benefits Section */}
          <div className="pb-32">
            <div className="bg-gradient-to-b from-red-950/40 to-transparent border-2 border-red-900 rounded-2xl p-16 backdrop-blur">
              <div className="max-w-4xl mx-auto">
                <h2 className="text-4xl md:text-5xl font-bold text-white text-center mb-4 uppercase tracking-tight">
                  Built for People Who Want Results
                </h2>
                <p className="text-xl text-gray-400 text-center mb-12">
                  Not another productivity hack. Actual self-improvement backed by AI.
                </p>
                <div className="grid md:grid-cols-2 gap-6">
                  <BenefitItem text="No more staring at a blank page" />
                  <BenefitItem text="Track goals without manual updates" />
                  <BenefitItem text="See patterns you'd never notice alone" />
                  <BenefitItem text="Get accountability from AI insights" />
                  <BenefitItem text="Understand yourself faster" />
                  <BenefitItem text="Turn reflection into action" />
                </div>
              </div>
            </div>
          </div>

          {/* Testimonials */}
          <div className="pb-32">
            <div className="text-center mb-16">
              <h2 className="text-4xl md:text-5xl font-bold text-white mb-4 uppercase tracking-tight">
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
                quote="I've tried journaling apps before. This one actually keeps me accountable. The insights are scary accurate."
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
          <div className="pb-32">
            <div className="bg-gradient-to-b from-red-950/40 to-transparent border-2 border-red-900 rounded-2xl p-16 backdrop-blur text-center">
              <h2 className="text-4xl md:text-5xl font-bold text-white mb-6 uppercase tracking-tight">
                It's Only a Matter of Time Until You Reach Your Goals.
                <br />
                <span className="text-red-600">Start the Countdown.</span>
              </h2>
              <button
                onClick={handleGetStarted}
                className="px-12 py-6 bg-red-600 text-white rounded-lg hover:bg-red-700 font-bold text-xl transition-all shadow-2xl shadow-red-900/60 uppercase tracking-wide inline-flex items-center gap-3 group mt-8"
              >
                Start Your Retaliation
                <ArrowRight className="w-6 h-6 group-hover:translate-x-1 transition-transform" />
              </button>
              <p className="text-sm text-gray-600 mt-6 uppercase tracking-wider">
                Free forever • No credit card • Cancel anytime
              </p>
            </div>
          </div>

          {/* Footer */}
          <footer className="border-t border-red-900/30 py-8">
            <div className="flex flex-col md:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <img src="/logo.png" alt="Retaliate AI" className="w-5 h-5" />
                <p className="text-gray-600 text-sm">
                  © 2025 Retaliate AI. Built for warriors, not victims.
                </p>
              </div>
              <div className="flex gap-6 text-sm text-gray-600">
                <button 
                  onClick={() => navigate('/privacy')} 
                  className="hover:text-gray-400 transition-colors"
                >
                  Privacy Policy
                </button>
                <button 
                  onClick={() => navigate('/terms')} 
                  className="hover:text-gray-400 transition-colors"
                >
                  Terms of Service
                </button>
              </div>
            </div>
          </footer>
        </div>
      </div>
    </div>
  );
}

function FeatureCard({ icon, title, description }) {
  return (
    <div className="bg-gradient-to-b from-red-950/30 to-transparent border border-red-900/40 rounded-xl p-8 hover:border-red-700 transition-all group">
      <div className="w-14 h-14 bg-red-900/50 rounded-lg flex items-center justify-center text-red-500 group-hover:bg-red-900 transition-colors mb-6">
        {icon}
      </div>
      <h3 className="text-2xl font-bold text-white mb-3 uppercase tracking-wide">{title}</h3>
      <p className="text-gray-400 leading-relaxed">{description}</p>
    </div>
  );
}

function StepCard({ number, title, description }) {
  return (
    <div className="text-center group">
      <div className="w-16 h-16 bg-gradient-to-br from-red-600 to-red-800 text-white rounded-lg flex items-center justify-center text-3xl font-bold mx-auto mb-6 shadow-lg shadow-red-900/50 group-hover:scale-110 transition-transform">
        {number}
      </div>
      <h3 className="text-2xl font-bold text-white mb-3 uppercase tracking-wide">{title}</h3>
      <p className="text-gray-400 leading-relaxed">{description}</p>
    </div>
  );
}

function BenefitItem({ text }) {
  return (
    <div className="flex items-center gap-3">
      <CheckCircle className="w-5 h-5 flex-shrink-0 text-red-500" />
      <span className="text-white">{text}</span>
    </div>
  );
}

function TestimonialCard({ quote, author, role }) {
  return (
    <div className="bg-gradient-to-b from-red-950/30 to-transparent border border-red-900/40 rounded-xl p-8 backdrop-blur-sm">
      <div className="mb-6">
        <div className="flex gap-1 mb-4">
          {[...Array(5)].map((_, i) => (
            <svg key={i} className="w-5 h-5 text-red-500 fill-current" viewBox="0 0 20 20">
              <path d="M10 15l-5.878 3.09 1.123-6.545L.489 6.91l6.572-.955L10 0l2.939 5.955 6.572.955-4.756 4.635 1.123 6.545z" />
            </svg>
          ))}
        </div>
        <p className="text-gray-300 leading-relaxed italic">"{quote}"</p>
      </div>
      <div className="border-t border-red-900/40 pt-4">
        <p className="font-bold text-white">{author}</p>
        <p className="text-sm text-gray-500">{role}</p>
      </div>
    </div>
  );
}