import { useEffect, useRef, useState } from 'react';
import { Download, Loader2, Trash2 } from 'lucide-react';
import { ExportProgressBar } from './ExportProgressBar';
import { resolveExportUrl, videoExportApi } from '../../utils/videoExportApi';

const defaultConfig = {
  demoUrl: 'http://localhost:5173/demo/abc123',
  resolution: '1080p',
  fps: 30,
  format: 'mp4',
  duration: 30,
  musicUrl: '',
  musicVolume: 0.3,
  watermark: {
    enabled: false,
    text: 'RetaliateAI',
    position: 'bottom-right',
    opacity: 0.7,
  },
  storage: 'local',
};

export default function VideoExportEngine({ initialDemoUrl = '', handoffMessage = '' }) {
  const [config, setConfig] = useState(defaultConfig);
  const [activeJob, setActiveJob] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [handoffNotice, setHandoffNotice] = useState(handoffMessage);
  const sourceRef = useRef(null);

  useEffect(() => {
    if (!initialDemoUrl) return;
    setConfig((prev) => ({ ...prev, demoUrl: initialDemoUrl }));
  }, [initialDemoUrl]);

  useEffect(() => {
    setHandoffNotice(handoffMessage || '');
  }, [handoffMessage]);

  useEffect(() => {
    if (!handoffNotice) return;
    const timer = window.setTimeout(() => setHandoffNotice(''), 2800);
    return () => window.clearTimeout(timer);
  }, [handoffNotice]);

  const refreshJobs = async () => {
    try {
      const nextJobs = await videoExportApi.getJobs();
      setJobs(nextJobs);
    } catch (err) {
      setError(err.message || 'Failed to load export jobs');
    }
  };

  useEffect(() => {
    refreshJobs();

    return () => {
      if (sourceRef.current) {
        sourceRef.current.close();
      }
    };
  }, []);

  const setWatermark = (patch) => {
    setConfig((prev) => ({
      ...prev,
      watermark: { ...prev.watermark, ...patch },
    }));
  };

  const startExport = async () => {
    setLoading(true);
    setError('');

    try {
      if (sourceRef.current) {
        sourceRef.current.close();
      }

      const payload = {
        ...config,
        fps: Number(config.fps),
        duration: Number(config.duration),
        musicVolume: Number(config.musicVolume),
        musicUrl: config.musicUrl?.trim() || null,
      };

      const { jobId } = await videoExportApi.startExport(payload);

      setActiveJob({
        id: jobId,
        status: 'queued',
        progress: 0,
        message: 'Queued',
        outputUrl: null,
      });

      const source = videoExportApi.createProgressStream(
        jobId,
        (job) => {
          if (job.error) {
            setError(job.error);
            source.close();
            sourceRef.current = null;
            return;
          }

          setActiveJob(job);

          if (job.status === 'done' || job.status === 'failed') {
            source.close();
            sourceRef.current = null;
            refreshJobs();
          }
        },
        () => {
          setError('Progress stream disconnected');
        },
      );

      sourceRef.current = source;
      await refreshJobs();
    } catch (err) {
      setError(err.message || 'Failed to start export');
    } finally {
      setLoading(false);
    }
  };

  const deleteJob = async (jobId) => {
    try {
      await videoExportApi.deleteJob(jobId);

      if (activeJob?.id === jobId) {
        if (sourceRef.current) sourceRef.current.close();
        sourceRef.current = null;
        setActiveJob(null);
      }

      await refreshJobs();
    } catch (err) {
      setError(err.message || 'Failed to delete job');
    }
  };

  const previewUrl = resolveExportUrl(activeJob?.outputUrl);
  const isGif = activeJob?.outputUrl?.endsWith('.gif');

  return (
    <div className="space-y-6 p-6 rounded-2xl border border-zinc-800 bg-zinc-950/80 shadow-2xl backdrop-blur-md">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold text-white">Video Export Engine</h1>
        <p className="text-sm text-zinc-400">Export demo playback to MP4, WebM, or GIF with watermark and optional music.</p>
      </div>

      {handoffNotice ? (
        <div className="rounded-lg border border-emerald-800 bg-emerald-950/40 p-3 text-sm text-emerald-300">
          {handoffNotice}
        </div>
      ) : null}

      {error && <div className="rounded-lg border border-red-700 bg-red-950/60 p-3 text-sm text-red-300">{error}</div>}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <label className="space-y-1 text-sm text-zinc-300 md:col-span-2">
          <span>Demo URL</span>
          <input
            value={config.demoUrl}
            onChange={(e) => setConfig((prev) => ({ ...prev, demoUrl: e.target.value }))}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-white outline-none ring-red-500/30 focus:ring"
            placeholder="http://localhost:5173/demo/abc123"
          />
        </label>

        <label className="space-y-1 text-sm text-zinc-300">
          <span>Resolution</span>
          <select
            value={config.resolution}
            onChange={(e) => setConfig((prev) => ({ ...prev, resolution: e.target.value }))}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-white"
          >
            <option value="1080p">1080p</option>
            <option value="1440p">1440p</option>
            <option value="4k">4K</option>
          </select>
        </label>

        <label className="space-y-1 text-sm text-zinc-300">
          <span>FPS</span>
          <select
            value={config.fps}
            onChange={(e) => setConfig((prev) => ({ ...prev, fps: Number(e.target.value) }))}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-white"
          >
            <option value={30}>30</option>
            <option value={60}>60</option>
          </select>
        </label>

        <label className="space-y-1 text-sm text-zinc-300">
          <span>Format</span>
          <select
            value={config.format}
            onChange={(e) => setConfig((prev) => ({ ...prev, format: e.target.value }))}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-white"
          >
            <option value="mp4">MP4 (H.264)</option>
            <option value="webm">WebM (VP9)</option>
            <option value="gif">GIF</option>
          </select>
        </label>

        <label className="space-y-1 text-sm text-zinc-300">
          <span>Duration (seconds)</span>
          <input
            type="number"
            min={1}
            max={300}
            value={config.duration}
            onChange={(e) => setConfig((prev) => ({ ...prev, duration: Number(e.target.value) || 1 }))}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-white"
          />
        </label>

        <label className="space-y-1 text-sm text-zinc-300 md:col-span-2">
          <span>Background Music URL (optional)</span>
          <input
            value={config.musicUrl}
            onChange={(e) => setConfig((prev) => ({ ...prev, musicUrl: e.target.value }))}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-white"
            placeholder="https://example.com/audio.mp3"
          />
        </label>

        <label className="space-y-1 text-sm text-zinc-300 md:col-span-2">
          <span>Music Volume ({config.musicVolume})</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.1}
            value={config.musicVolume}
            onChange={(e) => setConfig((prev) => ({ ...prev, musicVolume: Number(e.target.value) }))}
            className="w-full accent-red-500"
          />
        </label>

        <label className="inline-flex items-center gap-2 text-sm text-zinc-300 md:col-span-2">
          <input
            type="checkbox"
            checked={config.watermark.enabled}
            onChange={(e) => setWatermark({ enabled: e.target.checked })}
            className="size-4 rounded border-zinc-700 bg-zinc-900 text-red-500"
          />
          Enable watermark
        </label>

        {config.watermark.enabled && (
          <>
            <label className="space-y-1 text-sm text-zinc-300">
              <span>Watermark Text</span>
              <input
                value={config.watermark.text}
                onChange={(e) => setWatermark({ text: e.target.value })}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-white"
              />
            </label>

            <label className="space-y-1 text-sm text-zinc-300">
              <span>Position</span>
              <select
                value={config.watermark.position}
                onChange={(e) => setWatermark({ position: e.target.value })}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-white"
              >
                <option value="top-left">Top Left</option>
                <option value="top-right">Top Right</option>
                <option value="bottom-left">Bottom Left</option>
                <option value="bottom-right">Bottom Right</option>
                <option value="center">Center</option>
              </select>
            </label>

            <label className="space-y-1 text-sm text-zinc-300 md:col-span-2">
              <span>Opacity ({config.watermark.opacity})</span>
              <input
                type="range"
                min={0.1}
                max={1}
                step={0.1}
                value={config.watermark.opacity}
                onChange={(e) => setWatermark({ opacity: Number(e.target.value) })}
                className="w-full accent-red-500"
              />
            </label>
          </>
        )}

        <label className="space-y-1 text-sm text-zinc-300 md:col-span-2">
          <span>Storage</span>
          <select
            value={config.storage}
            onChange={(e) => setConfig((prev) => ({ ...prev, storage: e.target.value }))}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-white"
          >
            <option value="local">Local (/public/exports)</option>
            <option value="s3">AWS S3</option>
          </select>
        </label>
      </div>

      <button
        type="button"
        onClick={startExport}
        disabled={loading}
        className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? <Loader2 className="size-4 animate-spin" /> : null}
        Start Export
      </button>

      {activeJob && (
        <div className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
          <ExportProgressBar progress={activeJob.progress} status={activeJob.status} message={activeJob.message} />

          {activeJob.status === 'done' && activeJob.outputUrl && (
            <div className="space-y-3">
              <a
                href={previewUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-500"
              >
                <Download className="size-4" />
                Download Export
              </a>

              {isGif ? (
                <img src={previewUrl} alt="Export preview" className="max-h-80 rounded-lg border border-zinc-700" />
              ) : (
                <video controls src={previewUrl} className="w-full max-h-80 rounded-lg border border-zinc-700 bg-black" />
              )}
            </div>
          )}
        </div>
      )}

      <div className="space-y-3">
        <h2 className="text-lg font-medium text-white">Export History</h2>

        <div className="overflow-x-auto rounded-xl border border-zinc-800">
          <table className="min-w-full text-sm text-zinc-300">
            <thead className="bg-zinc-900/90 text-zinc-400">
              <tr>
                <th className="px-3 py-2 text-left">Job ID</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-left">Created</th>
                <th className="px-3 py-2 text-left">Output</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {jobs.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-4 text-center text-zinc-500">No export jobs yet.</td>
                </tr>
              )}

              {jobs.map((job) => (
                <tr key={job.id} className="border-t border-zinc-800 bg-zinc-950/40">
                  <td className="px-3 py-2 font-mono text-xs">{job.id}</td>
                  <td className="px-3 py-2 uppercase">{job.status}</td>
                  <td className="px-3 py-2">{new Date(job.createdAt).toLocaleString()}</td>
                  <td className="px-3 py-2">
                    {job.outputUrl ? (
                      <a href={resolveExportUrl(job.outputUrl)} target="_blank" rel="noreferrer" className="text-blue-400 hover:underline">
                        View file
                      </a>
                    ) : (
                      <span className="text-zinc-500">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => deleteJob(job.id)}
                      className="inline-flex items-center gap-1 rounded-md border border-zinc-700 px-2 py-1 text-xs hover:bg-zinc-800"
                    >
                      <Trash2 className="size-3" />
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
