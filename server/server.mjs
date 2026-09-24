/**
 * Backend Gateway Server
 * Unified HTTP & WebSocket server for Gemini Live Voice PWA + Hermes Bridge
 */

import http from 'http';
import https from 'https';
import net from 'net';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import dotenv from 'dotenv';
import { WebSocketServer, WebSocket } from 'ws';
import { GeminiLiveSession } from './gemini-live.mjs';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const RECORDINGS_DIR = path.join(__dirname, '..', 'recordings');
if (!fs.existsSync(RECORDINGS_DIR)) {
  fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
}
const PORT = process.env.PORT || 4040;

const MIME_TYPES = {
  '.html': 'text/html; charset=UTF-8',
  '.js': 'application/javascript; charset=UTF-8',
  '.mjs': 'application/javascript; charset=UTF-8',
  '.css': 'text/css; charset=UTF-8',
  '.json': 'application/json; charset=UTF-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg'
};

// Track active sessions
const activeSessions = new Map(); // wsClient -> GeminiLiveSession

// HTTP / HTTPS Request Handler
const requestHandler = async (req, res) => {
  const isSecure = Boolean(req.socket.encrypted);
  const clientProto = isSecure ? 'HTTPS' : 'HTTP';
  const clientIp = req.socket.remoteAddress;
  console.log(`[${clientProto}] ${req.method} ${req.url} (from ${clientIp})`);

  const url = new URL(req.url, `${isSecure ? 'https' : 'http'}://${req.headers.host}`);

  // API Endpoints
  if (url.pathname === '/api/status' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      status: 'online',
      model: process.env.GEMINI_MODEL || 'models/gemini-3.8-live',
      voice: process.env.GEMINI_VOICE || 'Aoede',
      activeConnections: activeSessions.size,
      hermesUrl: process.env.HERMES_API_URL || 'http://192.168.31.20:8642/v1/chat/completions'
    }));
  }

  if (url.pathname === '/api/orchestrator/inject' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { message } = JSON.parse(body || '{}');
        if (!message) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Falta el campo message' }));
        }

        let injectedCount = 0;
        for (const [wsClient, session] of activeSessions.entries()) {
          if (session && session.isReady) {
            session.injectProactiveTurn(`[MENSAJE DE HERMES]: ${message}. Comunícaselo a Felipe por voz.`);
            injectedCount++;
          }
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          success: true,
          injectedSessions: injectedCount,
          message
        }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // TTS Endpoint for Silent / Night-time testing
  if (url.pathname === '/api/tts' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { text } = JSON.parse(body || '{}');
        if (!text || !text.trim()) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Falta el texto para sintetizar' }));
        }

        const tmpFile = `/tmp/tts_prompt_${Date.now()}.wav`;
        // Try Mónica or Paulina or default voice
        try {
          execFileSync('/usr/bin/say', ['-v', 'Mónica', '-o', tmpFile, '--data-format=LEI16@16000', text.trim()]);
        } catch (voiceErr) {
          // Fallback to default system voice
          execFileSync('/usr/bin/say', ['-o', tmpFile, '--data-format=LEI16@16000', text.trim()]);
        }

        if (fs.existsSync(tmpFile)) {
          const wavBuf = fs.readFileSync(tmpFile);
          const dataIdx = wavBuf.indexOf(Buffer.from('data'));
          const pcmBuf = dataIdx !== -1 ? wavBuf.subarray(dataIdx + 8) : wavBuf.subarray(44);
          try { fs.unlinkSync(tmpFile); } catch (e) {}

          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({
            success: true,
            sampleRate: 16000,
            pcmBase64: pcmBuf.toString('base64'),
            byteLength: pcmBuf.length
          }));
        } else {
          throw new Error('No se generó el archivo de audio');
        }
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // List all saved user recordings
  if (url.pathname === '/api/recordings' && req.method === 'GET') {
    try {
      const files = fs.readdirSync(RECORDINGS_DIR).filter(f => f.endsWith('.wav'));
      const items = files.map(filename => {
        const fullPath = path.join(RECORDINGS_DIR, filename);
        const stats = fs.statSync(fullPath);
        return {
          filename,
          url: `/recordings/${filename}`,
          sizeBytes: stats.size,
          durationSec: Math.max(0, ((stats.size - 44) / 32000)).toFixed(2),
          createdAt: stats.mtime
        };
      }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ recordings: items }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: e.message }));
    }
  }

  // Save new user voice recording with auto-STT transcription
  if (url.pathname === '/api/save-recording' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const { base64Wav, title } = JSON.parse(body || '{}');
        if (!base64Wav) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Falta base64Wav' }));
        }

        const count = fs.readdirSync(RECORDINGS_DIR).filter(f => f.endsWith('.wav')).length + 1;
        const safeTitle = (title || `audio_${count}`).trim().replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
        const filename = `grabacion_${count}_${safeTitle}.wav`;
        const savePath = path.join(RECORDINGS_DIR, filename);
        const buf = Buffer.from(base64Wav, 'base64');
        fs.writeFileSync(savePath, buf);
        // Also keep /tmp/user_real_voice.wav updated for CLI scripts
        fs.writeFileSync('/tmp/user_real_voice.wav', buf);

        console.log(`[Gateway] 💾 Saved recording #${count} to ${savePath} (${buf.length} bytes)`);

        // Fast background transcription using gemini-3.5-flash to get ground-truth text
        let transcript = '';
        try {
          const sttRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{
                parts: [
                  { text: 'Transcribe exactamente en español palabra por palabra lo que dice el usuario en este audio. Devuelve SOLO el texto transcrito:' },
                  { inlineData: { mimeType: 'audio/wav', data: base64Wav } }
                ]
              }]
            })
          });
          const sttData = await sttRes.json();
          transcript = sttData?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
          console.log(`[Gateway] 📝 STT transcript for ${filename}: "${transcript}"`);
        } catch (sttErr) {
          console.warn('[Gateway] STT background error:', sttErr.message);
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          success: true,
          filename,
          url: `/recordings/${filename}`,
          transcript,
          bytes: buf.length,
          durationSec: Math.max(0, ((buf.length - 44) / 32000)).toFixed(2)
        }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // Delete recording endpoint
  if (url.pathname === '/api/delete-recording' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { filename } = JSON.parse(body || '{}');
        const safeName = path.basename(filename || '');
        const targetPath = path.join(RECORDINGS_DIR, safeName);
        if (fs.existsSync(targetPath)) {
          fs.unlinkSync(targetPath);
          console.log(`[Gateway] 🗑️ Deleted recording ${safeName}`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: true }));
        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Archivo no encontrado' }));
        }
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // Static serving for saved recordings
  if (url.pathname.startsWith('/recordings/')) {
    const filename = path.basename(url.pathname);
    const audioPath = path.join(RECORDINGS_DIR, filename);
    if (fs.existsSync(audioPath)) {
      res.writeHead(200, {
        'Content-Type': 'audio/wav',
        'Cache-Control': 'no-cache'
      });
      return fs.createReadStream(audioPath).pipe(res);
    } else {
      res.writeHead(404);
      return res.end('Audio no encontrado');
    }
  }

  // Rewrite friendly URLs for recording test page
  let reqPath = url.pathname;
  if (reqPath === '/grabar' || reqPath === '/recorder' || reqPath === '/test' || reqPath === '/voice') {
    reqPath = '/recorder.html';
  }

  // Static File Serving
  let filePath = path.join(PUBLIC_DIR, reqPath === '/' ? 'index.html' : reqPath);

  // Security check: ensure path is within PUBLIC_DIR
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Access Denied');
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      // Fallback for SPA routing if needed
      filePath = path.join(PUBLIC_DIR, 'index.html');
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    // Disable caching for development so changes are instantly reflected without hard refresh
    const headers = { 
      'Content-Type': contentType,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    };
    if (filePath.endsWith('service-worker.js')) {
      headers['Service-Worker-Allowed'] = '/';
    }

    res.writeHead(200, headers);
    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  });
};

// Create HTTP Server
const server = http.createServer(requestHandler);

// Create HTTPS Server (for Mobile Chrome/Safari mic access)
const HTTPS_PORT = process.env.HTTPS_PORT || 3443;
let httpsServer = null;
let polyglotServer = null;
const keyPath = path.join(__dirname, 'key.pem');
const certPath = path.join(__dirname, 'cert.pem');
if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
  try {
    httpsServer = https.createServer({
      key: fs.readFileSync(keyPath),
      cert: fs.readFileSync(certPath)
    }, requestHandler);

    httpsServer.on('tlsClientError', (err, socket) => {
      console.warn(`[HTTPS] ⚠️ TLS Client Error from ${socket?.remoteAddress}: ${err.message}`);
    });

    httpsServer.on('clientError', (err, socket) => {
      console.warn(`[HTTPS] ⚠️ Client Error from ${socket?.remoteAddress}: ${err.message}`);
    });

    // HTTP redirect fallback server for port 3443
    // Handles clients that type 192.168.31.191:3443 without https://
    const httpFallbackServer = http.createServer((req, res) => {
      const host = req.headers.host || `192.168.31.191:${HTTPS_PORT}`;
      const targetHttps = `https://${host}${req.url}`;
      console.log(`[Port ${HTTPS_PORT}] 🔄 Client used plain HTTP. Redirecting to ${targetHttps}`);

      res.writeHead(200, { 'Content-Type': 'text/html; charset=UTF-8' });
      res.end(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Cambiando a HTTPS Seguro...</title>
  <style>
    body { background: #07090e; color: #fff; font-family: -apple-system, sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; text-align: center; padding: 24px; box-sizing: border-box; }
    h2 { font-size: 1.3rem; margin-bottom: 8px; color: #38bdf8; }
    p { color: #94a3b8; font-size: 0.95rem; line-height: 1.5; margin-bottom: 24px; }
    a { background: linear-gradient(135deg, #00e5ff 0%, #0284c7 100%); color: #040608; padding: 14px 28px; border-radius: 99px; text-decoration: none; font-weight: 700; font-size: 1rem; box-shadow: 0 4px 20px rgba(0, 229, 255, 0.4); display: inline-block; }
  </style>
</head>
<body>
  <h2>🔒 Conexión Segura (HTTPS)</h2>
  <p>Para activar el micrófono en el celular debes usar HTTPS.<br>Pulsa el botón para continuar:</p>
  <a href="${targetHttps}">👉 Entrar con HTTPS Seguro</a>
  <script>window.location.replace("${targetHttps}");</script>
</body>
</html>`);
    });

    // Polyglot TCP router on port 3443
    // Inspects first byte: 0x16 = TLS Handshake, else = plain HTTP
    polyglotServer = net.createServer((socket) => {
      socket.once('data', (buf) => {
        socket.pause();
        socket.unshift(buf);
        if (buf.length > 0 && buf[0] === 0x16) {
          httpsServer.emit('connection', socket);
        } else {
          httpFallbackServer.emit('connection', socket);
        }
        process.nextTick(() => socket.resume());
      });

      socket.on('error', () => {});
    });

    console.log('[Gateway] 🔒 Polyglot HTTP/HTTPS Server initialized on port 3443');
  } catch (err) {
    console.warn('[Gateway] ⚠️ Failed initializing HTTPS server:', err.message);
  }
}

// Function to handle client WebSocket connection
function handleWsConnection(clientWs, req) {
  const clientIp = req.socket.remoteAddress;
  console.log(`[Gateway] 📱 PWA client connected from ${clientIp}`);

  // Create Gemini Live bridge session for this client
  const geminiSession = new GeminiLiveSession({
    onAudioOutput: (base64Pcm24k) => {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify({
          type: 'audio',
          data: base64Pcm24k
        }));
      }
    },
    onStateChange: (state, metadata) => {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify({
          type: 'state',
          state,
          metadata
        }));
      }
    },
    onInterrupted: () => {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify({
          type: 'interrupted'
        }));
      }
    },
    onTranscript: (role, text) => {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify({
          type: 'transcript',
          role,
          text
        }));
      }
    },
    onError: (err) => {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify({
          type: 'error',
          message: err.message
        }));
      }
    },
    onClose: (code, reason) => {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify({
          type: 'closed',
          code,
          reason
        }));
      }
    }
  });

function pcmToWavBuffer(pcmBuf, sampleRate = 16000) {
  const wavHeader = Buffer.alloc(44);
  wavHeader.write('RIFF', 0);
  wavHeader.writeUInt32LE(36 + pcmBuf.length, 4);
  wavHeader.write('WAVE', 8);
  wavHeader.write('fmt ', 12);
  wavHeader.writeUInt32LE(16, 16);
  wavHeader.writeUInt16LE(1, 20); // PCM
  wavHeader.writeUInt16LE(1, 22); // Mono
  wavHeader.writeUInt32LE(sampleRate, 24);
  wavHeader.writeUInt32LE(sampleRate * 2, 28);
  wavHeader.writeUInt16LE(2, 32);
  wavHeader.writeUInt16LE(16, 34);
  wavHeader.write('data', 36);
  wavHeader.writeUInt32LE(pcmBuf.length, 40);
  return Buffer.concat([wavHeader, pcmBuf]);
}

  activeSessions.set(clientWs, geminiSession);

  // Connect to Gemini Live
  geminiSession.connect();

  // VAD & Speech Turn Accumulator with rolling pre-roll
  const PRE_ROLL_LIMIT = 5; // ~320ms pre-roll
  const preRollChunks = [];
  let speechChunks = [];
  let isSpeakingDetected = false;
  let isClientPlayingAudio = false;
  let silenceTimer = null;
  let chunkCount = 0;
  let consecutiveSpeech = 0;

  clientWs.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());

      if (msg.type === 'playback_state') {
        isClientPlayingAudio = Boolean(msg.playing);
        if (isClientPlayingAudio) {
          // Immediately purge any speech chunks accumulated right before or during playback
          speechChunks = [];
          preRollChunks.length = 0;
          isSpeakingDetected = false;
          if (silenceTimer) {
            clearTimeout(silenceTimer);
            silenceTimer = null;
          }
          consecutiveSpeech = 0;
        }
        console.log(`[Gateway] 🔊 Client audio playback state: ${isClientPlayingAudio ? 'PLAYING (Mic Gated)' : 'IDLE (Mic Open)'}`);
      } else if (msg.type === 'user_audio' && msg.data) {
        // Direct commit of full audio turn from test recorder
        if (silenceTimer) clearTimeout(silenceTimer);
        isSpeakingDetected = false;
        speechChunks = [];
        preRollChunks.length = 0;
        consecutiveSpeech = 0;
        geminiSession.sendUserAudio(msg.data, msg.mimeType || 'audio/wav');
      } else if (msg.type === 'audio' && msg.data) {
        chunkCount++;
        const buf = Buffer.from(msg.data, 'base64');
        const int16 = new Int16Array(buf.buffer, buf.byteOffset, buf.length / 2);
        let sum = 0;
        for (let i = 0; i < int16.length; i++) {
          sum += int16[i] * int16[i];
        }
        const rms = Math.sqrt(sum / int16.length);

        // Echo suppression: strictly drop audio when client is playing sound or model is speaking,
        // unless user performs intentional loud barge-in (RMS > 950)
        if ((isClientPlayingAudio || geminiSession.isSpeaking) && rms < 950) {
          return;
        }

        // Voice threshold: 310 RMS firmly ignores ambient room noise, fan, and breathing
        const VOICE_THRESHOLD = 310;

        if (!isSpeakingDetected) {
          if (rms > VOICE_THRESHOLD) {
            consecutiveSpeech++;
            if (consecutiveSpeech >= 3) {
              isSpeakingDetected = true;
              speechChunks = [...preRollChunks, buf];
              preRollChunks.length = 0;
              consecutiveSpeech = 0;
              console.log(`[Gateway] 🗣️ User voice started (RMS: ${rms.toFixed(0)})`);
            }
          } else {
            consecutiveSpeech = 0;
            // Keep rolling pre-roll of ~300ms so start of speech is not clipped
            preRollChunks.push(buf);
            if (preRollChunks.length > PRE_ROLL_LIMIT) preRollChunks.shift();
          }
        } else {
          // Voice turn in progress: collect audio chunk
          speechChunks.push(buf);

          if (rms > VOICE_THRESHOLD) {
            // User is still speaking: cancel silence timeout
            if (silenceTimer) {
              clearTimeout(silenceTimer);
              silenceTimer = null;
            }
          } else {
            // User paused: start silence detection timeout
            if (!silenceTimer) {
              silenceTimer = setTimeout(() => {
                // Ensure at least ~770ms (12 chunks) of real voice was spoken
                if (speechChunks.length >= 10) {
                  const pcmData = Buffer.concat(speechChunks);
                  const wavData = pcmToWavBuffer(pcmData, 16000);
                  const duration = (pcmData.length / 32000).toFixed(2);
                  console.log(`[Gateway] 🤫 Silence detected after speech. Committing ${duration}s audio turn to Gemini Live...`);
                  if (clientWs.readyState === WebSocket.OPEN) {
                    clientWs.send(JSON.stringify({
                      type: 'voice_committed',
                      durationSec: duration
                    }));
                  }
                  geminiSession.sendUserAudio(wavData.toString('base64'), 'audio/wav');
                } else {
                  console.log(`[Gateway] ✂️ Discarding brief acoustic noise (${speechChunks.length} chunks)`);
                }
                speechChunks = [];
                isSpeakingDetected = false;
                silenceTimer = null;
                consecutiveSpeech = 0;
              }, 850);
            }
          }
        }

        if (chunkCount % 40 === 1) {
          console.log(`[Gateway] 🎙️ Audio stream #${chunkCount} | RMS: ${rms.toFixed(1)} ${rms > VOICE_THRESHOLD ? '🗣️ (Voz)' : '🤫 (Silencio)'}`);
        }
      } else if (msg.type === 'turn_complete') {
        if (silenceTimer) clearTimeout(silenceTimer);
        if (speechChunks.length >= 5) {
          const pcmData = Buffer.concat(speechChunks);
          const wavData = pcmToWavBuffer(pcmData, 16000);
          console.log(`[Gateway] 🏁 turn_complete: Committing ${pcmData.length} bytes to Gemini Live...`);
          geminiSession.sendUserAudio(wavData.toString('base64'), 'audio/wav');
        } else {
          geminiSession.signalTurnComplete();
        }
        speechChunks = [];
        isSpeakingDetected = false;
        speechChunks = [];
        isSpeakingDetected = false;
      } else if (msg.type === 'user_speech_transcript' && msg.text) {
        if (geminiSession.isEchoOfModel(msg.text)) {
          console.log(`[Gateway] 🛡️ Ignored client speech transcript echo of model: "${msg.text}"`);
        } else {
          console.log(`[Gateway] 👤 Client live voice transcription: "${msg.text}"`);
        }
      } else if (msg.type === 'user_text' && msg.text) {
        if (silenceTimer) clearTimeout(silenceTimer);
        isSpeakingDetected = false;
        speechChunks = [];
        preRollChunks.length = 0;
        geminiSession.sendUserText(msg.text);
      } else if (msg.type === 'test_inject' && msg.message) {
        geminiSession.injectProactiveTurn(`[MENSAJE DE HERMES]: ${msg.message}. Comunícaselo a Felipe por voz.`);
      }
    } catch (err) {
      console.error('[Gateway] Error handling client message:', err.message);
    }
  });

  clientWs.on('close', () => {
    if (silenceTimer) clearTimeout(silenceTimer);
    console.log('[Gateway] 📱 PWA client disconnected');
    geminiSession.close();
    activeSessions.delete(clientWs);
  });

  clientWs.on('error', (err) => {
    console.error('[Gateway] Client WebSocket error:', err.message);
    geminiSession.close();
    activeSessions.delete(clientWs);
  });
}

// Attach WebSocketServer to HTTP server
const wssHttp = new WebSocketServer({ server, path: '/ws' });
wssHttp.on('connection', handleWsConnection);

// Attach WebSocketServer to HTTPS server
if (httpsServer) {
  const wssHttps = new WebSocketServer({ server: httpsServer, path: '/ws' });
  wssHttps.on('connection', handleWsConnection);
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n======================================================`);
  console.log(`🎙️  Gemini 3.8 Live + Hermes Bridge Gateway Online!`);
  console.log(`📍 Web PWA (Local):     http://localhost:${PORT}`);
  console.log(`📱 Celular (LAN HTTP):  http://192.168.31.191:${PORT}`);
  if (httpsServer) {
    console.log(`🔒 Celular (LAN HTTPS): https://192.168.31.191:${HTTPS_PORT}`);
    console.log(`🎙️ Celular (Grabar):    https://192.168.31.191:${HTTPS_PORT}/grabar`);
  }
  console.log(`🤖 Model:               ${process.env.GEMINI_MODEL || 'models/gemini-3.8-live'}`);
  console.log(`🔊 Voice:               ${process.env.GEMINI_VOICE || 'Aoede'}`);
  console.log(`🛡️  Hermes:              ${process.env.HERMES_API_URL || 'http://192.168.31.20:8642/v1/chat/completions'}`);
  console.log(`======================================================\n`);
});

if (polyglotServer) {
  polyglotServer.listen(HTTPS_PORT, '0.0.0.0', () => {
    console.log(`🔒 Polyglot HTTPS Gateway listening on port ${HTTPS_PORT} (0.0.0.0)`);
  });
}
