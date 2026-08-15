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
      sendResponse({ type: 'PONG' });
      return true;
    }
    
    if (request.action === 'getPageContent') {
      // Return full page content
      sendResponse({
        title: document.title,
        url: window.location.href,
        content: document.body.innerText,
        html: document.body.innerHTML,
        links: Array.from(document.querySelectorAll('a')).map(a => ({
          text: a.innerText.trim(),
          href: a.href
        })).slice(0, 100),
        headings: Array.from(document.querySelectorAll('h1, h2, h3')).map(h => ({
          level: h.tagName,
          text: h.innerText.trim()
        }))
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

  // Find element using various strategies
  function findElement(selector) {
    // Try CSS selector first
    let element = document.querySelector(selector);
    if (element) return element;
    
    // Try by ID
    element = document.getElementById(selector);
    if (element) return element;
    
    // Try by text content
    const elements = document.querySelectorAll('*');
    for (const el of elements) {
      if (el.innerText && el.innerText.trim().toLowerCase() === selector.toLowerCase()) {
        return el;
      }
      if (el.textContent && el.textContent.trim().toLowerCase() === selector.toLowerCase()) {
        return el;
      }
    }
    
    // Try by aria-label
    element = document.querySelector(`[aria-label="${selector}"]`);
    if (element) return element;
    
    // Try by placeholder
    element = document.querySelector(`[placeholder="${selector}"]`);
    if (element) return element;
    
    // Try by name
    element = document.querySelector(`[name="${selector}"]`);
    if (element) return element;
    
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
