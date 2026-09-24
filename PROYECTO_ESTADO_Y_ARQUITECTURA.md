# 🎙️ Gemini Live + Hermes Bridge • Documentación de Arquitectura, Estado y Registro de Problemas

Este documento detalla el propósito del proyecto, la arquitectura implementada, los desafíos técnicos encontrados a lo largo del desarrollo, las soluciones aplicadas y el estado actual para retomar el trabajo con **contexto fresco**.

---

## 1. Visión General del Proyecto

El objetivo es construir una **Progressive Web App (PWA) de voz manos libres** que sirva como canal de interacción oral directo, fluido e inteligente entre **Felipe** y su orquestador técnico central (**Hermes**) ubicado en su búnker local.

### Principios Fundamentales
* **Manos libres y naturalidad:** El usuario habla de forma coloquial sin necesidad de mantener pulsado un botón (push-to-talk opcional, pero primando detección continua).
* **Baja latencia:** Gemini 3.8 Live procesa y genera respuestas vocales en tiempo real mediante streaming bidireccional de audio.
* **Separación de responsabilidades:**
  * **Gemini 3.8 Live:** Interfaz vocal humana, empática, concisa y rápida ("Voice Proxy"). No ejecuta comandos pesados ni código extenso por sí mismo.
  * **Hermes (Búnker):** Agente de ejecución técnica que corre comandos de consola, inspecciona repositorios Git, gestiona Docker y ejecuta scripts.
* **Human-in-the-Loop:** Cuando Hermes necesita confirmación o aclaración (ej. *"¿creamos una rama nueva o usamos main?"*), el Gateway inyecta la pregunta en la sesión de Gemini y este se la traslada al usuario por voz de manera directa.

---

## 2. Arquitectura del Sistema

```
[ PWA Móvil / Desktop (Android, iOS, Chrome, Safari) ]
       │
       │ WebSocket (Audio PCM 16kHz subida / Audio PCM 24kHz bajada / Transcripciones)
       ▼
[ Backend Gateway (Node.js) - server/server.mjs ]
       ├────────────────────────┬────────────────────────┐
       │ (Bidi WebSocket)       │ (HTTP / RPC)           │ (Polyglot TLS)
       ▼                        ▼                        ▼
[ Gemini 3.8 Live API ]   [ Hermes (Búnker) ]     [ Servidor HTTPS / Certs ]
Google AI Studio Bidi     http://192.168.31.20    Puerto 3443 para móviles
```

### Componentes Clave:
1. **Frontend PWA (`public/`):**
   * **`index.html` & `styles.css`:** Interfaz inspirada en WhatsApp con tema oscuro Obsidian/Cyan, encabezado de estado de llamada (`en línea`, `escuchando...`, `pensando...`, `hablando...`) y orbe animado estilo Siri/Gemini en Canvas (`public/orb.js`).
   * **`app.js`:** Controlador Web Audio API. Captura micrófono a 16 kHz mono con anti-aliasing filter, y reproduce audio de Gemini a 24 kHz mono con encolado preciso (`AudioBufferSourceNode`) para evitar cortes o chasquidos.
   * **`audio-recorder-worklet.js`:** Procesador en AudioWorklet para muestreo eficiente a 16 kHz, con fallback automático a `ScriptProcessorNode` en navegadores antiguos.
2. **Backend Gateway (`server/server.mjs`):**
   * Servidor dual HTTP (puerto 4040) y Polyglot HTTPS/TLS (puerto 3443).
   * WebSocket Server (`/ws`) que gestiona el puente entre cliente y Gemini Live.
   * VAD (Voice Activity Detection) por RMS con ventana de pre-roll (~320 ms) para asegurar que el inicio de cada palabra se preserve intacto.
3. **Módulo Gemini Live (`server/gemini-live.mjs`):**
   * Mantiene la sesión WebSocket bidireccional con Google AI Studio (`models/gemini-3.8-live`).
   * Manejo de herramientas (`send_to_orchestrator`) e inyección de turnos proactivos (`injectProactiveTurn`).
   * Forzado estricto de idioma español y reglas de conversación concisa.
4. **Orquestador Hermes (`server/orchestrator.mjs`):**
   * Despacha tareas técnicas a Hermes en segundo plano y maneja los callbacks (`onComplete`, `onClarification`, `onError`).

---

## 3. Registro de Desafíos y Problemas Detectados

A continuación se resume la cronología de problemas técnicos enfrentados y las acciones tomadas para resolverlos:

### Problema 1: Bloqueo de Micrófono en Celulares (Android / iOS)
* **Síntoma:** Al abrir `http://192.168.31.191:3000` en Chrome o Safari móvil, no se podía activar el orbe ni grabar voz; salía error de permiso de audio.
* **Causa:** La especificación de seguridad de los navegadores modernos restringe `navigator.mediaDevices.getUserMedia` **exclusivamente a orígenes seguros (HTTPS o localhost)**. Cualquier IP local (`192.168.x.x`) servida por HTTP plano tiene el micrófono bloqueado por la política del navegador.
* **Solución:**
  * Se implementó un servidor Polyglot TLS en `server/server.mjs` escuchando en el puerto 3443 con certificados SSL locales (`cert.pem` / `key.pem`).
  * Se añadió detección en el frontend y un banner interactivo con botón para conmutar automáticamente a `https://192.168.31.191:3443`.

### Problema 2: Error 1007 en Handshake WebSocket de Gemini Live
* **Síntoma:** `WebSocket closed (1007): Invalid JSON payload received. Unknown name "inputAudioTranscription" at 'setup.generation_config': Cannot find field.`
* **Causa:** En la configuración inicial se intentó colocar `inputAudioTranscription` dentro de `setup.generationConfig`. En el esquema protobuf de Google Generative Language, `inputAudioTranscription` es un campo opcional directo del objeto `setup`, no de `generationConfig`.
* **Solución:** Corrección de la estructura JSON en `sendSetup()`. Posteriormente se mantuvo el setup limpio con modalidades de audio y herramientas.

### Problema 3: Espacios Faltantes en el Texto de Gemini (`díasserá`, `miércolessiete`)
* **Síntoma:** En la transcripción de las respuestas de Gemini, palabras consecutivas se fusionaban sin espacios (ej. *"En trece díasserá miércolessiete de octubre"*).
* **Causa:** Gemini Live transmite fragmentos de texto (deltas) en tiempo real. En el backend (`filterNonSpeechTokens`) y en el frontend (`cleanTranscript`) se ejecutaba `.trim()` sobre cada delta. Esto eliminaba los espacios iniciales o finales (ej. `" será "` pasaba a `"será"`), provocando que al concatenar `textContent += clean` las palabras quedaran unidas.
* **Solución:**
  * Se eliminó el `.trim()` sobre fragmentos de texto individuales, conservando los espacios que Gemini emite naturalmente.
  * Se implementó una regla de **espaciado inteligente** en `public/app.js`:
    ```javascript
    const prev = textEl.textContent;
    const needsSpace = prev.length > 0 && 
                       !/[\s\n\r]$/.test(prev) && 
                       !/^[\s\n\r.,!?;:)\]]/.test(clean);
    textEl.textContent = prev + (needsSpace ? ' ' : '') + clean;
    ```
    Si el bloque anterior termina en letra y el nuevo empieza en letra sin espacio, se inyecta automáticamente un espacio (`" "`).

### Problema 4: Salida de Gemini Capturada como Entrada del Usuario (Eco Acústico)
* **Síntoma:** Cuando Gemini terminaba de hablar por los altavoces (ej. *"será miércoles siete de octubre"*), inmediatamente aparecía una burbuja verde como si el usuario hubiera dicho *"miércoles 7 de octubre"*.
* **Causa:** El micrófono del dispositivo captaba el sonido emitido por sus propios altavoces. La API de `SpeechRecognition` del navegador procesa el audio con una latencia de 600 a 1200 ms. Al terminar la reproducción y apagarse el estado `isPlayingAudio`, el motor de reconocimiento emitía el resultado retrasado, interpretándolo erróneamente como voz del usuario.
* **Solución (Filtro Anti-Eco de Múltiples Capas):**
  1. **Aborto instantáneo:** En cuanto Gemini comienza a emitir audio (`playAudioChunk`), el frontend llama de inmediato a `this.recognition.abort()`, lo que purga y cancela todos los buffers pendientes del motor de reconocimiento.
  2. **Gating en el Gateway:** Durante la reproducción de audio y con un cooldown controlado, el servidor descarta paquetes de audio con RMS bajo para evitar alimentar al modelo con su propia voz.
  3. **Guardián de Similitud (`isEchoOfModel`):** Se compara cualquier texto reconocido del usuario contra las frases recientes dichas por Gemini. Si coincide fonéticamente o comparte más del 60% de palabras con la respuesta de Gemini, se descarta silenciosamente.

### Problema 5: Supresión de Eco Excesiva que Cortaba el Inicio de Frases del Usuario
* **Síntoma:** Al hablar en desktop, Gemini no entendía o escuchaba solo el final de la frase (ej. en vez de *"qué día es hoy día"*, escuchaba *"quería hoy día"* o *"hoy día"*).
* **Causa:** En un intento de eliminar por completo el eco, se colocó una ventana de enfriamiento de 800 ms con un umbral alto de 1300 RMS en el servidor, sumado a 650 ms de cooldown en el cliente. Esto bloqueaba el micrófono durante casi 1.5 segundos después de que Gemini terminaba de hablar, recortando la primera mitad de la siguiente frase del usuario.
* **Solución:** Se redujo el cooldown a un valor ágil de 200 ms y se restableció el umbral normal de 950 RMS, dejando el micrófono 100% receptivo desde la primera sílaba.

### Problema 6: Fuga de Tokens Técnicos (`detected>`)
* **Síntoma:** En ocasiones aparecían burbujas con texto técnico como `detected>` o `<no speech detected>`.
* **Causa:** Cuando el modelo emite `<no speech detected>`, el token llegaba fraccionado por la red en dos paquetes (ej. paquete 1: `<no speech `, paquete 2: `detected>`). La expresión regular `/<[^>]+>/` no hacía match sobre `detected>` porque no tenía el carácter `<` de apertura.
* **Solución:** Se amplió el filtro en `filterNonSpeechTokens` y `cleanTranscript` para descartar explícitamente cualquier token que contenga las palabras `detected`, `no speech`, `silence`, o los caracteres `<` o `>`.

### Problema 7: Desfase y Burbujas Tardías con STT Secundario en Android
* **Síntoma:** Se intentó usar un modelo secundario (`gemini-3.5-transcribe`) en el servidor para transcribir el audio en Android. Esto demoraba entre 2 y 3 segundos, lo que causaba que Gemini respondiera por voz y luego, abajo de su respuesta, apareciera la burbuja del usuario con una etiqueta de *"Procesando voz..."*.
* **Causa:** En una conversación oral fluida, un STT fuera de banda con 3 segundos de latencia destruye el orden cronológico y la inmediatez visual.
* **Solución:** Se revirtió ese enfoque pesado para preservar la velocidad instantánea del sistema.

---

## 4. Estructura de Archivos del Proyecto

```
gemini-live/
├── .env.example                     # Plantilla de variables de entorno
├── .gitignore                       # Archivos excluidos (secrets, certs, logs, audios)
├── AGENTS.md                        # Project brief original de requerimientos
├── PROYECTO_ESTADO_Y_ARQUITECTURA.md# Este documento detallado de contexto
├── README.md                        # Documentación rápida y puesta en marcha
├── package.json                     # Scripts y dependencias (ws, dotenv)
├── public/                          # Frontend Progressive Web App
│   ├── index.html                   # HTML principal con UI estilo WhatsApp + Orb
│   ├── styles.css                   # Sistema de diseño futurista Obsidian/Cyan
│   ├── app.js                       # Controlador Web Audio, WebSocket y orbe
│   ├── orb.js                       # Renderizador Canvas / Shaders del orbe
│   ├── audio-recorder-worklet.js    # AudioWorklet para remuestreo 16kHz PCM
│   └── manifest.json                # PWA Manifest para instalación móvil
├── server/                          # Backend Gateway
│   ├── server.mjs                   # Servidor Polyglot HTTP/HTTPS + WebSocket
│   ├── gemini-live.mjs              # Conexión Bidi WebSocket con Gemini 3.8 Live
│   └── orchestrator.mjs             # Conector asíncrono con el agente Hermes
└── recordings/                      # Carpeta de audios de prueba de audio real
```

---

## 5. Configuración y Puesta en Marcha

### Variables de Entorno (`.env`)
```bash
PORT=4040
GEMINI_API_KEY=tu_api_key_de_google_ai_studio
GEMINI_MODEL=models/gemini-3.8-live
GEMINI_VOICE=Aoede
HERMES_API_URL=https://hermes.bolidus.xyz/v1/chat/completions
```

### Ejecución
```bash
# Instalar dependencias
npm install

# Modo desarrollo con auto-recarga
npm run dev
```

### Acceso
* **Local (Desktop):** `http://localhost:4040`
* **Celulares en LAN (HTTPS obligatorio para micrófono):** `https://192.168.31.191:3443`

---

## 6. Contexto Fresco y Recomendaciones para Continuar

1. **Estado Actual:**
   * La interfaz de chat continuo estilo WhatsApp funciona fluidamente.
   * La visualización del orbe reacciona a las frecuencias del micrófono y altavoces.
   * Gemini 3.8 Live responde en español directo y conciso.
   * La prevención de eco impide que la voz del altavoz se capture como texto del usuario.
   * Las palabras se espacian correctamente sin concatenaciones erróneas.
2. **Próximos Objetivos a Explorar:**
   * **Visualización de texto de usuario en Android:** En navegadores móviles donde `webkitSpeechRecognition` no comparte hardware con `getUserMedia`, explorar streaming de texto nativo por WebSocket o transcripción ultra-ligera en el borde sin bloquear el hilo de conversación.
   * **Pruebas de Integración con Hermes:** Conectar comandos reales de terminal y Git en el búnker para verificar la invocación de `send_to_orchestrator` y la inyección proactiva de respuestas complejas.
