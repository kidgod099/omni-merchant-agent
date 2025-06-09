// sidebar.js

document.addEventListener('DOMContentLoaded', () => {
  const msgs            = document.getElementById('messages');
  const form            = document.getElementById('chatForm');
  const input           = document.getElementById('userInput');
  const alertDiv        = document.getElementById('latestAlert');
  const currentAcctSpan = document.getElementById('currentAccount');
  const switchBtn       = document.getElementById('switchBtn');

  const MAX_DISPLAY = 100;
  const MAX_CONTEXT = 10;
  let chatHistory = [];
  let currentAccount = null;

  // your web-app client ID
  const WEB_CLIENT_ID = '298685355252-moh8cfupug726uu71ddrb1h7bccojahd.apps.googleusercontent.com';

  function append(text) {
    const d = document.createElement('div');
    d.textContent = text;
    msgs.append(d);
    msgs.scrollTop = msgs.scrollHeight;
    while (msgs.children.length > MAX_DISPLAY) msgs.removeChild(msgs.firstChild);
  }

  function renderSubjects(subjects) {
    if (!subjects || subjects.length === 0) {
      alertDiv.textContent = 'No emails found.';
      return;
    }
    const ul = document.createElement('ul'); ul.style.paddingLeft = '20px';
    subjects.forEach(s => {
      const li = document.createElement('li'); li.textContent = s;
      ul.append(li);
    });
    alertDiv.innerHTML = '';
    alertDiv.append(ul);
  }

  function loadHistoryForAccount(email) {
    chatHistory = [];
    msgs.innerHTML = '';
    if (!email) return;
    const key = 'chatHistory_' + email;
    chrome.storage.local.get(key, ({ [key]: stored = [] }) => {
      chatHistory = stored.slice(-MAX_DISPLAY);
      chatHistory.forEach(m => append(`${m.sender}: ${m.text}`));
    });
  }

  function addToHistory(sender, text) {
    if (!currentAccount) return;
    const key = 'chatHistory_' + currentAccount;
    chatHistory.push({ sender, text });
    if (chatHistory.length > MAX_DISPLAY) chatHistory.shift();
    chrome.storage.local.set({ [key]: chatHistory });
  }

  // initialize UI: load account, subjects, and history
  chrome.storage.local.get(['currentAccount','magicpinSubjects'],
    ({ currentAccount: acct, magicpinSubjects }) => {
      currentAccount = acct;
      if (acct) currentAcctSpan.textContent = acct;
      renderSubjects(magicpinSubjects || []);
      loadHistoryForAccount(acct);
    }
  );

  // receive new subjects
  chrome.runtime.onMessage.addListener(msg => {
    if (msg.type === 'newSubjects') {
      renderSubjects(msg.subjects);

      // --- NEW: send last 3 subjects to LLM for insights/actions ---
      const lastThree = msg.subjects.slice(0,3)
        .map((s,i) => `Email ${i+1}: "${s}"`)
        .join('\n');
      const prompt = `You are a helpful assistant. Here are the user's last three email subjects:\n${lastThree}\n\nPlease provide insights, recommended actions, or next steps based on these emails.`;
      chrome.runtime.sendMessage({ type: 'chat', prompt }, resp => {
        if (!resp.error) {
          append('Bot: ' + resp.text);
          addToHistory('Bot', resp.text);
        }
      });
      // ------------------------------------------------------------
    }
  });

  // listen for account change to reload history
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.currentAccount) {
      currentAccount = changes.currentAccount.newValue;
      currentAcctSpan.textContent = currentAccount;
      loadHistoryForAccount(currentAccount);
    }
  });

  // switch account flow (unchanged)
  switchBtn.addEventListener('click', () => {
    const scopes   = chrome.runtime.getManifest().oauth2.scopes.join(' ');
    const redirect = chrome.identity.getRedirectURL();
    const authUrl  =
      'https://accounts.google.com/o/oauth2/v2/auth' +
      `?client_id=${encodeURIComponent(WEB_CLIENT_ID)}` +
      `&response_type=token` +
      `&redirect_uri=${encodeURIComponent(redirect)}` +
      `&scope=${encodeURIComponent(scopes)}` +
      `&prompt=select_account`;

    chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true }, redirectUrl => {
      if (chrome.runtime.lastError || !redirectUrl) return;
      const token = new URLSearchParams(new URL(redirectUrl).hash.substring(1)).get('access_token');
      if (!token) return;
      chrome.storage.local.set({ gmailToken: token });
      chrome.identity.getProfileUserInfo(info => {
        const email = info.email || 'unknown';
        // delete old user's history and clear UI
        if (currentAccount) {
          chrome.storage.local.remove('chatHistory_' + currentAccount);
          chatHistory = [];
          msgs.innerHTML = '';
        }
        // set and load new user
        currentAccount = email;
        currentAcctSpan.textContent = email;
        chrome.storage.local.set({ currentAccount: email });
        loadHistoryForAccount(email);
      });
      chrome.runtime.sendMessage({ type: 'refreshSnippet' });
    });
  });

  // chat handler
  form.addEventListener('submit', e => {
    e.preventDefault();
    const txt = input.value.trim(); if (!txt) return;
    addToHistory('You', txt);
    append('You: ' + txt);
    input.value = '';
    const context = chatHistory
      .slice(-MAX_CONTEXT)
      .map(m => `${m.sender}: ${m.text}`)
      .join('\n') + '\nBot:';
    chrome.runtime.sendMessage({ type: 'chat', prompt: context }, resp => {
      if (chrome.runtime.lastError) return append('Bot Error: ' + chrome.runtime.lastError.message);
      if (resp.error) return append('Bot Error: ' + resp.error);
      addToHistory('Bot', resp.text);
      append('Bot: ' + resp.text);
    });
  });
});
