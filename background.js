// background.js

const REGION    = 'global';
const MODEL     = 'gemini-2.0-flash-lite-001';
const PROXY_URL = 'https://gemini-proxy-298685355252.asia-south1.run.app/';
const VERTEX_CFG = {
  project:   'omni-merchant-agent',
  region:    REGION,
  publisher: 'publishers/google',
  model:     MODEL,
  rpc:       'generateContent',
  generationConfig: { temperature: 0.5, maxOutputTokens: 256, topP: 0.9 }
};

async function callLLM(prompt) {
  const resp = await fetch(PROXY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...VERTEX_CFG, prompt })
  });
  if (!resp.ok) throw new Error(await resp.text());
  const { text, error } = await resp.json();
  if (error) throw new Error(error);
  return text;
}

function getToken(interactive = false) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get('gmailToken', ({ gmailToken }) => {
      if (gmailToken && !interactive) return resolve(gmailToken);
      chrome.identity.getAuthToken({ interactive }, token => {
        if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
        else {
          chrome.storage.local.set({ gmailToken: token });
          resolve(token);
        }
      });
    });
  });
}

async function refreshLatestSnippet() {
  try {
    const token = await getToken(false);

    // fetch the 3 most recent messages
    const listUrl = `https://www.googleapis.com/gmail/v1/users/me/messages?maxResults=3`;
    const listResp = await fetch(listUrl, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const { messages = [] } = await listResp.json();

    // extract their Subject headers
    const subjects = [];
    for (const m of messages) {
      const metaUrl =
        `https://www.googleapis.com/gmail/v1/users/me/messages/${m.id}` +
        `?format=metadata&metadataHeaders=Subject`;
      const metaResp = await fetch(metaUrl, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const { payload } = await metaResp.json();
      const hdr = (payload.headers || [])
        .find(h => h.name.toLowerCase() === 'subject');
      subjects.push(hdr?.value || '(no subject)');
    }

    // save and notify sidebar
    const prev = (await chrome.storage.local.get('magicpinSubjects')).magicpinSubjects || [];
    if (JSON.stringify(subjects) !== JSON.stringify(prev)) {
      await chrome.storage.local.set({ magicpinSubjects: subjects });
      chrome.runtime.sendMessage({ type: 'newSubjects', subjects });
    }
  } catch (err) {
    console.warn('Snippet refresh skipped:', err);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  getToken(true)
    .then(refreshLatestSnippet)
    .catch(e => console.error('Initial auth failed:', e));
  chrome.alarms.create('refreshSnippet', { periodInMinutes: 5 });
});

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'refreshSnippet') refreshLatestSnippet();
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'chat') {
    callLLM(msg.prompt)
      .then(text => sendResponse({ text }))
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }
  if (msg.type === 'refreshSnippet') {
    refreshLatestSnippet();
  }
});
