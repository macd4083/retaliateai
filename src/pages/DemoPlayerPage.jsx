import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';

function parseStoredDemo(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (_error) {
    return null;
  }
}

export default function DemoPlayerPage() {
  const { id } = useParams();
  const [demoData, setDemoData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!id) {
      setError('Missing demo id.');
      return;
    }

    const raw = window.localStorage.getItem(`retaliateai_demo_${id}`);
    const demo = parseStoredDemo(raw);
    if (!demo) {
      setError('Demo not found.');
      return;
    }

    setDemoData(demo);
    setError('');
  }, [id]);

  useEffect(() => {
    if (!demoData) return;
    let canceled = false;

    const playDemo = () => {
      if (canceled || !window.RetaliateAIDemo?.play) return;
      window.RetaliateAIDemo.stop?.();
      window.RetaliateAIDemo.play(demoData);
      const root = document.getElementById('demo-player-page-root');
      if (root) root.setAttribute('data-demo-ready', 'true');
    };

    if (window.RetaliateAIDemo?.play) {
      playDemo();
      return () => {
        canceled = true;
      };
    }

    const script = document.createElement('script');
    script.src = '/retaliateai-demo-player.js';
    script.async = true;
    script.onload = playDemo;
    script.onerror = () => {
      if (!canceled) setError('Failed to load demo player script.');
    };
    document.body.appendChild(script);

    return () => {
      canceled = true;
      script.remove();
    };
  }, [demoData]);

  const message = useMemo(() => {
    if (error) return error;
    if (!demoData) return 'Loading demo...';
    return '';
  }, [demoData, error]);

  return (
    <main id="demo-player-page-root" className="min-h-screen w-full bg-zinc-950 text-zinc-100">
      {message ? (
        <div className="min-h-screen grid place-items-center px-6">
          <p className="rounded-xl border border-zinc-700 bg-zinc-900/60 px-4 py-3 text-sm">
            {message}
          </p>
        </div>
      ) : null}
    </main>
  );
}
