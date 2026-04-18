import path from 'path';
import { Router } from 'express';
import { createJob, getJob, updateJob, getAllJobs, deleteJob } from '../utils/jobManager.js';
import { captureDemo } from '../services/captureService.js';
import { processVideo } from '../services/ffmpegService.js';
import { storeFile } from '../services/storageService.js';

const router = Router();

function isValidUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol);
  } catch {
    return false;
  }
}

router.post('/start', async (req, res) => {
  const {
    demoUrl,
    resolution = '1080p',
    fps = 30,
    format = 'mp4',
    duration = 30,
    musicUrl,
    musicVolume,
    watermark,
    storage = 'local',
  } = req.body;

  if (!demoUrl || !isValidUrl(demoUrl)) {
    return res.status(400).json({ error: 'A valid demoUrl is required' });
  }

  if (!['1080p', '1440p', '4k'].includes(resolution)) {
    return res.status(400).json({ error: 'Invalid resolution' });
  }

  const normalizedFps = Number(fps);
  if (![30, 60].includes(normalizedFps)) {
    return res.status(400).json({ error: 'fps must be 30 or 60' });
  }

  if (!['mp4', 'webm', 'gif'].includes(format)) {
    return res.status(400).json({ error: 'Invalid format' });
  }

  const normalizedDuration = Number(duration);
  if (!Number.isFinite(normalizedDuration) || normalizedDuration <= 0 || normalizedDuration > 300) {
    return res.status(400).json({ error: 'duration must be between 1 and 300 seconds' });
  }

  if (!['local', 's3'].includes(storage)) {
    return res.status(400).json({ error: 'storage must be local or s3' });
  }

  const normalizedMusicVolume = musicVolume == null ? 0.3 : Number(musicVolume);
  if (!Number.isFinite(normalizedMusicVolume) || normalizedMusicVolume < 0 || normalizedMusicVolume > 1) {
    return res.status(400).json({ error: 'musicVolume must be between 0 and 1' });
  }

  if (musicUrl && !isValidUrl(musicUrl)) {
    return res.status(400).json({ error: 'musicUrl must be a valid URL' });
  }

  const uploadedMusic = Array.isArray(req.files) && req.files[0]?.path
    ? path.resolve(req.files[0].path)
    : null;

  const finalMusicUrl = uploadedMusic || musicUrl || null;

  const normalizedWatermark = {
    enabled: Boolean(watermark?.enabled),
    text: watermark?.text || 'RetaliateAI',
    position: watermark?.position || 'bottom-right',
    opacity: watermark?.opacity == null ? 0.7 : Number(watermark.opacity),
  };

  const job = createJob({
    demoUrl,
    resolution,
    fps: normalizedFps,
    format,
    duration: normalizedDuration,
    musicUrl: finalMusicUrl,
    musicVolume: normalizedMusicVolume,
    watermark: normalizedWatermark,
    storage,
  });

  const isCancelled = () => !getJob(job.id);

  (async () => {
    try {
      updateJob(job.id, { status: 'capturing', progress: 0, message: 'Launching browser...' });

      const captureResult = await captureDemo({
        demoUrl,
        resolution,
        fps: normalizedFps,
        duration: normalizedDuration,
        jobId: job.id,
        onProgress: (p) => {
          if (!isCancelled()) {
            updateJob(job.id, { progress: p, message: `Capturing frames... ${p}%` });
          }
        },
      });

      if (isCancelled()) throw new Error('Job cancelled');

      updateJob(job.id, { status: 'processing', progress: 50, message: 'Processing video with FFmpeg...' });

      const { outputFile } = await processVideo({
        ...captureResult,
        jobId: job.id,
        format,
        musicUrl: finalMusicUrl,
        musicVolume: normalizedMusicVolume,
        watermark: normalizedWatermark,
        onProgress: (p) => {
          if (!isCancelled()) {
            updateJob(job.id, { progress: p, message: `Encoding video... ${p}%` });
          }
        },
      });

      if (isCancelled()) throw new Error('Job cancelled');

      updateJob(job.id, { status: 'uploading', progress: 95, message: 'Storing output file...' });

      const stored = await storeFile({ filePath: outputFile, jobId: job.id, format, storage });

      if (isCancelled()) throw new Error('Job cancelled');

      updateJob(job.id, {
        status: 'done',
        progress: 100,
        message: 'Export complete!',
        outputUrl: stored.url,
      });
    } catch (error) {
      if (!isCancelled()) {
        console.error('[VideoExport] Job failed:', error);
        updateJob(job.id, { status: 'failed', message: error.message || 'Export failed' });
      }
    }
  })();

  return res.json({ jobId: job.id, status: 'queued' });
});

router.get('/progress/:jobId', (req, res) => {
  const { jobId } = req.params;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = () => {
    const job = getJob(jobId);

    if (!job) {
      res.write(`data: ${JSON.stringify({ error: 'Job not found' })}\n\n`);
      clearInterval(interval);
      res.end();
      return;
    }

    res.write(`data: ${JSON.stringify(job)}\n\n`);

    if (job.status === 'done' || job.status === 'failed') {
      clearInterval(interval);
      res.end();
    }
  };

  const interval = setInterval(send, 1000);
  send();

  req.on('close', () => {
    clearInterval(interval);
  });
});

router.get('/jobs', (_req, res) => {
  const jobs = getAllJobs().map(({ id, status, createdAt, outputUrl, progress, message }) => ({
    id,
    status,
    createdAt,
    outputUrl,
    progress,
    message,
  }));

  res.json(jobs);
});

router.delete('/jobs/:jobId', (req, res) => {
  const deleted = deleteJob(req.params.jobId);

  if (!deleted) {
    return res.status(404).json({ error: 'Job not found' });
  }

  return res.json({ success: true });
});

export default router;
