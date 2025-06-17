// index.js
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import fetch from 'node-fetch';
import { GoogleAuth } from 'google-auth-library';

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Acquire a single GoogleAuth client for all requests
const auth = new GoogleAuth({
  scopes: ['https://www.googleapis.com/auth/cloud-platform']
});

/**
 * Generic Vertex AI call, now against v1beta1
 * @param {object} cfg 
 *   { project, region, publisher, model, rpc, prompt, generationConfig? }
 */
async function callVertex(cfg) {
  const {
    project,
    region,
    publisher,    // e.g. 'publishers/google'
    model,        // e.g. 'gemini-1.5-pro'
    rpc,          // e.g. 'generateContent'
    prompt,       // string
    generationConfig // optional object
  } = cfg;

  // Use the v1beta1 Generative Models endpoint
  const BASE = 'https://aiplatform.googleapis.com/v1beta1';
  const url  = `${BASE}/projects/${project}` +
               `/locations/${region}` +
               `/${publisher}/models/${model}:${rpc}`;

  const client = await auth.getClient();
  const token  = (await client.getAccessToken()).token;

  const body = {
    contents: [
      { role: 'user', parts: [{ text: prompt }] }
    ],
    ...(generationConfig ? { generationConfig } : {})
  };

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      Authorization:   `Bearer ${token}`
    },
    body: JSON.stringify(body)
  });

  if (!resp.ok) {
    const errBody = await resp.text();
    throw new Error(`Vertex AI ${resp.status}: ${errBody}`);
  }

  const json = await resp.json();
  return json.candidates?.[0]?.output || '';
}

// HTTP handler
app.post('/', async (req, res) => {
  try {
    const text = await callVertex(req.body);
    return res.json({ text });
  } catch (e) {
    console.error('Proxy error:', e);
    return res.status(500).json({ error: e.message });
  }
});

app.get('/health', (_req, res) => res.send('OK'));

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Proxy listening on port ${PORT}`);
});