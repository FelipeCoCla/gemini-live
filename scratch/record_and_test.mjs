#!/usr/bin/env node
/**
 * Interactive Real Voice Recorder & Gemini Live Diagnostic Tool
 * Records YOUR actual microphone voice, sends it to Gemini Live,
 * logs all debug messages, and plays back Gemini's response.
 */

import fs from 'fs';
import readline from 'readline';
import { spawn } from 'child_process';
import dotenv from 'dotenv';
dotenv.config();
import { WebSocket } from 'ws';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const RECORD_FILE = '/tmp/user_real_voice.wav';

console.log('\n======================================================');
console.log('🎙️  TEST DE VOZ REAL HUMANA CON GEMINI 3.8 LIVE');
console.log('======================================================\n');

function askQuestion(query) {
  return new Promise((resolve) => rl.question(query, resolve));
}

async function main() {
  await askQuestion('👉 Presiona [ENTER] cuando estés listo para empezar a hablar...');

  console.log('\n🔴 GRABANDO... Habla ahora (hazle tu pregunta a Gemini en voz alta)');
  console.log('👉 Presiona [ENTER] nuevamente para TERMINAR de hablar...\n');

  // Spawn rec process
  const recProcess = spawn('/opt/homebrew/bin/rec', [
    '-r', '16000',
    '-c', '1',
    '-b', '16',
    RECORD_FILE
  ]);

  recProcess.stderr.on('data', () => {}); // silence sox progress in console

  await askQuestion('');

  // Stop recording cleanly
  console.log('⏹️ Deteniendo grabación...');
  recProcess.kill('SIGINT');

  // Wait 400ms for file to be flushed
  await new Promise(r => setTimeout(r, 400));

  if (!fs.existsSync(RECORD_FILE)) {
    console.error('❌ No se encontró el archivo grabado en', RECORD_FILE);
    process.exit(1);
  }

  const stat = fs.statSync(RECORD_FILE);
  console.log(`✅ Audio grabado con éxito (${(stat.size / 1024).toFixed(1)} KB en ${RECORD_FILE})`);

  // Verify playback so user knows what was captured
  console.log('\n🔊 Reproduciendo lo que grabaste para verificar tu micrófono...');
  const player = spawn('/usr/bin/afplay', [RECORD_FILE]);
  await new Promise(resolve => player.on('close', resolve));

  const proceed = await askQuestion('\n¿Se escuchó bien tu voz? (Presiona [ENTER] para enviarlo a Gemini o Ctrl+C para cancelar)...');

  console.log('\n🚀 Conectando a Gemini 3.8 Live WebSocket y transmitiendo tu voz real...');
  await sendToGeminiLive(RECORD_FILE);
}

function sendToGeminiLive(wavPath) {
  return new Promise((resolve) => {
    const apiKey = process.env.GEMINI_API_KEY;
    const model = process.env.GEMINI_MODEL || 'models/gemini-3.8-live';
    const voice = process.env.GEMINI_VOICE || 'Aoede';

    const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${apiKey}`;
    const ws = new WebSocket(url);

    const wavBuffer = fs.readFileSync(wavPath);
    // Find data chunk in RIFF header
    const dataIdx = wavBuffer.indexOf(Buffer.from('data'));
    const pcmBuffer = dataIdx !== -1 ? wavBuffer.subarray(dataIdx + 8) : wavBuffer.subarray(44);

    console.log(`📦 Buffer PCM extraído: ${pcmBuffer.length} bytes (~${(pcmBuffer.length / 32000).toFixed(2)}s de audio a 16kHz)`);

    const geminiAudioChunks = [];

    ws.on('open', () => {
      console.log('🔗 WebSocket conectado con Google AI. Enviando setup...');
      ws.send(JSON.stringify({
        setup: {
          model,
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName: voice
                }
              }
            }
          },
          systemInstruction: {
            parts: [{
              text: `Eres la interfaz de voz inteligente y humana entre Felipe y su orquestador técnico central Hermes en su bunker.
Tus responsabilidades:
1. Escucha con máxima atención lo que Felipe te dice o pregunta.
2. Responde SIEMPRE de forma directa, concisa, natural y en español a la pregunta específica que Felipe haya hecho. NUNCA respondas saludos genéricos de bienvenida si ya te hizo una pregunta.
3. Si Felipe te pide expresamente una tarea técnica, invoca la herramienta 'send_to_orchestrator' y dile una frase corta de confirmación.`
            }]
          },
          tools: [
            {
              functionDeclarations: [
                {
                  name: 'send_to_orchestrator',
                  description: 'Delega una tarea técnica de comandos, terminal, scripts o git a Hermes en el bunker.',
                  parameters: {
                    type: 'OBJECT',
                    properties: {
                      task: { type: 'STRING', description: 'Descripción de la tarea' },
                      action_type: { type: 'STRING', description: 'Tipo de acción: git, command, script' }
                    },
                    required: ['task', 'action_type']
                  }
                }
              ]
            }
          ]
        }
      }));
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());

        if (msg.setupComplete) {
          console.log('⚡ Sesión de Gemini Live lista. Transmitiendo tu voz chunk a chunk (64ms)...');
          streamAudio(ws, pcmBuffer);
        }

        if (msg.serverContent) {
          const keys = Object.keys(msg.serverContent);
          if (keys.length > 0) {
            console.log('📩 [serverContent]:', keys.join(', '));
          }

          if (msg.serverContent.inputTranscription?.text) {
            console.log(`\n🎤 [LO QUE GEMINI ENTENDIÓ DE TU VOZ]: "${msg.serverContent.inputTranscription.text}"`);
          }

          if (msg.serverContent.outputTranscription?.text) {
            process.stdout.write(msg.serverContent.outputTranscription.text);
          }

          if (msg.serverContent.modelTurn?.parts) {
            for (const part of msg.serverContent.modelTurn.parts) {
              if (part.inlineData?.data) {
                geminiAudioChunks.push(Buffer.from(part.inlineData.data, 'base64'));
              }
            }
          }

          if (msg.serverContent.turnComplete) {
            console.log('\n\n🏁 Turno de Gemini completado.');
            playGeminiAudio(geminiAudioChunks).then(() => {
              ws.close();
              resolve();
            });
          }
        }

        if (msg.toolCall) {
          console.log('\n🛠️ [TOOL CALL INVOCADA POR GEMINI]:', JSON.stringify(msg.toolCall, null, 2));
          // Respond to tool call
          const callId = msg.toolCall.functionCalls[0].id;
          ws.send(JSON.stringify({
            toolResponse: {
              functionResponses: [
                {
                  id: callId,
                  response: { output: { status: 'acknowledged', message: 'Tarea recibida por Hermes' } }
                }
              ]
            }
          }));
        }
      } catch (err) {
        console.error('Error procesando mensaje:', err.message);
      }
    });

    ws.on('error', (err) => {
      console.error('❌ Error de WebSocket:', err.message);
      resolve();
    });

    ws.on('close', (code, reason) => {
      console.log(`🔌 Conexión cerrada (${code}): ${reason.toString()}`);
      resolve();
    });
  });
}

function streamAudio(ws, pcmBuffer) {
  const chunkSize = 2048; // 64ms at 16kHz
  let offset = 0;

  const interval = setInterval(() => {
    if (offset >= pcmBuffer.length) {
      clearInterval(interval);
      console.log('✅ Tu audio completo ha sido transmitido.');
      console.log('⏳ Enviando fin de audio (audioStreamEnd & turnComplete)...');
      
      // Send audio stream end and turn complete
      ws.send(JSON.stringify({
        realtimeInput: {
          audioStreamEnd: true
        }
      }));

      ws.send(JSON.stringify({
        clientContent: {
          turnComplete: true
        }
      }));

      console.log('\n🗣️ Respuesta hablada de Gemini:\n');
      return;
    }

    const chunk = pcmBuffer.subarray(offset, Math.min(offset + chunkSize, pcmBuffer.length));
    ws.send(JSON.stringify({
      realtimeInput: {
        mediaChunks: [
          {
            mimeType: 'audio/pcm;rate=16000',
            data: chunk.toString('base64')
          }
        ]
      }
    }));
    offset += chunkSize;
  }, 64);
}

async function playGeminiAudio(chunks) {
  if (chunks.length === 0) {
    console.log('(No se recibió audio de Gemini)');
    return;
  }

  const fullPcm = Buffer.concat(chunks);
  const outWav = `/tmp/gemini_real_reply_${Date.now()}.wav`;

  // Write standard 24kHz mono WAV
  const wavHeader = Buffer.alloc(44);
  const sampleRate = 24000;
  const channels = 1;
  const bitDepth = 16;
  const dataLength = fullPcm.length;
  const byteRate = (sampleRate * channels * bitDepth) / 8;
  const blockAlign = (channels * bitDepth) / 8;

  wavHeader.write('RIFF', 0);
  wavHeader.writeUInt32LE(36 + dataLength, 4);
  wavHeader.write('WAVE', 8);
  wavHeader.write('fmt ', 12);
  wavHeader.writeUInt32LE(16, 16);
  wavHeader.writeUInt16LE(1, 20);
  wavHeader.writeUInt16LE(channels, 22);
  wavHeader.writeUInt32LE(sampleRate, 24);
  wavHeader.writeUInt32LE(byteRate, 28);
  wavHeader.writeUInt16LE(blockAlign, 32);
  wavHeader.writeUInt16LE(bitDepth, 34);
  wavHeader.write('data', 36);
  wavHeader.writeUInt32LE(dataLength, 40);

  fs.writeFileSync(outWav, Buffer.concat([wavHeader, fullPcm]));

  console.log('\n🔊 Reproduciendo la voz de Gemini en tus audífonos/parlantes (afplay)...');
  const player = spawn('/usr/bin/afplay', [outWav]);
  await new Promise(resolve => player.on('close', resolve));
  try { fs.unlinkSync(outWav); } catch (e) {}
  console.log('✨ Fin de la reproducción.\n');
}

main().catch(console.error);
