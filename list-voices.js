// Lista todas las voces en español disponibles, para elegir cuál poner en VOICE_NAME.
const { MsEdgeTTS } = require('msedge-tts');

(async () => {
  const tts = new MsEdgeTTS();
  const voices = await tts.getVoices();
  const spanish = voices.filter((v) => v.Locale.startsWith('es-'));
  for (const v of spanish) {
    console.log(`${v.ShortName}  (${v.Gender}, ${v.Locale})`);
  }
})();
