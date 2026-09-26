/**
 * Backend Gateway Server
 * Unified HTTP & WebSocket server for Gemini Live Voice PWA + Hermes Bridge
 */

import http from 'http';
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

  // Static File Serving
  const reqPath = url.pathname;
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

// Function to handle client WebSocket connection
function handleWsConnection(clientWs, req) {
  const clientIp = req.socket.remoteAddress;
  console.log(`[Gateway] 📱 PWA client connected from ${clientIp}`);

  let isTurnPending = false;
  let responseFallbackTimer = null;
  let lastClientTranscript = null;

  // Create Gemini Live bridge session for this client
  const geminiSession = new GeminiLiveSession({
    onAudioOutput: (base64Pcm24k) => {
      isTurnPending = false;
      if (responseFallbackTimer) {
        clearTimeout(responseFallbackTimer);
        responseFallbackTimer = null;
      }
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify({
          type: 'audio',
          data: base64Pcm24k
        }));
      }
    },
    onStateChange: (state, metadata) => {
      if (state === 'speaking') {
        isTurnPending = false;
        if (responseFallbackTimer) {
          clearTimeout(responseFallbackTimer);
          responseFallbackTimer = null;
        }
      }
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify({
          type: 'state',
          state,
          metadata
        }));
      }
    },
    onInterrupted: () => {
      isTurnPending = false;
      if (responseFallbackTimer) {
        clearTimeout(responseFallbackTimer);
        responseFallbackTimer = null;
      }
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify({
          type: 'interrupted'
        }));
      }
    },
    onTranscript: (role, text) => {
      if (role === 'model') {
        isTurnPending = false;
        if (responseFallbackTimer) {
          clearTimeout(responseFallbackTimer);
          responseFallbackTimer = null;
        }
      }
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify({
          type: 'transcript',
          role,
          text
        }));
      }
    },
    onError: (err) => {
      isTurnPending = false;
      if (responseFallbackTimer) {
        clearTimeout(responseFallbackTimer);
        responseFallbackTimer = null;
      }
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

/**
 * Fast parallel audio transcription using Google Gemini 3.5 Transcribe.
 * Runs asynchronously alongside Gemini Live without blocking vocal response streaming.
 * Emits the exact transcribed sentence to Android and Desktop clients.
 * @param {Buffer|string} wavBuffer
 * @returns {Promise<string>}
 */
async function transcribeAudioAsync(wavBuffer) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || !wavBuffer) return '';
  try {
    const base64Data = Buffer.isBuffer(wavBuffer) ? wavBuffer.toString('base64') : String(wavBuffer);
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-transcribe:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [{ inlineData: { mimeType: 'audio/wav', data: base64Data } }]
        }]
      })
    });
    if (!res.ok) {
      const errBody = await res.text();
      console.warn(`[Gateway] ⚠️ Fast transcribe HTTP ${res.status}:`, errBody);
      return '';
    }
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.audioTranscription?.text || 
                 data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return text.trim();
  } catch (err) {
    console.warn('[Gateway] ⚠️ Fast transcribe error:', err.message);
    return '';
  }
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
  let hasClientLiveTranscription = false;
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
        isTurnPending = true;
        geminiSession.sendUserAudio(msg.data, msg.mimeType || 'audio/wav');
        transcribeAudioAsync(msg.data).then((transcribedText) => {
          if (transcribedText) {
            lastClientTranscript = transcribedText;
            if (clientWs.readyState === WebSocket.OPEN) {
              console.log(`[Gateway] 🎙️ Speech transcribed via gemini-3.5-transcribe: "${transcribedText}"`);
              clientWs.send(JSON.stringify({
                type: 'transcript',
                role: 'user',
                text: transcribedText
              }));
            }
          }
        }).catch(() => {});
      } else if (msg.type === 'audio' && msg.data) {
        chunkCount++;
        const buf = Buffer.from(msg.data, 'base64');
        const int16 = new Int16Array(buf.buffer, buf.byteOffset, buf.length / 2);
        let sum = 0;
        for (let i = 0; i < int16.length; i++) {
          sum += int16[i] * int16[i];
        }
        const rms = Math.sqrt(sum / int16.length);

        // 1. Connection warm-up: ignore first 8 chunks (~500ms) to filter out
        // hardware mic initialization pops/clicks that spike to high RMS
        if (chunkCount <= 8) {
          preRollChunks.push(buf);
          if (preRollChunks.length > PRE_ROLL_LIMIT) preRollChunks.shift();
          return;
        }

        // 2. Turn-in-flight collision & echo suppression:
        // - Block audio when client is playing speaker sound or model is speaking, unless intentional loud barge-in (RMS > 1100)
        // - Block low/medium noise while an audio turn is currently waiting for Gemini Live response so in-flight turn is never aborted!
        if ((isTurnPending || isClientPlayingAudio || geminiSession.isSpeaking) && rms < 1100) {
          return;
        }

        // Voice threshold: 360 RMS firmly ignores ambient room noise, fan, and breathing
        const VOICE_THRESHOLD = 360;
        const CONSECUTIVE_REQUIRED = 4; // ~256ms of continuous speech

        if (!isSpeakingDetected) {
          if (rms > VOICE_THRESHOLD) {
            consecutiveSpeech++;
            if (consecutiveSpeech >= CONSECUTIVE_REQUIRED) {
              isSpeakingDetected = true;
              hasClientLiveTranscription = false;
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
                // Ensure at least ~640ms (10 chunks) of real voice was spoken
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
                  isTurnPending = true;
                  geminiSession.sendUserAudio(wavData.toString('base64'), 'audio/wav');

                  // Fast parallel transcription for mobile clients that lack local speech recognition
                  if (!hasClientLiveTranscription) {
                    transcribeAudioAsync(wavData).then((transcribedText) => {
                      if (transcribedText) {
                        lastClientTranscript = transcribedText;
                        if (clientWs.readyState === WebSocket.OPEN) {
                          console.log(`[Gateway] 🎙️ Speech transcribed for mobile client: "${transcribedText}"`);
                          clientWs.send(JSON.stringify({
                            type: 'transcript',
                            role: 'user',
                            text: transcribedText
                          }));
                        }
                      }
                    }).catch((err) => {
                      console.warn('[Gateway] ⚠️ transcribeAudioAsync failed:', err?.message || err);
                    });
                  } else {
                    console.log(`[Gateway] ⚡ Client provided live speech transcription ("${lastClientTranscript}"); skipped redundant server transcription.`);
                  }

                  // 3.5s Watchdog Fallback:
                  // If Gemini Live does not answer the audio turn within 3.5s (e.g. ambient noise false-alarm or clipped audio),
                  // and we have a high-confidence transcript from client speech recognition, recover immediately via text!
                  if (responseFallbackTimer) clearTimeout(responseFallbackTimer);
                  responseFallbackTimer = setTimeout(() => {
                    if (isTurnPending && lastClientTranscript && !geminiSession.isSpeaking) {
                      console.log(`[Gateway] ⏱️ Gemini Live audio turn was silent/unanswered after 3.5s. Rescuing turn with client transcript: "${lastClientTranscript}"`);
                      isTurnPending = true;
                      geminiSession.sendUserText(lastClientTranscript);
                    }
                  }, 3500);
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
          isTurnPending = true;
          geminiSession.sendUserAudio(wavData.toString('base64'), 'audio/wav');

          // Fast parallel transcription for mobile clients
          if (!hasClientLiveTranscription) {
            transcribeAudioAsync(wavData).then((transcribedText) => {
              if (transcribedText) {
                lastClientTranscript = transcribedText;
                if (clientWs.readyState === WebSocket.OPEN) {
                  console.log(`[Gateway] 🎙️ Speech transcribed for mobile client: "${transcribedText}"`);
                  clientWs.send(JSON.stringify({
                    type: 'transcript',
                    role: 'user',
                    text: transcribedText
                  }));
                }
              }
            }).catch((err) => {
              console.warn('[Gateway] ⚠️ transcribeAudioAsync failed:', err?.message || err);
            });
          }
        } else {
          geminiSession.signalTurnComplete();
        }
        speechChunks = [];
        isSpeakingDetected = false;
        consecutiveSpeech = 0;
      } else if (msg.type === 'user_speech_transcript' && msg.text) {
        lastClientTranscript = msg.text.trim();
        hasClientLiveTranscription = true;
        if (geminiSession.isEchoOfModel(msg.text)) {
          console.log(`[Gateway] 🛡️ Ignored client speech transcript echo of model: "${msg.text}"`);
        } else {
          console.log(`[Gateway] 👤 Client live voice transcription: "${msg.text}"`);
        }
      } else if (msg.type === 'user_text' && msg.text) {
        if (silenceTimer) clearTimeout(silenceTimer);
        if (responseFallbackTimer) clearTimeout(responseFallbackTimer);
        isSpeakingDetected = false;
        speechChunks = [];
        preRollChunks.length = 0;
        consecutiveSpeech = 0;
        isTurnPending = true;
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
    if (responseFallbackTimer) clearTimeout(responseFallbackTimer);
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
const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', handleWsConnection);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n======================================================`);
  console.log(`🎙️  Gemini 3.8 Live + Hermes Bridge Gateway Online!`);
  console.log(`📍 Web PWA (Local):     http://localhost:${PORT}`);
  console.log(`📱 Celular (LAN):       http://192.168.31.191:${PORT}`);
  console.log(`🤖 Model:               ${process.env.GEMINI_MODEL || 'models/gemini-3.8-live'}`);
  console.log(`🔊 Voice:               ${process.env.GEMINI_VOICE || 'Aoede'}`);
  console.log(`🛡️  Hermes:              ${process.env.HERMES_API_URL || 'http://192.168.31.20:8642/v1/chat/completions'}`);
  console.log(`======================================================\n`);
});
