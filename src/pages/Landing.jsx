import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { Sparkles, Heart, Target, TrendingUp, ArrowRight, CheckCircle, Brain, Shield } from 'lucide-react';

export default function Landing() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();

  // If user is already logged in, redirect to app
  React.useEffect(() => {
    if (user) {
      navigate('/reflection');
    }
  }, [user, navigate]);

  const handleGetStarted = () => {
    navigate('/login?signup=true');
  };

  // Don't render anything while auth is resolving or if user is logged in
  if (loading || user) return null;

  return (
    <div className="min-h-screen bg-black">
      {/* Animated red glow background */}
      <div className="fixed inset-0 bg-gradient-radial from-red-900/20 via-black to-black pointer-events-none" />
      
      {/* Content */}
      <div className="relative z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">

          {/* ── 1. HEADER ── */}
          <header className="pt-8 pb-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <img 
                  src="/logo.png" 
                  alt="Retaliate AI" 
                  className="w-12 h-12 object-contain"
                />
                <span className="text-2xl font-blackletter tracking-tight text-white">
                  Retaliate AI
                </span>
              </div>
              <div className="flex items-center gap-4">
                <span className="hidden sm:inline-block px-4 py-1.5 bg-red-950/60 text-red-400 border border-red-800 rounded-full text-xs font-semibold tracking-wide">
                  🎁 Free 7-Day Trial — No Card Required
                </span>
                <button
                  onClick={() => navigate('/login')}
                  className="px-6 py-2 text-red-500 hover:text-red-400 font-semibold transition-colors border border-red-900 hover:border-red-700 rounded"
                >
                  Sign In
                </button>
              </div>
            </div>
          </header>

          {/* ── 2. HERO ── */}
          <div className="pt-20 pb-32 text-center">
            <div className="inline-block mb-6">
              <span className="px-6 py-2 bg-red-950/50 text-red-500 border border-red-900 rounded-full text-sm font-bold uppercase tracking-wider">
                Free Week Trial — No Credit Card
              </span>
            </div>

            <h1 className="text-5xl md:text-6xl lg:text-7xl font-bold text-white mb-6 leading-[1.1] tracking-tight">
              You know what you want.
              <br />
              <span className="text-red-600">
                You just keep not doing it.
              </span>
            </h1>

            <p className="text-xl md:text-2xl text-gray-400 mb-12 max-w-3xl mx-auto leading-relaxed">
              Every night, that familiar feeling. Another day where your goals stayed goals.
              Retaliate AI is the system that closes the loop — it remembers what you said,
              holds you to it, and helps you actually become who you keep saying you'll be.
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <button
                onClick={handleGetStarted}
                className="px-10 py-5 bg-red-600 text-white rounded-lg hover:bg-red-700 font-bold text-lg transition-all shadow-2xl shadow-red-900/50 hover:shadow-red-900/70 flex items-center gap-3 uppercase tracking-wide group"
              >
                Start Your Free Week
                <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </button>
            </div>

            <p className="text-sm text-gray-500 mt-6 tracking-wide">
              7 days free • No credit card • Feedback earns you another week
            </p>
          </div>

          {/* ── 3. PROMO BANNER ── */}
          <div className="pb-32">
            <div className="bg-red-950/60 border border-red-700 rounded-2xl p-12 backdrop-blur">
              <div className="text-center mb-10">
                <h2 className="text-2xl font-bold text-white uppercase tracking-wide">
                  Launch Offer — Limited Time
                </h2>
              </div>
              <div className="grid md:grid-cols-3 gap-8 mb-10">
                <div className="text-center">
                  <div className="text-3xl mb-3">🗓️</div>
                  <h3 className="font-bold text-white mb-2">7 Days Free</h3>
                  <p className="text-gray-400 text-sm leading-relaxed">
                    Full access, no credit card needed. See if this changes how you show up.
                  </p>
                </div>
                <div className="text-center">
                  <div className="text-3xl mb-3">💬</div>
                  <h3 className="font-bold text-white mb-2">Feedback = Another Week</h3>
                  <p className="text-gray-400 text-sm leading-relaxed">
                    Submit honest feedback during your trial and we'll add a second free week automatically.
                  </p>
                </div>
                <div className="text-center">
                  <div className="text-3xl mb-3">🔒</div>
                  <h3 className="font-bold text-white mb-2">No Risk</h3>
                  <p className="text-gray-400 text-sm leading-relaxed">
                    Cancel anytime. But most people don't want to.
                  </p>
                </div>
              </div>
              <div className="text-center">
                <button
                  onClick={handleGetStarted}
                  className="px-10 py-4 bg-red-600 text-white rounded-lg hover:bg-red-700 font-bold text-lg transition-all shadow-xl shadow-red-900/50 uppercase tracking-wide inline-flex items-center gap-3 group"
                >
                  Claim Your Free Week
                  <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                </button>
              </div>
            </div>
          </div>

          {/* ── 4. GUIDE SECTION ── */}
          <div className="pb-32">
            <div className="text-center mb-16">
              <p className="text-red-500 text-sm font-bold uppercase tracking-widest mb-4">
                Why This Works
              </p>
              <h2 className="text-4xl md:text-5xl font-bold text-white mb-6 leading-tight">
                We've figured out what actually makes people follow through.
              </h2>
              <p className="text-xl text-gray-400 max-w-3xl mx-auto leading-relaxed">
                Most apps track what you want. We track whether you did it — and why you didn't.
                Retaliate AI was built around one insight from behavioral research and real interviews:
                people change when they're consistently reconnected to why their goals matter and held
                accountable to what they said yesterday.
              </p>
            </div>
            <div className="grid md:grid-cols-3 gap-8">
              <div className="bg-gradient-to-b from-red-950/30 to-transparent border border-red-900/40 rounded-xl p-8 text-center">
                <div className="text-4xl font-bold text-red-500 mb-3">7 data points</div>
                <p className="text-gray-400 text-sm">captured every session</p>
              </div>
              <div className="bg-gradient-to-b from-red-950/30 to-transparent border border-red-900/40 rounded-xl p-8 text-center">
                <div className="text-2xl font-bold text-red-500 mb-3">Cross-session memory</div>
                <p className="text-gray-400 text-sm">AI remembers your patterns, not just your last message</p>
              </div>
              <div className="bg-gradient-to-b from-red-950/30 to-transparent border border-red-900/40 rounded-xl p-8 text-center">
                <div className="text-2xl font-bold text-red-500 mb-3">Commitment tracking</div>
                <p className="text-gray-400 text-sm">Knows if you did what you said</p>
              </div>
            </div>
          </div>

          {/* ── 5. THREE-STEP PLAN ── */}
          <div className="pb-32">
            <div className="text-center mb-16">
              <h2 className="text-4xl md:text-5xl font-bold text-white mb-4 uppercase tracking-tight">
                How It Works
              </h2>
              <p className="text-xl text-gray-400">
                Three steps. Every night. Takes five minutes.
              </p>
            </div>
            <div className="grid md:grid-cols-3 gap-8">
              <StepCard
                number="1"
                title="Tell it how your day went"
                description="Open the app, share your wins and where you fell short. No blank page. The AI leads the conversation."
              />
              <StepCard
                number="2"
                title="It holds you to yesterday. You commit to tomorrow."
                description="It remembers what you said last night. Asks about it. Then helps you make a specific, realistic plan for tomorrow — not a vague intention."
              />
              <StepCard
                number="3"
                title="Over time, it knows you better than you know yourself."
                description="It tracks your patterns, your excuses, your breakthroughs. The longer you use it, the harder it is to bullshit."
              />
            </div>
          </div>

          {/* ── 6. PRODUCT SCREENSHOT / MOCKUP ── */}
          <div className="pb-32">
            <div className="text-center mb-12">
              <p className="text-red-500 text-sm font-bold uppercase tracking-widest mb-4">
                See It In Action
              </p>
              <h2 className="text-4xl md:text-5xl font-bold text-white mb-4 uppercase tracking-tight">
                A real conversation. Every night.
              </h2>
              <p className="text-xl text-gray-400 max-w-2xl mx-auto">
                Not prompts. Not a form. A coach that remembers everything.
              </p>
            </div>
            <MockupSlideshow />
          </div>

          {/* ── 7. FEATURES ── */}
          <div className="pb-32">
            <div className="text-center mb-16">
              <h2 className="text-4xl md:text-5xl font-bold text-white mb-4 uppercase tracking-tight">
                Built Around How People Actually Change
              </h2>
            </div>
            <div className="grid md:grid-cols-3 gap-8">
              <FeatureCard
                icon={<Brain className="w-7 h-7" />}
                title="It Remembers"
                description="Every session is stored. Your wins, your misses, your excuses. The AI builds a picture of you over time — not just what you did, but why you keep doing it."
                tooltip={{
                  title: 'Long-term memory',
                  description: 'Vector-embedded session history lets the AI surface semantically similar moments from weeks ago — connecting patterns you\'d never notice in the moment.'
                }}
              />
              <FeatureCard
                icon={<Target className="w-7 h-7" />}
                title="It Tracks Your Word"
                description="You committed to something last night. It knows. Tonight it's going to ask you about it. That's the loop most apps don't close."
                tooltip={{
                  title: 'Commitment accountability',
                  description: 'Commitment kept/missed rates, trajectory (improving, stable, declining), and a live gauge for the current week — behavioral data, not self-reported feelings.'
                }}
              />
              <FeatureCard
                icon={<Shield className="w-7 h-7" />}
                title="It Won't Let You Off the Hook"
                description="It hears excuses. It acknowledges them — and pivots to what's in your control. Warm but direct. No shame, no coddling."
                tooltip={{
                  title: 'Anti-excuse system',
                  description: 'Intent classification detects excuse patterns in real-time. After three consecutive excuse signals, it escalates — pulling your future self vision into the conversation.'
                }}
              />
              <FeatureCard
                icon={<TrendingUp className="w-7 h-7" />}
                title="It Sees Your Patterns"
                description="The blockers that keep showing up. The wins that keep happening. The gap between who you say you are and what you actually do. It names it."
                tooltip={{
                  title: 'Behavioral pattern synthesis',
                  description: 'Cross-session insight synthesis runs after every completed session — identifying recurring themes, emerging strengths, and persistent blockers from up to 30 sessions of data.'
                }}
              />
              <FeatureCard
                icon={<Sparkles className="w-7 h-7" />}
                title="It Builds Your Why"
                description="Goals without a reason behind them don't survive hard days. This AI works to deepen your understanding of why your goals actually matter to you — not the surface answer, the real one."
                tooltip={{
                  title: 'Motivation architecture',
                  description: 'Why-building is tracked per goal over time. The system knows when your motivation signal is declining and prioritizes reconnecting you to your why before you quietly quit.'
                }}
              />
              <FeatureCard
                icon={<Heart className="w-7 h-7" />}
                title="It Evolves With You"
                description="After every session, your profile updates. Your strengths, your patterns, your identity. The AI that talks to you in month three knows things about you that month-one you couldn't have told it."
                tooltip={{
                  title: 'Adaptive profile evolution',
                  description: 'Post-session GPT-4o pass updates your short-term state, long-term patterns, growth areas, values, and strengths — building a behavioral profile that makes every future session more accurate.'
                }}
              />
            </div>
          </div>

          {/* ── 8. SUCCESS VISION ── */}
          <div className="pb-32">
            <div className="text-center mb-16">
              <h2 className="text-4xl md:text-5xl font-bold text-white mb-4 uppercase tracking-tight">
                What It Looks Like When It's Working
              </h2>
            </div>
            <div className="grid md:grid-cols-2 gap-8">
              {/* Before */}
              <div className="bg-gradient-to-b from-gray-900/40 to-transparent border border-gray-800 rounded-2xl p-10">
                <p className="text-gray-500 text-sm font-bold uppercase tracking-widest mb-6">
                  Right now
                </p>
                <ul className="space-y-4">
                  {[
                    'Goals you think about but don\'t move on',
                    'Nights where you feel behind but don\'t know why',
                    'Promising yourself things that don\'t stick',
                    'Motivation that spikes and disappears',
                  ].map((item) => (
                    <li key={item} className="flex items-start gap-3 text-gray-500">
                      <span className="mt-1 w-4 h-4 flex-shrink-0 rounded-full border border-gray-700" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
              {/* After */}
              <div className="bg-gradient-to-b from-red-950/40 to-transparent border border-red-800 rounded-2xl p-10">
                <p className="text-red-500 text-sm font-bold uppercase tracking-widest mb-6">
                  After 30 days
                </p>
                <ul className="space-y-4">
                  {[
                    'You know exactly what you committed to and whether you kept it',
                    'You understand the pattern behind your own inconsistency',
                    'Your goals have a real why behind them — one you\'ve tested',
                    'You\'re becoming someone who does what they say',
                  ].map((item) => (
                    <li key={item} className="flex items-start gap-3 text-white">
                      <CheckCircle className="mt-0.5 w-5 h-5 flex-shrink-0 text-red-500" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>

          {/* ── 9. FAILURE WARNING ── */}
          <div className="pb-32">
            <div className="max-w-3xl mx-auto text-center">
              <h2 className="text-4xl md:text-5xl font-bold text-white mb-8 uppercase tracking-tight">
                Or Nothing Changes.
              </h2>
              <p className="text-xl text-gray-500 leading-relaxed mb-10">
                Same goals. Same excuses. Same feeling every night that you're behind.
                A year from now you'll still know what you want. You just won't have done it.
                That's not a motivation problem. It's a system problem.
              </p>
              <button
                onClick={handleGetStarted}
                className="px-10 py-5 bg-red-600 text-white rounded-lg hover:bg-red-700 font-bold text-lg transition-all shadow-2xl shadow-red-900/50 uppercase tracking-wide inline-flex items-center gap-3 group"
              >
                Get the system. Start free.
                <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </button>
            </div>
          </div>

          {/* ── 10. FINAL CTA ── */}
          <div className="pb-32">
            <div className="bg-gradient-to-b from-red-950/40 to-transparent border-2 border-red-900 rounded-2xl p-16 backdrop-blur text-center">
              <h2 className="text-4xl md:text-5xl font-bold text-white mb-4 leading-tight">
                One week. No card. No commitment.
              </h2>
              <p className="text-xl text-gray-400 mb-10 max-w-2xl mx-auto">
                Just seven nights to find out if this is the thing that actually works for you.
              </p>
              {/* Promo reminder card */}
              <div className="inline-block bg-red-950/60 border border-red-800 rounded-xl px-8 py-6 mb-10 text-left">
                <ul className="space-y-2">
                  {[
                    '7 days free',
                    'No credit card required',
                    'Submit feedback → get a second week free',
                    'Cancel anytime',
                  ].map((item) => (
                    <li key={item} className="flex items-center gap-3 text-white text-sm">
                      <CheckCircle className="w-4 h-4 flex-shrink-0 text-red-500" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <button
                  onClick={handleGetStarted}
                  className="px-12 py-6 bg-red-600 text-white rounded-lg hover:bg-red-700 font-bold text-xl transition-all shadow-2xl shadow-red-900/60 uppercase tracking-wide inline-flex items-center gap-3 group"
                >
                  Start Your Free Week
                  <ArrowRight className="w-6 h-6 group-hover:translate-x-1 transition-transform" />
                </button>
              </div>
              <p className="text-sm text-gray-500 mt-6">
                Built for people who are serious about becoming who they say they'll be.
              </p>
            </div>
          </div>

          {/* ── 11. FOOTER ── */}
          <footer className="border-t border-red-900/30 py-8">
            <div className="flex flex-col md:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <img src="/logo.png" alt="Retaliate AI" className="w-5 h-5" />
                <p className="text-gray-600 text-sm">
                  © 2026 Retaliate AI. Built for people who are done making excuses.
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

// 🔥 NEW SLIDESHOW COMPONENT 🔥
function MockupSlideshow() {
  const [currentSlide, setCurrentSlide] = useState(0);
  const mockups = [
    { png: '/mockup-1.png', webp: '/mockup-1.webp', alt: 'Retaliate AI Dashboard - Journal Interface' },
    { png: '/mockup-2.png', webp: '/mockup-2.webp', alt: 'Retaliate AI - AI Insights Analysis' },
    { png: '/mockup-3.png', webp: '/mockup-3.webp', alt: 'Retaliate AI - Goal Tracking Dashboard' }
  ];

  // Auto-advance slideshow every 4 seconds
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentSlide((prev) => (prev + 1) % mockups.length);
    }, 4000);

    return () => clearInterval(timer);
  }, [mockups.length]);

  return (
    <div className="max-w-6xl mx-auto">
      {/* Slideshow Container */}
      <div className="relative aspect-[16/10] rounded-2xl overflow-hidden bg-gradient-to-br from-gray-100 to-white shadow-2xl shadow-red-900/30 border-2 border-red-900/20">
        
        {/* Red glow overlay to blend white backgrounds */}
        <div className="absolute inset-0 bg-gradient-to-t from-red-900/10 via-transparent to-red-900/5 pointer-events-none z-10" />
        
        {/* Mockup Images */}
        {mockups.map((mockup, index) => (
          <div
            key={index}
            className={`absolute inset-0 transition-opacity duration-1000 ease-in-out ${
              currentSlide === index ? 'opacity-100' : 'opacity-0'
            }`}
          >
            <picture>
              <source srcSet={mockup.webp} type="image/webp" />
              <img 
                src={mockup.png} 
                alt={mockup.alt}
                className="w-full h-full object-contain p-8"
                loading={index === 0 ? "eager" : "lazy"}
              />
            </picture>
          </div>
        ))}

        {/* Slide Indicators */}
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex gap-3 z-20">
          {mockups.map((_, index) => (
            <button
              key={index}
              onClick={() => setCurrentSlide(index)}
              className={`transition-all duration-300 rounded-full ${
                currentSlide === index 
                  ? 'w-8 h-3 bg-red-600' 
                  : 'w-3 h-3 bg-gray-400 hover:bg-red-400'
              }`}
              aria-label={`Go to slide ${index + 1}`}
            />
          ))}
        </div>
      </div>

      {/* Slideshow Progress Bar */}
      <div className="mt-6 h-1 bg-red-950/30 rounded-full overflow-hidden">
        <div 
          className="h-full bg-red-600 transition-all duration-1000 ease-linear"
          style={{ 
            width: `${((currentSlide + 1) / mockups.length) * 100}%` 
          }}
        />
      </div>
    </div>
  );
}

function FeatureCard({ icon, title, description, tooltip }) {
  const [hoveredCard, setHoveredCard] = useState(false);
  const [showTooltip, setShowTooltip] = useState(false);
  const hoverTimeoutRef = useRef(null);

  const handleMouseEnter = () => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
    }
    
    setHoveredCard(true);
    
    // 500ms delay before showing tooltip
    hoverTimeoutRef.current = setTimeout(() => {
      setShowTooltip(true);
    }, 500);
  };

  const handleMouseLeave = () => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
    }
    
    setHoveredCard(false);
    setShowTooltip(false);
  };

  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
      }
    };
  }, []);

  return (
    <div 
      className="relative bg-gradient-to-b from-red-950/30 to-transparent border border-red-900/40 rounded-xl p-8 hover:border-red-700 transition-all group"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div className="w-14 h-14 bg-red-900/50 rounded-lg flex items-center justify-center text-red-500 group-hover:bg-red-900 transition-colors mb-6">
        {icon}
      </div>
      <h3 className="text-2xl font-bold text-white mb-3 uppercase tracking-wide">{title}</h3>
      <p className="text-gray-400 leading-relaxed">{description}</p>
      
      {/* Hover tooltip with fade-in */}
      {showTooltip && tooltip && (
        <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-4 z-50 w-80 pointer-events-none animate-in fade-in duration-200">
          <div className="bg-red-950/95 border border-red-900/60 rounded-lg shadow-2xl shadow-red-900/40 p-4 backdrop-blur-sm">
            <div className="font-bold text-sm mb-2 text-red-400 uppercase tracking-wide">
              {tooltip.title}
            </div>
            <div className="text-xs leading-relaxed text-gray-300">
              {tooltip.description}
            </div>
          </div>
          {/* Arrow pointing down */}
          <div className="absolute left-1/2 -translate-x-1/2 -bottom-2 w-4 h-4 bg-red-950/95 border-r border-b border-red-900/60 rotate-45"></div>
        </div>
      )}
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
