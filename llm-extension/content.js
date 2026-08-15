// Content script for page interaction and navigation control
// This script runs on every webpage and enables the LLM to interact with the page

(function() {
  // Prevent multiple injections
  if (window.llmAssistantInjected) return;
  window.llmAssistantInjected = true;

  // Listen for messages from background/popup
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // Handle ping to check if content script is alive
    if (request.type === 'PING') {
      console.log('Content Script: PING received, sending PONG');
      sendResponse({ type: 'PONG' });
      return true;
    }
    
    if (request.action === 'getPageContent') {
      // Return full page content with detailed information for LLM
      const links = Array.from(document.querySelectorAll('a[href]'))
        .map(a => ({ text: a.innerText.trim() || a.title || a.getAttribute('aria-label') || '', href: a.href }))
        .filter(l => l.text.length > 0);
      
      const buttons = Array.from(document.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"]'))
        .map(b => ({ text: b.innerText.trim() || b.value || b.title || b.id || '' }))
        .filter(b => b.text.length > 0);

      const inputs = Array.from(document.querySelectorAll('input:not([type="hidden"]), textarea, select'))
        .map(i => ({ text: i.placeholder || i.name || i.id || '' }))
        .filter(i => i.text.length > 0);

      const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6'))
        .map(h => ({ text: h.innerText.trim() }));

      // Collect ALL text including hidden elements (dropdown menus, collapsed sections, etc.)
      // This is crucial for finding menu items that are currently hidden
      const allElements = Array.from(document.querySelectorAll('*'));
      const visibleTexts = [];
      const hiddenMenuItems = [];
      
      for (const el of allElements) {
        const hasText = el.innerText && el.innerText.trim().length > 0;
        if (!hasText) continue;
        
        const style = window.getComputedStyle(el);
        const isVisible = style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
        const text = el.innerText.trim();
        
        // Check if this might be a menu item (inside nav, menu, dropdown, etc.)
        const isMenuItem = el.closest('nav, [role="menu"], [role="menubar"], .menu, .dropdown, .nav, header') !== null;
        
        if (isVisible) {
          visibleTexts.push(text);
        } else if (isMenuItem && text.length < 50) {
          // Hidden menu items are important!
          hiddenMenuItems.push({
            text: text,
            parent: el.parentElement?.tagName || 'unknown',
            classes: el.className || ''
          });
        }
      }
      
      // Limit visible texts to avoid token overflow
      const snippet = visibleTexts.slice(0, 300).join(' | ');
      
      // Deduplicate hidden menu items
      const uniqueHiddenItems = [...new Map(hiddenMenuItems.map(item => [item.text, item])).values()];

      sendResponse({
        title: document.title,
        url: window.location.href,
        links,
        buttons,
        inputs,
        headings,
        snippet,
        hiddenMenuItems: uniqueHiddenItems.slice(0, 50), // Include up to 50 hidden menu items
        hasHiddenMenus: uniqueHiddenItems.length > 0
      });
    }
    
    if (request.action === 'performAction') {
      performAction(request.actionType, request.target).then(sendResponse);
      return true; // Keep message channel open for async response
    }
    
    if (request.action === 'highlightElement') {
      highlightElement(request.selector);
      sendResponse({ success: true });
    }
    
    if (request.action === 'clearHighlights') {
      clearHighlights();
      sendResponse({ success: true });
    }
  });

  // Perform actions on the page
  async function performAction(actionType, target) {
    try {
      switch (actionType) {
        case 'click':
          const clickElement = findElement(target);
          if (clickElement) {
            // Check if element is hidden (likely in a dropdown menu)
            const style = window.getComputedStyle(clickElement);
            const isHidden = style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0';
            
            if (isHidden) {
              // Try to find and click the parent menu trigger first
              const menuContainer = clickElement.closest('nav, [role="menu"], [role="menubar"], .menu, .dropdown, header');
              if (menuContainer) {
                // Look for a button/link that opens this menu
                const menuTrigger = menuContainer.querySelector('button, a[role="button"], summary, .menu-toggle, .dropdown-toggle, [aria-haspopup="true"]');
                if (menuTrigger) {
                  menuTrigger.click();
                  return { 
                    success: true, 
                    message: `Opened menu "${menuTrigger.innerText.trim() || menuTrigger.getAttribute('aria-label') || ''}". Please click again to select "${target}".`,
                    needsRetry: true,
                    retryDelay: 500 // Wait 500ms for menu to open
                  };
                }
              }
              // If no trigger found, still try to click the hidden element (might work with event bubbling)
              clickElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
              clickElement.click();
              return { success: true, message: `Clicked hidden element: ${target}` };
            }
            
            // Element is visible, click normally
            clickElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
            clickElement.click();
            return { success: true, message: `Clicked: ${target}` };
          }
          return { success: false, message: `Element not found: ${target}` };
        
        case 'type':
          const typeElement = findElement(target.selector);
          if (typeElement) {
            typeElement.value = target.text;
            typeElement.dispatchEvent(new Event('input', { bubbles: true }));
            typeElement.dispatchEvent(new Event('change', { bubbles: true }));
            return { success: true, message: `Typed into: ${target.selector}` };
          }
          return { success: false, message: `Input element not found: ${target.selector}` };
        
        case 'scroll':
          if (target === 'top') {
            window.scrollTo({ top: 0, behavior: 'smooth' });
          } else if (target === 'bottom') {
            window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
          } else if (target === 'up') {
            window.scrollBy({ top: -window.innerHeight, behavior: 'smooth' });
          } else if (target === 'down') {
            window.scrollBy({ top: window.innerHeight, behavior: 'smooth' });
          }
          return { success: true, message: `Scrolled ${target}` };
        
        case 'navigate':
          // Navigation is handled by background script
          return { success: false, message: 'Navigation handled by background' };
        
        case 'select':
          const selectElement = findElement(target.selector);
          if (selectElement && selectElement.tagName === 'SELECT') {
            selectElement.value = target.value;
            selectElement.dispatchEvent(new Event('change', { bubbles: true }));
            return { success: true, message: `Selected: ${target.value}` };
          }
          return { success: false, message: `Select element not found` };
        
        case 'hover':
          const hoverElement = findElement(target);
          if (hoverElement) {
            hoverElement.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
            return { success: true, message: `Hovered: ${target}` };
          }
          return { success: false, message: `Element not found: ${target}` };
        
        default:
          return { success: false, message: `Unknown action: ${actionType}` };
      }
    } catch (error) {
      return { success: false, message: `Error: ${error.message}` };
    }
  }

  // Find element using various strategies with improved matching and logging
  function findElement(selector) {
    // Clean selector from quotes if present
    const cleanSelector = selector.replace(/^"/g, '').replace(/"$/g, '').trim();
    
    console.log('[findElement] Looking for:', cleanSelector);
    
    // Try CSS selector first
    let element = document.querySelector(cleanSelector);
    if (element) {
      console.log('[findElement] Found by CSS selector');
      return element;
    }
    
    // Try by ID
    element = document.getElementById(cleanSelector);
    if (element) {
      console.log('[findElement] Found by ID');
      return element;
    }
    
    // Try by text content with fuzzy matching (handles "Данные счетчики" vs "Данные счетчиков")
    const elements = document.querySelectorAll('*');
    let bestMatch = null;
    let bestMatchScore = 0;
    const normalizedSearch = cleanSelector.toLowerCase().trim();
    
    for (const el of elements) {
      // Skip hidden elements
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;
      
      const text = (el.innerText || el.textContent || '').trim();
      if (!text) continue;
      
      const normalizedText = text.toLowerCase();
      
      let score = 0;

      // 1. Exact match (highest priority)
      if (normalizedText === normalizedSearch) {
        console.log('[findElement] Found by exact text:', el.tagName, text);
        return el;
      }
      
      // 2. Text contains search query (e.g., looking for "Данные счетчики", found "Данные счетчиков")
      if (normalizedText.includes(normalizedSearch)) {
        score = 90 - (normalizedText.length - normalizedSearch.length);
        if (score > bestMatchScore) {
          bestMatchScore = score;
          bestMatch = el;
        }
      }
      // 3. Search query contains text (e.g., looking for long phrase, found short button)
      else if (normalizedSearch.includes(normalizedText) && normalizedText.length > 3) {
        score = 80 - (normalizedSearch.length - normalizedText.length);
        if (score > bestMatchScore) {
          bestMatchScore = score;
          bestMatch = el;
        }
      }
      // 4. Similar start (first 5+ chars match)
      else if (normalizedText.startsWith(normalizedSearch.substring(0, Math.min(6, normalizedSearch.length))) && normalizedSearch.length > 4) {
        score = 70;
        if (score > bestMatchScore) {
          bestMatchScore = score;
          bestMatch = el;
        }
      }
    }
    
    if (bestMatch) {
      console.log('[findElement] Found by fuzzy match (score:', bestMatchScore + '):', bestMatch.tagName, (bestMatch.innerText || bestMatch.textContent).substring(0, 50));
      return bestMatch;
    }
    
    // Try by aria-label (case insensitive)
    element = document.querySelector(`[aria-label*="${cleanSelector}" i]`);
    if (element) {
      console.log('[findElement] Found by aria-label');
      return element;
    }
    
    // Try by placeholder
    element = document.querySelector(`[placeholder*="${cleanSelector}" i]`);
    if (element) {
      console.log('[findElement] Found by placeholder');
      return element;
    }
    
    // Try by name
    element = document.querySelector(`[name*="${cleanSelector}" i]`);
    if (element) {
      console.log('[findElement] Found by name');
      return element;
    }
    
    // Try by title
    element = document.querySelector(`[title*="${cleanSelector}" i]`);
    if (element) {
      console.log('[findElement] Found by title');
      return element;
    }
    
    // Try links by href or text
    const links = document.querySelectorAll('a[href]');
    for (const link of links) {
      if (link.href.toLowerCase().includes(cleanSelector.toLowerCase())) {
        console.log('[findElement] Found link by href');
        return link;
      }
      const linkText = (link.innerText || link.textContent || '').trim().toLowerCase();
      if (linkText.includes(cleanSelector.toLowerCase())) {
        console.log('[findElement] Found link by text:', link.innerText?.substring(0, 30));
        return link;
      }
    }
    
    // Try buttons by text
    const buttons = document.querySelectorAll('button, [role="button"]');
    for (const btn of buttons) {
      const btnText = (btn.innerText || btn.textContent || '').trim().toLowerCase();
      if (btnText.includes(cleanSelector.toLowerCase())) {
        console.log('[findElement] Found button by text:', btn.innerText?.substring(0, 30));
        return btn;
      }
    }
    
    // Try by role
    element = document.querySelector(`[role="${cleanSelector}"]`);
    if (element) {
      console.log('[findElement] Found by role');
      return element;
    }
    
    // Last resort: any element containing the text
    for (const el of elements) {
      const text = (el.innerText || el.textContent || '').trim();
      if (text && text.toLowerCase().includes(cleanSelector.toLowerCase())) {
        console.log('[findElement] Found by text containment:', el.tagName, text.substring(0, 30));
        return el;
      }
    }
    
    console.log('[findElement] NOT FOUND:', cleanSelector);
    return null;
  }

  // Highlight element visually
  function highlightElement(selector) {
    clearHighlights();
    const element = findElement(selector);
    if (element) {
      const originalStyle = element.getAttribute('data-original-style');
      if (!originalStyle) {
        element.setAttribute('data-original-style', element.style.cssText);
      }
      element.style.outline = '3px solid #ff0000';
      element.style.backgroundColor = '#ffff0055';
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  // Clear all highlights
  function clearHighlights() {
    const highlighted = document.querySelectorAll('[data-original-style]');
    highlighted.forEach(el => {
      const originalStyle = el.getAttribute('data-original-style');
      el.style.cssText = originalStyle || '';
      el.removeAttribute('data-original-style');
    });
  }

  // Notify background that content script is ready
  console.log('LLM Assistant Content Script loaded');
})();
