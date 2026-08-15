// Side panel script for enhanced chat with page interaction

let chatHistory = [];
let currentPageInfo = null;

document.addEventListener('DOMContentLoaded', async () => {
  // Load chat history
  const result = await chrome.storage.local.get(['chatHistory', 'sidePanelChatHistory']);
  if (result.sidePanelChatHistory && result.sidePanelChatHistory.length > 0) {
    chatHistory = result.sidePanelChatHistory;
    renderChat(chatHistory);
  }

  // Get current page info
  updatePageInfo();

  // Event listeners
  document.getElementById('sendBtn').addEventListener('click', sendMessage);
  document.getElementById('userMessage').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  document.getElementById('clearBtn').addEventListener('click', async () => {
    chatHistory = [];
    await chrome.storage.local.set({ sidePanelChatHistory: [] });
    document.getElementById('chatContainer').innerHTML = 
      '<div class="message system">Chat cleared. Start a new conversation!</div>';
  });

  document.getElementById('settingsBtn').addEventListener('click', () => {
    chrome.tabs.create({ url: 'popup.html' });
  });

  // Quick action buttons
  document.querySelectorAll('.quick-action-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      document.getElementById('userMessage').value = action;
      sendMessage();
    });
  });

  // Listen for updates when selection is made
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && changes.lastResponse) {
      const response = changes.lastResponse.newValue;
      const context = changes.lastContext?.newValue;
      
      if (response) {
        addMessageToUI(response, 'assistant');
        chatHistory.push({ role: 'assistant', content: response });
        chrome.storage.local.set({ sidePanelChatHistory: chatHistory });
      }
    }
  });
});

async function updatePageInfo() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      currentPageInfo = { title: tab.title, url: tab.url };
      
      document.getElementById('pageTitle').textContent = tab.title;
      document.getElementById('pageUrl').textContent = tab.url;
      document.getElementById('pageInfo').style.display = 'block';
    }
  } catch (error) {
    console.error('Error getting page info:', error);
  }
}

async function sendMessage() {
  const userMessage = document.getElementById('userMessage').value.trim();
  if (!userMessage) return;

  // Add user message to UI
  addMessageToUI(userMessage, 'user');
  chatHistory.push({ role: 'user', content: userMessage });
  
  // Clear input
  document.getElementById('userMessage').value = '';
  document.getElementById('sendBtn').disabled = true;

  // Show loading
  const loadingDiv = document.createElement('div');
  loadingDiv.className = 'message assistant loading';
  loadingDiv.textContent = 'Thinking...';
  document.getElementById('chatContainer').appendChild(loadingDiv);
  scrollToBottom();

  try {
    // Send message to background script for processing with page context
    const response = await chrome.runtime.sendMessage({
      action: 'chatWithPageContext',
      message: userMessage,
      history: chatHistory.slice(-10) // Last 10 messages for context
    });

    loadingDiv.remove();

    if (response.success) {
      // Add assistant response to UI
      let displayText = response.response;
      
      // Show actions info if any were performed
      if (response.actions && response.actions.length > 0) {
        const actionsDesc = response.actions.map(a => {
          switch(a.type) {
            case 'navigate': return `Navigated to ${a.target}`;
            case 'click': return `Clicked: ${a.target}`;
            case 'type': return `Typed into ${a.target.selector}`;
            case 'scroll': return `Scrolled ${a.target}`;
            case 'select': return `Selected ${a.target.value} in ${a.target.selector}`;
            default: return a.type;
          }
        }).join(', ');
        
        displayText += `<div class="actions-info">⚡ Actions performed: ${actionsDesc}</div>`;
      }
      
      addMessageToUI(displayText, 'assistant', true);
      chatHistory.push({ role: 'assistant', content: response.response });
      await chrome.storage.local.set({ sidePanelChatHistory: chatHistory });
    } else {
      addMessageToUI(`Error: ${response.message}`, 'system');
    }
  } catch (err) {
    loadingDiv.remove();
    addMessageToUI(`Error: ${err.message}`, 'system');
  }

  document.getElementById('sendBtn').disabled = false;
}

function addMessageToUI(content, role, allowHTML = false) {
  const chatContainer = document.getElementById('chatContainer');
  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${role}`;
  
  if (allowHTML) {
    messageDiv.innerHTML = content;
  } else {
    messageDiv.textContent = content;
  }
  
  chatContainer.appendChild(messageDiv);
  scrollToBottom();
}

function renderChat(history) {
  const chatContainer = document.getElementById('chatContainer');
  chatContainer.innerHTML = '';
  
  history.forEach(msg => {
    addMessageToUI(msg.content, msg.role);
  });
  
  scrollToBottom();
}

function scrollToBottom() {
  const chatContainer = document.getElementById('chatContainer');
  chatContainer.scrollTop = chatContainer.scrollHeight;
}
