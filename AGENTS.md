Project Brief: Voice Interface PWA (Gemini 3.8 Live + Orchestrator Bridge)
1. Visión general del proyecto
Desarrollar una Progressive Web App (PWA) minimalista que funcione como interfaz de voz manos libres entre el usuario y un sistema orquestador central (que ejecuta tareas técnicas en un agente Hermes en backend).

La PWA servirá exclusivamente como interfaz de entrada/salida de audio. Todo el procesamiento de voz en tiempo real se delega a Gemini 3.8 Live, mientras que la lógica de ejecución y tareas complejas se delega a un servidor puente (Backend Gateway / Orquestador).

2. Requerimientos de UI / UX (Frontend PWA)
Diseño y Pantalla
Minimalismo total: Pantalla completa limpia (fondo oscuro #0d0f12 o similar) sin menús, formularios ni barras de navegación visibles.

Componente central (Orb / Glow Icon):

Un orbe animado estilo Siri / Gemini en el centro exacto de la pantalla.

Renderizado mediante Canvas, SVG dinámico o CSS con shaders/blur.

Estados visuales y retroalimentación:

Idle (Desconectado): Orbe en reposo, respiración lenta y tenue (tono neutro / violeta suave). Texto sutil o pista visual: "Toca para hablar".

Listening (Usuario hablando): El orbe reacciona en tiempo real a las frecuencias del micrófono del usuario (usando Web Audio API: AnalyserNode), escalando en tamaño y mostrando tonos vibrantes (azul/cyan).

Thinking / Orchestrating (Esperando a Hermes): Pulsación continua o rotación interna sutil (tono ámbar o púrpura profundo).

Speaking (Gemini hablando / respondiendo): El orbe ondula al ritmo del flujo de audio PCM entrante de Gemini (tonos degradados estilo Gemini/Siri: magenta, violeta y cyan).

Interacción:

Un solo tap: Alterna entre conectar/desconectar la sesión de WebSocket.

Al activarse, inicializa el contexto de audio (AudioContext) para evitar bloqueos de autoplay del navegador y solicita permisos de micrófono.

3. Especificaciones Técnicas del Frontend
Tecnología recomendada: Vanilla JS o framework reactivo ligero (Vite + React / Svelte / Solid).

Configuración PWA:

manifest.json configurado para display: "standalone", orientación vertical bloqueada o flexible, e iconos para iOS/Android.

service-worker.js básico para caché de assets de la UI y permitir apertura offline de la interfaz base.

Procesamiento de Audio (Web Audio API):

Entrada (Micrófono): Captura a través de navigator.mediaDevices.getUserMedia({ audio: true }). Uso de un AudioWorklet o ScriptProcessor para muestrear audio PCM lineal a 16 kHz (16-bit mono) en pequeños chunks para streaming de baja latencia.

Salida (Altavoces): Cola de buffers en streaming (AudioContext.createBufferSource o streaming directo con Web Audio API) para reproducir audio PCM de 24 kHz que devuelve Gemini sin pausas ni cortes.

4. Arquitectura del Sistema y Backend Gateway
La PWA no debe exponer la API Key de Gemini directamente en el navegador. Se utilizará un servidor intermedio (Node.js o Python FastAPI) que mantenga dos canales WebSockets abiertos.

Plaintext
[ PWA Client ] 
      ▲
      │ (WebSocket: Audio PCM / Estados UI)
      ▼
[ Backend Gateway (Control Plane) ]
      ├────────► [ Gemini 3.8 Live API ] (WebSockets / Audio Bidi)
      └────────► [ Orquestador / Hermes ] (RPC / Webhooks / Eventos)
Funciones del Backend Gateway:
Manejar la conexión con Gemini 3.8 Live:

Establece y autentica la sesión WebSocket con Google AI Studio / Vertex AI (gemini-3.8-live).

Transmite el audio del micrófono de la PWA hacia Gemini y reenvía el audio de Gemini de vuelta a la PWA.

Definir y registrar las Tools de Gemini:

Proveer la herramienta: send_to_orchestrator(task: string, action_type: string, details: object).

Manejo del diálogo triangular (Human-in-the-Loop):

Cuando Gemini detecta una tarea pesada, invoca send_to_orchestrator.

El Gateway notifica a la PWA para cambiar el estado visual del orbe a "Thinking".

El Gateway delega la instrucción al Orquestador / Hermes.

Inyección proactiva: Si Hermes responde con una duda o confirmación, el Gateway inyecta un mensaje en la sesión de Gemini:

Payload inyectado: "[MENSAJE DE HERMES]: Hermes necesita saber si creamos una rama nueva en Git o usamos main. Pregúntale al usuario de forma concisa."

Gemini generará automáticamente el turno de audio para hacértelo saber por la PWA.

5. System Prompt de Gemini 3.8 Live
Configuración obligatoria para la sesión del modelo de voz:

Plaintext
Eres la interfaz de voz humana ("Voice Proxy") entre el usuario y su orquestador de sistemas técnicos.
Tus responsabilidades:
1. Escuchar al usuario de forma atenta, directa y conversacional. Respuestas breves y naturales por audio.
2. Nunca intentes escribir código extenso, ejecutar comandos de terminal ni realizar arquitecturas complejas por tu cuenta.
3. Para cualquier tarea técnica, ejecución, análisis de código o comando, invoca la herramienta 'send_to_orchestrator' con la orden depurada y dile una frase corta de confirmación al usuario (ej. "Entendido, se lo paso a Hermes").
4. Si el sistema te envía una notificación de Hermes con dudas o requerimientos técnicos, tradúcesela al usuario en tono claro, amable y al grano, pidiendo su confirmación.
5. Si el usuario te interrumpe, detén la respuesta de inmediato y atiende la nueva directiva.
6. Fases de Implementación para el Agente Programador
[ ] Fase 1 (Frontend Base & Orbe): Maquetar la PWA con el orbe animado usando Canvas/CSS, implementando los 4 estados visuales y la lógica de tap-to-start con desbloqueo de AudioContext.

[ ] Fase 2 (Audio Worklet): Configurar la captura de audio en 16 kHz PCM y el reproductor de chunks de audio entrantes.

[ ] Fase 3 (Backend Bridge): Crear el servidor intermedio en Node.js o Python con soporte para WebSockets bidireccionales hacia Gemini 3.8 Live.

[ ] Fase 4 (Tool Calling & Hermes Loop): Implementar la función send_to_orchestrator, mockear una respuesta de clarificación de Hermes y verificar que Gemini hable de vuelta proactivamente con la pregunta.

[ ] Fase 5 (Afinación): Pulir latencias de audio, supresión de eco (echo cancellation) y transiciones de color del orbe.