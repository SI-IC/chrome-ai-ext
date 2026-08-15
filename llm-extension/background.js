// Background service worker for context menu, navigation, and page control

chrome.runtime.onInstalled.addListener(() => {
  // Create context menu items
  chrome.contextMenus.create({
    id: 'llm-explain',
    title: 'Explain with LLM',
    contexts: ['selection']
  });
  
  chrome.contextMenus.create({
    id: 'llm-summarize',
    title: 'Summarize with LLM',
    contexts: ['selection']
  });
  
  chrome.contextMenus.create({
    id: 'llm-translate',
    title: 'Translate with LLM',
    contexts: ['selection']
  });

  chrome.contextMenus.create({
    id: 'llm-chat',
    title: 'Chat about this selection',
    contexts: ['selection']
  });

  // Enable side panel
  if (chrome.sidePanel) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  }
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const selectedText = info.selectionText;
  
  if (!selectedText) return;

  // Get settings
  const result = await chrome.storage.local.get([
    'apiUrl', 'apiKey', 'model', 'maxTokens', 'temperature', 'systemPrompt'
  ]);

  if (!result.apiUrl || !result.apiKey || !result.model) {
    chrome.tabs.create({ url: 'popup.html' });
    return;
  }

  let prompt = '';
  switch (info.menuItemId) {
    case 'llm-explain':
      prompt = `Please explain the following text in simple terms:\n\n${selectedText}`;
      break;
    case 'llm-summarize':
      prompt = `Please summarize the following text concisely:\n\n${selectedText}`;
      break;
    case 'llm-translate':
      prompt = `Please translate the following text to English:\n\n${selectedText}`;
      break;
    case 'llm-chat':
      prompt = `The user has selected this text on a webpage and wants to chat about it:\n\n${selectedText}\n\nPage URL: ${tab.url}\nPage Title: ${tab.title}\n\nWhat would you like to discuss?`;
      break;
  }

  // Send to LLM
  try {
    const response = await fetch(`${result.apiUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${result.apiKey}`
      },
      body: JSON.stringify({
        model: result.model,
        messages: [
          { role: 'system', content: result.systemPrompt || 'You are a helpful assistant.' },
          { role: 'user', content: prompt }
        ],
        max_tokens: result.maxTokens,
        temperature: result.temperature
      })
    });

    if (!response.ok) {
      throw new Error(response.statusText);
    }

    const data = await response.json();
    const answer = data.choices[0].message.content;

    // Show answer in side panel or notification
    chrome.storage.local.set({ lastResponse: answer, lastContext: { type: 'selection', text: selectedText, url: tab.url } });
    
    // Open side panel if available
    if (chrome.sidePanel) {
      chrome.sidePanel.open({ windowId: tab.windowId });
    } else {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: 'LLM Response',
        message: answer.substring(0, 500) + (answer.length > 500 ? '...' : '')
      });
    }

  } catch (err) {
    console.error('LLM API error:', err);
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'Error',
      message: `Failed to get response: ${err.message}`
    });
  }
});

// Listen for messages from popup/sidepanel
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Handle settings request
  if (request.action === 'getSettings') {
    chrome.storage.local.get([
      'apiUrl', 'apiKey', 'model', 'maxTokens', 'temperature', 'systemPrompt'
    ]).then(sendResponse);
    return true;
  }

  // Handle page content request
  if (request.action === 'getPageContent') {
    chrome.tabs.query({ active: true, currentWindow: true }).then(async (tabs) => {
      const tab = tabs[0];
      try {
        const response = await chrome.tabs.sendMessage(tab.id, { action: 'getPageContent' });
        sendResponse(response);
      } catch (error) {
        sendResponse({ error: error.message });
      }
    });
    return true;
  }

  // Handle perform action request
  if (request.action === 'performAction') {
    chrome.tabs.query({ active: true, currentWindow: true }).then(async (tabs) => {
      const tab = tabs[0];
      try {
        const response = await chrome.tabs.sendMessage(tab.id, { 
          action: 'performAction', 
          actionType: request.actionType, 
          target: request.target 
        });
        sendResponse(response);
      } catch (error) {
        sendResponse({ success: false, message: error.message });
      }
    });
    return true;
  }

  // Handle navigation request
  if (request.action === 'navigate') {
    chrome.tabs.query({ active: true, currentWindow: true }).then(async (tabs) => {
      const tab = tabs[0];
      try {
        await chrome.tabs.update(tab.id, { url: request.url });
        sendResponse({ success: true, message: `Navigated to ${request.url}` });
      } catch (error) {
        sendResponse({ success: false, message: error.message });
      }
    });
    return true;
  }

  // Handle highlight element request
  if (request.action === 'highlightElement') {
    chrome.tabs.query({ active: true, currentWindow: true }).then(async (tabs) => {
      const tab = tabs[0];
      try {
        await chrome.tabs.sendMessage(tab.id, { 
          action: 'highlightElement', 
          selector: request.selector 
        });
        sendResponse({ success: true });
      } catch (error) {
        sendResponse({ success: false, message: error.message });
      }
    });
    return true;
  }

  // Handle clear highlights request
  if (request.action === 'clearHighlights') {
    chrome.tabs.query({ active: true, currentWindow: true }).then(async (tabs) => {
      const tab = tabs[0];
      try {
        await chrome.tabs.sendMessage(tab.id, { action: 'clearHighlights' });
        sendResponse({ success: true });
      } catch (error) {
        sendResponse({ success: false, message: error.message });
      }
    });
    return true;
  }

  // Handle LLM chat with page context
  if (request.action === 'chatWithPageContext') {
    handleChatWithPageContext(request, sendResponse);
    return true;
  }
});

// Handle chat with page context - sends page info to LLM for intelligent actions
async function handleChatWithPageContext(request, sendResponse) {
  const result = await chrome.storage.local.get([
    'apiUrl', 'apiKey', 'model', 'maxTokens', 'temperature', 'systemPrompt'
  ]);

  if (!result.apiUrl || !result.apiKey || !result.model) {
    sendResponse({ success: false, message: 'API settings not configured' });
    return;
  }

  // Get current page content with detailed context
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  
  let pageContent = '';
  try {
    // Inject content script first to ensure it's loaded
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js']
    });
    await new Promise(resolve => setTimeout(resolve, 300));
    
    const content = await chrome.tabs.sendMessage(tab.id, { action: 'getPageContent' });
    
    // Format rich context for LLM
    const linksText = content.links && content.links.length > 0 
      ? content.links.slice(0, 100).map(l => `- "${l.text}"`).join('\n') 
      : 'No links found';
    
    const buttonsText = content.buttons && content.buttons.length > 0
      ? content.buttons.slice(0, 50).map(b => `- "${b.text}"`).join('\n')
      : 'No buttons found';
    
    const headingsText = content.headings && content.headings.length > 0
      ? content.headings.map(h => `- "${h.text}"`).join('\n')
      : 'No headings found';
    
    const inputsText = content.inputs && content.inputs.length > 0
      ? content.inputs.map(i => `- "${i.text}"`).join('\n')
      : 'No inputs found';
    
    // Include hidden menu items - crucial for dropdown navigation!
    let hiddenMenusText = '';
    if (content.hiddenMenuItems && content.hiddenMenuItems.length > 0) {
      hiddenMenusText = `\n\n=== HIDDEN MENU ITEMS (in dropdowns/collapsed menus) ===\nThese items are currently hidden but can be accessed by clicking their parent menu:\n${content.hiddenMenuItems.map(item => `- "${item.text}" (parent: ${item.parent})`).join('\n')}`;
    }
    
    pageContent = `Current Page: ${content.title}\nURL: ${content.url}\n\n=== HEADINGS ===\n${headingsText}\n\n=== LINKS (clickable elements) ===\n${linksText}\n\n=== BUTTONS ===\n${buttonsText}\n\n=== INPUTS/FORMS ===\n${inputsText}${hiddenMenusText}`;
    
    // Add snippet if available (contains all visible text including dropdown menus)
    if (content.snippet && content.snippet.length > 0) {
      const snippetPreview = content.snippet.substring(0, 5000);
      pageContent += `\n\n=== ALL VISIBLE TEXT ON PAGE ===\n${snippetPreview}`;
    }
    
    // Important hint for LLM about hidden menus
    if (content.hasHiddenMenus) {
      pageContent += `\n\n⚠️ NOTE: This page has HIDDEN menu items in dropdowns. To access them, you may need to first click on a menu button (like "Menu", "☰", or a profile icon) to reveal the dropdown, THEN click the desired item.`;
    }
  } catch (error) {
    pageContent = `Current Page: ${tab.title}\nURL: ${tab.url}\n(Note: Could not retrieve detailed page content - try refreshing the page)`;
  }

  const systemPrompt = `${result.systemPrompt || 'You are a helpful AI assistant that can help users navigate websites and perform actions on web pages.'}

You have the ability to:
1. Navigate to URLs - respond with [[NAVIGATE:url]] syntax
2. Click elements - respond with [[CLICK:selector]] syntax (use CSS selectors, button text, link text, etc.)
3. Type into inputs - respond with [[TYPE:selector|text]] syntax
4. Scroll - respond with [[SCROLL:top|bottom|up|down]] syntax
5. Select dropdown options - respond with [[SELECT:selector|value]] syntax

Current page context:
${pageContent}

User message: ${request.message}

Provide a helpful response. If you need to perform actions, use the special syntax above. You can perform multiple actions by listing them.`;

  try {
    const response = await fetch(`${result.apiUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${result.apiKey}`
      },
      body: JSON.stringify({
        model: result.model,
        messages: [
          { role: 'system', content: systemPrompt },
          ...request.history || [],
          { role: 'user', content: request.message }
        ],
        max_tokens: result.maxTokens,
        temperature: result.temperature
      })
    });

    if (!response.ok) {
      throw new Error(response.statusText);
    }

    const data = await response.json();
    const assistantMessage = data.choices[0].message.content;

    // Parse and execute actions
    const actions = parseActions(assistantMessage);
    
    sendResponse({ 
      success: true, 
      response: assistantMessage,
      actions: actions
    });

// Execute actions after sending response with improved error handling
    for (const action of actions) {
      try {
        console.log("=== Executing action ===", action);

        // Wait a bit to ensure content script is ready (it's already injected via manifest)
        await new Promise(resolve => setTimeout(resolve, 200));

        // Check if content script is responding
        let contentScriptReady = false;
        try {
          const pingResult = await chrome.tabs.sendMessage(tab.id, { type: "PING" });
          if (pingResult && pingResult.type === "PONG") {
            contentScriptReady = true;
            console.log("✓ Content script is ready");
          }
        } catch (pingError) {
          console.error("✗ Content script not responding:", pingError.message);
        }

        if (!contentScriptReady) {
          console.warn("Content script may not be fully ready, but attempting action anyway...");
        }

        // Send the action message
        const result = await chrome.tabs.sendMessage(tab.id, {
          action: "performAction",
          actionType: action.type,
          target: action.target
        });

        console.log("=== Action result ===", result);

        if (!result) {
          console.error("✗ Action returned no result");
        } else if (!result.success) {
          console.error("✗ Action failed:", result.message);
        } else {
          console.log("✓ Action succeeded:", result.message);
        }

        // If action indicates menu was opened and retry is needed, wait and execute again
        if (result && result.needsRetry && result.retryDelay) {
          console.log(`⏳ Waiting ${result.retryDelay}ms for menu to open before retrying...`);
          await new Promise(resolve => setTimeout(resolve, result.retryDelay));

          // Retry the same action (now the element should be visible)
          const retryResult = await chrome.tabs.sendMessage(tab.id, {
            action: "performAction",
            actionType: action.type,
            target: action.target
          });

          console.log("=== Retry result ===", retryResult);

          if (!retryResult || !retryResult.success) {
            console.error("✗ Retry action failed:", retryResult?.message || "Unknown error");
          } else {
            console.log("✓ Retry succeeded:", retryResult.message);
          }
        }
      } catch (error) {
        console.error("=== Failed to execute action ===", error.message);
        console.error("Stack:", error.stack);
      }
    }

  } catch (err) {
    console.error('LLM API error:', err);
    sendResponse({ success: false, message: err.message });
  }
}

// Parse action syntax from LLM response
function parseActions(message) {
  const actions = [];
  
  // Match [[ACTION:target]] patterns
  const navigateMatches = message.match(/\[\[NAVIGATE:([^\]]+)\]\]/g);
  if (navigateMatches) {
    navigateMatches.forEach(match => {
      const url = match.replace('[[NAVIGATE:', '').replace(']]', '');
      actions.push({ type: 'navigate', target: url });
    });
  }

  const clickMatches = message.match(/\[\[CLICK:([^\]]+)\]\]/g);
  if (clickMatches) {
    clickMatches.forEach(match => {
      const selector = match.replace('[[CLICK:', '').replace(']]', '');
      actions.push({ type: 'click', target: selector });
    });
  }

  const typeMatches = message.match(/\[\[TYPE:([^\]|]+)\|([^\]]+)\]\]/g);
  if (typeMatches) {
    typeMatches.forEach(match => {
      const parts = match.replace('[[TYPE:', '').replace(']]', '').split('|');
      actions.push({ type: 'type', target: { selector: parts[0], text: parts[1] } });
    });
  }

  const scrollMatches = message.match(/\[\[SCROLL:(top|bottom|up|down)\]\]/g);
  if (scrollMatches) {
    scrollMatches.forEach(match => {
      const direction = match.replace('[[SCROLL:', '').replace(']]', '');
      actions.push({ type: 'scroll', target: direction });
    });
  }

  const selectMatches = message.match(/\[\[SELECT:([^\]|]+)\|([^\]]+)\]\]/g);
  if (selectMatches) {
    selectMatches.forEach(match => {
      const parts = match.replace('[[SELECT:', '').replace(']]', '').split('|');
      actions.push({ type: 'select', target: { selector: parts[0], value: parts[1] } });
    });
  }

  return actions;
}
