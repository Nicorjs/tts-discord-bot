require('dotenv').config();
const fs = require('fs');
const path = require('path');
const {
  Client,
  GatewayIntentBits,
} = require('discord.js');
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  StreamType,
  entersState,
  getVoiceConnection,
} = require('@discordjs/voice');
const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');

const TOKEN = process.env.DISCORD_TOKEN;
const TEXT_CHANNEL_ID = process.env.TEXT_CHANNEL_ID;
const VOICE_NAME = process.env.VOICE_NAME || 'es-ES-AlvaroNeural';
const MAX_CHARS = Number(process.env.MAX_CHARS || 400);
const LEAVE_DELAY_MS = Number(process.env.LEAVE_DELAY_MS || 60_000);
const COMMAND_PREFIX = process.env.COMMAND_PREFIX || '!';

if (!TOKEN || !TEXT_CHANNEL_ID) {
  console.error('Faltan variables de entorno. Revisa tu archivo .env (DISCORD_TOKEN y TEXT_CHANNEL_ID son obligatorios).');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

// Voz elegida por cada servidor (persiste en disco entre reinicios).
const VOICES_FILE = path.join(__dirname, 'guild-voices.json');

function loadGuildVoices() {
  try {
    const raw = fs.readFileSync(VOICES_FILE, 'utf8');
    return new Map(Object.entries(JSON.parse(raw)));
  } catch {
    return new Map();
  }
}

function saveGuildVoices() {
  try {
    fs.writeFileSync(VOICES_FILE, JSON.stringify(Object.fromEntries(guildVoices), null, 2));
  } catch (err) {
    console.error('No pude guardar guild-voices.json:', err.message);
  }
}

const guildVoices = loadGuildVoices();

function getVoiceForGuild(guildId) {
  return guildVoices.get(guildId) || VOICE_NAME;
}

// Lista completa de voces de Edge TTS, cacheada tras la primera consulta.
let allVoicesCache = null;
async function getAllVoices() {
  if (!allVoicesCache) {
    const tts = new MsEdgeTTS();
    allVoicesCache = await tts.getVoices();
  }
  return allVoicesCache;
}

// Estado por servidor: { player, queue, speaking, leaveTimer }
const guildStates = new Map();

function getState(guildId) {
  let state = guildStates.get(guildId);
  if (!state) {
    const player = createAudioPlayer();
    state = { player, queue: [], speaking: false, leaveTimer: null };

    player.on(AudioPlayerStatus.Idle, () => {
      state.speaking = false;
      playNext(guildId);
    });
    player.on('error', (err) => {
      console.error('Error del reproductor de audio:', err.message);
      state.speaking = false;
      playNext(guildId);
    });

    guildStates.set(guildId, state);
  }
  return state;
}

/** Limpia el texto de un mensaje de Discord para que suene bien en voz. */
function sanitizeForSpeech(message) {
  let text = message.content;

  // Menciones de usuario -> nombre visible
  text = text.replace(/<@!?(\d+)>/g, (_, id) => {
    const member = message.guild.members.cache.get(id);
    return member ? `arroba ${member.displayName}` : 'arroba usuario';
  });
  // Menciones de rol
  text = text.replace(/<@&(\d+)>/g, (_, id) => {
    const role = message.guild.roles.cache.get(id);
    return role ? `rol ${role.name}` : 'un rol';
  });
  // Menciones de canal
  text = text.replace(/<#(\d+)>/g, (_, id) => {
    const ch = message.guild.channels.cache.get(id);
    return ch ? `canal ${ch.name}` : 'un canal';
  });
  // Emojis personalizados <:nombre:id> o animados <a:nombre:id>
  text = text.replace(/<a?:(\w+):\d+>/g, (_, name) => name.replace(/_/g, ' '));
  // URLs
  text = text.replace(/https?:\/\/\S+/g, 'enlace');
  // Símbolos de markdown
  text = text.replace(/[*_~`>|]/g, '');
  // Espacios múltiples
  text = text.replace(/\s+/g, ' ').trim();

  if (!text) return '';

  if (text.length > MAX_CHARS) {
    text = `${text.slice(0, MAX_CHARS)}... mensaje recortado`;
  }

  // Escapar para SSML (msedge-tts no escapa el texto internamente)
  text = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

  return text;
}

async function synthesize(text, voiceName) {
  const tts = new MsEdgeTTS();
  await tts.setMetadata(voiceName || VOICE_NAME, OUTPUT_FORMAT.WEBM_24KHZ_16BIT_MONO_OPUS);
  const { audioStream } = tts.toStream(text);
  return audioStream;
}

async function playNext(guildId) {
  const state = getState(guildId);
  if (state.speaking) return;

  const next = state.queue.shift();
  if (!next) {
    scheduleLeaveCheck(guildId);
    return;
  }

  state.speaking = true;
  try {
    const audioStream = await synthesize(next.text, next.voiceName);
    // El audio ya viene codificado en Opus dentro de un contenedor WebM,
    // así que no hace falta ffmpeg: se demultiplexa directamente.
    const resource = createAudioResource(audioStream, {
      inputType: StreamType.WebmOpus,
    });
    state.player.play(resource);
  } catch (err) {
    console.error('Error generando/reproduciendo TTS:', err.message);
    state.speaking = false;
    playNext(guildId);
  }
}

function scheduleLeaveCheck(guildId) {
  const state = getState(guildId);
  if (state.leaveTimer) clearTimeout(state.leaveTimer);
  state.leaveTimer = setTimeout(() => {
    const connection = getVoiceConnection(guildId);
    if (!connection) return;
    const channel = client.channels.cache.get(connection.joinConfig.channelId);
    const humanCount = channel ? channel.members.filter((m) => !m.user.bot).size : 0;
    if (humanCount === 0) {
      connection.destroy();
    }
  }, LEAVE_DELAY_MS);
}

/** Une (o mueve) el bot al canal de voz del autor del mensaje. */
async function ensureConnectionFor(message) {
  const voiceChannel = message.member?.voice?.channel;
  if (!voiceChannel) return null;

  const guildId = message.guild.id;
  let connection = getVoiceConnection(guildId);

  if (!connection || connection.joinConfig.channelId !== voiceChannel.id) {
    connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId,
      adapterCreator: message.guild.voiceAdapterCreator,
      selfDeaf: true,
    });
    await entersState(connection, VoiceConnectionStatus.Ready, 10_000);
    const state = getState(guildId);
    connection.subscribe(state.player);
  }

  return connection;
}

/** Maneja comandos de texto (ej. !voz es-MX-JorgeNeural). Devuelve true si el mensaje era un comando. */
async function handleCommand(message, commandText) {
  const [cmd, ...rest] = commandText.split(/\s+/);
  const arg = rest.join(' ').trim();
  const guildId = message.guild.id;

  switch ((cmd || '').toLowerCase()) {
    case 'voz': {
      if (!arg) {
        await message.reply(
          `Voz actual: **${getVoiceForGuild(guildId)}**.\n` +
          `Para cambiarla: \`${COMMAND_PREFIX}voz es-MX-JorgeNeural\`\n` +
          `Para ver opciones: \`${COMMAND_PREFIX}vozlista\` (o \`${COMMAND_PREFIX}vozlista es-MX\`)`
        );
        return true;
      }
      try {
        const voices = await getAllVoices();
        const match = voices.find((v) => v.ShortName.toLowerCase() === arg.toLowerCase());
        if (!match) {
          await message.reply(
            `No encontré la voz "${arg}". Usa \`${COMMAND_PREFIX}vozlista\` para ver nombres válidos, ` +
            `o escúchalas en https://geeksta.net/tools/tts-samples/`
          );
          return true;
        }
        guildVoices.set(guildId, match.ShortName);
        saveGuildVoices();
        await message.reply(`Listo, ahora uso la voz **${match.ShortName}** (${match.Gender}, ${match.Locale}).`);
      } catch (err) {
        console.error('Error cambiando voz:', err.message);
        await message.reply('No pude conectar con el servicio de voces, intenta de nuevo en un momento.');
      }
      return true;
    }
    case 'vozlista': {
      try {
        const voices = await getAllVoices();
        const locale = arg || 'es';
        const names = voices
          .filter((v) => v.Locale.toLowerCase().startsWith(locale.toLowerCase()))
          .map((v) => v.ShortName);

        if (names.length === 0) {
          await message.reply(`No encontré voces para "${locale}".`);
          return true;
        }

        // Discord limita los mensajes a 2000 caracteres: partimos en bloques.
        const chunks = [];
        let current = '';
        for (const name of names) {
          if ((current + name).length > 1800) {
            chunks.push(current);
            current = '';
          }
          current += `${name}, `;
        }
        if (current) chunks.push(current);

        for (const chunk of chunks) {
          await message.reply(chunk.replace(/, $/, ''));
        }
      } catch (err) {
        console.error('Error listando voces:', err.message);
        await message.reply('No pude conectar con el servicio de voces, intenta de nuevo en un momento.');
      }
      return true;
    }
    case 'ayuda':
    case 'help': {
      await message.reply(
        `**Comandos disponibles:**\n` +
        `\`${COMMAND_PREFIX}voz\` — muestra la voz actual\n` +
        `\`${COMMAND_PREFIX}voz <nombre>\` — cambia la voz (ej. \`${COMMAND_PREFIX}voz es-MX-JorgeNeural\`)\n` +
        `\`${COMMAND_PREFIX}vozlista [prefijo]\` — lista voces disponibles (por defecto español)\n` +
        `Cualquier otro mensaje en este canal se lee en voz alta.`
      );
      return true;
    }
    default:
      return false;
  }
}

client.once('ready', () => {
  console.log(`Conectado como ${client.user.tag}`);
  console.log(`Escuchando el canal de texto ${TEXT_CHANNEL_ID}`);
});

client.on('messageCreate', async (message) => {
  try {
    if (message.author.bot) return;
    if (!message.guild) return;
    if (message.channel.id !== TEXT_CHANNEL_ID) return;
    if (!message.content || !message.content.trim()) return;

    const trimmed = message.content.trim();
    if (trimmed.startsWith(COMMAND_PREFIX)) {
      const wasCommand = await handleCommand(message, trimmed.slice(COMMAND_PREFIX.length).trim());
      if (wasCommand) return;
    }

    const voiceChannel = message.member?.voice?.channel;
    if (!voiceChannel) {
      // El autor no está en un canal de voz: avisamos con una reacción y no leemos el mensaje.
      message.react('🔇').catch(() => {});
      return;
    }

    await ensureConnectionFor(message);

    const text = sanitizeForSpeech(message);
    if (!text) return;

    const state = getState(message.guild.id);
    if (state.leaveTimer) {
      clearTimeout(state.leaveTimer);
      state.leaveTimer = null;
    }
    state.queue.push({ text, voiceName: getVoiceForGuild(message.guild.id) });
    playNext(message.guild.id);
  } catch (err) {
    console.error('Error procesando mensaje:', err);
  }
});

// Si el canal de voz del bot se queda sin humanos, programa la salida.
client.on('voiceStateUpdate', (oldState, newState) => {
  const guildId = oldState.guild.id;
  const connection = getVoiceConnection(guildId);
  if (!connection) return;

  const channelId = connection.joinConfig.channelId;
  if (oldState.channelId === channelId || newState.channelId === channelId) {
    const channel = oldState.guild.channels.cache.get(channelId);
    const humanCount = channel ? channel.members.filter((m) => !m.user.bot).size : 0;
    if (humanCount === 0) {
      scheduleLeaveCheck(guildId);
    }
  }
});

client.login(TOKEN);
