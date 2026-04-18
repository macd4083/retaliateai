import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXPORTS_DIR = path.join(__dirname, '../../public/exports');

ffmpeg.setFfmpegPath(process.env.FFMPEG_PATH || ffmpegInstaller.path);

function extensionForFormat(format) {
  if (format === 'gif') return 'gif';
  if (format === 'webm') return 'webm';
  return 'mp4';
}

function escapeDrawText(text) {
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
    .replace(/%/g, '\\%')
    .replace(/=/g, '\\=')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

export async function processVideo({
  framesDir,
  jobId,
  fps,
  format,
  width,
  musicUrl,
  musicVolume,
  watermark,
  onProgress,
}) {
  fs.mkdirSync(EXPORTS_DIR, { recursive: true });

  const ext = extensionForFormat(format);
  const outputFile = path.join(EXPORTS_DIR, `${jobId}.${ext}`);
  const inputPattern = path.join(framesDir, 'frame_%06d.png');

  return new Promise((resolve, reject) => {
    let cmd = ffmpeg().input(inputPattern).inputFPS(fps);

    if (musicUrl && format !== 'gif') {
      cmd = cmd
        .input(musicUrl)
        .audioFilters(`volume=${musicVolume ?? 0.3}`)
        .outputOptions(['-shortest']);
    }

    if (format === 'mp4') {
      cmd = cmd
        .videoCodec('libx264')
        .outputOptions(['-crf 18', '-preset fast', '-pix_fmt yuv420p', '-movflags +faststart']);
    } else if (format === 'webm') {
      cmd = cmd
        .videoCodec('libvpx-vp9')
        .outputOptions(['-crf 30', '-b:v 0', '-pix_fmt yuv420p']);
    } else if (format === 'gif') {
      const palette = path.join(framesDir, 'palette.png');

      ffmpeg()
        .input(inputPattern)
        .inputFPS(fps)
        .videoFilters(`fps=${fps},scale=${width}:-1:flags=lanczos,palettegen`)
        .output(palette)
        .on('end', () => {
          ffmpeg()
            .input(inputPattern)
            .inputFPS(fps)
            .input(palette)
            .videoFilters(`fps=${fps},scale=${width}:-1:flags=lanczos[x];[x][1:v]paletteuse`)
            .output(outputFile)
            .on('progress', (p) => onProgress && onProgress(50 + Math.round((p.percent || 0) * 0.5)))
            .on('end', () => {
              fs.rmSync(framesDir, { recursive: true, force: true });
              resolve({ outputFile, outputUrl: `/exports/${jobId}.gif` });
            })
            .on('error', (error) => {
              fs.rmSync(framesDir, { recursive: true, force: true });
              reject(error);
            })
            .run();
        })
        .on('error', (error) => {
          fs.rmSync(framesDir, { recursive: true, force: true });
          reject(error);
        })
        .run();

      return;
    }

    if (watermark?.enabled && watermark?.text) {
      const positionMap = {
        'top-left': 'x=20:y=20',
        'top-right': 'x=w-tw-20:y=20',
        'bottom-left': 'x=20:y=h-th-20',
        'bottom-right': 'x=w-tw-20:y=h-th-20',
        center: 'x=(w-tw)/2:y=(h-th)/2',
      };

      const pos = positionMap[watermark.position] || positionMap['bottom-right'];
      const alpha = watermark.opacity ?? 0.7;
      const safeText = escapeDrawText(watermark.text);

      cmd = cmd.videoFilters(`drawtext=text='${safeText}':fontcolor=white@${alpha}:fontsize=48:${pos}`);
    }

    cmd
      .output(outputFile)
      .on('progress', (p) => onProgress && onProgress(50 + Math.round((p.percent || 0) * 0.5)))
      .on('end', () => {
        fs.rmSync(framesDir, { recursive: true, force: true });
        resolve({ outputFile, outputUrl: `/exports/${jobId}.${ext}` });
      })
      .on('error', (error) => {
        fs.rmSync(framesDir, { recursive: true, force: true });
        reject(error);
      })
      .run();
  });
}
