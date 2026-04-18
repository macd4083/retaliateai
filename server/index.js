import express from 'express';
import cors from 'cors';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import videoExportRouter from './routes/videoExport.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.SERVER_PORT || 3001;
const uploadsDir = path.join(__dirname, '../public/exports/uploads');

fs.mkdirSync(uploadsDir, { recursive: true });

const upload = multer({ dest: uploadsDir });

app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173' }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use('/exports', express.static(path.join(__dirname, '../public/exports')));

app.use('/api/video-export', upload.any(), videoExportRouter);

app.listen(PORT, () => {
  console.log(`[VideoExportServer] Listening on http://localhost:${PORT}`);
});

export default app;
