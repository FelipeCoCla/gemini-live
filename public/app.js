/**
 * Voice Interface PWA Controller
 * Bulletproof Web Audio API capture (16kHz PCM) + 24kHz PCM Playback scheduler.
 * Guaranteed audio graph pull via muteGain -> destination.
 */

import { GlowingOrb } from './orb.js?v=14';

class VoiceApp {
  constructor() {
    this.canvas = document.getElementById('orb-canvas');
    this.statusText = document.getElementById('status-text');
    this.container = document.getElementById('app-container');
    this.debugBtn = document.getElementById('debug-trigger');
    this.debugDrawer = document.getElementById('debug-drawer');
    this.closeDrawerBtn = document.getElementById('close-drawer');
    this.testInjectBtn = document.getElementById('test-inject-btn');
    this.customInjectInput = document.getElementById('custom-inject-text');
    this.ttsBtn = document.getElementById('tts-speak-btn');
    this.ttsInput = document.getElementById('tts-input-text');

    // WhatsApp-style Conversational UI Elements
    this.conversationPanel = document.getElementById('conversation-panel');
    this.chatThread = document.getElementById('chat-thread');
    this.chatContactStatus = document.getElementById('chat-contact-status');
    this.panelDisconnectBtn = document.getElementById('panel-disconnect-btn');
    this.quickTextForm = document.getElementById('quick-text-form');
    this.quickTextInput = document.getElementById('quick-text-input');

    this.activeUserBubble = null;
    this.activeModelBubble = null;
    this.lastUserSpokenText = '';
    this.recognition = null;
    this.isPlayingAudio = false;
    this.playbackEndTimer = null;
    this.recentModelTexts = [];
    this.isRecognitionAllowed = true;
    this.finalizeModelBubbleTimer = null;

    this.orb = new GlowingOrb(this.canvas);
    this.isConnected = false;
    this.isConnecting = false;

    // Web Audio state
    this.audioCtx = null;
    this.micStream = null;
    this.recorderNode = null;
    this.micAnalyser = null;
    this.speakerAnalyser = null;
    this.muteGain = null;

    // 24kHz PCM Playback scheduler
    this.scheduledSources = [];
    this.nextPlayTime = 0;

    // WebSocket connection
    this.ws = null;
    this.chunksSent = 0;

    this.checkEnvironment();
    this.initEvents();
    this.checkAutoStart();
  }

  checkEnvironment() {
    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const isMicAvailable = Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    const banner = document.getElementById('https-banner');
    const switchBtn = document.getElementById('btn-orb-switch-https');

    if (!isMicAvailable && !isLocal && window.location.protocol === 'http:') {
      if (banner && switchBtn) {
        banner.style.display = 'block';
        switchBtn.href = `https://${window.location.hostname}:3443${window.location.pathname}${window.location.search}`;
      }
    }
  }

  initEvents() {
    // Mobile touch handling to avoid accidental drags triggering click
    let touchMoved = false;
    this.container.addEventListener('touchstart', () => {
      touchMoved = false;
    }, { passive: true });
    this.container.addEventListener('touchmove', () => {
      touchMoved = true;
    }, { passive: true });

    // Tap to connect / disconnect
    // In idle: clicking anywhere connects.
    // In active session: clicking outside conversation panel (e.g. on the top minimized orb) disconnects.
    this.container.addEventListener('click', (e) => {
      if (touchMoved) return;
      if (e.target.closest('#debug-drawer') || 
          e.target.closest('#debug-trigger') || 
          e.target.closest('#https-banner') ||
          e.target.closest('#conversation-panel')) {
        return;
      }
      this.toggleSession();
    });

    if (this.panelDisconnectBtn) {
      this.panelDisconnectBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.disconnect();
      });
    }

    if (this.quickTextForm) {
      this.quickTextForm.addEventListener('submit', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const text = this.quickTextInput?.value?.trim();
        if (text) {
          this.sendUserText(text);
          this.quickTextInput.value = '';
          this.quickTextInput.blur();
        }
      });
    }

    if (this.conversationPanel) {
      this.conversationPanel.addEventListener('click', (e) => {
        e.stopPropagation();
      });
    }

    if (this.debugBtn) {
      this.debugBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.debugDrawer.classList.toggle('open');
      });
    }

    if (this.closeDrawerBtn) {
      this.closeDrawerBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.debugDrawer.classList.remove('open');
      });
    }

    if (this.ttsBtn) {
      this.ttsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const text = this.ttsInput?.value?.trim();
        if (text) this.sendUserText(text);
      });
    }

    if (this.ttsInput) {
      this.ttsInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          e.stopPropagation();
          const text = this.ttsInput?.value?.trim();
          if (text) this.sendUserText(text);
        }
      });
    }

    if (this.testInjectBtn) {
      this.testInjectBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const msg = this.customInjectInput.value.trim() || 
          "Hermes necesita saber si creamos una rama nueva en Git o usamos main.";
        this.sendHermesInjection(msg);
      });
    }
  }

  getCurrentTime() {
    const d = new Date();
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  scrollToBottom() {
    if (this.chatThread) {
      requestAnimationFrame(() => {
        this.chatThread.scrollTop = this.chatThread.scrollHeight;
      });
    }
  }

  setChatStatus(statusText) {
    if (this.chatContactStatus) {
      this.chatContactStatus.textContent = statusText;
      if (statusText === 'hablando...') {
        this.chatContactStatus.style.color = '#c084fc';
      } else if (statusText === 'pensando...') {
        this.chatContactStatus.style.color = '#38bdf8';
      } else if (statusText === 'escuchando...') {
        this.chatContactStatus.style.color = '#34d399';
      } else {
        this.chatContactStatus.style.color = '#00a884';
      }
    }
  }

  appendUserMessage(text, isLive = false) {
    if (!this.chatThread || !text) return null;

    const row = document.createElement('div');
    row.className = 'chat-bubble-row user-row';

    const bubble = document.createElement('div');
    bubble.className = `chat-bubble user-bubble ${isLive ? 'is-speaking' : ''}`;

    const textEl = document.createElement('div');
    textEl.className = 'bubble-text';
    textEl.textContent = text;
    bubble.appendChild(textEl);

    const meta = document.createElement('div');
    meta.className = 'bubble-meta';

    if (isLive) {
      const dot = document.createElement('span');
      dot.className = 'bubble-speaking-dot';
      meta.appendChild(dot);
    }

    const time = document.createElement('span');
    time.className = 'bubble-time';
    time.textContent = isLive ? 'hablando...' : this.getCurrentTime();
    meta.appendChild(time);

    const ticks = document.createElement('span');
    ticks.className = 'bubble-ticks';
    ticks.textContent = '✓✓';
    ticks.style.display = isLive ? 'none' : 'inline';
    meta.appendChild(ticks);

    bubble.appendChild(meta);
    row.appendChild(bubble);
    this.chatThread.appendChild(row);

    this.scrollToBottom();
    return bubble;
  }

  appendVoiceNoteMessage(durationStr) {
    if (!this.chatThread) return null;

    const row = document.createElement('div');
    row.className = 'chat-bubble-row user-row';

    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble user-bubble voice-note-bubble';

    const content = document.createElement('div');
    content.className = 'bubble-voice-content';
    content.innerHTML = `
      <div class="voice-mic-icon">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"></path>
          <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
          <line x1="12" y1="19" x2="12" y2="22"></line>
        </svg>
      </div>
      <div class="voice-bars">
        <span class="vbar"></span><span class="vbar"></span><span class="vbar"></span><span class="vbar"></span><span class="vbar"></span><span class="vbar"></span>
      </div>
      <span class="voice-dur">${durationStr}</span>
    `;
    bubble.appendChild(content);

    const meta = document.createElement('div');
    meta.className = 'bubble-meta';
    meta.innerHTML = `
      <span class="bubble-time">${this.getCurrentTime()}</span>
      <span class="bubble-ticks" style="display: inline;">✓✓</span>
    `;
    bubble.appendChild(meta);

    row.appendChild(bubble);
    this.chatThread.appendChild(row);
    this.scrollToBottom();
    return bubble;
  }

  appendModelMessage(text, isLive = false) {
    if (!this.chatThread) return null;

    const row = document.createElement('div');
    row.className = 'chat-bubble-row model-row';

    const bubble = document.createElement('div');
    bubble.className = `chat-bubble model-bubble ${isLive ? 'is-streaming' : ''}`;

    const sender = document.createElement('div');
    sender.className = 'bubble-sender';
    sender.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
      </svg>
      <span>Gemini 3.8</span>
    `;
    bubble.appendChild(sender);

    const textEl = document.createElement('div');
    textEl.className = 'bubble-text';
    textEl.textContent = text || '';
    bubble.appendChild(textEl);

    const meta = document.createElement('div');
    meta.className = 'bubble-meta';

    if (isLive) {
      const dot = document.createElement('span');
      dot.className = 'bubble-speaking-dot';
      meta.appendChild(dot);
    }

    const time = document.createElement('span');
    time.className = 'bubble-time';
    time.textContent = isLive ? 'voz...' : this.getCurrentTime();
    meta.appendChild(time);

    bubble.appendChild(meta);
    row.appendChild(bubble);
    this.chatThread.appendChild(row);

    this.scrollToBottom();
    return bubble;
  }

  appendSystemPill(text, icon = '⚙️') {
    if (!this.chatThread || !text) return;
    const pill = document.createElement('div');
    pill.className = 'chat-system-pill';
    pill.innerHTML = `<span>${icon}</span> <span>${text}</span>`;
    this.chatThread.appendChild(pill);
    this.scrollToBottom();
  }

  cleanTranscript(text) {
    if (!text) return '';
    const lower = text.toLowerCase();
    if (lower.includes('no speech') || 
        lower.includes('no audio') || 
        lower.includes('no_speech') || 
        lower.includes('detected') ||
        lower.includes('silence') || 
        lower.includes('silencio') ||
        lower.includes('<') ||
        lower.includes('>')) {
      return '';
    }
    let stripped = text.replace(/<[^>]+>/g, '').replace(/\[[^\]]+\]/g, '');
    if (!stripped.trim() || /^[\s.,!?;:–—-]+$/.test(stripped.trim())) {
      return '';
    }
    return stripped;
  }

  addRecentModelText(text) {
    if (!this.recentModelTexts) this.recentModelTexts = [];
    this.recentModelTexts.push(text);
    if (this.recentModelTexts.length > 25) {
      this.recentModelTexts.shift();
    }
  }

  isEchoOfModel(userText) {
    if (!userText || !this.recentModelTexts || !this.recentModelTexts.length) return false;

    const normalize = (s) => s.toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[\d]+/g, (d) => ({
        '1':'uno', '2':'dos', '3':'tres', '4':'cuatro', '5':'cinco',
        '6':'seis', '7':'siete', '8':'ocho', '9':'nueve', '10':'diez',
        '11':'once', '12':'doce', '13':'trece', '14':'catorce', '15':'quince',
        '16':'dieciseis', '17':'diecisiete', '18':'dieciocho', '19':'diecinueve', '20':'veinte'
      }[d] || d))
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const normUser = normalize(userText);
    if (!normUser || normUser.length < 3) return false;

    const userWords = normUser.split(' ').filter(w => w.length > 2);
    if (userWords.length === 0) return false;

    const combinedModel = normalize(this.recentModelTexts.join(' '));

    // 1. Direct substring match
    if (combinedModel.includes(normUser)) {
      return true;
    }

    // 2. Word overlap match (if >= 60% of user words appear in recent model output)
    let matchingWords = 0;
    for (const w of userWords) {
      if (combinedModel.includes(w)) {
        matchingWords++;
      }
    }

    const overlap = matchingWords / userWords.length;
    return overlap >= 0.6;
  }

  setupSpeechRecognition() {
    // CRITICAL: On mobile devices (Android / Huawei / iOS), native Web SpeechRecognition
    // triggers intrusive system sound effects (WhatsApp-like mic beeps) and seizes
    // exclusive hardware audio, disrupting live Web Audio PCM streaming to Gemini.
    // Desktop (Mac/PC) handles it silently without system beeps.
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    if (isMobile) {
      console.log('[PWA] 📱 Mobile device detected: Disabling client SpeechRecognition to prevent system chime tones and mic conflicts.');
      return;
    }

    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRec) {
      console.warn('[PWA] SpeechRecognition not natively available on this browser');
      return;
    }

    try {
      if (this.recognition) {
        try {
          this.recognition.onend = null;
          this.recognition.abort();
        } catch (e) {}
      }

      this.recognition = new SpeechRec();
      this.recognition.continuous = true;
      this.recognition.interimResults = true;
      this.recognition.lang = navigator.language || 'es-ES';

      this.recognition.onstart = () => {
        console.log('[PWA] 🎙️ Live SpeechRecognition active (lang:', this.recognition.lang, ')');
      };

      this.recognition.onresult = (event) => {
        // Drop recognition immediately if Gemini is playing audio or recognition is gated
        if (this.isPlayingAudio || !this.isRecognitionAllowed) {
          return;
        }

        let interimText = '';
        let finalText = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const trans = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            finalText += trans;
          } else {
            interimText += trans;
          }
        }

        const candidate = finalText || interimText;
        const currentText = this.cleanTranscript(candidate);
        if (!currentText) return;

        // Anti-echo guard: Drop if matches model output
        if (this.isEchoOfModel(currentText)) {
          console.warn(`[PWA] 🛡️ Ignored SpeechRecognition echo of model: "${currentText}"`);
          return;
        }

        this.handleUserSpeechInput(currentText, Boolean(finalText));
      };

      this.recognition.onerror = (e) => {
        console.warn('[PWA] SpeechRecognition error:', e.error);
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
          this.recognition = null;
        }
      };

      this.recognition.onend = () => {
        if (this.isConnected) {
          setTimeout(() => {
            if (this.isConnected) {
              try {
                this.recognition?.start();
              } catch (e) {
                // If instance failed or already started, re-setup cleanly
                if (e.name !== 'InvalidStateError') {
                  this.setupSpeechRecognition();
                }
              }
            }
          }, 250);
        }
      };

      this.isRecognitionAllowed = true;
      try {
        this.recognition.start();
      } catch (err) {
        console.warn('[PWA] Delayed recognition start:', err.message);
      }
    } catch (err) {
      console.warn('[PWA] Could not initialize SpeechRecognition:', err.message);
    }
  }

  handleUserSpeechInput(text, isFinal) {
    if (this.isPlayingAudio || !this.isRecognitionAllowed) return;
    if (this.isEchoOfModel(text)) {
      console.warn(`[PWA] 🛡️ handleUserSpeechInput blocked model echo: "${text}"`);
      if (this.activeUserBubble) {
        this.activeUserBubble.closest('.chat-bubble-row')?.remove();
        this.activeUserBubble = null;
      }
      return;
    }

    // Cancel model bubble timer and finalize previous model bubble if user begins speaking
    if (this.finalizeModelBubbleTimer) {
      clearTimeout(this.finalizeModelBubbleTimer);
      this.finalizeModelBubbleTimer = null;
    }
    if (this.activeModelBubble) {
      this.activeModelBubble.classList.remove('is-streaming');
      const dot = this.activeModelBubble.querySelector('.bubble-speaking-dot');
      if (dot) dot.remove();
      const time = this.activeModelBubble.querySelector('.bubble-time');
      if (time) time.textContent = this.getCurrentTime();
      this.activeModelBubble = null;
    }

    if (!this.activeUserBubble) {
      this.activeUserBubble = this.appendUserMessage(text, true);
      this.setChatStatus("escuchando...");
    } else {
      const textEl = this.activeUserBubble.querySelector('.bubble-text');
      if (textEl) textEl.textContent = text;
      this.scrollToBottom();
    }

    if (isFinal) {
      if (this.activeUserBubble) {
        this.activeUserBubble.classList.remove('is-speaking');
        const dot = this.activeUserBubble.querySelector('.bubble-speaking-dot');
        if (dot) dot.remove();
        const time = this.activeUserBubble.querySelector('.bubble-time');
        if (time) time.textContent = this.getCurrentTime();
        const ticks = this.activeUserBubble.querySelector('.bubble-ticks');
        if (ticks) ticks.style.display = 'inline';

        this.lastUserSpokenText = text;
        this.activeUserBubble = null;
      }

      this.setChatStatus("pensando...");

      // Send recognized text to Gateway for logging and sync
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({
          type: 'user_speech_transcript',
          text: text
        }));
      }
    }
  }

  sendUserText(text) {
    if (!text || !text.trim()) return;
    const cleanText = text.trim();

    if (this.finalizeModelBubbleTimer) {
      clearTimeout(this.finalizeModelBubbleTimer);
      this.finalizeModelBubbleTimer = null;
    }
    if (this.activeModelBubble) {
      this.activeModelBubble.classList.remove('is-streaming');
      const dot = this.activeModelBubble.querySelector('.bubble-speaking-dot');
      if (dot) dot.remove();
      const time = this.activeModelBubble.querySelector('.bubble-time');
      if (time) time.textContent = this.getCurrentTime();
      this.activeModelBubble = null;
    }

    // Directly append user message into WhatsApp feed
    this.appendUserMessage(cleanText, false);
    this.setChatStatus("pensando...");

    if (!this.isConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.connect().then(() => {
        setTimeout(() => {
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type: 'user_text', text: cleanText }));
          }
        }, 500);
      });
      return;
    }

    this.ws.send(JSON.stringify({
      type: 'user_text',
      text: cleanText
    }));
  }

  checkAutoStart() {
    const params = new URLSearchParams(window.location.search);
    const shouldAutoStart = params.get('auto') === 'true' || 
                            params.get('autostart') === 'true' || 
                            params.get('start') === '1' ||
                            params.get('source') === 'assistant';

    if (shouldAutoStart) {
      console.log('[PWA] 🚀 Auto-start triggered from Hey Google / Shortcut intent');
      this.setStatus("Iniciando manos libres...", "thinking");
      setTimeout(() => {
        this.connect();
      }, 400);
    }
  }

  setStatus(text, state = null) {
    if (this.statusText) {
      this.statusText.textContent = text;
    }
    if (state) {
      this.orb.setState(state);
      this.container.dataset.state = state;
    }
  }

  async toggleSession() {
    if (this.isConnecting) return;
    const now = Date.now();
    if (this.lastToggleTime && now - this.lastToggleTime < 600) return;
    this.lastToggleTime = now;

    if (this.isConnected) {
      this.disconnect();
    } else {
      await this.connect();
    }
  }

  async connect() {
    this.isConnecting = true;
    this.chunksSent = 0;

    // Check if browser environment supports microphone
    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      this.isConnecting = false;
      const errMsg = "Micrófono bloqueado (requiere HTTPS)";
      this.setStatus(errMsg, "idle");
      if (!isLocal && window.location.protocol === 'http:') {
        const httpsUrl = `https://${window.location.hostname}:3443${window.location.pathname}${window.location.search}`;
        if (confirm('⚠️ Tu navegador móvil (Chrome/Safari) bloquea el micrófono por HTTP.\n\n¿Deseas cambiar ahora a la versión segura HTTPS en el puerto 3443?')) {
          window.location.href = httpsUrl;
          return;
        }
      } else {
        alert('Tu navegador no permite acceso al micrófono en este modo. En celulares accede vía HTTPS: https://' + window.location.hostname + ':3443');
      }
      return;
    }

    this.setStatus("Iniciando audio...", "thinking");
    this.setChatStatus("conectando...");
    if (this.container) {
      this.container.classList.add('session-active');
    }
    if (this.orb) {
      this.orb.setCompact(true);
    }

    try {
      // 1. Initialize AudioContext at native hardware rate (e.g. 48000Hz)
      // NEVER force sampleRate: 16000: on macOS Chrome, forcing 16000 causes
      // createMediaStreamSource to fill the audio buffers with digital silence!
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!this.audioCtx) {
        this.audioCtx = new AudioContextClass({ latencyHint: 'interactive' });
      }
      if (this.audioCtx.state === 'suspended') {
        await this.audioCtx.resume();
      }

      console.log(`[PWA] AudioContext active at sampleRate: ${this.audioCtx.sampleRate}Hz`);

      // 2. Request Microphone Access
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1
        }
      });

      console.log('[PWA] Microphone permission granted');

      // 3. Connect Microphone Source & Analyser for Orb
      const micSource = this.audioCtx.createMediaStreamSource(this.micStream);
      this.micAnalyser = this.audioCtx.createAnalyser();
      this.micAnalyser.fftSize = 128;
      micSource.connect(this.micAnalyser);
      this.orb.setMicAnalyser(this.micAnalyser);

      // 4. Setup Speaker Analyser for Gemini voice visualization
      this.speakerAnalyser = this.audioCtx.createAnalyser();
      this.speakerAnalyser.fftSize = 128;
      this.speakerAnalyser.connect(this.audioCtx.destination);
      this.orb.setSpeakerAnalyser(this.speakerAnalyser);

      // 5. Connect WebSocket to Backend Gateway
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws`;
      console.log('[PWA] Connecting WebSocket to', wsUrl);
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log('[PWA] WebSocket connected to Gateway. Listening to user voice...');
        this.isConnected = true;
        this.isConnecting = false;
        this.setStatus("Conectado con Gemini. Di algo...", "listening");
        this.setChatStatus("en línea");
      };

      this.ws.onmessage = (event) => {
        this.handleGatewayMessage(event.data);
      };

      this.ws.onerror = (err) => {
        console.error('[PWA] WebSocket error:', err);
        this.setStatus("Error de conexión. Toca para reintentar.", "idle");
        this.setChatStatus("error");
      };

      this.ws.onclose = () => {
        console.log('[PWA] WebSocket closed');
        this.disconnect();
      };

      // 6. Setup Audio Capture Node with guaranteed graph pull
      await this.setupAudioCapture(micSource);

      // 7. Setup Live Speech Recognition for real-time WhatsApp bubble transcription
      this.setupSpeechRecognition();

    } catch (err) {
      console.error('[PWA] Connection failed:', err);
      this.isConnecting = false;
      this.setStatus(`Error: ${err.message || 'Permiso de micrófono denegado'}`, "idle");
      this.disconnect(true);
    }
  }

  /**
   * Sets up 16kHz PCM audio capture using AudioWorklet with ScriptProcessor fallback
   */
  async setupAudioCapture(micSource) {
    const inputSampleRate = this.audioCtx.sampleRate;
    const targetSampleRate = 16000;
    const ratio = inputSampleRate / targetSampleRate;

    // Create a mute gain connected to destination
    // THIS IS CRUCIAL: Web Audio requires a path to destination to pull frames through the nodes!
    this.muteGain = this.audioCtx.createGain();
    this.muteGain.gain.value = 0.0;
    this.muteGain.connect(this.audioCtx.destination);

    // Anti-aliasing low-pass filter (Nyquist limit for 16kHz is 8000Hz)
    this.antiAliasingFilter = this.audioCtx.createBiquadFilter();
    this.antiAliasingFilter.type = 'lowpass';
    this.antiAliasingFilter.frequency.value = 7500;
    this.antiAliasingFilter.Q.value = 0.7071;
    micSource.connect(this.antiAliasingFilter);

    try {
      // Try AudioWorklet first
      await this.audioCtx.audioWorklet.addModule('./audio-recorder-worklet.js?v=10');
      const worklet = new AudioWorkletNode(this.audioCtx, 'audio-recorder-processor');
      
      this.antiAliasingFilter.connect(worklet);
      worklet.connect(this.muteGain); // Completes graph pull to destination
      this.recorderNode = worklet;

      worklet.port.onmessage = (e) => {
        this.sendPcmChunk(e.data);
      };

      console.log('[PWA] AudioWorklet capture node initialized with anti-aliasing filter');
    } catch (workletErr) {
      console.warn('[PWA] AudioWorklet failed, using ScriptProcessorNode fallback:', workletErr);

      // Fallback: ScriptProcessorNode (universal across all browsers)
      const bufferSize = 2048;
      const scriptNode = this.audioCtx.createScriptProcessor(bufferSize, 1, 1);
      
      let sampleOffset = 0;
      let pcmChunk = [];

      scriptNode.onaudioprocess = (audioEvent) => {
        if (!this.isConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;

        const channelData = audioEvent.inputBuffer.getChannelData(0);
        let i = sampleOffset;

        while (i < channelData.length) {
          const idx = Math.floor(i);
          const nextIdx = Math.min(idx + 1, channelData.length - 1);
          const frac = i - idx;
          const s = channelData[idx] * (1 - frac) + channelData[nextIdx] * frac;

          const clamped = Math.max(-1, Math.min(1, s));
          const int16 = clamped < 0 ? clamped * 32768 : clamped * 32767;
          pcmChunk.push(Math.round(int16));

          if (pcmChunk.length >= 1024) {
            const int16Buf = new Int16Array(pcmChunk);
            this.sendPcmChunk(int16Buf.buffer);
            pcmChunk = [];
          }

          i += ratio;
        }

        sampleOffset = i - channelData.length;
      };

      micSource.connect(scriptNode);
      scriptNode.connect(this.muteGain);
      this.recorderNode = scriptNode;
      console.log('[PWA] ScriptProcessorNode capture active');
    }
  }

  sendPcmChunk(arrayBuffer) {
    if (!this.isConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    // GATED: Prevent microphone from feeding speaker output back into Gemini Live
    if (this.isPlayingAudio) {
      return;
    }

    this.chunksSent++;
    if (this.chunksSent % 50 === 1) {
      console.log(`[PWA] 🎙️ Sent ${this.chunksSent} audio chunks to Gemini Live`);
    }

    const base64 = this.arrayBufferToBase64(arrayBuffer);
    this.ws.send(JSON.stringify({
      type: 'audio',
      data: base64
    }));
  }

  handleGatewayMessage(rawData) {
    try {
      const msg = JSON.parse(rawData);

      switch (msg.type) {
        case 'state':
          if (msg.state === 'ready' || msg.state === 'listening') {
            this.setChatStatus("en línea");
            this.setStatus("Escuchando...", "listening");
            // Do not immediately close activeModelBubble here; let finalizeModelBubbleTimer or user speech close it smoothly
          } else if (msg.state === 'thinking') {
            const taskInfo = msg.metadata?.task ? `: "${msg.metadata.task}"` : '';
            this.setChatStatus("pensando...");
            this.setStatus(`Hermes orquestando${taskInfo}...`, "thinking");
            if (msg.metadata?.task) {
              this.appendSystemPill(`Hermes: ${msg.metadata.task}`, '⚙️');
            }
          } else if (msg.state === 'speaking') {
            this.setChatStatus("hablando...");
            this.setStatus("Gemini respondiendo...", "speaking");
          }
          break;

        case 'audio':
          // Streamed 24kHz PCM audio chunk from Gemini
          this.playAudioChunk(msg.data);
          this.setChatStatus("hablando...");
          this.setStatus("Gemini respondiendo...", "speaking");
          break;

        case 'interrupted':
          console.log('[PWA] Barge-in interrupted by user');
          this.stopAudioPlayback();
          if (this.finalizeModelBubbleTimer) {
            clearTimeout(this.finalizeModelBubbleTimer);
            this.finalizeModelBubbleTimer = null;
          }
          if (this.activeModelBubble) {
            this.activeModelBubble.classList.remove('is-streaming');
            const dot = this.activeModelBubble.querySelector('.bubble-speaking-dot');
            if (dot) dot.remove();
            const time = this.activeModelBubble.querySelector('.bubble-time');
            if (time) time.textContent = this.getCurrentTime();
            this.activeModelBubble = null;
          }
          this.setChatStatus("escuchando...");
          this.setStatus("Escuchando...", "listening");
          break;

        case 'voice_committed': {
          const duration = parseFloat(msg.durationSec) || 0;
          const durStr = duration > 0 ? `${duration.toFixed(1)}s` : 'audio';
          console.log(`[PWA] 🎙️ Voice turn committed (${durStr})`);

          // Finalize previous model bubble if open
          if (this.finalizeModelBubbleTimer) {
            clearTimeout(this.finalizeModelBubbleTimer);
            this.finalizeModelBubbleTimer = null;
          }
          if (this.activeModelBubble) {
            this.activeModelBubble.classList.remove('is-streaming');
            const dot = this.activeModelBubble.querySelector('.bubble-speaking-dot');
            if (dot) dot.remove();
            const time = this.activeModelBubble.querySelector('.bubble-time');
            if (time) time.textContent = this.getCurrentTime();
            this.activeModelBubble = null;
          }

          // If no client speech recognition bubble is already active with text, create a voice note bubble
          if (!this.activeUserBubble) {
            this.appendVoiceNoteMessage(durStr);
          } else {
            this.activeUserBubble.classList.remove('is-speaking');
            const dot = this.activeUserBubble.querySelector('.bubble-speaking-dot');
            if (dot) dot.remove();
            const time = this.activeUserBubble.querySelector('.bubble-time');
            if (time) time.textContent = this.getCurrentTime();
            const ticks = this.activeUserBubble.querySelector('.bubble-ticks');
            if (ticks) ticks.style.display = 'inline';
            this.activeUserBubble = null;
          }
          this.setChatStatus("pensando...");
          this.setStatus("Pensando...", "thinking");
          break;
        }

        case 'transcript':
          console.log(`[Transcript] ${msg.role}: ${msg.text}`);
          if (msg.role === 'user' && msg.text) {
            const clean = this.cleanTranscript(msg.text);
            if (!clean) break;

            // Prevent gateway echo of model output from showing up as user bubble
            if (this.isEchoOfModel(clean)) {
              console.warn(`[PWA] 🛡️ Ignored gateway user transcript echo of model: "${clean}"`);
              if (this.activeUserBubble && this.activeUserBubble.classList.contains('is-speaking')) {
                this.activeUserBubble.closest('.chat-bubble-row')?.remove();
                this.activeUserBubble = null;
              }
              break;
            }

            // Finalize previous model bubble if open
            if (this.finalizeModelBubbleTimer) {
              clearTimeout(this.finalizeModelBubbleTimer);
              this.finalizeModelBubbleTimer = null;
            }
            if (this.activeModelBubble) {
              this.activeModelBubble.classList.remove('is-streaming');
              const dot = this.activeModelBubble.querySelector('.bubble-speaking-dot');
              if (dot) dot.remove();
              const time = this.activeModelBubble.querySelector('.bubble-time');
              if (time) time.textContent = this.getCurrentTime();
              this.activeModelBubble = null;
            }

            if (clean !== this.lastUserSpokenText) {
              if (this.activeUserBubble) {
                const textEl = this.activeUserBubble.querySelector('.bubble-text');
                if (textEl) textEl.textContent = clean;
                this.activeUserBubble.classList.remove('is-speaking');
                const dot = this.activeUserBubble.querySelector('.bubble-speaking-dot');
                if (dot) dot.remove();
                const time = this.activeUserBubble.querySelector('.bubble-time');
                if (time) time.textContent = this.getCurrentTime();
                const ticks = this.activeUserBubble.querySelector('.bubble-ticks');
                if (ticks) ticks.style.display = 'inline';
                this.activeUserBubble = null;
              } else {
                this.appendUserMessage(clean, false);
              }
              this.lastUserSpokenText = clean;
            } else if (this.activeUserBubble) {
              this.activeUserBubble.classList.remove('is-speaking');
              const dot = this.activeUserBubble.querySelector('.bubble-speaking-dot');
              if (dot) dot.remove();
              const time = this.activeUserBubble.querySelector('.bubble-time');
              if (time) time.textContent = this.getCurrentTime();
              const ticks = this.activeUserBubble.querySelector('.bubble-ticks');
              if (ticks) ticks.style.display = 'inline';
              this.activeUserBubble = null;
            }
            this.setChatStatus("pensando...");
          } else if (msg.role === 'model' && msg.text) {
            const clean = this.cleanTranscript(msg.text);
            if (!clean) break;

            this.addRecentModelText(clean);

            if (this.finalizeModelBubbleTimer) {
              clearTimeout(this.finalizeModelBubbleTimer);
              this.finalizeModelBubbleTimer = null;
            }

            if (!this.activeModelBubble) {
              this.activeModelBubble = this.appendModelMessage(clean.trimStart(), true);
            } else {
              const textEl = this.activeModelBubble.querySelector('.bubble-text');
              if (textEl) {
                const prev = textEl.textContent;
                // Smart spacing: guarantee words are not concatenated without spaces
                const needsSpace = prev.length > 0 && 
                                   !/[\s\n\r]$/.test(prev) && 
                                   !/^[\s\n\r.,!?;:)\]]/.test(clean);
                textEl.textContent = prev + (needsSpace ? ' ' : '') + clean;
              }
              this.scrollToBottom();
            }
            this.setChatStatus("hablando...");
          }
          break;

        case 'error':
          console.error('[PWA] Gateway error:', msg.message);
          this.setStatus(`Error: ${msg.message}`, "idle");
          this.setChatStatus("error");
          break;

        case 'closed':
          this.disconnect();
          break;
      }
    } catch (err) {
      console.error('[PWA] Error handling message:', err);
    }
  }

  /**
   * Plays a 24,000 Hz 16-bit linear PCM audio chunk smoothly using scheduled AudioBufferSourceNodes
   */
  playAudioChunk(base64Pcm24k) {
    if (!this.audioCtx) return;

    if (!this.isPlayingAudio) {
      this.isPlayingAudio = true;
      // Gate recognition without calling abort() so the native recognition engine stays alive
      this.isRecognitionAllowed = false;

      // Purge any lingering user bubble that was open right as audio started
      if (this.activeUserBubble && this.activeUserBubble.classList.contains('is-speaking')) {
        this.activeUserBubble.closest('.chat-bubble-row')?.remove();
        this.activeUserBubble = null;
      }

      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'playback_state', playing: true }));
      }
    }

    if (this.playbackEndTimer) {
      clearTimeout(this.playbackEndTimer);
      this.playbackEndTimer = null;
    }

    try {
      const binaryString = atob(base64Pcm24k);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // Convert 16-bit PCM to Float32
      const int16Array = new Int16Array(bytes.buffer);
      const sampleCount = int16Array.length;
      const float32Array = new Float32Array(sampleCount);

      for (let i = 0; i < sampleCount; i++) {
        float32Array[i] = int16Array[i] / 32768.0;
      }

      // Create AudioBuffer at 24000 Hz
      const audioBuffer = this.audioCtx.createBuffer(1, sampleCount, 24000);
      audioBuffer.getChannelData(0).set(float32Array);

      // Create buffer source
      const source = this.audioCtx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.speakerAnalyser);

      // Schedule playback to prevent audio gaps or overlaps
      const currentTime = this.audioCtx.currentTime;
      if (this.nextPlayTime < currentTime) {
        this.nextPlayTime = currentTime + 0.02; // Small 20ms safety offset
      }

      source.start(this.nextPlayTime);
      this.nextPlayTime += audioBuffer.duration;

      this.scheduledSources.push(source);
      source.onended = () => {
        const idx = this.scheduledSources.indexOf(source);
        if (idx > -1) this.scheduledSources.splice(idx, 1);

        // If no more audio is scheduled, start quick cooldown before reopening mic
        if (this.scheduledSources.length === 0) {
          if (this.playbackEndTimer) clearTimeout(this.playbackEndTimer);
          // Fast 200ms cooldown so user voice is never cut off
          this.playbackEndTimer = setTimeout(() => {
            if (this.scheduledSources.length === 0) {
              this.isPlayingAudio = false;
              if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({ type: 'playback_state', playing: false }));
              }
              if (this.isConnected && this.orb.targetState === 'speaking') {
                this.setStatus("Escuchando...", "listening");
                this.setChatStatus("en línea");
              }

              // Finalize model bubble with debounce so pauses between clauses don't split bubble
              if (this.finalizeModelBubbleTimer) clearTimeout(this.finalizeModelBubbleTimer);
              this.finalizeModelBubbleTimer = setTimeout(() => {
                if (this.activeModelBubble && !this.isPlayingAudio) {
                  this.activeModelBubble.classList.remove('is-streaming');
                  const dot = this.activeModelBubble.querySelector('.bubble-speaking-dot');
                  if (dot) dot.remove();
                  const time = this.activeModelBubble.querySelector('.bubble-time');
                  if (time) time.textContent = this.getCurrentTime();
                  this.activeModelBubble = null;
                }
              }, 1200);

              // Allow speech recognition immediately
              this.isRecognitionAllowed = true;
              if (this.isConnected) {
                try {
                  this.recognition?.start();
                } catch (e) {
                  if (e.name !== 'InvalidStateError') {
                    this.setupSpeechRecognition();
                  }
                }
              }
            }
          }, 200);
        }
      };

    } catch (err) {
      console.error('[PWA] Error decoding audio chunk:', err);
    }
  }

  stopAudioPlayback() {
    for (const source of this.scheduledSources) {
      try {
        source.stop();
      } catch (e) {}
    }
    this.scheduledSources = [];
    this.isPlayingAudio = false;
    if (this.playbackEndTimer) {
      clearTimeout(this.playbackEndTimer);
      this.playbackEndTimer = null;
    }
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'playback_state', playing: false }));
    }
    if (this.audioCtx) {
      this.nextPlayTime = this.audioCtx.currentTime;
    }
  }

  disconnect(keepStatus = false) {
    this.isConnected = false;
    this.isConnecting = false;
    this.chunksSent = 0;
    this.isPlayingAudio = false;
    if (this.playbackEndTimer) {
      clearTimeout(this.playbackEndTimer);
      this.playbackEndTimer = null;
    }
    if (this.finalizeModelBubbleTimer) {
      clearTimeout(this.finalizeModelBubbleTimer);
      this.finalizeModelBubbleTimer = null;
    }

    if (this.recognition) {
      try {
        this.recognition.abort();
      } catch (e) {}
      this.recognition = null;
    }

    if (this.activeUserBubble) {
      this.activeUserBubble.classList.remove('is-speaking');
      const dot = this.activeUserBubble.querySelector('.bubble-speaking-dot');
      if (dot) dot.remove();
      this.activeUserBubble = null;
    }

    if (this.activeModelBubble) {
      this.activeModelBubble.classList.remove('is-streaming');
      const dot = this.activeModelBubble.querySelector('.bubble-speaking-dot');
      if (dot) dot.remove();
      this.activeModelBubble = null;
    }

    this.setChatStatus("desconectado");

    // Reset UI to idle centered orb and hide conversation panel
    if (this.container) {
      this.container.classList.remove('session-active');
    }
    if (this.orb) {
      this.orb.setCompact(false);
    }

    this.stopAudioPlayback();

    if (this.ws) {
      try {
        this.ws.close();
      } catch (e) {}
      this.ws = null;
    }

    if (this.micStream) {
      this.micStream.getTracks().forEach(track => track.stop());
      this.micStream = null;
    }

    if (this.recorderNode) {
      try {
        this.recorderNode.disconnect();
      } catch (e) {}
      this.recorderNode = null;
    }

    if (this.antiAliasingFilter) {
      try {
        this.antiAliasingFilter.disconnect();
      } catch (e) {}
      this.antiAliasingFilter = null;
    }

    if (this.muteGain) {
      try {
        this.muteGain.disconnect();
      } catch (e) {}
      this.muteGain = null;
    }

    if (!keepStatus) {
      this.setStatus("Toca para hablar", "idle");
    } else {
      if (this.orb) this.orb.setState("idle");
      if (this.container) this.container.dataset.state = "idle";
    }
  }

  async sendTtsSpeech(text) {
    if (!text || !text.trim()) return;

    if (!this.isConnected) {
      this.setStatus("Iniciando sesión de voz...", "thinking");
      await this.connect();
      let attempts = 0;
      while (!this.isConnected && attempts < 25) {
        await new Promise(r => setTimeout(r, 200));
        attempts++;
      }
      if (!this.isConnected) {
        alert("No se pudo conectar la sesión. Toca la pantalla primero.");
        return;
      }
    }

    this.debugDrawer.classList.remove('open');
    this.setStatus(`Consultando: "${text.slice(0, 32)}..."`, "thinking");

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'user_text',
        text: text.trim()
      }));
    }
  }

  sendHermesInjection(message) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      console.log('[PWA] Requesting proactive Hermes injection:', message);
      this.appendSystemPill(`Hermes: ${message}`, '⚙️');
      this.ws.send(JSON.stringify({
        type: 'test_inject',
        message
      }));
      this.debugDrawer.classList.remove('open');
      this.setStatus("Inyectando pregunta de Hermes...", "thinking");
      this.setChatStatus("pensando...");
    } else {
      alert("Debes conectar la sesión de voz primero tocando el orbe.");
    }
  }

  arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
  }
}

// Initialize on DOM load
window.addEventListener('DOMContentLoaded', () => {
  const welcomeTime = document.getElementById('initial-welcome-time');
  if (welcomeTime) {
    welcomeTime.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  window.app = new VoiceApp();

  // Register PWA Service Worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./service-worker.js?v=9')
      .then(reg => console.log('[PWA] Service Worker registered:', reg.scope))
      .catch(err => console.log('[PWA] Service Worker registration failed:', err));
  }
});
