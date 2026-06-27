import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { ArrowRight, CheckCircle, Download, Smartphone } from 'lucide-react';
import { usePWAInstall } from '@/hooks/usePWAInstall';
import { trackEvent } from '@/lib/analytics';
import { supabase } from '@/lib/supabase/client';
import { buildSignupPath, evaluateGuestAccess, readAttribution } from '@/lib/guestSession';

export default function Landing() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  // true while we are fetching the anonymous user's profile to decide where to send them
  const [checkingGuestProfile, setCheckingGuestProfile] = useState(false);

  useEffect(() => {
    if (!user) return;

    // Non-anonymous signed-in users go straight to the app.
    if (!user.is_anonymous) {
      navigate('/reflection', { replace: true });
      return;
    }

    // Anonymous (guest) user: check timing/signup policy before deciding what to show.
    // Per policy: do NOT auto-resume guest reflection from `/`.
    // If the guest is in cooldown or has completed their session, redirect to signup.
    // Otherwise, show the landing page so they can navigate intentionally.
    let cancelled = false;
    setCheckingGuestProfile(true);
    supabase
      .from('user_profiles')
      .select('requires_signup_for_next_session, guest_started_at, guest_cooldown_until')
      .eq('id', user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        const accessResult = !error ? evaluateGuestAccess(data) : 'allow';
        if (accessResult === 'require_signup' || accessResult === 'cooldown') {
          // Guest is blocked — send them to signup, preserving any attribution.
          navigate(buildSignupPath(readAttribution()), { replace: true });
        }
        // Otherwise (first-visit or within 2-day window): show the landing page.
        // Guest must intentionally navigate to /start/guest to enter a session.
      })
      .catch(() => {
        // On error, show landing page rather than auto-routing anywhere.
      })
      .finally(() => {
        if (!cancelled) setCheckingGuestProfile(false);
      });

    return () => {
      cancelled = true;
    };
  // navigate and supabase are stable references; user.id/is_anonymous drive re-runs.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, user?.is_anonymous]);

  const handleGetStarted = (location = 'hero') => {
    trackEvent('landing_cta_clicked', { location });
    navigate('/login?signup=true');
  };

  // Don't render anything while auth is resolving, a user is logged in, or we
  // are waiting for the guest profile check to complete.
  if (loading || user || checkingGuestProfile) return null;

  return (
    <div className="min-h-screen bg-black">
      {/* Animated red glow background */}
      <div className="fixed inset-0 bg-gradient-radial from-red-900/20 via-black to-black pointer-events-none" />
      
      {/* Content */}
      <div className="relative z-10">
        <div className="max-w-7xl 2xl:max-w-none mx-auto px-4 sm:px-6 lg:px-8 2xl:px-10">

          {/* ── 1. HEADER ── */}
          <header className="pt-8 pb-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <img 
                  src="/android-chrome2-192x192.png" 
                  alt="Retaliate AI" 
                  className="w-12 h-12 object-contain"
                />
                <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                  <span className="text-2xl font-blackletter tracking-tight text-white">
                    Retaliate AI
                  </span>
                  <span className="text-xs sm:text-sm font-serif italic tracking-[0.08em] text-gray-400">
                    Your partner in building daily discipline.
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <button
                  onClick={() => { trackEvent('landing_signin_clicked'); navigate('/login'); }}
                  className="px-6 py-2 text-red-500 hover:text-red-400 font-semibold transition-colors border border-red-900 hover:border-red-700 rounded"
                >
                  Sign In
                </button>
                <PWALandingBadge />
              </div>
            </div>
          </header>

          {/* ── 2. HERO ── */}
          <div className="pt-16 pb-24 md:pb-32">
            {/* 
              Grid: single column on mobile (< 768px), 12-col side-by-side at md+ (768px+)
              Text is first in DOM → always renders on LEFT when side-by-side
              Video is second in DOM → always renders on RIGHT when side-by-side
              No order overrides needed or wanted.
            */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-16 items-center">

              {/* ── LEFT: Text column ──
                   md (768px): 5/12 cols: text is compact, video gets 7/12 (58% of width)
                   lg (1024px): 4/12 cols: text even more compact, video gets 8/12 (67% of width)
                   No order classes. DOM order is correct */}
              <div className="md:col-span-5 lg:col-span-4 2xl:col-span-4 text-center lg:text-left mb-10 lg:mb-0">

                {/* Headline:
                    - Mobile (stacked): text-4xl, large, comfortable at full width
                    - md (768px, side-by-side starts): text-2xl, shrinks to give video room
                    - lg (1024px): text-3xl, screen wider, text can grow
                    - xl (1280px): text-4xl, more room
                    - 2xl (1536px): text-5xl, wide screens, near full size
                    No explicit <br /> tags. Let text wrap naturally at all column widths */}
                <h1 className="text-5xl lg:text-3xl xl:text-4xl 2xl:text-5xl font-bold text-white mb-6 lg:mb-8 leading-[1.15] tracking-tight">
                  There’s a war in your mind.
                  <br /><br />
                  <span className="text-red-600">
                    It’s time to pick a winner.
                  </span>
                </h1>

                {/* Subtext: also shrinks when side-by-side to preserve video size */}
                <p className="text-lg lg:text-sm xl:text-base 2xl:text-xl text-gray-400 leading-relaxed">
                  Your future self is fighting for the habits that will build the life you want. Your present self is fighting for comfort. Build the consistency and discipline the best version of you has. Bring your ambitions to life.
                </p>

              </div>

              {/* ── RIGHT: Video column ──
                   md (768px): 7/12 cols: video takes 58% of width
                   lg (1024px): 8/12 cols: video takes 67% of width, clearly dominant
                   No order classes. DOM order keeps video on right */}
              <div className="md:col-span-7 lg:col-span-8 2xl:col-span-8">
                {/*
                  HeroVideoPlayer: self-contained video with custom controls.
                  To resize or reposition the video, only change the `className` prop below.
                  All controls (seek bar, buttons, overlays) are sized relatively and will scale automatically.
                  The aspect-video class on the <video> element maintains 16:9 ratio at any width.
                */}
                <HeroVideoPlayer
                  src="/hero-video.mp4"
                  className="rounded-2xl overflow-hidden shadow-2xl shadow-red-900/50 border border-red-900/40 ring-2 ring-red-900/10"
                />
              </div>

            </div>

            {/* ── CTA: centered below BOTH columns, visually detached ──
                mt-12 md:mt-14 ensures clear visual separation from the grid above
                flex flex-col items-center centers the button horizontally within the full container width */}
            <div className="mt-12 md:mt-14 flex flex-col items-center gap-5 text-center">
              <button
                onClick={handleGetStarted}
                className="group px-10 py-5 bg-red-600 text-white rounded-lg hover:bg-red-700 font-bold text-lg transition-all shadow-2xl shadow-red-900/50 hover:shadow-red-900/70 flex items-center gap-3 uppercase tracking-wide"
              >
                Start Your Free Week
                <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </button>
              <p className="text-sm text-gray-500 tracking-wide">
                7 days free • No credit card • Feedback earns you another week
              </p>
            </div>
          </div>

          {/* ── 2b. WHAT HAPPENS IN EACH SESSION ── */}
          <div className="pb-32">
            <div className="text-center mb-16">
              <p className="text-red-500 text-sm font-bold uppercase tracking-widest mb-4">
                Inside Every Session
              </p>
              <h2 className="text-4xl md:text-5xl font-bold text-white mb-6 leading-tight">
                Four phases of conversation directed by an ai coach.
              </h2>
              <p className="text-xl text-gray-400 max-w-3xl mx-auto leading-relaxed">
                Taught to find what matters. Build and reinforce the why behind your desired identity shift.
              </p>
            </div>

            <div className="grid md:grid-cols-2 gap-6">
              {/* Phase 1. Accountability */}
              <div className="bg-gradient-to-b from-red-950/30 to-transparent border border-red-900/40 rounded-xl p-8">
                <div className="flex items-center gap-4 mb-4">
                  <span className="w-10 h-10 flex-shrink-0 rounded-full bg-red-600 text-white font-bold text-lg flex items-center justify-center">
                    1
                  </span>
                  <h3 className="text-xl font-bold text-white uppercase tracking-wide">Accountability Check</h3>
                </div>
                <p className="text-red-400 italic mb-4">
                  "You said you'd do [X] yesterday. Did you?"
                </p>
                <p className="text-gray-400 leading-relaxed">
                  Close the loop every other system skips. Answering honestly for yesterday's commitment is where real discipline forms. No quiet exits. No letting yourself off the hook unnoticed.
                </p>
              </div>

              {/* Phase 2. Wins and Momentum */}
              <div className="bg-gradient-to-b from-red-950/30 to-transparent border border-red-900/40 rounded-xl p-8">
                <div className="flex items-center gap-4 mb-4">
                  <span className="w-10 h-10 flex-shrink-0 rounded-full bg-red-600 text-white font-bold text-lg flex items-center justify-center">
                    2
                  </span>
                  <h3 className="text-xl font-bold text-white uppercase tracking-wide">Wins and Momentum</h3>
                </div>
                <p className="text-red-400 italic mb-4">
                  "What moved forward today? Where is it taking you?"
                </p>
                <p className="text-gray-400 leading-relaxed">
                  Not a highlight reel. A practice. Recognizing real wins and understanding what they signal about your trajectory is how confidence compounds into something you can actually feel.
                </p>
              </div>

              {/* Phase 3. Honest Reflection */}
              <div className="bg-gradient-to-b from-red-950/30 to-transparent border border-red-900/40 rounded-xl p-8">
                <div className="flex items-center gap-4 mb-4">
                  <span className="w-10 h-10 flex-shrink-0 rounded-full bg-red-600 text-white font-bold text-lg flex items-center justify-center">
                    3
                  </span>
                  <h3 className="text-xl font-bold text-white uppercase tracking-wide">Honest Reflection</h3>
                </div>
                <p className="text-red-400 italic mb-4">
                  "What didn't go as planned? What got in the way?"
                </p>
                <p className="text-gray-400 leading-relaxed">
                  Most people skip this and wonder why nothing changes. The AI hears excuses, acknowledges them, and pivots to what's actually in your control. Warm but direct. No shame, no coddling.
                </p>
              </div>

              {/* Phase 4. Tomorrow's Commitment */}
              <div className="bg-gradient-to-b from-red-950/30 to-transparent border border-red-900/40 rounded-xl p-8">
                <div className="flex items-center gap-4 mb-4">
                  <span className="w-10 h-10 flex-shrink-0 rounded-full bg-red-600 text-white font-bold text-lg flex items-center justify-center">
                    4
                  </span>
                  <h3 className="text-xl font-bold text-white uppercase tracking-wide">Tomorrow's Commitment</h3>
                </div>
                <p className="text-red-400 italic mb-4">
                  "What are you committing to tomorrow, and why does it matter to you?"
                </p>
                <p className="text-gray-400 leading-relaxed">
                  Vague intentions don't survive a real day. This phase turns intention into a specific promise tied to your long-term vision. The AI tracks whether you kept it and brings it back tomorrow night.
                </p>
              </div>
            </div>
          </div>

          {/* ── 8. SUCCESS VISION ── */}
          <div className="pb-16">
            <div className="text-center mb-16">
              <h2 className="text-4xl md:text-5xl font-bold text-white mb-4 uppercase tracking-tight">
                Commit to watch your transformation
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
                    'Your goals have a real why behind them. One you\'ve tested',
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
          <div className="pb-16">
            <div className="max-w-3xl mx-auto text-center">
              <h2 className="text-4xl md:text-5xl font-bold text-white mb-8 uppercase tracking-tight">
                Or Nothing Changes.
              </h2>
              <p className="text-xl text-gray-500 leading-relaxed mb-10">
                Same goals. Same excuses. Same feeling every night that you're behind.
                A year from now you'll still know what you want. You just won't have done it.
                That's not a motivation problem. It's a system problem.
              </p>
            </div>
          </div>

          {/* ── 10. FINAL CTA ── */}
          <div className="pb-16">
            <div className="bg-gradient-to-b from-red-950/40 to-transparent border-2 border-red-900 rounded-2xl p-16 backdrop-blur text-center">
              <h2 className="text-4xl md:text-5xl font-bold text-white mb-4 leading-tight">
                One week. No card. Real Commitment.
              </h2>
              <p className="text-xl text-gray-400 mb-10 max-w-2xl mx-auto">
                Ultimately it's your responsibility to create your success and happiness in your life. Treat your future-self with the habit that will give you everything.
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
                  onClick={() => handleGetStarted('bottom')}
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

          {/* ── 3b. PWA INSTALL ── */}
          <div className="pb-20">
            <PWALandingSection />
          </div>

          {/* ── 11. FOOTER ── */}
          <footer className="border-t border-red-900/30 py-8">
            <div className="flex flex-col md:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <img src="/android-chrome2-192x192.png" alt="Retaliate AI" className="w-5 h-5" />
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

function PWALandingBadge() {
  const { isInstallable, isStandalone, promptInstall } = usePWAInstall();
  if (isStandalone || !isInstallable) return null;

  return (
    <button
      onClick={() => promptInstall()}
      className="hidden sm:flex items-center gap-2 px-4 py-2 bg-zinc-900 border border-zinc-700 hover:border-red-700 text-zinc-300 hover:text-white rounded-lg text-sm font-medium transition-all"
    >
      <Download className="w-4 h-4" />
      Install App
    </button>
  );
}

function PWALandingSection() {
  const { isInstallable, isIos, isStandalone, promptInstall } = usePWAInstall();

  // Only hide if already running as installed PWA
  if (isStandalone) return null;

  return (
    <div className="border border-zinc-800 rounded-2xl p-8 md:p-12 bg-zinc-950/80 backdrop-blur">
      <div className="flex flex-col md:flex-row items-center gap-8 mb-8">
        <div className="w-20 h-20 rounded-2xl bg-red-900/40 border border-red-800 flex items-center justify-center flex-shrink-0">
          <Smartphone className="w-10 h-10 text-red-500" />
        </div>
        <div className="flex-1 text-center md:text-left">
          <h3 className="text-2xl font-bold text-white mb-2 uppercase tracking-wide">
            Add to Your Home Screen
          </h3>
          <p className="text-gray-400 leading-relaxed max-w-xl">
            Install Retaliate AI as an app. No App Store needed. Loads instantly and
            feels native on every device. One tap to open, every night.
          </p>
        </div>
      </div>

      {isInstallable && !isIos ? (
        <div className="flex flex-wrap gap-3 justify-center md:justify-start">
          <button
            onClick={() => promptInstall()}
            className="flex items-center gap-2 px-6 py-3 bg-red-600 hover:bg-red-700 text-white font-bold rounded-lg transition-all shadow-lg shadow-red-900/40 text-sm uppercase tracking-wide"
          >
            <Download className="w-4 h-4" />
            Install Free App
          </button>
          <div className="flex items-center gap-2 px-4 py-2.5 bg-zinc-900/50 rounded-lg text-xs text-zinc-500">
            ✓ No App Store &nbsp;·&nbsp; ✓ Free &nbsp;·&nbsp; ✓ All devices
          </div>
        </div>
      ) : (
        <div className="grid sm:grid-cols-3 gap-4">
          <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-5">
            <p className="text-white text-sm font-semibold mb-1">📱 iPhone / iPad</p>
            <p className="text-zinc-400 text-xs leading-relaxed">
              Open in Safari → tap <strong className="text-zinc-300">Share</strong> → <strong className="text-zinc-300">Add to Home Screen</strong>
            </p>
          </div>
          <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-5">
            <p className="text-white text-sm font-semibold mb-1">🤖 Android</p>
            <p className="text-zinc-400 text-xs leading-relaxed">
              Open in Chrome → tap <strong className="text-zinc-300">⋮ Menu</strong> → <strong className="text-zinc-300">Add to Home Screen</strong>
            </p>
          </div>
          <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-5">
            <p className="text-white text-sm font-semibold mb-1">🖥️ Desktop</p>
            <p className="text-zinc-400 text-xs leading-relaxed">
              Open in Chrome or Edge → click the <strong className="text-zinc-300">install icon</strong> in the address bar
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function HeroVideoPlayer({ src, className = '' }) {
  const videoRef = useRef(null);
  const containerRef = useRef(null);
  const seekBarRef = useRef(null);
  const hideTimer = useRef(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [showControls, setShowControls] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [autoMuted, setAutoMuted] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // Wait 1.5s before starting. Gives the page a moment to settle before audio kicks in
    const startTimer = setTimeout(() => {
      video.muted = false;
      video.play()
        .then(() => {
          setIsPlaying(true);
        })
        .catch(() => {
          // Browser blocked unmuted autoplay. Fall back to muted
          video.muted = true;
          setIsMuted(true);
          setAutoMuted(true);
          // Don't autoplay when muted. User must click the unmute button to start
          setIsPlaying(false);
        });
    }, 1500);

    return () => clearTimeout(startTimer);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onTimeUpdate = () => {
      setCurrentTime(video.currentTime);
      setProgress(video.duration ? (video.currentTime / video.duration) * 100 : 0);
    };
    const onLoadedMetadata = () => {
      setDuration(video.duration || 0);
      setCurrentTime(video.currentTime || 0);
      setProgress(video.duration ? (video.currentTime / video.duration) * 100 : 0);
    };
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);

    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('loadedmetadata', onLoadedMetadata);
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);

    return () => {
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('loadedmetadata', onLoadedMetadata);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
    };
  }, []);

  const revealControls = () => {
    setShowControls(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      if (videoRef.current && !videoRef.current.paused) {
        setShowControls(false);
      }
    }, 3000);
  };

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      v.play().catch(() => {});
    } else {
      v.pause();
    }
  };

  const toggleMute = () => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setIsMuted(v.muted);
    if (!v.muted) setAutoMuted(false);
  };

  const seek = (e) => {
    const v = videoRef.current;
    const bar = seekBarRef.current;
    if (!v || !bar || !v.duration) return;
    const rect = bar.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    v.currentTime = ratio * v.duration;
  };

  const beginDragSeek = (e) => {
    seek(e);
    const handleMouseMove = (moveEvent) => seek(moveEvent);
    const handleTouchMove = (moveEvent) => seek(moveEvent);
    const stopDrag = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', stopDrag);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', stopDrag);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', stopDrag);
    document.addEventListener('touchmove', handleTouchMove, { passive: true });
    document.addEventListener('touchend', stopDrag);
  };

  const toggleFullscreen = () => {
    const el = containerRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      el.requestFullscreen?.() || el.webkitRequestFullscreen?.();
    } else {
      const webkitExit = document['webkitExitFullscreen'];
      document.exitFullscreen?.() || webkitExit?.call(document);
    }
  };

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    document.addEventListener('webkitfullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      document.removeEventListener('webkitfullscreenchange', onChange);
    };
  }, []);

  const fmt = (s) => {
    if (!s || Number.isNaN(s)) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  useEffect(() => {
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className={`relative ${className}`}
      onMouseMove={revealControls}
      onMouseEnter={revealControls}
      onMouseLeave={() => {
        if (hideTimer.current) clearTimeout(hideTimer.current);
        if (videoRef.current && !videoRef.current.paused) setShowControls(false);
      }}
      onTouchStart={revealControls}
    >
      <video
        ref={videoRef}
        className="w-full aspect-video block object-cover"
        playsInline
        loop
        preload="auto"
        onClick={togglePlay}
        style={{ cursor: 'pointer' }}
      >
        <source src={src} type="video/mp4" />
      </video>

      <div className="absolute inset-0 bg-gradient-to-t from-red-900/20 via-transparent to-transparent pointer-events-none" />

      {/* Big centered unmute button, only shown when browser forced muted autoplay */}
      {autoMuted && (
        <button
          onClick={() => {
            const v = videoRef.current;
            if (!v) return;
            v.muted = false;
            setIsMuted(false);
            setAutoMuted(false);
            // Also ensure video is playing when user unmutes
            if (v.paused) {
              v.play().then(() => setIsPlaying(true)).catch(() => {});
            }
          }}
          className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 z-20 flex items-center gap-3 px-6 py-4 bg-black/50 hover:bg-black/70 backdrop-blur-sm text-white font-semibold text-base rounded-xl border border-white/20 hover:border-white/40 transition-all shadow-xl"
          aria-label="Play with sound"
        >
          <span aria-hidden="true">
            <VolumeOffIcon className="w-6 h-6 flex-shrink-0" />
          </span>
          Tap to play with sound
        </button>
      )}

      {!isPlaying && (
        <button
          onClick={togglePlay}
          className="absolute inset-0 z-10 flex items-center justify-center bg-black/30 backdrop-blur-[2px] transition-all"
          aria-label="Play video"
        >
          <div className="w-16 h-16 rounded-full bg-red-600/90 hover:bg-red-600 flex items-center justify-center shadow-2xl shadow-red-900/60 transition-all hover:scale-105">
            <PlayIcon className="w-7 h-7 text-white translate-x-0.5" />
          </div>
        </button>
      )}

      <div
        className={`absolute inset-0 flex flex-col justify-end pointer-events-none transition-opacity duration-300 ${
          showControls || !isPlaying ? 'opacity-100' : 'opacity-0'
        }`}
        style={{ zIndex: 15 }}
      >
        <div className="absolute bottom-0 left-0 right-0 h-20 bg-gradient-to-t from-black/75 via-black/40 to-transparent" />

        {/*
          Controls scale with container: icon sizes use w-4 h-4, text uses text-[11px],
          seek bar height is 1–1.5 Tailwind units. All relative, no fixed pixel sizes.
          To make controls larger on a bigger video, adjust w-4/h-4 → w-5/h-5 and text-[11px] → text-xs here.
        */}
        <div className="relative px-3 pb-3 flex flex-col gap-2 pointer-events-auto">
          <div
            ref={seekBarRef}
            role="slider"
            aria-label="Video progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress)}
            className="w-full h-1 bg-white/25 rounded-full cursor-pointer group/seek hover:h-1.5 transition-all duration-150"
            onClick={seek}
            onMouseDown={beginDragSeek}
            onTouchStart={beginDragSeek}
          >
            <div
              className="h-full bg-red-500 group-hover/seek:bg-red-400 rounded-full relative transition-colors"
              style={{ width: `${progress}%` }}
            >
              <div className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 w-3 h-3 bg-white rounded-full shadow opacity-0 group-hover/seek:opacity-100 transition-opacity" />
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <button
                onClick={togglePlay}
                className="p-1.5 text-white hover:text-red-400 transition-colors rounded"
                aria-label={isPlaying ? 'Pause' : 'Play'}
              >
                {isPlaying
                  ? <PauseIcon className="w-4 h-4" />
                  : <PlayIcon className="w-4 h-4 translate-x-px" />
                }
              </button>

              <button
                onClick={toggleMute}
                className="p-1.5 text-white hover:text-red-400 transition-colors rounded"
                aria-label={isMuted ? 'Unmute' : 'Mute'}
              >
                {isMuted
                  ? <VolumeOffIcon className="w-4 h-4" />
                  : <VolumeOnIcon className="w-4 h-4" />
                }
              </button>

              <span className="text-white/70 text-[11px] tabular-nums leading-none select-none">
                {fmt(currentTime)} / {fmt(duration)}
              </span>
            </div>

            <button
              onClick={toggleFullscreen}
              className="p-1.5 text-white hover:text-red-400 transition-colors rounded"
              aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            >
              {isFullscreen
                ? <ExitFullscreenIcon className="w-4 h-4" />
                : <FullscreenIcon className="w-4 h-4" />
              }
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function PlayIcon({ className = 'w-4 h-4' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M8 5.14v14l11-7-11-7z" />
    </svg>
  );
}

function PauseIcon({ className = 'w-4 h-4' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
    </svg>
  );
}

function VolumeOnIcon({ className = 'w-4 h-4' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
    </svg>
  );
}

function VolumeOffIcon({ className = 'w-4 h-4' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z" />
    </svg>
  );
}

function FullscreenIcon({ className = 'w-4 h-4' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" />
    </svg>
  );
}

function ExitFullscreenIcon({ className = 'w-4 h-4' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z" />
    </svg>
  );
}
