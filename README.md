# Bot de Discord: texto a voz

Bot que lee en voz alta, en un canal de voz, todo lo que escribas en un canal de texto fijo. Usa las voces neuronales gratuitas de Microsoft Edge (sin API key, sin costo).

Cómo funciona: escribes en el canal de texto que configures. Si estás conectado a un canal de voz, el bot se une a ese mismo canal (o se mueve si ya estaba en otro) y lee tu mensaje en voz alta. Si escribes varios mensajes seguidos, se leen en orden, uno tras otro. Si te quedas solo en el canal de voz, el bot se desconecta al minuto.

## 1. Crear el bot en Discord

1. Ve a https://discord.com/developers/applications y crea una "New Application".
2. En el menú lateral, ve a **Bot** → **Reset Token** → copia el token (lo vas a pegar en `.env`, no lo compartas con nadie).
3. En la misma página **Bot**, activa el intent **Message Content Intent** (obligatorio para leer el texto de los mensajes).
4. Ve a **OAuth2 → URL Generator**:
   - Scopes: `bot`
   - Bot Permissions: `View Channels`, `Send Messages`, `Add Reactions`, `Connect`, `Speak`
5. Abre la URL generada y añade el bot a tu servidor.

## 2. Obtener el ID del canal de texto

En Discord: **Ajustes de usuario → Avanzado → Modo desarrollador** (actívalo). Luego clic derecho sobre el canal de texto que quieras usar → **Copiar ID de canal**.

## 3. Configurar el proyecto

1. Instala [Node.js](https://nodejs.org/) 18 o superior.
2. En esta carpeta, instala las dependencias:
   ```
   npm install
   ```
3. Copia `.env.example` a `.env` y complétalo:
   ```
   DISCORD_TOKEN=el_token_de_tu_bot
   TEXT_CHANNEL_ID=el_id_del_canal_de_texto
   ```
   Las demás variables (`VOICE_NAME`, `MAX_CHARS`, `LEAVE_DELAY_MS`) son opcionales.

4. (Opcional) Para escuchar qué voces en español hay disponibles y elegir otra:
   ```
   npm run voices
   ```
   Copia el `ShortName` que más te guste (ej. `es-MX-JorgeNeural`) en `VOICE_NAME` dentro de `.env`.

## 4. Ejecutar el bot

```
npm start
```

Si ves `Conectado como TuBot#1234` en la consola, está listo. Entra a un canal de voz, escribe en el canal de texto configurado, y el bot lo leerá.

Para dejarlo corriendo siempre (sin depender de tu PC), sigue la sección de despliegue con Docker + VPS más abajo.

## 5. Desplegar en un VPS con Docker (siempre encendido + auto-actualización)

Con esto el bot corre en tu servidor 24/7, y cuando subas cambios a GitHub el VPS los detecta solo y reconstruye el contenedor — no vuelves a subir archivos a mano.

### 5.1 Crear el repositorio en GitHub

1. Entra a https://github.com/new, ponle un nombre (ej. `discord-tts-bot`) y créalo como **privado** (recomendado, aunque el token no vive en el código).
2. En esta carpeta, en tu terminal:
   ```
   git init
   git add .
   git commit -m "Bot inicial"
   git branch -M main
   git remote add origin https://github.com/TU_USUARIO/discord-tts-bot.git
   git push -u origin main
   ```
   El `.gitignore` ya excluye `.env`, `guild-voices.json` y `node_modules`, así que tu token nunca se sube.

### 5.2 Preparar el VPS

Conéctate por SSH a tu servidor e instala Docker (si no lo tienes):
```
curl -fsSL https://get.docker.com | sh
```

Clona el repo:
```
git clone https://github.com/TU_USUARIO/discord-tts-bot.git
cd discord-tts-bot
```

Crea el `.env` directamente en el VPS (este archivo nunca vive en GitHub):
```
cp .env.example .env
nano .env   # pega tu DISCORD_TOKEN y TEXT_CHANNEL_ID
```

Crea el archivo donde se guarda la voz elegida (para que Docker no lo cree como carpeta):
```
touch guild-voices.json
echo '{}' > guild-voices.json
```

Levanta el bot:
```
docker compose up -d --build
```

Revisa que arrancó bien:
```
docker compose logs -f
```
(`Ctrl+C` para salir de los logs, el bot sigue corriendo en segundo plano).

### 5.3 Auto-actualización cuando subes cambios a GitHub

El script `deploy.sh` revisa si hay commits nuevos en `main` y, si los hay, hace `git pull` y reconstruye el contenedor. Prográmalo con cron para que corra cada 5 minutos:

```
chmod +x deploy.sh
crontab -e
```

Agrega esta línea al final:
```
*/5 * * * * /ruta/completa/a/discord-tts-bot/deploy.sh >> /ruta/completa/a/discord-tts-bot/deploy.log 2>&1
```
(reemplaza `/ruta/completa/a/` por la ruta real, la obtienes con `pwd` dentro de la carpeta del repo en el VPS).

A partir de ahí, tu flujo de trabajo es: edita el código donde quieras, `git push`, y en máximo 5 minutos el VPS lo toma solo y reinicia el bot con la versión nueva. Puedes ver el historial de actualizaciones con `cat deploy.log`.

## Comandos en el chat

Escribe estos comandos en el mismo canal de texto configurado (no se leen en voz alta):

- `!voz` — muestra la voz que está usando el servidor ahora mismo.
- `!voz es-MX-JorgeNeural` — cambia la voz (usa el `ShortName` exacto). Se guarda en `guild-voices.json` y sobrevive a reinicios del bot.
- `!vozlista` — lista las voces en español disponibles. `!vozlista es-MX` filtra solo las de México (funciona con cualquier prefijo de idioma/país, ej. `en-US`, `fr-FR`).
- `!ayuda` — muestra este mismo resumen de comandos.

El prefijo `!` se puede cambiar con la variable opcional `COMMAND_PREFIX` en `.env`.

## Notas

- El bot solo lee mensajes del canal de texto configurado, y solo si el autor está conectado a un canal de voz en ese momento (si no lo está, reacciona con 🔇 en vez de leerlo).
- Menciones, emojis personalizados y enlaces se convierten a texto legible antes de leerse (ej. un @usuario se lee como "arroba NombreDeUsuario").
- Los mensajes muy largos se recortan a `MAX_CHARS` caracteres (400 por defecto) para evitar audios eternos.
- No requiere ffmpeg ni ninguna instalación adicional: todo el audio se genera y reproduce en JavaScript puro.
