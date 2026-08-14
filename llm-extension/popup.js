// Load settings on popup open
document.addEventListener('DOMContentLoaded', async () => {
  // Load saved settings
  const result = await chrome.storage.local.get([
    'apiUrl',
    'apiKey',
    'model',
    'maxTokens',
    'temperature',
    'systemPrompt',
    'chatHistory'
  ]);

  if (result.apiUrl) document.getElementById('apiUrl').value = result.apiUrl;
  if (result.apiKey) document.getElementById('apiKey').value = result.apiKey;
  if (result.model) document.getElementById('model').value = result.model;
  if (result.maxTokens) document.getElementById('maxTokens').value = result.maxTokens;
  if (result.temperature) document.getElementById('temperature').value = result.temperature;
  if (result.systemPrompt) document.getElementById('systemPrompt').value = result.systemPrompt;
  
  // Load chat history
  if (result.chatHistory && result.chatHistory.length > 0) {
    renderChat(result.chatHistory);
  }

  // Tab switching
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      
      tab.classList.add('active');
      document.getElementById(tab.dataset.tab).classList.add('active');
    });
  });

  // Save settings
  document.getElementById('saveBtn').addEventListener('click', async () => {
    const settings = {
      apiUrl: document.getElementById('apiUrl').value.trim(),
      apiKey: document.getElementById('apiKey').value.trim(),
      model: document.getElementById('model').value.trim(),
      maxTokens: parseInt(document.getElementById('maxTokens').value),
      temperature: parseFloat(document.getElementById('temperature').value),
      systemPrompt: document.getElementById('systemPrompt').value.trim()
    };

    await chrome.storage.local.set(settings);
    showStatus('Settings saved successfully!', 'success');
  });

  // Test connection
  document.getElementById('testBtn').addEventListener('click', async () => {
    const apiUrl = document.getElementById('apiUrl').value.trim();
    const apiKey = document.getElementById('apiKey').value.trim();
    const model = document.getElementById('model').value.trim();

    if (!apiUrl || !apiKey || !model) {
      showStatus('Please fill in API URL, API Key, and Model', 'error');
      return;
    }

    try {
      const response = await fetch(`${apiUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: model,
          messages: [{ role: 'user', content: 'Hello' }],
          max_tokens: 10
        })
      });

      if (response.ok) {
        showStatus('Connection successful! ✅', 'success');
      } else {
        const error = await response.json();
        showStatus(`Connection failed: ${error.error?.message || response.statusText}`, 'error');
      }
    } catch (err) {
      showStatus(`Connection failed: ${err.message}`, 'error');
    }
  });

  // Send message
  document.getElementById('sendBtn').addEventListener('click', sendMessage);
  document.getElementById('userMessage').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // Clear chat
  document.getElementById('clearBtn').addEventListener('click', async () => {
    await chrome.storage.local.set({ chatHistory: [] });
    document.getElementById('chatContainer').innerHTML = 
      '<div class="message system">Chat cleared. Start a new conversation!</div>';
  });
});

async function sendMessage() {
  const userMessage = document.getElementById('userMessage').value.trim();
  if (!userMessage) return;

  const settings = await chrome.storage.local.get([
    'apiUrl', 'apiKey', 'model', 'maxTokens', 'temperature', 'systemPrompt', 'chatHistory'
  ]);

  if (!settings.apiUrl || !settings.apiKey || !settings.model) {
    alert('Please configure your API settings first!');
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.querySelector('[data-tab="settings"]').classList.add('active');
    document.getElementById('settings').classList.add('active');
    return;
  }

  // Add user message to UI
  addMessageToUI(userMessage, 'user');

  // Prepare messages array
  let messages = settings.chatHistory || [];
  
  // Add system prompt if exists
  if (settings.systemPrompt && messages.length === 0) {
    messages.push({ role: 'system', content: settings.systemPrompt });
  }
  
  messages.push({ role: 'user', content: userMessage });

  // Clear input
  document.getElementById('userMessage').value = '';

  // Show loading
  const loadingDiv = document.createElement('div');
  loadingDiv.className = 'message assistant loading';
  loadingDiv.textContent = 'Thinking...';
  document.getElementById('chatContainer').appendChild(loadingDiv);
  scrollToBottom();

  try {
    const response = await fetch(`${settings.apiUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${settings.apiKey}`
      },
      body: JSON.stringify({
        model: settings.model,
        messages: messages,
        max_tokens: settings.maxTokens,
        temperature: settings.temperature
      })
    });

    loadingDiv.remove();

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || response.statusText);
    }

    const data = await response.json();
    const assistantMessage = data.choices[0].message.content;

    // Add assistant message to UI
    addMessageToUI(assistantMessage, 'assistant');

    // Update chat history
    messages.push({ role: 'assistant', content: assistantMessage });
    await chrome.storage.local.set({ chatHistory: messages });

  } catch (err) {
    loadingDiv.remove();
    addMessageToUI(`Error: ${err.message}`, 'system');
  }
}

function addMessageToUI(content, role) {
  const chatContainer = document.getElementById('chatContainer');
  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${role}`;
  messageDiv.textContent = content;
  chatContainer.appendChild(messageDiv);
  scrollToBottom();
}

function renderChat(history) {
  const chatContainer = document.getElementById('chatContainer');
  chatContainer.innerHTML = '';
  
  history.forEach(msg => {
    if (msg.role !== 'system') {
      addMessageToUI(msg.content, msg.role);
    }
  });
}

function scrollToBottom() {
  const chatContainer = document.getElementById('chatContainer');
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

function showStatus(message, type) {
  const status = document.getElementById('status');
  status.textContent = message;
  status.className = `status ${type}`;
  
  setTimeout(() => {
    status.className = 'status';
  }, 3000);
}
