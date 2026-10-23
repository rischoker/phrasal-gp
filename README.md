# Phrasal GP 🏎️ — Phrasal Verbs Grand Prix

Juego de carreras isométrico estilo F1 para practicar **phrasal verbs (A2 → C1)**.
El proyector muestra la pista completa; cada estudiante juega desde su celular.
Los carros avanzan solos: **respuesta correcta = más velocidad**, incorrecta = el carro pierde ritmo.
Gana quien complete las vueltas en el menor tiempo.

## En clase
1. En el PC del proyector abre `https://TU-SERVICIO.onrender.com/?host=1` (o `/host`). Haz clic en cualquier parte para activar el sonido. `F` = pantalla completa, `M` = silencio.
2. Los estudiantes escanean el QR (o abren la URL y escriben el código de 4 letras), escriben su nombre y eligen carro (18 modelos, no se repiten). Máximo 6 pilotos.
3. Elige **circuito** (Boston, Bogotá, Monte Carlo, Tokyo Night, London, Paris, Cairo, Rio — cada uno con sus monumentos), **nivel** (A2, B1, B2, C1 o MIX) y **vueltas** (5 · 10 · 20 · 30) → **LIGHTS OUT**.
4. Semáforo de 5 luces → carrera. Torre de tiempos estilo F1 (posición, gap, sectores morado/verde/amarillo), vueltas rápidas, mejores sectores, puntos (respuestas correctas) y “Race Control”.
5. Bandera a cuadros → podio con los 3 primeros, trofeo bajando en un haz de luz, fuegos artificiales, confeti y música.
6. **RACE REPORT & FEEDBACK**: tarjeta por estudiante para comentar desde el tablero: precisión con la meta del 80 %, correctas/incorrectas, mejor racha, tiempo y mejor vuelta, un comentario cualitativo, partículas fuertes (✓) y a repasar (↺) y los phrasal verbs que falló con su significado.

Duración aproximada (grupo respondiendo bien): 5 vueltas ≈ 2–3 min · 10 ≈ 3–4 min · 20 ≈ 5 min · 30 ≈ 6 min. Con más errores, más largo.

## Repaso en casa
Al terminar, cada estudiante ve en su celular **📥 DOWNLOAD MY REVIEW**: una hoja de estudio (HTML que funciona sin internet) con los phrasal verbs que falló, su significado, la frase correcta, un mini-quiz para practicar y lo que acertó. También se puede abrir y guardar como PDF. Deben descargarla en clase (el servidor gratis de Render se duerme y borra las salas).

## Reglas
- Cada acierto sube la “energía” del carro y da un impulso corto; cada error la baja y frena un momento. Si nadie responde, el carro va perdiendo energía poco a poco.
- Ayuda suave para quien va muy atrás (para no desmotivar a los estudiantes más lentos). Cada estudiante responde a su ritmo.
- **Racha de 3 correctas → power-up** (los 2 últimos, si van muy atrás, reciben un power-up de rescate con cada acierto) en el celular: 🚀 Turbo · ⚡ Mini-Ray (encoge y frena a todos) · 🎯 Misil al líder (si tú vas primero, al segundo) · 🛡️ Escudo (bloquea el siguiente ataque). Se puede guardar para después.
- Cuando el líder termina, los demás terminan al cruzar la meta en su vuelta actual (regla F1), con un máximo de 45 s.
- El profesor puede terminar la carrera con **END RACE** (doble clic) y quitar pilotos en el lobby (×).

## Conexión (proxy de la academia, iPhone/Android nuevos y viejos)
- Todo sale del mismo servidor en Render: sin CDNs, sin Google Fonts, sin audio externo (música y efectos se generan en el navegador).
- Socket.IO empieza por **long-polling** (pasa por proxies estrictos) y sube a WebSocket solo si se puede; tras 3 fallos el celular se queda solo en polling.
- **Reconexión**: automática + botón **RECONNECT NOW** (si en 8 s no vuelve, recarga la página sola). El carro sigue en pista mientras el celular está desconectado. Al volver recupera su puesto con un token guardado (localStorage + cookie); si cambió de navegador, basta con entrar con el **mismo nombre**. Al desbloquear el iPhone se reconecta solo.
- Si se recarga el proyector, retoma la sala y la carrera en curso. El QR y el código quedan en la esquina durante la carrera.
- El control del celular está escrito en JavaScript ES5 (verificado) para iPhone y Android viejos. El proyector usa WebGL y baja la resolución o las sombras solo si el PC va lento.

## Desplegar en Render
1. Sube esta carpeta a un repo de GitHub (p. ej. `rischoker/phrasal-gp`).
2. Render → **New → Blueprint** (usa `render.yaml`) o **Web Service** con
   Build `npm install --omit=dev` · Start `npm start` · Health check `/healthz`.
3. Proyector: `https://<servicio>.onrender.com/?host=1` · Celulares: el QR.

Local: `npm install && npm start` → http://localhost:3000/?host=1 (`npm run dev` = carreras 2,5× más rápidas para probar).

## Archivos
- `server.js` — salas, simulación autoritativa de la carrera (10 Hz), preguntas, power-ups, reconexión, `/healthz`.
- `data/questions.js` — 168 preguntas (42 por nivel A2, B1, B2, C1) con significado para el feedback.
- `public/js/track.js` — circuitos hechos con las piezas de carretera (fácil de crear nuevos: S = recta, R/L = curva cerrada, r/l = curva amplia).
- `public/js/host/` — proyector (lobby 3D, carrera isométrica, podio, audio). `public/js/phone.js` — control del celular.
- `public/assets/` — modelos GLB (carros, carreteras, trofeo), miniaturas de carros, fuentes locales.
