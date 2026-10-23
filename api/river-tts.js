// api/river-tts.js
// Converts River's text responses to speech via ElevenLabs.
// Uses River's voice ID -- calm, warm, professional female voice.
// Required env var: ELEVENLABS_API_KEY
import { withCommandAuth } from './_lib/auth.js';

export const config = { runtime: 'nodejs' };

// River's ElevenLabs voice -- "Rachel" (calm, warm, American English)
// You can change this to any ElevenLabs voice ID
const VOICE_ID = '21m00Tcm4TlvDq8ikWAM';

const ELEVENLABS_API = `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`;

async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
  if (!ELEVENLABS_API_KEY) {
    return res.status(500).json({ error: 'ELEVENLABS_API_KEY not configured' });
  }

  try {
    const { text } = req.body;
    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'text is required' });
    }

    // Strip action blocks before speaking -- River shouldn't read XML tags aloud
    const cleanText = text
      .replace(/<RIVER_ACTION>[\s\S]*?<\/RIVER_ACTION>/g, 'I have prepared that action for you.')
      .replace(/<DISPATCH_ACTION>[\s\S]*?<\/DISPATCH_ACTION>/g, 'I have prepared the dispatch.')
      .replace(/<CREATE_PROJECT>[\s\S]*?<\/CREATE_PROJECT>/g, 'I have drafted that project.')
      .replace(/```[\s\S]*?```/g, '')
      .replace(/\*\*/g, '')
      .replace(/#{1,6}\s/g, '')
      .trim();

    if (!cleanText) {
      return res.status(400).json({ error: 'No speakable text after cleaning' });
    }

    const response = await fetch(ELEVENLABS_API, {
      method: 'POST',
      headers: {
        'xi-api-key':   ELEVENLABS_API_KEY,
        'Content-Type': 'application/json',
        'Accept':       'audio/mpeg',
      },
      body: JSON.stringify({
        text: cleanText,
        model_id: 'eleven_turbo_v2',
        voice_settings: {
          stability:        0.5,
          similarity_boost: 0.75,
          style:            0.0,
          use_speaker_boost: true,
        },
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      return res.status(response.status).json({ error: 'ElevenLabs error: ' + err });
    }

    const audioBuffer = await response.arrayBuffer();
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', audioBuffer.byteLength);
    return res.status(200).send(Buffer.from(audioBuffer));

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

export default withCommandAuth(handler);
