// Global variables to track auto-refresh interval and recording status
let recordedApisRefreshInterval = null;
let statusCheckInterval = null;
let lastKnownDataHash = null;
let lastKnownRecordingStatus = null;

document.addEventListener('DOMContentLoaded', () => {
  console.log('=== SPACES API EXPLORER LOADED ===');
  
  // Debug: Check storage state on load
  chrome.storage.local.get(null, (data) => {
    console.log('[SpacesAPIExplorer] Storage state on load:', data);
  });
  
  // Set up tab navigation
  const tabButtons = document.querySelectorAll('.spaces-tab-button');
  const tabContents = document.querySelectorAll('.spaces-tab-content');

  // Listen for storage changes to detect recording status changes from other windows
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && changes.isRecording) {
      console.log('Recording status changed in storage:', changes.isRecording.newValue);
      // Immediately update the recording status when it changes
      setTimeout(() => updateRecordingStatus(), 100);
      
      // Also refresh recorded APIs tab if it's currently active
      const recordedApisTab = document.getElementById('recorded-apis-tab');
      if (recordedApisTab && recordedApisTab.classList.contains('active')) {
        console.log('Refreshing recorded APIs tab for recording status change');
        setTimeout(() => smartRefreshRecordedApisData(), 150);
      }
    }
    // Also listen for new API data
    if (namespace === 'local' && changes.recordedApiCalls) {
      console.log('API data changed in storage');
      // If we're currently on the recorded APIs tab and monitoring, trigger a refresh
      const recordedApisTab = document.getElementById('recorded-apis-tab');
      if (recordedApisTab && recordedApisTab.classList.contains('active')) {
        // Check if this is a data clearing event (empty data) vs new data
        const newData = changes.recordedApiCalls.newValue || {};
        const oldData = changes.recordedApiCalls.oldValue || {};
        const hasNewData = Object.keys(newData).some(tabId => 
          newData[tabId] && newData[tabId].length > 0
        );
        
        if (hasNewData) {
          // Detect if new data was added (not just cleared)
          const isNewData = detectNewDataChanges(oldData, newData);
          // Only refresh if there's actual new data, not just clearing
          setTimeout(() => {
            smartRefreshRecordedApisData();
          }, 200);
        } else {
          console.log('Data cleared, clearing display');
          // Data was cleared, update display to show empty state
          setTimeout(() => smartRefreshRecordedApisData(), 100);
        }
      }
    }
  });

  // Function to detect what new data was added
  function detectNewDataChanges(oldData, newData) {
    if (!oldData || Object.keys(oldData).length === 0) {
      // No old data means everything is new
      const hasAnyData = Object.keys(newData).some(tabId => {
        const calls = newData[tabId] || [];
        return Array.isArray(calls) && calls.length > 0;
      });
      return hasAnyData;
    }
    
    // Check for new tabs or additional calls in existing tabs
    for (const tabId in newData) {
      const newCalls = newData[tabId] || [];
      const oldCalls = oldData[tabId] || [];
      
      if (!Array.isArray(newCalls) || !Array.isArray(oldCalls)) {
        continue;
      }
      
      if (newCalls.length > oldCalls.length) {
        console.log(`New data detected: Tab ${tabId} has ${newCalls.length} calls (was ${oldCalls.length})`);
        return true; // New calls added
      }
    }
    
    // Check for entirely new tabs
    const newTabIds = Object.keys(newData);
    const oldTabIds = Object.keys(oldData);
    const hasNewTabs = newTabIds.some(tabId => !oldTabIds.includes(tabId));
    
    if (hasNewTabs) {
      console.log('New tabs detected in data');
      return true;
    }
    
    return false; // No new data detected
  }

  function switchTab(targetTabId) {
    // Clear auto-refresh when leaving recorded APIs tab
    if (targetTabId !== 'recorded-apis-tab') {
      if (recordedApisRefreshInterval) {
        clearInterval(recordedApisRefreshInterval);
        recordedApisRefreshInterval = null;
      }
      if (statusCheckInterval) {
        clearInterval(statusCheckInterval);
        statusCheckInterval = null;
      }
      // Clean up backup monitoring
      if (window.backupMonitoringInterval) {
        clearInterval(window.backupMonitoringInterval);
        window.backupMonitoringInterval = null;
      }
    }
    
    // Hide all tabs
    tabContents.forEach(tab => tab.classList.remove('active'));
    tabButtons.forEach(btn => btn.classList.remove('active'));
    
    // Show target tab
    const targetTab = document.getElementById(targetTabId);
    const targetButton = document.querySelector(`[data-tab="${targetTabId}"]`);
    
    if (targetTab && targetButton) {
      targetTab.classList.add('active');
      targetButton.classList.add('active');
    }
    
    // Start status monitoring if switching to recorded APIs tab
    if (targetTabId === 'recorded-apis-tab') {
      setTimeout(() => {
        startStatusMonitoring();
        // Immediately show current recording status and any existing data
        displayRecordedApisData();
      }, 100);
    }
  }

  // Tab button click handlers
  tabButtons.forEach(button => {
    button.addEventListener('click', () => {
      const targetTab = button.getAttribute('data-tab');
      switchTab(targetTab);
    });
  });

  // Check for URL parameters to set initial tab and pre-populate API data
  const params = new URLSearchParams(window.location.search);
  const domain = params.get('domain');
  const tabParam = params.get('tab');
  const apiUrl = params.get('apiUrl');
  const method = params.get('method');
  const autoExecute = params.get('autoExecute');
  
  if (tabParam === 'recorded-apis-tab') {
    switchTab('recorded-apis-tab');
    // Wait for initialization to complete before displaying data
    setTimeout(() => displayRecordedApisData(), 100);
  } else {
    switchTab('api-explorer-tab');
    
    // Pre-populate API fields if provided
    if (apiUrl) {
      const urlInput = document.getElementById('api-endpoint');
      if (urlInput) {
        urlInput.value = apiUrl;
        
        // Auto-execute if requested
        if (autoExecute === 'true') {
          setTimeout(() => {
            const executeButton = document.getElementById('run-api-call');
            if (executeButton) {
              executeButton.click();
            }
          }, 100);
        }
      }
    }
    
    // Clear any active intervals when not on recorded APIs tab
    if (recordedApisRefreshInterval) {
      clearInterval(recordedApisRefreshInterval);
      recordedApisRefreshInterval = null;
    }
    if (statusCheckInterval) {
      clearInterval(statusCheckInterval);
      statusCheckInterval = null;
    }
  }
  
  // Initialize marked paths display
  initializeMarkedPaths();
  
  // Setup API Explorer functionality
  setupApiExplorer();
});

// API Explorer functionality
function setupApiExplorer() {
  const runButton = document.getElementById('run-api-call');
  const endpointInput = document.getElementById('api-endpoint');
  const outputContainer = document.getElementById('api-output');
  
  if (!runButton || !endpointInput || !outputContainer) {
    console.warn('API Explorer elements not found');
    return;
  }
  
  // Update current domain display
  updateCurrentDomain();
  
  // Run API Call button click handler
  runButton.addEventListener('click', async () => {
    const endpoint = endpointInput.value.trim();
    
    if (!endpoint) {
      outputContainer.innerHTML = '<div class="spaces-error">Please enter an API endpoint</div>';
      return;
    }
    
    await runApiExplorer(endpoint, outputContainer, runButton);
  });
  
  // Enter key support for endpoint input
  endpointInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      runButton.click();
    }
  });
  
  // Setup marked paths copy functionality
  setupMarkedPathsCopyHandlers();
}

// Setup marked paths copy functionality
function setupMarkedPathsCopyHandlers() {
  const copyPathsBtn = document.getElementById('copy-marked-paths');
  const copyValuesBtn = document.getElementById('copy-marked-values');
  
  if (copyPathsBtn) {
    copyPathsBtn.addEventListener('click', async () => {
      await copyMarkedPaths('paths');
    });
  }
  
  if (copyValuesBtn) {
    copyValuesBtn.addEventListener('click', async () => {
      await copyMarkedPaths('values');
    });
  }
}

// Copy marked paths functionality
async function copyMarkedPaths(type = 'paths') {
  const button = type === 'paths' ? document.getElementById('copy-marked-paths') : document.getElementById('copy-marked-values');
  
  try {
    // Get current marked paths for API Explorer (we'll use a generic card index)
    const apiExplorerCardIndexes = Array.from(document.querySelectorAll('.explorer-card')).map(card => card.getAttribute('data-card-index'));
    let allMarkedData = [];
    
    for (const cardIndex of apiExplorerCardIndexes) {
      const cardMarkedPaths = getMarkedPathsForCard(cardIndex);
      if (cardMarkedPaths.length > 0) {
        // Get the response data for this card
        const card = document.querySelector(`[data-card-index="${cardIndex}"]`);
        const jsonContainer = card?.querySelector('.json-interactive');
        
        if (jsonContainer) {
          const encodedData = jsonContainer.getAttribute('data-json-content');
          if (encodedData) {
            const responseData = JSON.parse(decodeURIComponent(encodedData));
            
            cardMarkedPaths.forEach(path => {
              const value = getValueByPath(responseData, path);
              allMarkedData.push({
                path: path,
                value: value
              });
            });
          }
        }
      }
    }
    
    if (allMarkedData.length === 0) {
      showButtonFeedback(button, 'No paths marked');
      return;
    }
    
    let textToCopy = '';
    
    if (type === 'paths') {
      // Copy paths with their values
      textToCopy = allMarkedData.map(item => {
        const valueStr = typeof item.value === 'object' ? JSON.stringify(item.value) : String(item.value);
        return `${item.path}: ${valueStr}`;
      }).join('\n');
    } else {
      // Copy values only
      textToCopy = allMarkedData.map(item => {
        return typeof item.value === 'object' ? JSON.stringify(item.value, null, 2) : String(item.value);
      }).join('\n\n');
    }
    
    await navigator.clipboard.writeText(textToCopy);
    showButtonFeedback(button, `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M20 6L9 17l-5-5"/>
      </svg>
    `);
    
  } catch (error) {
    console.error('Failed to copy marked paths:', error);
    showButtonFeedback(button, 'Error');
  }
}

// Helper function to get value by path
function getValueByPath(obj, path) {
  if (!path) return obj;
  
  const parts = path.split('.');
  let current = obj;
  
  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }
    
    // Handle array indices
    if (part.includes('[') && part.includes(']')) {
      const arrayName = part.substring(0, part.indexOf('['));
      const index = parseInt(part.substring(part.indexOf('[') + 1, part.indexOf(']')));
      
      if (arrayName) {
        current = current[arrayName];
      }
      
      if (Array.isArray(current) && index >= 0 && index < current.length) {
        current = current[index];
      } else {
        return undefined;
      }
    } else {
      current = current[part];
    }
  }
  
  return current;
}

// Update the current domain display based on open tabs from allowed domains
async function updateCurrentDomain() {
  try {
    // Define the allowed domains from the manifest
    const allowedDomains = [
      'https://dnaspaces.io',
      'https://dnaspaces.eu', 
      'https://dnaspaces.sg'
    ];
    
    // Also check for subdomains
    const allowedPatterns = [
      /^https:\/\/.*\.dnaspaces\.io$/,
      /^https:\/\/.*\.dnaspaces\.eu$/,
      /^https:\/\/.*\.dnaspaces\.sg$/,
      /^https:\/\/dnaspaces\.io$/,
      /^https:\/\/dnaspaces\.eu$/,
      /^https:\/\/dnaspaces\.sg$/
    ];
    
    // Query all tabs to find one with an allowed domain
    const tabs = await chrome.tabs.query({});
    let foundDomain = null;
    
    for (const tab of tabs) {
      if (tab.url) {
        try {
          const url = new URL(tab.url);
          const domain = `${url.protocol}//${url.host}`;
          
          // Check exact matches first
          if (allowedDomains.includes(domain)) {
            foundDomain = domain;
            break;
          }
          
          // Check pattern matches (for subdomains)
          for (const pattern of allowedPatterns) {
            if (pattern.test(domain)) {
              foundDomain = domain;
              break;
            }
          }
          
          if (foundDomain) break;
          
        } catch (e) {
          // Skip invalid URLs
          continue;
        }
      }
    }
    
    // If no allowed domain found, default to dnaspaces.io
    const displayDomain = foundDomain || 'https://dnaspaces.io';
    
    const domainElement = document.getElementById('current-domain');
    if (domainElement) {
      domainElement.textContent = displayDomain;
    }
    
    console.log('API Explorer: Current domain set to:', displayDomain);
    
  } catch (error) {
    console.warn('Failed to update current domain:', error);
    // Fallback to default domain
    const domainElement = document.getElementById('current-domain');
    if (domainElement) {
      domainElement.textContent = 'https://dnaspaces.io';
    }
  }
}

// Execute API call for explorer tab - now using unified execution
async function runApiExplorer(endpoint, outputContainer, button) {
  const originalButtonText = button.textContent;
  let fullUrl = ''; // Initialize to avoid undefined reference
  
  try {
    // Update button state
    button.disabled = true;
    button.textContent = 'Running...';
    
    // Show loading state
    outputContainer.innerHTML = '<div class="spaces-loading">Making API request...</div>';
    
    // Determine if endpoint is relative or absolute
    fullUrl = endpoint;
    if (!endpoint.startsWith('http')) {
      // Get current domain from the span or default to dnaspaces.io
      const domainElement = document.getElementById('current-domain');
      const domain = domainElement ? domainElement.textContent : 'https://dnaspaces.io';
      fullUrl = endpoint.startsWith('/') ? `${domain}${endpoint}` : `${domain}/${endpoint}`;
    }
    
    console.log('API Explorer: Making request to:', fullUrl);
    
    // Create a mock call data structure for unified execution
    const callData = {
      method: 'GET',
      url: fullUrl,
      pageUrl: 'api-explorer'
    };
    
    // Generate a unique card index for this API Explorer call
    const cardIndex = `api-explorer-${Date.now()}`;
    
    // Use the unified API execution function
    const response = await executeApiCall(callData, cardIndex);
    
    // Create the card using the unified card creation
    const cardHtml = createUnifiedApiCard(response, cardIndex, true); // true for isExplorer
    outputContainer.innerHTML = cardHtml;
    
    // Initialize the interactive JSON viewer
    const jsonContainer = outputContainer.querySelector('.json-interactive');
    if (jsonContainer && response.responseData) {
      renderInteractiveJSON(jsonContainer, response.responseData, cardIndex);
    }
    
    // Setup event handlers for the new card
    setupUnifiedCardEventHandlers(outputContainer);
    
    // Show and update the marked paths section
    updateMarkedPathsDisplay();
    
  } catch (error) {
    console.error('API Explorer error:', error);
    outputContainer.innerHTML = `
      <div class="spaces-error">
        <h3>Request Failed</h3>
        <p><strong>Error:</strong> ${error.message}</p>
        <p><strong>URL:</strong> ${fullUrl || endpoint}</p>
      </div>
    `;
    
    // Hide marked paths section on error
    const markedPathsSection = document.getElementById('marked-paths-section');
    if (markedPathsSection) {
      markedPathsSection.style.display = 'none';
    }
  } finally {
    // Restore button state
    button.disabled = false;
    button.textContent = originalButtonText;
  }
}

// Unified API execution function that works for both Explorer and Recorded APIs
async function executeApiCall(callData, cardIndex) {
  // Find a DNA Spaces tab for content script injection
  const allowedPatterns = [
    /^https:\/\/.*\.dnaspaces\.io/,
    /^https:\/\/.*\.dnaspaces\.eu/,
    /^https:\/\/.*\.dnaspaces\.sg/,
    /^https:\/\/dnaspaces\.io/,
    /^https:\/\/dnaspaces\.eu/,
    /^https:\/\/dnaspaces\.sg/
  ];
  
  const tabs = await chrome.tabs.query({});
  let targetTab = null;
  
  for (const tab of tabs) {
    if (tab.url && allowedPatterns.some(pattern => pattern.test(tab.url))) {
      targetTab = tab;
      break;
    }
  }
  
  if (!targetTab) {
    throw new Error('No DNA Spaces tab found. Please open a DNA Spaces tab first.');
  }
  
  // Inject content script to make authenticated request
  const results = await chrome.scripting.executeScript({
    target: { tabId: targetTab.id },
    func: async (url, method) => {
      try {
        const response = await fetch(url, {
          method: method || 'GET',
          credentials: 'include',
          headers: {
            'Accept': 'application/json, text/plain, */*',
            'Content-Type': 'application/json'
          }
        });
        
        const responseText = await response.text();
        return {
          ok: response.ok,
          status: response.status,
          statusText: response.statusText,
          headers: Object.fromEntries(response.headers.entries()),
          text: responseText
        };
      } catch (error) {
        throw new Error(`Request failed: ${error.message}`);
      }
    },
    args: [callData.url, callData.method || 'GET']
  });
  
  const response = results[0].result;
  
  // Get response text and try to parse as JSON
  const responseText = response.text;
  let responseData;
  
  // Create timestamp in user's timezone
  const now = new Date();
  const timeOptions = {
    month: '2-digit',
    day: '2-digit', 
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
    hour12: true
  };
  const timestamp = now.toLocaleDateString('en-US', timeOptions).replace(',', ' -');
  
  try {
    // Clean the response text of problematic characters before parsing
    const cleanedText = cleanResponseText(responseText);
    responseData = JSON.parse(cleanedText);
  } catch (jsonError) {
    console.warn('Failed to parse as JSON, using raw text:', jsonError.message);
    // If JSON parsing fails, treat as plain text response
    responseData = {
      __raw_response__: true,
      content_type: response.headers['content-type'] || 'text/plain',
      status: response.status,
      status_text: response.statusText,
      data: responseText.substring(0, 10000) // Limit to first 10KB for display
    };
  }
  
  // Return unified response structure
  return {
    method: callData.method || 'GET',
    url: callData.url,
    pageUrl: callData.pageUrl,
    statusCode: response.status,
    statusText: response.statusText,
    responseData: responseData,
    responseHeaders: response.headers,
    timestamp: timestamp,
    requestBody: callData.requestBody
  };
}

// Unified card creation function
function createUnifiedApiCard(call, cardIndex, isExplorer = false) {
  const statusClass = call.statusCode && call.statusCode >= 200 && call.statusCode < 300 ? 'success' : 'error';
  
  // For Explorer mode, create simpler card without Execute button
  if (isExplorer) {
    return `
      <div class="spaces-api-call-card explorer-card" data-card-index="${cardIndex}">
        <div class="spaces-api-call-content">
          <div class="spaces-api-call-summary">
            <div class="api-call-header-row">
              <div class="api-call-main-info">
                <span class="spaces-method-badge ${call.method.toLowerCase()}">${call.method}</span>
                <span class="spaces-url-display">${call.url}</span>
              </div>
              <div class="api-call-meta-info">
                <span class="spaces-status spaces-status-${statusClass}">${call.statusCode} ${call.statusText}</span>
                <span class="spaces-timestamp">${call.timestamp}</span>
              </div>
            </div>
          </div>
          
          <div class="response-section">
            <div class="response-header">
              <div class="response-header-left">
                <strong>Response:</strong>
              </div>
              <div class="response-header-right">
                <span class="marked-paths-indicator" id="marked-count-${cardIndex}">
                  <span class="marked-count">0</span> path(s) marked
                </span>
                <button class="spaces-btn spaces-btn-ghost spaces-btn-small spaces-copy-response-btn" 
                        data-response="${encodeURIComponent(JSON.stringify(call.responseData))}" 
                        title="Copy response">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M9 9V6.2002C9 5.08009 9 4.51962 9.21799 4.0918C9.40973 3.71547 9.71547 3.40973 10.0918 3.21799C10.5196 3 11.0801 3 12.2002 3H17.8002C18.9203 3 19.4801 3 19.9079 3.21799C20.2842 3.40973 20.5905 3.71547 20.7822 4.0918C21.0002 4.51962 21.0002 5.07967 21.0002 6.19978V11.7998C21.0002 12.9199 21.0002 13.48 20.7822 13.9078C20.5905 14.2841 20.2839 14.5905 19.9076 14.7822C19.4802 15 18.921 15 17.8031 15H15M9 9H6.2002C5.08009 9 4.51962 9 4.0918 9.21799C3.71547 9.40973 3.40973 9.71547 3.21799 10.0918C3 10.5196 3 11.0801 3 12.2002V17.8002C3 18.9203 3 19.4801 3.21799 19.9079C3.40973 20.2842 3.71547 20.5905 4.0918 20.7822C4.5192 21 5.07899 21 6.19691 21H11.8036C12.9215 21 13.4805 21 13.9079 20.7822C14.2842 20.5905 14.5905 20.2839 14.7822 19.9076C15 19.4802 15 18.921 15 17.8031V15M9 9H11.8002C12.9203 9 13.4801 9 13.9079 9.21799C14.2842 9.40973 14.5905 9.71547 14.7822 10.0918C15 10.5192 15 11.079 15 12.1969L15 15" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                </button>
              </div>
            </div>
            
            <div class="response-content" data-card-index="${cardIndex}">
              ${call.responseData ? `
                <div class="json-interactive" data-json-content="${encodeURIComponent(JSON.stringify(call.responseData))}"></div>
              ` : '<div class="no-response">No response data</div>'}
            </div>
          </div>
        </div>
      </div>
    `;
  }
  
  // For Recorded APIs mode, create full card with Execute button (delegate to existing function)
  return createApiCallCard(call, cardIndex, call.pageUrl);
}

// Unified event handler setup
function setupUnifiedCardEventHandlers(container) {
  // Copy response button
  const copyBtn = container.querySelector('.spaces-copy-response-btn');
  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      const encodedResponse = copyBtn.getAttribute('data-response');
      const responseData = JSON.parse(decodeURIComponent(encodedResponse));
      await copyToClipboard(responseData, copyBtn);
    });
  }
  
  // For recorded APIs, also setup replay button if present
  const replayBtn = container.querySelector('.replay-btn');
  if (replayBtn) {
    replayBtn.addEventListener('click', async () => {
      const callData = JSON.parse(replayBtn.getAttribute('data-call'));
      const cardIndex = replayBtn.getAttribute('data-card-index');
      await replayApiCall(callData, cardIndex, replayBtn);
    });
  }
}

// Legacy function - now delegates to unified execution
function createApiExplorerCard(call, cardIndex) {
  return createUnifiedApiCard(call, cardIndex, true);
}

// Legacy function - now delegates to unified event handlers  
function setupApiExplorerEventHandlers(container) {
  return setupUnifiedCardEventHandlers(container);
}

// Create API Explorer card HTML (similar to recorded APIs but simplified)
function createApiExplorerCard(call, cardIndex) {
  const statusClass = call.statusCode && call.statusCode >= 200 && call.statusCode < 300 ? 'success' : 'error';
  
  return `
    <div class="spaces-api-call-card explorer-card" data-card-index="${cardIndex}">
      <div class="spaces-api-call-content">
        <div class="spaces-api-call-summary">
          <span class="spaces-method-badge">${call.method}</span>
          <span class="spaces-url">${call.url}</span>
          <span class="spaces-status spaces-status-${statusClass}">${call.statusCode} ${call.statusText}</span>
          <span class="spaces-timestamp">${new Date(call.timestamp).toLocaleString()}</span>
        </div>
        
        <div class="response-section">
          <div class="response-header">
            <div class="response-header-left">
              <strong>Response:</strong>
              <span class="response-status-info">
                <span class="response-status ${statusClass}">${call.statusCode} ${call.statusText}</span>
              </span>
            </div>
            <div class="response-header-right">
              <span class="marked-paths-indicator" id="marked-count-${cardIndex}">
                <span class="marked-count">0</span> path(s) marked
              </span>
              <button class="spaces-btn spaces-btn-ghost spaces-btn-small spaces-copy-response-btn" 
                      data-response="${encodeURIComponent(JSON.stringify(call.responseData))}" 
                      title="Copy response">
                Copy
              </button>
            </div>
          </div>
          
          <div class="response-content" data-card-index="${cardIndex}">
            ${call.responseData ? `
              <div class="json-interactive" data-json-content="${encodeURIComponent(JSON.stringify(call.responseData))}"></div>
            ` : '<div class="no-response">No response data</div>'}
          </div>
        </div>
      </div>
    </div>
  `;
}

// Setup event handlers for API Explorer cards
function setupApiExplorerEventHandlers(container) {
  // Copy response button
  const copyBtn = container.querySelector('.spaces-copy-response-btn');
  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      const encodedResponse = copyBtn.getAttribute('data-response');
      const responseData = JSON.parse(decodeURIComponent(encodedResponse));
      await copyToClipboard(responseData, copyBtn);
    });
  }
}

// Helper function to create API call card HTML
function createApiCallCard(call, cardIndex, pageUrl) {
  try {
    // Validate input
    if (!call) {
      return '<div class="error-card">Invalid call data</div>';
    }
    
    let requestBodyHtml = '';
    let responseDataHtml = '';
    
    // Request body
    if (call.requestBody) {
      try {
        const editButton = `<button class="spaces-btn spaces-btn-ghost spaces-btn-small spaces-edit-payload-btn" data-card-index="${cardIndex}" title="Edit payload">Edit</button>`;
        const bodyStr = typeof call.requestBody === 'string' ? call.requestBody : JSON.stringify(call.requestBody, null, 2);
        requestBodyHtml = `<p><strong>Request Payload:</strong> <span class="payload-content" data-card-index="${cardIndex}"><code>${bodyStr}</code></span> ${editButton}</p>`;
      } catch (e) {
        console.error('Error processing request body:', e);
        requestBodyHtml = '<p><strong>Request Payload:</strong> <em>Error displaying request body</em></p>';
      }
    }
    
    // Response data
    if (call.responseData) {
      try {
        let parsedResponse;
        try {
          parsedResponse = typeof call.responseData === 'string' ? JSON.parse(call.responseData) : call.responseData;
        } catch (e) {
          parsedResponse = call.responseData;
        }
        
        responseDataHtml = `
          <div class="response-section">
            <div class="response-header">
              <div class="response-header-left">
                <strong>Response:</strong>
                <span class="response-status-info">
                  ${call.responseStatus || 'Unknown'} - ${call.responseTimestamp || 'Unknown time'}
                </span>
              </div>
              <div class="response-header-right">
                <span class="marked-paths-indicator" id="marked-count-${cardIndex}">
                  <span class="marked-count">0</span> path(s) marked
                </span>
                <div class="response-actions">
                  <button class="spaces-btn spaces-btn-info spaces-btn-small spaces-copy-response-btn" data-response='${encodeURIComponent(safeJSONStringify(parsedResponse))}'>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M9 9V6.2002C9 5.08009 9 4.51962 9.21799 4.0918C9.40973 3.71547 9.71547 3.40973 10.0918 3.21799C10.5196 3 11.0801 3 12.2002 3H17.8002C18.9203 3 19.4801 3 19.9079 3.21799C20.2842 3.40973 20.5905 3.71547 20.7822 4.0918C21.0002 4.51962 21.0002 5.07967 21.0002 6.19978V11.7998C21.0002 12.9199 21.0002 13.48 20.7822 13.9078C20.5905 14.2841 20.2839 14.5905 19.9076 14.7822C19.4802 15 18.921 15 17.8031 15H15M9 9H6.2002C5.08009 9 4.51962 9 4.0918 9.21799C3.71547 9.40973 3.40973 9.71547 3.21799 10.0918C3 10.5196 3 11.0801 3 12.2002V17.8002C3 18.9203 3 19.4801 3.21799 19.9079C3.40973 20.2842 3.71547 20.5905 4.0918 20.7822C4.5192 21 5.07899 21 6.19691 21H11.8036C12.9215 21 13.4805 21 13.9079 20.7822C14.2842 20.5905 14.5905 20.2839 14.7822 19.9076C15 19.4802 15 18.921 15 17.8031V15M9 9H11.8002C12.9203 9 13.4801 9 13.9079 9.21799C14.2842 9.40973 14.5905 9.71547 14.7822 10.0918C15 10.5192 15 11.079 15 12.1969L15 15" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                  </button>
                  <button class="spaces-btn spaces-btn-ghost spaces-btn-small spaces-minimize-response-btn" data-card-index="${cardIndex}-live">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="m6 9 6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                  </button>
                </div>
              </div>
            </div>
            <div class="response-content minimizable-content" data-card-index="${cardIndex}-live">
              <div class="json-interactive" data-json-content="${encodeURIComponent(safeJSONStringify(parsedResponse))}"></div>
            </div>
          </div>
        `;
      } catch (e) {
        console.error('Error processing response data:', e);
        responseDataHtml = '<div class="response-section"><p><strong>Response:</strong> <em>Error displaying response data</em></p></div>';
      }
    }
    
    // Safe defaults for call properties
    const method = call.method || 'GET';
    const url = call.url || 'Unknown URL';
    const safeCall = safeJSONStringify(call).replace(/'/g, '&#39;');
    
    return `
      <div class="spaces-api-call-card" data-card-index="${cardIndex}" data-page-url="${call.pageUrl || 'unknown-page'}">
        <div class="spaces-call-header">
          <div class="call-info">
            <span class="spaces-method-badge ${method.toLowerCase()}">${method}</span>
            <span class="spaces-url-text">
              ${url}
              <button class="delete-btn call-delete-btn" data-card-index="${cardIndex}" data-page-url="${call.pageUrl || 'unknown-page'}" title="Delete this API call">
                <svg width="14" height="14" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="#dc2626" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M3 6h18"/>
                  <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/>
                  <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
                  <line x1="10" y1="11" x2="10" y2="17"/>
                  <line x1="14" y1="11" x2="14" y2="17"/>
                </svg>
              </button>
            </span>
          </div>
          <div class="call-actions">
            <button class="spaces-btn spaces-btn-ghost spaces-btn-small spaces-copy-call-btn" data-call='${safeCall}'>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M9 9V6.2002C9 5.08009 9 4.51962 9.21799 4.0918C9.40973 3.71547 9.71547 3.40973 10.0918 3.21799C10.5196 3 11.0801 3 12.2002 3H17.8002C18.9203 3 19.4801 3 19.9079 3.21799C20.2842 3.40973 20.5905 3.71547 20.7822 4.0918C21.0002 4.51962 21.0002 5.07967 21.0002 6.19978V11.7998C21.0002 12.9199 21.0002 13.48 20.7822 13.9078C20.5905 14.2841 20.2839 14.5905 19.9076 14.7822C19.4802 15 18.921 15 17.8031 15H15M9 9H6.2002C5.08009 9 4.51962 9 4.0918 9.21799C3.71547 9.40973 3.40973 9.71547 3.21799 10.0918C3 10.5196 3 11.0801 3 12.2002V17.8002C3 18.9203 3 19.4801 3.21799 19.9079C3.40973 20.2842 3.71547 20.5905 4.0918 20.7822C4.5192 21 5.07899 21 6.19691 21H11.8036C12.9215 21 13.4805 21 13.9079 20.7822C14.2842 20.5905 14.5905 20.2839 14.7822 19.9076C15 19.4802 15 18.921 15 17.8031V15M9 9H11.8002C12.9203 9 13.4801 9 13.9079 9.21799C14.2842 9.40973 14.5905 9.71547 14.7822 10.0918C15 10.5192 15 11.079 15 12.1969L15 15" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
            <button class="spaces-btn spaces-btn-secondary spaces-btn-small replay-btn" data-call='${safeCall}' data-card-index="${cardIndex}">Execute</button>
          </div>
        </div>
        <div class="spaces-call-details">
          ${requestBodyHtml}
          ${responseDataHtml}
          ${!responseDataHtml && !requestBodyHtml && !call.responseData ? '<div class="response-section"><div class="response-header"><div class="response-header-left"><strong>Response:</strong><span class="response-status-info"><em>Click Execute to see response data</em></span></div><div class="response-header-right"><span class="marked-paths-indicator" id="marked-count-' + cardIndex + '"><span class="marked-count">0</span> path(s) marked</span></div></div></div>' : ''}
        </div>
      </div>
    `;
  } catch (error) {
    console.error('Error in createApiCallCard:', error);
    return `<div class="error-card">Error creating card: ${error.message}</div>`;
  }
}

// Update recording status indicator and handle auto-refresh
async function updateRecordingStatus() {
  const statusElement = document.getElementById('recording-status');
  if (!statusElement) return;

  try {
    // Check if recording is active by querying the background script
    const response = await chrome.runtime.sendMessage({ type: 'getRecordingStatus' });
    const isRecording = response && response.isRecording;
    
    // Track state changes more precisely
    const previousStatus = lastKnownRecordingStatus;
    lastKnownRecordingStatus = isRecording;
    
    if (isRecording) {
      statusElement.innerHTML = `
        <span class="spaces-recording-dot"></span>
        Recording Active
      `;
      statusElement.className = 'spaces-recording-indicator active';
      
      // If recording just started (transition from false/null to true), check if data should be cleared
      if (previousStatus === false || previousStatus === null) {
        console.log('Recording started - checking if this is a fresh start');
        
        // Check if we should wait for data clearing (fresh recording start)
        // vs immediate refresh (recording resumed or cross-window detection)
        const result = await chrome.storage.local.get(['recordedApiCalls']);
        const recordedApiCalls = result.recordedApiCalls || {};
        const hasExistingData = Object.keys(recordedApiCalls).some(tabId => 
          recordedApiCalls[tabId] && recordedApiCalls[tabId].length > 0
        );
        
        if (hasExistingData) {
          // Wait a moment for potential data clearing, then refresh
          setTimeout(async () => {
            console.log('Refreshing after recording start delay');
            await smartRefreshRecordedApisData();
          }, 500);
        } else {
          // No existing data, safe to refresh immediately
          console.log('No existing data, refreshing immediately');
          await smartRefreshRecordedApisData();
        }
      }
      
      // Set up auto-refresh if not already running
      if (!recordedApisRefreshInterval) {
        console.log('Starting auto-refresh interval');
        recordedApisRefreshInterval = setInterval(async () => {
          await smartRefreshRecordedApisData();
        }, 5000); // Refresh every 5 seconds (reduced from 2)
      }
    } else {
      statusElement.innerHTML = 'Recording Stopped';
      statusElement.className = 'spaces-recording-indicator inactive';
      
      // If recording just stopped, do one final refresh to get any remaining data
      if (previousStatus === true) {
        console.log('Recording stopped - doing final data refresh');
        await smartRefreshRecordedApisData();
      }
      
      // Clear auto-refresh interval but keep status checking
      if (recordedApisRefreshInterval) {
        console.log('Stopping auto-refresh interval');
        clearInterval(recordedApisRefreshInterval);
        recordedApisRefreshInterval = null;
      }
    }
  } catch (error) {
    console.error('Failed to get recording status:', error);
    // If we can't get recording status, assume not recording
    lastKnownRecordingStatus = false;
    statusElement.innerHTML = 'Recording Stopped';
    statusElement.className = 'spaces-recording-indicator inactive';
    
    if (recordedApisRefreshInterval) {
      clearInterval(recordedApisRefreshInterval);
      recordedApisRefreshInterval = null;
    }
  }
}

// Smart refresh that preserves page group collapse states
async function smartRefreshRecordedApisData() {
  try {
    // Get current data from recorded storage
    const result = await chrome.storage.local.get(['recordedApiCalls']);
    const recordedApiCalls = result.recordedApiCalls || {};
    
    // Create a hash of the current data to detect changes
    const currentDataHash = JSON.stringify(recordedApiCalls);
    
    console.log('Smart refresh check - Previous hash:', lastKnownDataHash ? 'exists' : 'null');
    console.log('Smart refresh check - Current hash length:', currentDataHash.length);
    console.log('Smart refresh check - Data changed:', currentDataHash !== lastKnownDataHash);
    
    // Only refresh if data actually changed
    if (currentDataHash !== lastKnownDataHash) {
      console.log('Data changed, refreshing display...');
      lastKnownDataHash = currentDataHash;
      
      // Store current expand states (since default is collapsed)
      const expandedStates = {};
      document.querySelectorAll('.spaces-page-group').forEach(group => {
        const pageId = group.querySelector('.spaces-page-header')?.getAttribute('data-page-id');
        const isExpanded = !group.querySelector('.spaces-page-content')?.classList.contains('collapsed');
        if (pageId && isExpanded) {
          expandedStates[pageId] = true;
        }
      });
      
      // Store response section collapse states
      const responseStates = {};
      document.querySelectorAll('.minimizable-content').forEach(responseContent => {
        const cardIndex = responseContent.getAttribute('data-card-index');
        const isCollapsed = responseContent.classList.contains('collapsed');
        if (cardIndex && isCollapsed) {
          responseStates[cardIndex] = true;
        }
      });
      
      console.log('Stored expanded states:', Object.keys(expandedStates));
      console.log('Stored response collapse states:', Object.keys(responseStates));
      
      // Refresh the data
      await displayRecordedApisData();
      
      // Restore expanded states using requestAnimationFrame for better timing
      requestAnimationFrame(() => {
        Object.keys(expandedStates).forEach(pageId => {
          const pageContent = document.querySelector(`.spaces-page-content[data-page-id="${pageId}"]`);
          const expandBtn = document.querySelector(`.spaces-expand-btn[data-page-id="${pageId}"]`);
          const runAllBtn = document.querySelector(`.spaces-run-all-btn[data-page-id="${pageId}"]`);
          
          if (pageContent && expandBtn && runAllBtn) {
            // Expand the previously expanded page groups
            pageContent.classList.remove('collapsed');
            expandBtn.classList.remove('collapsed');
            runAllBtn.classList.remove('collapsed');
            console.log('Restored expanded state for page:', pageId);
          }
        });
        
        // Restore response section collapse states
        Object.keys(responseStates).forEach(cardIndex => {
          const responseContent = document.querySelector(`.minimizable-content[data-card-index="${cardIndex}"]`);
          const minimizeBtn = document.querySelector(`.spaces-minimize-response-btn[data-card-index="${cardIndex}"]`);
          
          if (responseContent && minimizeBtn) {
            // Collapse the previously collapsed response sections
            responseContent.classList.add('collapsed');
            minimizeBtn.classList.add('collapsed');
            console.log('Restored collapsed state for response:', cardIndex);
          }
        });
      });
    } else {
      console.log('No data changes detected, skipping refresh');
    }
    
    // Always update the summary stats even if no new data
    await updateSummaryStats();
    
  } catch (error) {
    console.error('Smart refresh failed:', error);
  }
}

// Update just the summary statistics without rebuilding everything
async function updateSummaryStats() {
  try {
    const result = await chrome.storage.local.get(['recordedApiCalls']);
    const recordedApiCalls = result.recordedApiCalls || {};
    
    let totalCalls = 0;
    const pageUrls = new Set();
    
    // Count calls and pages (similar logic to displayRecordedApisData)
    Object.values(recordedApiCalls).forEach(calls => {
      if (Array.isArray(calls)) {
        calls.forEach(call => {
          if (call && call.url) {
            const pageUrl = call.pageUrl || 'unknown-page';
            // Filter out extension pages
            const isExtensionUrl = (
              pageUrl.startsWith('chrome-extension://') ||
              pageUrl.startsWith('moz-extension://') ||
              pageUrl.startsWith('extension://') ||
              pageUrl.includes('spacesAPIexplorer.html')
            );
            
            if (!isExtensionUrl) {
              pageUrls.add(pageUrl);
              totalCalls++;
            }
          }
        });
      }
    });
    
    // Update summary text
    const summaryText = document.querySelector('.spaces-summary-text');
    if (summaryText) {
      summaryText.textContent = `${pageUrls.size} pages visited, ${totalCalls} API calls recorded`;
    }
  } catch (error) {
    console.error('Failed to update summary stats:', error);
  }
}

// Continuous status monitoring with fallback
function startStatusMonitoring() {
  // Clear any existing interval
  if (statusCheckInterval) {
    clearInterval(statusCheckInterval);
  }
  
  // Check status every 3 seconds (slower than data refresh)
  statusCheckInterval = setInterval(async () => {
    await updateRecordingStatus();
  }, 3000);
  
  // Initial check
  updateRecordingStatus();
  
  // Add a backup storage-based monitoring in case message passing fails
  const backupMonitoringInterval = setInterval(async () => {
    try {
      const result = await chrome.storage.local.get(['isRecording']);
      const isRecording = result.isRecording || false;
      
      // Only update if there's a mismatch with our tracked state
      if (isRecording !== lastKnownRecordingStatus) {
        console.log('Backup monitoring detected status change:', isRecording);
        lastKnownRecordingStatus = isRecording;
        await updateRecordingStatus();
      }
    } catch (error) {
      console.error('Backup monitoring failed:', error);
    }
  }, 1000); // Check more frequently as backup
  
  // Store the backup interval for cleanup
  window.backupMonitoringInterval = backupMonitoringInterval;
}

// Set up event handlers for recorded APIs buttons
function setupRecordedApisButtons() {
  // Export JSON button
  const exportBtn = document.getElementById('export-recorded-apis');
  if (exportBtn) {
    exportBtn.addEventListener('click', async () => {
      try {
        const result = await chrome.storage.local.get(['recordedApiCalls']);
        const recordedApiCalls = result.recordedApiCalls || {};
        
        console.log('Export: recordedApiCalls:', recordedApiCalls);
        console.log('Export: markedPaths size:', markedPaths.size);
        console.log('Export: All markedPaths entries:');
        markedPaths.forEach((value, key) => {
          console.log('  markedPath:', key, '->', value);
        });
        
        // Flatten all API calls from all tabs into a single array
        const flattenedApiCalls = [];
        
        // First, group all calls by pageUrl to match the display logic
        const pageGroups = {};
        
        Object.entries(recordedApiCalls).forEach(([tabId, tabCalls]) => {
          if (Array.isArray(tabCalls)) {
            tabCalls.forEach((call, originalIndex) => {
              const pageUrl = call.pageUrl || call.tabUrl || 'unknown';
              if (!pageGroups[pageUrl]) {
                pageGroups[pageUrl] = [];
              }
              pageGroups[pageUrl].push({
                ...call,
                originalTabId: tabId,
                originalIndex: originalIndex
              });
            });
          }
        });
        
        // Now process each page group with the same cardIndex logic as display
        Object.entries(pageGroups).forEach(([pageUrl, calls]) => {
          calls.forEach((call, index) => {
            // Create simplified API call structure for scripting notes
            const exportCall = {
              method: call.method,
              url: call.url,
              pageUrl: call.pageUrl || call.tabUrl
            };
            
            // Add request data if available
            if (call.requestBody) {
              exportCall.requestBody = call.requestBody;
            }
            if (call.payload) {
              exportCall.payload = call.payload;
            }
            
            // Use the same cardIndex format as display: pageUrl-index
            const cardIndex = `${pageUrl}-${index}`;
            console.log('Export: Checking cardIndex:', cardIndex, '(original tabId was:', call.originalTabId, 'original index was:', call.originalIndex, ')');
            
            // Extract marked path values only
            const markedValues = extractMarkedPathValues(call, cardIndex);
            console.log('Export: marked values for', cardIndex, ':', markedValues);
            
            if (markedValues && Object.keys(markedValues).length > 0) {
              exportCall.markedValues = markedValues;
            }
            
            flattenedApiCalls.push(exportCall);
          });
        });
        
        const exportJson = JSON.stringify(flattenedApiCalls, null, 2);
        
        // Copy to clipboard instead of downloading
        await navigator.clipboard.writeText(exportJson);
        
        // Show success feedback
        const originalText = exportBtn.textContent;
        exportBtn.textContent = 'Copied!';
        setTimeout(() => {
          exportBtn.textContent = originalText;
        }, 2000);
      } catch (error) {
        console.error('Export failed:', error);
        const originalText = exportBtn.textContent;
        exportBtn.textContent = 'Error!';
        setTimeout(() => {
          exportBtn.textContent = originalText;
        }, 2000);
      }
    });
  }
  
  // Clear Data button  
  const clearBtn = document.getElementById('clear-recorded-apis');
  if (clearBtn) {
    clearBtn.addEventListener('click', async () => {
      const confirmed = await showConfirmModal(
        'Clear All Data',
        'Are you sure you want to clear all recorded API data? This action cannot be undone and will permanently delete all recorded API calls.',
        'Clear All Data'
      );
      if (confirmed) {
        await clearRecordedApis();
      }
    });
  }
}

// Enhanced function to extract comprehensive marked path information
function extractMarkedPathInformation(apiCall, cardIndex) {
  const result = {
    markedPaths: {},
    markedValues: {}
  };
  
  console.log('extractMarkedPathInformation: cardIndex:', cardIndex);
  console.log('extractMarkedPathInformation: apiCall has responseData:', !!apiCall.responseData);
  
  // Parse response data if available
  let responseData = null;
  if (apiCall.responseData) {
    try {
      responseData = typeof apiCall.responseData === 'string' 
        ? JSON.parse(apiCall.responseData) 
        : apiCall.responseData;
    } catch (e) {
      console.warn('Failed to parse response data for marked path extraction:', e);
      return result;
    }
  }
  
  // Find all marked paths for this specific card/API call
  markedPaths.forEach((pathData, pathId) => {
    console.log('extractMarkedPathInformation: Checking pathData:', pathData, 'against cardIndex:', cardIndex);
    if (pathData.cardIndex === cardIndex) {
      const pathStr = pathData.path;
      
      // Store the marked path metadata
      result.markedPaths[pathStr] = {
        key: pathData.key,
        timestamp: new Date().toISOString(),
        type: 'marked_favorite'
      };
      
      // Extract the actual value if response data is available
      if (responseData) {
        const value = getValueAtPath(responseData, pathStr);
        console.log('extractMarkedPathInformation: Found value for path:', pathStr, 'value:', value);
        
        if (value !== undefined) {
          result.markedValues[pathStr] = value;
        }
      }
    }
  });
  
  // Also include information about included paths (children of marked parents)
  const includedPathsForCard = [];
  includedPaths.forEach(includedId => {
    if (includedId.startsWith(`${cardIndex}-`) && !includedId.includes('_close_')) {
      const pathStr = includedId.replace(`${cardIndex}-`, '');
      includedPathsForCard.push(pathStr);
      
      // Mark these as included in the metadata
      if (!result.markedPaths[pathStr]) {
        result.markedPaths[pathStr] = {
          key: pathStr.split('.').pop(),
          timestamp: new Date().toISOString(),
          type: 'included_child'
        };
        
        // Extract values for included paths too
        if (responseData) {
          const value = getValueAtPath(responseData, pathStr);
          if (value !== undefined) {
            result.markedValues[pathStr] = value;
          }
        }
      }
    }
  });
  
  console.log('extractMarkedPathInformation: Final result:', result);
  return result;
}

// Helper function to extract values from response data based on marked paths (legacy support)
function extractMarkedPathValues(apiCall, cardIndex) {
  const datapaths = {};
  
  console.log('extractMarkedPathValues: cardIndex:', cardIndex);
  console.log('extractMarkedPathValues: apiCall keys:', Object.keys(apiCall));
  console.log('extractMarkedPathValues: apiCall has responseData:', !!apiCall.responseData);
  console.log('extractMarkedPathValues: responseData preview:', apiCall.responseData ? (typeof apiCall.responseData === 'string' ? apiCall.responseData.substring(0, 100) + '...' : 'object') : 'null');
  
  // Check if this API call has response data
  if (!apiCall.responseData) {
    console.log('extractMarkedPathValues: No responseData found for cardIndex:', cardIndex);
    
    // Check if we have any marked paths for this cardIndex anyway
    let hasMarkedPaths = false;
    markedPaths.forEach((pathData, pathId) => {
      if (pathData.cardIndex === cardIndex) {
        hasMarkedPaths = true;
        console.log('extractMarkedPathValues: Found marked path but no response data:', pathId, pathData);
      }
    });
    
    if (hasMarkedPaths) {
      console.log('extractMarkedPathValues: Has marked paths but no response data - this might be the issue');
    }
    
    return datapaths;
  }
  
  let responseData;
  try {
    responseData = typeof apiCall.responseData === 'string' 
      ? JSON.parse(apiCall.responseData) 
      : apiCall.responseData;
  } catch (e) {
    console.warn('Failed to parse response data for export:', e);
    return datapaths;
  }
  
  console.log('extractMarkedPathValues: responseData parsed successfully');
  
  // Find all marked paths for this specific card/API call
  markedPaths.forEach((pathData, pathId) => {
    console.log('extractMarkedPathValues: Checking pathData:', pathData, 'against cardIndex:', cardIndex);
    if (pathData.cardIndex === cardIndex) {
      const pathStr = pathData.path;
      const value = getValueAtPath(responseData, pathStr);
      
      console.log('extractMarkedPathValues: Found matching path:', pathStr, 'value:', value);
      
      if (value !== undefined) {
        datapaths[pathStr] = value;
      }
    }
  });
  
  console.log('extractMarkedPathValues: Final datapaths:', datapaths);
  return datapaths;
}

// Helper function to get value at a specific JSON path
function getValueAtPath(obj, path) {
  if (!path || !obj) return undefined;
  
  const pathParts = path.split('.');
  let current = obj;
  
  for (const part of pathParts) {
    if (current === null || current === undefined) {
      return undefined;
    }
    
    // Handle array indices
    if (Array.isArray(current) && !isNaN(part)) {
      current = current[parseInt(part)];
    } else if (typeof current === 'object' && current.hasOwnProperty(part)) {
      current = current[part];
    } else {
      return undefined;
    }
  }
  
  return current;
}

// Recorded APIs functionality - SINGLE DATA SOURCE: recordedApiCalls
async function displayRecordedApisData() {
  // Initialize with safe defaults
  document.getElementById('recorded-apis-metadata').innerHTML = '<p>Loading...</p>';
  document.getElementById('recorded-apis-output').innerHTML = '<p>Loading data...</p>';
  
  try {
    // Get both API data and recording status from appropriate storage locations
    const result = await chrome.storage.local.get(['recordedApiCalls', 'isRecording']);
    const recordedApiCalls = result.recordedApiCalls || {};
    const isRecording = !!result.isRecording;
    
    console.log('Raw recordedApiCalls data:', recordedApiCalls);
    console.log('Recording status:', isRecording);
    
    // Check if we have any API calls
    const hasApiCalls = Object.keys(recordedApiCalls).length > 0;
    
    if (!hasApiCalls && !isRecording) {
      // No data and not recording - show start message
      document.getElementById('recorded-apis-metadata').innerHTML = '<p>No API calls recorded.</p>';
      document.getElementById('recorded-apis-output').innerHTML = '<p>Start recording to see API calls here.</p>';
      return;
    }
    
    if (!hasApiCalls && isRecording) {
      // Recording active but no data yet - show recording status
      document.getElementById('recorded-apis-metadata').innerHTML = `
        <div class="spaces-recording-status-container">
          <span id="recording-status" class="spaces-recording-indicator active">Recording Active</span>
          <p>Recording API calls... No calls captured yet.</p>
        </div>
      `;
      document.getElementById('recorded-apis-output').innerHTML = '<p>Waiting for API calls to be made...</p>';
      return;
    }
    
    if (hasApiCalls && !isRecording) {
      // Has data and recording stopped - show stopped status with data
      // Will continue to normal data display logic below
    } else if (hasApiCalls && isRecording) {
      // Has data and still recording - show active status with data
      // Will continue to normal data display logic below
    }
    
    // Process raw data into page groups
    const pageGroups = {};
    const pageUrls = new Set();
    let totalCalls = 0;
    
    const tabIds = Object.keys(recordedApiCalls);
    
    for (const tabId of tabIds) {
      const calls = recordedApiCalls[tabId];
      
      if (Array.isArray(calls)) {
        totalCalls += calls.length;
        calls.forEach((call, index) => {
          if (call && call.url) {
            const pageUrl = call.pageUrl || 'unknown-page';
            
            // Filter out extension pages (chrome-extension://, moz-extension://, etc.)
            if (pageUrl.startsWith('chrome-extension://') || 
                pageUrl.startsWith('moz-extension://') || 
                pageUrl.startsWith('extension://') ||
                pageUrl.includes('spacesAPIexplorer.html')) {
              return; // Skip this call
            }
            
            pageUrls.add(pageUrl);
            
            if (!pageGroups[pageUrl]) {
              pageGroups[pageUrl] = [];
            }
            pageGroups[pageUrl].push({
              ...call,
              tabId: tabId,
              callIndex: index
            });
          }
        });
      }
    }
    
    if (totalCalls === 0) {
      document.getElementById('recorded-apis-metadata').innerHTML = '<p>No valid API calls found.</p>';
      document.getElementById('recorded-apis-output').innerHTML = '<p>No data to display.</p>';
      return;
    }
    
    // Create compact metadata with inline buttons and recording status
    const recordingStatusText = isRecording ? 'Recording Active' : 'Recording Stopped';
    const recordingStatusClass = isRecording ? 'active' : 'inactive';
    
    const metadataHtml = `
      <div class="spaces-recording-summary">
        <div class="spaces-summary-content">
          <div class="spaces-summary-line">
            <span class="spaces-summary-text">
              ${pageUrls.size} pages visited, ${totalCalls} API calls recorded
            </span>
            <span id="recording-status" class="spaces-recording-indicator ${recordingStatusClass}">${recordingStatusText}</span>
            <div class="spaces-summary-actions">
              <button id="export-recorded-apis" class="spaces-btn spaces-btn-secondary spaces-btn-small">Export JSON</button>
              <button id="clear-recorded-apis" class="spaces-btn spaces-btn-danger spaces-btn-small">Clear Data</button>
            </div>
          </div>
        </div>
      </div>
    `;
    document.getElementById('recorded-apis-metadata').innerHTML = metadataHtml;
    
    // Initialize data hash for smart refresh
    lastKnownDataHash = JSON.stringify(recordedApiCalls);
    
    // Set up event handlers for the new buttons
    setupRecordedApisButtons();
    
    // Start continuous status monitoring
    startStatusMonitoring();
    
    // Display API calls grouped by page
    let outputHtml = '';
    for (const [pageUrl, calls] of Object.entries(pageGroups)) {
      const pageId = pageUrl.replace(/[^a-zA-Z0-9]/g, '_'); // Create safe ID for page
      outputHtml += `
        <div class="spaces-page-group" data-page-url="${pageUrl}">
          <div class="spaces-page-header" data-page-id="${pageId}">
            <div class="spaces-page-header-content">
              <h3 class="spaces-page-title">
                Page: ${pageUrl === 'unknown-page' ? 'Unknown Page' : pageUrl}
                <button class="delete-btn page-delete-btn" data-page-url="${pageUrl}" title="Delete this page group">
                  <svg width="16" height="16" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="#dc2626" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M3 6h18"/>
                    <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/>
                    <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
                    <line x1="10" y1="11" x2="10" y2="17"/>
                    <line x1="14" y1="11" x2="14" y2="17"/>
                  </svg>
                </button>
              </h3>
              <p class="spaces-page-info">${calls.length} API call${calls.length !== 1 ? 's' : ''}</p>
            </div>
            <div class="spaces-page-header-buttons">
              <button class="spaces-btn spaces-btn-warning spaces-btn-small spaces-run-all-btn collapsed" data-page-id="${pageId}">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <polygon points="5,3 19,12 5,21"/>
                </svg>
                Run All
              </button>
              <button class="spaces-expand-btn collapsed" data-page-id="${pageId}">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                  <path d="m6 9 6 6 6-6"/>
                </svg>
              </button>
            </div>
          </div>
          <div class="spaces-page-content collapsed" data-page-id="${pageId}">
      `;
      
      calls.forEach((call, index) => {
        const cardIndex = `${pageUrl}-${index}`; // Use array index for consistency
        try {
          outputHtml += createApiCallCard(call, cardIndex, pageUrl);
        } catch (e) {
          console.error('Error creating card for call:', call, e);
          outputHtml += `<div class="error-card">Error displaying call: ${e.message}</div>`;
        }
      });
      
      outputHtml += '</div></div>'; // Close spaces-page-content and spaces-page-group
    }
    
    document.getElementById('recorded-apis-output').innerHTML = outputHtml;
    
    // Set up all event handlers for the dynamically created elements
    setupEventHandlers();
    
    // Update marked paths display for all response headers
    updateMarkedPathsDisplay();
    
    // Defer cleanup until after JSON content has had time to render
    setTimeout(() => {
      console.log('Running deferred cleanup after JSON render...');
      forceCleanupMarkedPaths();
    }, 1000); // Give JSON rendering time to complete
    
  } catch (error) {
    console.error('Error displaying recorded APIs:', error);
    console.error('Error stack:', error.stack);
    document.getElementById('recorded-apis-metadata').innerHTML = `<p>Error loading recorded APIs data: ${error.message}</p>`;
    document.getElementById('recorded-apis-output').innerHTML = `<p>Error details: ${error.stack}</p>`;
  }
}

// Set up event handlers for dynamically created elements
function setupEventHandlers() {
  // Add replay button handlers
  document.querySelectorAll('.replay-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const callData = JSON.parse(btn.getAttribute('data-call'));
      const cardIndex = btn.getAttribute('data-card-index');
      replayApiCall(callData, cardIndex);
    });
  });
  
  // Add expand/collapse button handlers
  document.querySelectorAll('.spaces-expand-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const pageId = btn.getAttribute('data-page-id');
      const pageContent = document.querySelector(`.spaces-page-content[data-page-id="${pageId}"]`);
      const runAllBtn = document.querySelector(`.spaces-run-all-btn[data-page-id="${pageId}"]`);
      
      // Toggle the collapsed state
      const isCurrentlyCollapsed = pageContent.classList.contains('collapsed');
      
      if (isCurrentlyCollapsed) {
        // Currently collapsed, so expand it
        pageContent.classList.remove('collapsed');
        btn.classList.remove('collapsed');
        runAllBtn.classList.remove('collapsed');
      } else {
        // Currently expanded, so collapse it
        pageContent.classList.add('collapsed');
        btn.classList.add('collapsed');
        runAllBtn.classList.add('collapsed');
      }
    });
  });
  
  // Add "Run All" button handlers
  const runAllButtons = document.querySelectorAll('.spaces-run-all-btn');
  
  runAllButtons.forEach((btn, index) => {
    btn.addEventListener('click', async () => {
      const pageId = btn.getAttribute('data-page-id');
      
      // Pause auto-refresh during Run All execution
      clearInterval(recordedApisRefreshInterval);
      recordedApisRefreshInterval = null;
      
      // Get current recorded data from storage
      const result = await chrome.storage.local.get(['recordedApiCalls']);
      const recordedApiCalls = result.recordedApiCalls || {};
      
      // Disable the button during execution
      btn.disabled = true;
      btn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 12a9 9 0 11-6.219-8.56"/>
        </svg>
        Running...
      `;
      
      try {
        // Reconstruct page groups from raw data
        const pageGroups = {};
        const tabIds = Object.keys(recordedApiCalls);
        
        for (const tabId of tabIds) {
          const calls = recordedApiCalls[tabId];
          if (Array.isArray(calls)) {
            calls.forEach((call) => {
              if (call && call.url) {
                const pageUrl = call.pageUrl || 'unknown-page';
                
                // Filter out extension pages (chrome-extension://, moz-extension://, etc.)
                if (pageUrl.startsWith('chrome-extension://') || 
                    pageUrl.startsWith('moz-extension://') || 
                    pageUrl.startsWith('extension://') ||
                    pageUrl.includes('spacesAPIexplorer.html')) {
                  return; // Skip this call
                }
                
                if (!pageGroups[pageUrl]) {
                  pageGroups[pageUrl] = [];
                }
                pageGroups[pageUrl].push(call);
              }
            });
          }
        }
        
        // Find the matching page
        let pageCalls = null;
        let matchedPageUrl = null;
        
        for (const [pageUrl, calls] of Object.entries(pageGroups)) {
          const currentPageId = pageUrl.replace(/[^a-zA-Z0-9]/g, '_');
          if (currentPageId === pageId) {
            pageCalls = calls;
            matchedPageUrl = pageUrl;
            console.log(`Found page: ${pageUrl}`);
            break;
          }
        }
        
        if (pageCalls && pageCalls.length > 0) {
          console.log(`Starting execution of ${pageCalls.length} API calls`);
          
          // Execute each API call with delays
          for (let i = 0; i < pageCalls.length; i++) {
            const call = pageCalls[i];
            const cardIndex = `${matchedPageUrl}-${i}`;
            
            // Update button text to show progress
            btn.innerHTML = `
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 12a9 9 0 11-6.219-8.56"/>
              </svg>
              Running ${i + 1}/${pageCalls.length}
            `;
            
            // Find and click the execute button for this API call
            const executeBtn = document.querySelector(`.replay-btn[data-card-index="${cardIndex}"]`);
            if (executeBtn) {
              await replayApiCall(call, cardIndex, executeBtn, true); // Pass true to collapse response by default
            } else {
              console.warn(`Execute button not found for card index: ${cardIndex}`);
            }
            
            // Add delay between calls
            if (i < pageCalls.length - 1) {
              await new Promise(resolve => setTimeout(resolve, 1000));
            }
          }
        } else {
          console.warn(`No API calls found for page ID: ${pageId}`);
        }
      } catch (error) {
        console.error('Error running all API calls:', error);
      } finally {
        // Re-enable button and restore original text
        btn.disabled = false;
        btn.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="5,3 19,12 5,21"/>
          </svg>
          Run All
        `;
        
        // Resume auto-refresh after Run All completion
        startAutoRefresh();
        
        // Don't refresh immediately - let the final responses settle
        console.log('Run All completed for page:', pageId);
      }
    });
  });
  
  // Add copy response button handlers
  document.querySelectorAll('.spaces-copy-response-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const encodedResponse = btn.getAttribute('data-response');
      const responseData = JSON.parse(decodeURIComponent(encodedResponse));
      await copyToClipboard(responseData, btn);
    });
  });
  
  // Add copy call button handlers
  document.querySelectorAll('.spaces-copy-call-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const callData = JSON.parse(btn.getAttribute('data-call'));
      const copyText = formatCallForCopy(callData);
      await copyToClipboard(copyText, btn);
    });
  });
  
  // Add edit payload button handlers
  document.querySelectorAll('.spaces-edit-payload-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const cardIndex = btn.getAttribute('data-card-index');
      togglePayloadEdit(cardIndex);
    });
  });
  
  // Add minimize response button handlers
  document.querySelectorAll('.spaces-minimize-response-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const cardIndex = btn.getAttribute('data-card-index');
      toggleResponseCollapse(cardIndex);
    });
  });
  
  // Add delete button handlers for page groups
  const pageDeleteBtns = document.querySelectorAll('.page-delete-btn');
  pageDeleteBtns.forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation(); // Prevent triggering expand/collapse
      const pageUrl = btn.getAttribute('data-page-url');
      const confirmed = await showConfirmModal(
        'Delete Page Group',
        `Are you sure you want to delete all API calls for page: ${pageUrl}? This action cannot be undone.`,
        'Delete Page'
      );
      if (confirmed) {
        await deletePageGroup(pageUrl);
      }
    });
  });
  
  // Add delete button handlers for individual API calls
  const callDeleteBtns = document.querySelectorAll('.call-delete-btn');
  callDeleteBtns.forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation(); // Prevent triggering any parent actions
      const cardIndex = btn.getAttribute('data-card-index');
      const pageUrl = btn.getAttribute('data-page-url');
      
      // Check if this is the only API call for this page
      const checkResult = await chrome.storage.local.get(['recordedApiCalls']);
      const checkData = checkResult.recordedApiCalls || {};
      
      let callsForThisPage = 0;
      for (const [tabId, calls] of Object.entries(checkData)) {
        if (Array.isArray(calls)) {
          callsForThisPage += calls.filter(call => call.pageUrl === pageUrl).length;
        }
      }
      
      let confirmed;
      if (callsForThisPage === 1) {
        // This is the last call for this page - use the comprehensive modal
        confirmed = await showConfirmModal(
          'Delete Last API Call',
          `This is the only API call for page "${pageUrl}".\n\nDeleting it will also remove the entire page group.\n\nAre you sure you want to continue?`,
          'Delete Call & Page'
        );
      } else {
        // Regular API call deletion modal
        confirmed = await showConfirmModal(
          'Delete API Call',
          'Are you sure you want to delete this API call? This action cannot be undone.',
          'Delete Call'
        );
      }
      
      if (confirmed) {
        await deleteApiCall(cardIndex, pageUrl);
      }
    });
  });
  
  // Initialize interactive JSON displays
  document.querySelectorAll('.json-interactive').forEach(container => {
    const encodedJson = container.getAttribute('data-json-content');
    if (encodedJson && !container.querySelector('.json-interactive-content')) {
      // Only initialize if not already initialized (to avoid resetting state)
      const jsonData = JSON.parse(decodeURIComponent(encodedJson));
      
      // Find the card index from the parent API call card
      const apiCard = container.closest('.spaces-api-call-card');
      const cardIndex = apiCard ? apiCard.getAttribute('data-card-index') : null;
      
      renderInteractiveJSON(container, jsonData, cardIndex);
    }
  });
}

// Helper function to start auto-refresh
function startAutoRefresh() {
  if (!recordedApisRefreshInterval) {
    console.log('Starting auto-refresh interval after Run All');
    recordedApisRefreshInterval = setInterval(async () => {
      await smartRefreshRecordedApisData();
    }, 5000); // Refresh every 5 seconds
  }
}

// Clear recorded APIs functionality - Clear both storage systems
async function clearRecordedApis() {
  console.log('=== CLEAR RECORDED APIS CLICKED ===');
  
  try {
    // Clear BOTH recording and tracking storage keys while preserving other settings
    const keysToRemove = ['recordedApiCalls', 'trackedApiCalls', 'markedPaths'];
    await chrome.storage.local.remove(keysToRemove);
    console.log('Recording and tracking storage cleared successfully');
    
    // Clear in-memory marked paths
    markedPaths.clear();
    
    // Update UI
    document.getElementById('recorded-apis-metadata').innerHTML = '<p>Recorded APIs data cleared.</p>';
    document.getElementById('recorded-apis-output').innerHTML = '<p>No data to display.</p>';
    
    // Show success toast
    showSuccessToast('Data Cleared', 'All recorded API data has been successfully cleared.');
    
    // Update button temporarily
    const clearBtn = document.querySelector('.spaces-clear-btn, #clear-recorded-apis');
    if (clearBtn) {
      const originalText = clearBtn.textContent;
      clearBtn.textContent = 'Cleared!';
      clearBtn.disabled = true;
      
      setTimeout(() => {
        clearBtn.textContent = originalText;
        clearBtn.disabled = false;
      }, 2000);
    }
  } catch (error) {
    console.error('Error clearing recorded APIs:', error);
    
    // Show error toast
    showErrorToast('Clear Failed', 'Failed to clear recorded data. Please try again.');
    
    const clearBtn = document.querySelector('.spaces-clear-btn, #clear-recorded-apis');
    if (clearBtn) {
      clearBtn.textContent = 'Error!';
      setTimeout(() => {
        clearBtn.textContent = 'Clear Data';
      }, 2000);
    }
  }
}

// Delete functionality for page groups and individual API calls
async function deletePageGroup(pageUrl) {
  try {
    console.log(`Deleting page group: ${pageUrl}`);
    
    // Get current data from both storage locations
    const result = await chrome.storage.local.get(['recordedApiCalls', 'trackedApiCalls']);
    const recordedApiCalls = result.recordedApiCalls || {};
    const trackedApiCalls = result.trackedApiCalls || {};
    
    // Function to process deletion for a specific storage object
    const processStorageDeletion = (storageData) => {
      const updatedData = {};
      for (const [tabId, calls] of Object.entries(storageData)) {
        const filteredCalls = calls.filter(call => call.pageUrl !== pageUrl);
        if (filteredCalls.length > 0) {
          updatedData[tabId] = filteredCalls;
        }
      }
      return updatedData;
    };
    
    // Process deletion for both storage systems
    const updatedRecordedData = processStorageDeletion(recordedApiCalls);
    const updatedTrackedData = processStorageDeletion(trackedApiCalls);
    
    // Save updated data to both storage locations
    await chrome.storage.local.set({ 
      recordedApiCalls: updatedRecordedData,
      trackedApiCalls: updatedTrackedData
    });
    console.log(`Page group ${pageUrl} deleted from both storage systems`);
    
    // Remove the DOM element instead of full refresh
    const pageGroup = document.querySelector(`[data-page-url="${pageUrl}"]`);
    if (pageGroup) {
      // Animate out the page group
      pageGroup.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
      pageGroup.style.opacity = '0';
      pageGroup.style.transform = 'translateY(-20px)';
      
      setTimeout(() => {
        pageGroup.remove();
      }, 300);
    }
    
    // Show success toast
    showSuccessToast('Page Deleted', `All API calls for page ${pageUrl} have been deleted.`);
  } catch (error) {
    console.error('Error deleting page group:', error);
    showErrorToast('Delete Failed', 'Error deleting page group. Please try again.');
  }
}

async function deleteApiCall(cardIndex, pageUrl) {
  try {
    console.log(`Deleting API call: ${cardIndex} from page: ${pageUrl}`);
    
    // Extract the index from cardIndex (format: pageUrl-index)
    const parts = cardIndex.split('-');
    const callIndex = parseInt(parts[parts.length - 1]);
    
    // Get current data from both storage locations
    const result = await chrome.storage.local.get(['recordedApiCalls', 'trackedApiCalls']);
    const recordedApiCalls = result.recordedApiCalls || {};
    const trackedApiCalls = result.trackedApiCalls || {};
    
    // Function to process deletion for a specific storage object
    const processStorageDeletion = (storageData) => {
      let callFound = false;
      const updatedData = {};
      
      for (const [tabId, calls] of Object.entries(storageData)) {
        if (!Array.isArray(calls)) continue;
        
        // Group calls by pageUrl within this tab
        const callsByPageUrl = {};
        calls.forEach((call, index) => {
          const pageUrlKey = call.pageUrl || 'unknown-page';
          if (!callsByPageUrl[pageUrlKey]) {
            callsByPageUrl[pageUrlKey] = [];
          }
          callsByPageUrl[pageUrlKey].push({ call, originalIndex: index });
        });
        
        // Find the specific call within the page group
        const pageGroup = callsByPageUrl[pageUrl];
        let callToRemoveIndex = -1;
        
        if (pageGroup && pageGroup.length > callIndex) {
          callToRemoveIndex = pageGroup[callIndex].originalIndex;
          callFound = true;
        }
        
        // Create filtered calls array
        const filteredCalls = calls.filter((call, index) => {
          return index !== callToRemoveIndex;
        });
        
        if (filteredCalls.length > 0) {
          updatedData[tabId] = filteredCalls;
        }
      }
      
      return { updatedData, callFound };
    };
    
    // Process deletion for both storage systems
    const recordedResult = processStorageDeletion(recordedApiCalls);
    const trackedResult = processStorageDeletion(trackedApiCalls);
    
    if (recordedResult.callFound || trackedResult.callFound) {
      // Save updated data to both storage locations
      await chrome.storage.local.set({ 
        recordedApiCalls: recordedResult.updatedData,
        trackedApiCalls: trackedResult.updatedData
      });
      console.log(`API call ${cardIndex} deleted from both storage systems`);
      
      // Clean up marked paths for this specific card before DOM removal
      const pathsToRemove = [];
      const pathsToUpdate = [];
      
      markedPaths.forEach((data, id) => {
        if (data.cardIndex === cardIndex || data.cardIndex === `${cardIndex}-live`) {
          pathsToRemove.push(id);
        } else {
          // Check if this marked path is from the same page and has a higher index
          const pathPageUrl = data.cardIndex.split('-').slice(0, -1).join('-');
          const pathIndexStr = data.cardIndex.split('-').pop();
          const pathIndex = parseInt(pathIndexStr);
          
          if (pathPageUrl === pageUrl && !isNaN(pathIndex) && pathIndex > callIndex) {
            // This marked path needs to have its index decremented
            pathsToUpdate.push({
              id: id,
              data: data,
              newIndex: pathIndex - 1
            });
          }
        }
      });
      
      // Remove marked paths for the deleted card
      pathsToRemove.forEach(id => markedPaths.delete(id));
      
      // Update marked paths that had higher indices
      pathsToUpdate.forEach(({ id, data, newIndex }) => {
        const newCardIndex = `${pageUrl}-${newIndex}`;
        markedPaths.delete(id);
        
        // Create new marked path entry with updated cardIndex
        const newPathId = `${newCardIndex}-${data.path}`;
        markedPaths.set(newPathId, {
          ...data,
          cardIndex: newCardIndex
        });
        console.log(`Updated marked path from ${data.cardIndex} to ${newCardIndex}`);
      });
      
      const totalPathsModified = pathsToRemove.length + pathsToUpdate.length;
      if (totalPathsModified > 0) {
        console.log(`Removed ${pathsToRemove.length} marked paths and updated ${pathsToUpdate.length} marked path indices for deleted card ${cardIndex}`);
        saveMarkedPathsImmediate(); // Use immediate save for deletion
      }
      
      // Remove the DOM element instead of full refresh
      const apiCard = document.querySelector(`[data-card-index="${cardIndex}"]`);
      if (apiCard) {
        // Find the parent page group to update counts
        const pageGroup = apiCard.closest('.spaces-page-group');
        if (pageGroup) {
          // Remove the API card with animation
          apiCard.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
          apiCard.style.opacity = '0';
          apiCard.style.transform = 'translateX(-20px)';
          
          setTimeout(() => {
            apiCard.remove();
            
            // Update the page info count
            const pageInfo = pageGroup.querySelector('.spaces-page-info');
            const remainingCards = pageGroup.querySelectorAll('.spaces-api-call-card');
            const count = remainingCards.length;
            
            if (count === 0) {
              // No more calls in this page group, remove the entire group
              pageGroup.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
              pageGroup.style.opacity = '0';
              pageGroup.style.transform = 'translateY(-20px)';
              setTimeout(() => pageGroup.remove(), 300);
            } else {
              // Update the count
              if (pageInfo) {
                pageInfo.textContent = `${count} API call${count !== 1 ? 's' : ''}`;
              }
            }
          }, 300);
        }
      }
      
      // Show success toast
      showSuccessToast('API Call Deleted', 'The API call has been successfully deleted.');
    } else {
      console.warn(`API call ${cardIndex} not found for deletion`);
      showErrorToast('Delete Failed', 'API call not found. It may have already been deleted.');
    }
    
  } catch (error) {
    console.error('Error deleting API call:', error);
    showErrorToast('Delete Failed', 'Error deleting API call. Please try again.');
  }
}

// UTILITY FUNCTIONS

// Helper function to safely stringify JSON for HTML attributes
function safeJSONStringify(obj) {
  try {
    const jsonString = JSON.stringify(obj);
    // Remove control characters (0x00-0x1F and 0x7F-0x9F) that can break JSON parsing
    return jsonString.replace(/[\x00-\x1F\x7F-\x9F]/g, '');
  } catch (error) {
    console.warn('JSON stringify failed, using fallback:', error);
    return JSON.stringify({ 
      error: 'Failed to serialize response', 
      original_error: error.message,
      data_type: typeof obj
    });
  }
}

// Helper function to clean response text before JSON parsing
function cleanResponseText(responseText) {
  // Remove null bytes, control characters, and other problematic characters
  return responseText
    .replace(/\x00/g, '') // Remove null bytes
    .replace(/[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // Remove control characters except \t \n \r
    .replace(/\r\n/g, '\n') // Normalize line endings
    .replace(/\r/g, '\n'); // Convert remaining \r to \n
}

// Copy API call to clipboard
async function replayApiCall(callData, cardIndex, button = null, collapseResponse = false) {
  try {
    const replayBtn = button || document.querySelector(`.replay-btn[data-card-index="${cardIndex}"]`);
    if (replayBtn) {
      replayBtn.disabled = true;
      replayBtn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 12a9 9 0 11-6.219-8.56"/>
        </svg>
        Running...
      `;
    }
    
    // Use the unified API execution function
    const responseData = await executeApiCall(callData, cardIndex);
    
    // Update the card with new response data
    const card = document.querySelector(`[data-card-index="${cardIndex}"]`);
    
    // Store response data persistently in chrome storage
    try {
      // Parse cardIndex to get pageUrl and index
      const parts = cardIndex.split('-');
      const callIndex = parseInt(parts[parts.length - 1]);
      const pageUrl = parts.slice(0, -1).join('-');
      
      // Get current storage data and update the specific API call
      chrome.storage.local.get(['recordedApiCalls', 'trackedApiCalls'], (result) => {
        const recordedApiCalls = result.recordedApiCalls || {};
        const trackedApiCalls = result.trackedApiCalls || {};
        
        // Function to update calls in a storage object
        const updateStorageCalls = (storageData) => {
          Object.keys(storageData).forEach(tabId => {
            if (Array.isArray(storageData[tabId])) {
              const calls = storageData[tabId];
              
              // Group calls by pageUrl within this tab
              const callsByPageUrl = {};
              calls.forEach((call, index) => {
                const pageUrlKey = call.pageUrl || 'unknown-page';
                if (!callsByPageUrl[pageUrlKey]) {
                  callsByPageUrl[pageUrlKey] = [];
                }
                callsByPageUrl[pageUrlKey].push({ call, originalIndex: index });
              });
              
              // Find the specific call within the page group
              const pageGroup = callsByPageUrl[pageUrl];
              if (pageGroup && pageGroup.length > callIndex) {
                const targetCall = pageGroup[callIndex];
                // Store the response data, status, and timestamp in the API call
                targetCall.call.responseData = responseData.responseData;
                targetCall.call.responseStatus = responseData.statusCode;
                targetCall.call.responseTimestamp = responseData.timestamp;
                console.log('Stored responseData for API call:', targetCall.call.url);
              }
            }
          });
        };
        
        // Update both storage systems
        updateStorageCalls(recordedApiCalls);
        updateStorageCalls(trackedApiCalls);
        
        // Save the updated data back to storage
        chrome.storage.local.set({ recordedApiCalls, trackedApiCalls }, () => {
          console.log('Response data saved to both storage systems');
        });
      });
    } catch (storageError) {
      console.warn('Failed to store response data persistently:', storageError);
    }
    
    if (card) {
      const responseSection = card.querySelector('.response-section');
      const detailsDiv = card.querySelector('.spaces-call-details');
      
      if (responseSection) {
        // Update existing response section
        responseSection.innerHTML = `
          <div class="response-header">
            <div class="response-header-left">
              <strong>Response:</strong>
              <span class="response-status-info">
                ${responseData.statusCode} - ${responseData.timestamp}
              </span>
            </div>
            <div class="response-header-right">
              <span class="marked-paths-indicator" id="marked-count-${cardIndex}-live">
                <span class="marked-count">0</span> path(s) marked
              </span>
              <div class="response-actions">
                <button class="spaces-btn spaces-btn-info spaces-btn-small spaces-copy-response-btn" data-response='${encodeURIComponent(safeJSONStringify(responseData.responseData))}'>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M9 9V6.2002C9 5.08009 9 4.51962 9.21799 4.0918C9.40973 3.71547 9.71547 3.40973 10.0918 3.21799C10.5196 3 11.0801 3 12.2002 3H17.8002C18.9203 3 19.4801 3 19.9079 3.21799C20.2842 3.40973 20.5905 3.71547 20.7822 4.0918C21.0002 4.51962 21.0002 5.07967 21.0002 6.19978V11.7998C21.0002 12.9199 21.0002 13.48 20.7822 13.9078C20.5905 14.2841 20.2839 14.5905 19.9076 14.7822C19.4802 15 18.921 15 17.8031 15H15M9 9H6.2002C5.08009 9 4.51962 9 4.0918 9.21799C3.71547 9.40973 3.40973 9.71547 3.21799 10.0918C3 10.5196 3 11.0801 3 12.2002V17.8002C3 18.9203 3 19.4801 3.21799 19.9079C3.40973 20.2842 3.71547 20.5905 4.0918 20.7822C4.5192 21 5.07899 21 6.19691 21H11.8036C12.9215 21 13.4805 21 13.9079 20.7822C14.2842 20.5905 14.5905 20.2839 14.7822 19.9076C15 19.4802 15 18.921 15 17.8031V15M9 9H11.8002C12.9203 9 13.4801 9 13.9079 9.21799C14.2842 9.40973 14.5905 9.71547 14.7822 10.0918C15 10.5192 15 11.079 15 12.1969L15 15" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                </button>
                <button class="spaces-btn spaces-btn-ghost spaces-btn-small spaces-minimize-response-btn ${collapseResponse ? 'collapsed' : ''}" data-card-index="${cardIndex}-live">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="m6 9 6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                </button>
              </div>
            </div>
          </div>
          <div class="response-content minimizable-content ${collapseResponse ? 'collapsed' : ''}" data-card-index="${cardIndex}-live">
            <div class="json-interactive" data-json-content="${encodeURIComponent(safeJSONStringify(responseData.responseData))}"></div>
          </div>
        `;        // Re-setup event handlers for the new response section
        setupResponseEventHandlers(responseSection);
        
        // Initialize JSON display
        const jsonContainer = responseSection.querySelector('.json-interactive');
        if (jsonContainer) {
          renderInteractiveJSON(jsonContainer, responseData.responseData, `${cardIndex}-live`);
          // Update marked paths display after rendering
          setTimeout(() => updateMarkedPathsDisplay(), 100);
        }
      } else {
        // Clear any placeholder text and add response section  
        const detailsDiv = card.querySelector('.spaces-call-details');
        if (detailsDiv) {
          const placeholderText = detailsDiv.querySelector('p em');
          if (placeholderText && placeholderText.textContent.includes('Click Execute')) {
            placeholderText.parentElement.remove();
          }
          const responseHtml = `
            <div class="response-section">
              <div class="response-header">
                <div class="response-header-left">
                  <strong>Response:</strong>
                  <span class="response-status-info">
                    ${responseData.statusCode} - ${responseData.timestamp}
                  </span>
                </div>
                <div class="response-header-right">
                  <span class="marked-paths-indicator" id="marked-count-${cardIndex}-live">
                    <span class="marked-count">0</span> path(s) marked
                  </span>
                  <div class="response-actions">
                    <button class="spaces-btn spaces-btn-info spaces-btn-small spaces-copy-response-btn" data-response='${encodeURIComponent(safeJSONStringify(responseData))}'>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M9 9V6.2002C9 5.08009 9 4.51962 9.21799 4.0918C9.40973 3.71547 9.71547 3.40973 10.0918 3.21799C10.5196 3 11.0801 3 12.2002 3H17.8002C18.9203 3 19.4801 3 19.9079 3.21799C20.2842 3.40973 20.5905 3.71547 20.7822 4.0918C21.0002 4.51962 21.0002 5.07967 21.0002 6.19978V11.7998C21.0002 12.9199 21.0002 13.48 20.7822 13.9078C20.5905 14.2841 20.2839 14.5905 19.9076 14.7822C19.4802 15 18.921 15 17.8031 15H15M9 9H6.2002C5.08009 9 4.51962 9 4.0918 9.21799C3.71547 9.40973 3.40973 9.71547 3.21799 10.0918C3 10.5196 3 11.0801 3 12.2002V17.8002C3 18.9203 3 19.4801 3.21799 19.9079C3.40973 20.2842 3.71547 20.5905 4.0918 20.7822C4.5192 21 5.07899 21 6.19691 21H11.8036C12.9215 21 13.4805 21 13.9079 20.7822C14.2842 20.5905 14.5905 20.2839 14.7822 19.9076C15 19.4802 15 18.921 15 17.8031V15M9 9H11.8002C12.9203 9 13.4801 9 13.9079 9.21799C14.2842 9.40973 14.5905 9.71547 14.7822 10.0918C15 10.5192 15 11.079 15 12.1969L15 15" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                      </svg>
                    </button>
                    <button class="spaces-btn spaces-btn-ghost spaces-btn-small spaces-minimize-response-btn ${collapseResponse ? 'collapsed' : ''}" data-card-index="${cardIndex}-live">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="m6 9 6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
              <div class="response-content minimizable-content ${collapseResponse ? 'collapsed' : ''}" data-card-index="${cardIndex}-live">
                <div class="json-interactive" data-json-content="${encodeURIComponent(safeJSONStringify(responseData))}"></div>
              </div>
            </div>
          `;
          detailsDiv.insertAdjacentHTML('beforeend', responseHtml);
          
          // Setup event handlers and initialize JSON display
          const newResponseSection = detailsDiv.querySelector('.response-section:last-child');
          setupResponseEventHandlers(newResponseSection);
          
          const jsonContainer = newResponseSection.querySelector('.json-interactive');
          if (jsonContainer) {
            renderInteractiveJSON(jsonContainer, responseData, `${cardIndex}-live`);
            // Update marked paths display after rendering
            setTimeout(() => updateMarkedPathsDisplay(), 100);
          }
        }
      }
    }
    
  } catch (error) {
    console.error('Error replaying API call:', error);
    
    // Show error in card
    const card = document.querySelector(`[data-card-index="${cardIndex}"]`);
    if (card) {
      const detailsDiv = card.querySelector('.spaces-call-details');
      if (detailsDiv) {
        const errorHtml = `
          <div class="response-section error">
            <p><strong>Error:</strong> ${error.message}</p>
          </div>
        `;
        detailsDiv.insertAdjacentHTML('beforeend', errorHtml);
      }
    }
  } finally {
    // Re-enable button
    const replayBtn = button || document.querySelector(`.replay-btn[data-card-index="${cardIndex}"]`);
    if (replayBtn) {
      replayBtn.disabled = false;
      replayBtn.innerHTML = 'Execute';
    }
  }
}

// Helper function to setup event handlers for response sections
function setupResponseEventHandlers(responseSection) {
  const copyBtn = responseSection.querySelector('.spaces-copy-response-btn');
  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      const encodedResponse = copyBtn.getAttribute('data-response');
      const responseData = JSON.parse(decodeURIComponent(encodedResponse));
      await copyToClipboard(responseData, copyBtn);
    });
  }
  
  const minimizeBtn = responseSection.querySelector('.spaces-minimize-response-btn');
  if (minimizeBtn) {
    minimizeBtn.addEventListener('click', () => {
      const cardIndex = minimizeBtn.getAttribute('data-card-index');
      toggleResponseCollapse(cardIndex);
    });
  }
}

// Utility Functions for JSON Path Management

// Button feedback utilities
function showButtonFeedback(button, content, duration = 2000) {
  const originalContent = button.innerHTML;
  button.innerHTML = content;
  setTimeout(() => {
    button.innerHTML = originalContent;
  }, duration);
}

// Copy to clipboard functionality
async function copyToClipboard(data, button) {
  try {
    const textToCopy = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    await navigator.clipboard.writeText(textToCopy);
    
    showButtonFeedback(button, `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M20 6L9 17l-5-5"/>
      </svg>
    `);
    
  } catch (error) {
    console.error('Failed to copy to clipboard:', error);
    showButtonFeedback(button, 'Error');
  }
}

// Open API call in the API Explorer tab
async function openInApiExplorer(callData) {
  try {
    // Switch to the API Explorer tab
    const apiExplorerTab = document.getElementById('api-explorer-tab');
    const recordedApisTab = document.getElementById('recorded-apis-tab');
    
    if (apiExplorerTab && recordedApisTab) {
      // Remove active class from current tab
      recordedApisTab.classList.remove('active');
      document.getElementById('recorded-apis').classList.remove('active');
      
      // Activate API Explorer tab
      apiExplorerTab.classList.add('active');
      document.getElementById('api-explorer').classList.add('active');
      
      // Pre-populate the form with the call data
      setTimeout(() => {
        const urlInput = document.getElementById('api-url');
        const methodSelect = document.getElementById('api-method');
        const bodyTextarea = document.getElementById('api-body');
        
        if (urlInput) urlInput.value = callData.url || '';
        if (methodSelect) methodSelect.value = callData.method || 'GET';
        if (bodyTextarea && callData.requestBody) {
          bodyTextarea.value = typeof callData.requestBody === 'string' 
            ? callData.requestBody 
            : JSON.stringify(callData.requestBody, null, 2);
        }
        
        // Show success notification
        showSuccessToast('Opened in API Explorer', 'API call details have been loaded in the API Explorer tab.');
      }, 100);
    }
  } catch (error) {
    console.error('Failed to open in API Explorer:', error);
    showErrorToast('Navigation Failed', 'Could not open the API call in API Explorer.');
  }
}

// Format call data for copying
function formatCallForCopy(callData) {
  return `Method: ${callData.method}
URL: ${callData.url}
Headers: ${JSON.stringify(callData.headers || {}, null, 2)}
${callData.requestBody ? `Body: ${typeof callData.requestBody === 'string' ? callData.requestBody : JSON.stringify(callData.requestBody, null, 2)}` : ''}`;
}

// Toggle payload editing
function togglePayloadEdit(cardIndex) {
  const payloadSpan = document.querySelector(`.payload-content[data-card-index="${cardIndex}"]`);
  const editBtn = document.querySelector(`.spaces-edit-payload-btn[data-card-index="${cardIndex}"]`);
  
  if (!payloadSpan || !editBtn) return;
  
  if (payloadSpan.querySelector('textarea')) {
    // Currently in edit mode, save changes
    const textarea = payloadSpan.querySelector('textarea');
    const newValue = textarea.value;
    payloadSpan.innerHTML = `<code>${newValue}</code>`;
    editBtn.textContent = 'Edit';
  } else {
    // Switch to edit mode
    const currentValue = payloadSpan.textContent;
    const textarea = document.createElement('textarea');
    textarea.value = currentValue;
    textarea.style.width = '100%';
    textarea.style.minHeight = '100px';
    textarea.style.fontFamily = 'monospace';
    payloadSpan.innerHTML = '';
    payloadSpan.appendChild(textarea);
    editBtn.textContent = 'Save';
    textarea.focus();
  }
}

// Toggle response collapse/expand
function toggleResponseCollapse(cardIndex) {
  const responseContent = document.querySelector(`.minimizable-content[data-card-index="${cardIndex}"]`);
  const minimizeBtn = document.querySelector(`.spaces-minimize-response-btn[data-card-index="${cardIndex}"]`);
  
  if (!responseContent || !minimizeBtn) return;
  
  if (responseContent.classList.contains('collapsed')) {
    // Currently collapsed, expand it
    responseContent.classList.remove('collapsed');
    minimizeBtn.classList.remove('collapsed');
  } else {
    // Currently expanded, collapse it
    responseContent.classList.add('collapsed');
    minimizeBtn.classList.add('collapsed');
  }
}

// Enhanced JSON Rendering System with Hierarchical Marking
// =========================================================

// Utility Functions
function getElement(selector, cache = true) {
  if (cache && cachedElements[selector]) {
    return cachedElements[selector];
  }
  const element = document.querySelector(selector);
  if (cache) cachedElements[selector] = element;
  return element;
}

function getAllLines() {
  return document.querySelectorAll(CONFIG.SELECTORS.allLines);
}

function getLineByPath(path) {
  return document.querySelector(`[data-path="${path}"]`);
}

function isClosingBracket(line) {
  const content = line.textContent.trim();
  return content === '}' || content === '},' || content === ']' || content === '],';
}

function hasClosingBracketContent(line) {
  const content = line.innerHTML;
  return content.includes('}') || content.includes(']');
}

function isChildPath(childPath, parentPath) {
  // Add null/undefined checks
  if (childPath === null || childPath === undefined) {
    return false;
  }
  if (parentPath === null || parentPath === undefined) {
    return false;
  }
  
  // Handle root path case (empty string)
  if (parentPath === '') {
    return childPath !== '' && childPath.length > 0;
  }
  
  return childPath !== parentPath && childPath.startsWith(parentPath + '.');
}

function removeClasses(element, ...classes) {
  element.classList.remove(...classes);
}

function addClasses(element, ...classes) {
  element.classList.add(...classes);
}

// Enhanced JSON Rendering with Path Tracking
function renderInteractiveJSON(container, data, cardIndex = null, path = []) {
  console.log('renderInteractiveJSON called with:');
  console.log('  - Container:', container);
  console.log('  - Data:', data);
  console.log('  - CardIndex:', cardIndex);
  
  if (!container || !data) {
    console.error('renderInteractiveJSON: Missing container or data');
    return;
  }
  
  console.log('Clearing container content...');
  container.innerHTML = '';
  
  // Create a container for the JSON display and path indicator
  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'position: relative;';
  wrapper.setAttribute('data-debug', 'custom-json-wrapper');
  
  // Create the JSON display
  const jsonDisplay = document.createElement('div');
  jsonDisplay.className = 'json-interactive-content';
  jsonDisplay.style.cssText = `
    font-family: 'Courier New', monospace;
    font-size: 12px;
    line-height: 1.4;
    position: relative;
  `;
  jsonDisplay.setAttribute('data-debug', 'custom-json-content');
  
  wrapper.appendChild(jsonDisplay);
  container.appendChild(wrapper);
  
  // Clear and reset path map
  let pathMap = {};
  
  // Generate and render JSON with enhanced path tracking
  console.log('Calling formatJSONWithPathTracking...');
  console.log('  - Input data type:', typeof data);
  console.log('  - Input data keys:', Object.keys(data));
  
  const lines = formatJSONWithPathTracking(data, 0, [], cardIndex);
  console.log('Generated', lines.length, 'lines');
  console.log('First 200 chars:', lines.join('\n').substring(0, 200));
  
  jsonDisplay.innerHTML = lines.join('\n');
  
  // Verify the content was added
  const addedLines = container.querySelectorAll('.json-path-line');
  console.log('Added', addedLines.length, 'JSON lines to DOM');
  
  // Add interactivity with enhanced hierarchical support
  addClickEvents(jsonDisplay, cardIndex);
  
  // Restore marked state for this card after rendering
  restoreVisualMarkedState(cardIndex);
  
  console.log('Custom JSON viewer initialized successfully');
}

// Enhanced JSON Formatter with Individual Line Rendering
function formatJSONWithPathTracking(obj, indent = 0, currentPath = [], cardIndex = null) {
  let lines = [];
  
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
  
  function createLine(content, path, indent, isContainer = false) {
    const lineId = `line-${path.join('-')}-${indent}`;
    const spaces = '  '.repeat(indent);
    
    return `<div class="json-path-line ${isContainer ? 'json-container-line' : ''}" data-line-id="${lineId}" data-path="${path.join('.')}" data-indent="${indent}" data-card-index="${cardIndex || ''}">${spaces}${content}</div>`;
  }
  
  if (obj === null) {
    return [createLine('<span style="color: #64748b;">null</span>', currentPath, indent)];
  }
  
  if (typeof obj === 'boolean') {
    return [createLine(`<span style="color: #f59e0b;">${obj}</span>`, currentPath, indent)];
  }
  
  if (typeof obj === 'number') {
    return [createLine(`<span style="color: #f59e0b;">${obj}</span>`, currentPath, indent)];
  }
  
  if (typeof obj === 'string') {
    return [createLine(`<span style="color: #059669;">"${escapeHtml(obj)}"</span>`, currentPath, indent)];
  }
  
  if (Array.isArray(obj)) {
    if (obj.length === 0) {
      return [createLine('<span style="color: #64748b;">[]</span>', currentPath, indent)];
    }
    
    lines.push(createLine('<span style="color: #64748b;">[</span>', currentPath, indent, true));
    
    obj.forEach((item, index) => {
      const itemPath = [...currentPath, index];
      const isSimpleValue = (typeof item !== 'object' || item === null);
      
      if (isSimpleValue) {
        const content = formatJSONWithPathTracking(item, indent + 1, itemPath, cardIndex)[0];
        // Extract content more safely from the div structure
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = content;
        const valueContent = tempDiv.querySelector('.json-path-line').innerHTML.trim();
        // Remove the indentation spaces from the beginning
        const cleanedContent = valueContent.replace(/^(\s*)+/, '');
        const comma = index < obj.length - 1 ? '<span style="color: #64748b;">,</span>' : '';
        lines.push(createLine(cleanedContent + comma, itemPath, indent + 1));
      } else {
        const nestedLines = formatJSONWithPathTracking(item, indent + 1, itemPath, cardIndex);
        lines.push(...nestedLines);
        if (index < obj.length - 1) {
          const lastLine = lines[lines.length - 1];
          lines[lines.length - 1] = lastLine.replace('</div>', '<span style="color: #64748b;">,</span></div>');
        }
      }
    });
    
    lines.push(createLine('<span style="color: #64748b;">]</span>', currentPath, indent));
    return lines;
  }
  
  if (typeof obj === 'object') {
    const keys = Object.keys(obj);
    if (keys.length === 0) {
      return [createLine('<span style="color: #64748b;">{}</span>', currentPath, indent)];
    }
    
    lines.push(createLine('<span style="color: #64748b;">{</span>', currentPath, indent, true));
    
    keys.forEach((key, index) => {
      const keyPath = [...currentPath, key];
      const value = obj[key];
      const isSimpleValue = (typeof value !== 'object' || value === null);
      
      if (isSimpleValue) {
        const valueHtml = formatJSONWithPathTracking(value, indent + 1, keyPath, cardIndex)[0];
        // Extract content more safely from the div structure
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = valueHtml;
        const valueContent = tempDiv.querySelector('.json-path-line').innerHTML.trim();
        // Remove the indentation spaces from the beginning
        const cleanedContent = valueContent.replace(/^(\s*)+/, '');
        const comma = index < keys.length - 1 ? '<span style="color: #64748b;">,</span>' : '';
        const content = `<span style="color: #0074d9;">"${escapeHtml(key)}"</span><span style="color: #64748b;">:</span> ${cleanedContent}${comma}`;
        lines.push(createLine(content, keyPath, indent + 1));
      } else {
        // For complex objects, create a line for the key, then nested content
        const keyContent = `<span style="color: #0074d9;">"${escapeHtml(key)}"</span><span style="color: #64748b;">:</span> `;
        const nestedLines = formatJSONWithPathTracking(value, indent + 1, keyPath, cardIndex);
        const firstNested = nestedLines[0];
        const combinedFirst = firstNested.replace(/^(<div[^>]*>)(\s*)(.+)/, `$1$2${keyContent}$3`);
        lines.push(combinedFirst);
        lines.push(...nestedLines.slice(1));
        
        if (index < keys.length - 1) {
          const lastLine = lines[lines.length - 1];
          lines[lines.length - 1] = lastLine.replace('</div>', '<span style="color: #64748b;">,</span></div>');
        }
      }
    });
    
    lines.push(createLine('<span style="color: #64748b;">}</span>', currentPath, indent));
    return lines;
  }
  
  return [createLine(String(obj), currentPath, indent)];
}

// Enhanced Event Handling with Inline Copy Buttons  
function addClickEvents(jsonDisplay, cardIndex) {
  const pathLines = jsonDisplay.querySelectorAll('.json-path-line');
  
  pathLines.forEach(line => {
    // Prevent hover from bubbling to parent elements
    line.addEventListener('mouseenter', (e) => {
      e.stopPropagation();
      highlightParentElements(line);
    });
    
    line.addEventListener('mouseleave', (e) => {
      e.stopPropagation();
      clearParentHighlights();
    });
    
    line.addEventListener('click', (e) => {
      e.stopPropagation();
      
      const path = line.getAttribute('data-path');
      
      // Remove any existing inline copy buttons
      const existingButtons = jsonDisplay.querySelectorAll('.inline-copy-btn');
      existingButtons.forEach(btn => btn.remove());
      
      // Create and add inline copy button
      createInlineCopyButton(line, path);
    });
    
    // Double-click to mark/unmark with hierarchical logic
    line.addEventListener('dblclick', async (e) => {
      e.stopPropagation();
      
      // If the double-click target is the copy button, ignore it
      if (e.target.classList.contains('inline-copy-btn')) {
        return;
      }
      
      const path = line.getAttribute('data-path');
      const pathKey = `${cardIndex}-${path}`;
      
      console.log(`Double-click on path: ${path}`);
      console.log(`Path key: ${pathKey}`);
      console.log(`Is included: ${includedPaths.has(pathKey)}`);
      console.log(`Is marked: ${markedPaths.has(pathKey)}`);
      
      // ISSUE #1 FIX: Prevent marking included items as favorites
      // Check if this item is currently included by a parent (and not already marked)
      // Also check if the line has the 'included' CSS class as an additional safeguard
      const hasIncludedClass = line.classList.contains('included');
      const isInIncludedPaths = includedPaths.has(pathKey);
      const isInMarkedPaths = markedPaths.has(pathKey);
      
      console.log(`Has included class: ${hasIncludedClass}`);
      console.log(`In includedPaths Set: ${isInIncludedPaths}`);
      console.log(`In markedPaths Map: ${isInMarkedPaths}`);
      
      if ((isInIncludedPaths || hasIncludedClass) && !isInMarkedPaths) {
        // Find the parent that has this item included
        const parentPath = findParentThatIncludesPath(path, cardIndex);
        if (parentPath) {
          showWarningToast(
            'Cannot Mark Included Item',
            `This item is included by parent "${parentPath}". Unmark the parent first to mark this item individually.`
          );
          return;
        }
      }
      
      if (markedPaths.has(pathKey)) {
        console.log(`Unmarking: ${path}`);
        await unmarkPathWithChildren(path, cardIndex);
      } else {
        console.log(`Marking as favorite: ${path}`);
        await markPathWithChildren(path, cardIndex);
      }
      
      updateMarkedPathsDisplay();
    });
  });
}

// Create inline copy button for clicked JSON line
function createInlineCopyButton(line, path) {
  const copyBtn = document.createElement('button');
  copyBtn.className = 'inline-copy-btn';
  copyBtn.innerHTML = 'Copy';
  
  // Initially disable to prevent double-click interference
  copyBtn.disabled = true;
  setTimeout(() => {
    copyBtn.disabled = false;
  }, 300);
  
  copyBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    
    // Clear auto-hide timeout
    if (copyBtn._autoHideTimeout) {
      clearTimeout(copyBtn._autoHideTimeout);
    }
    
    try {
      await navigator.clipboard.writeText(path);
      
      // Show success feedback
      copyBtn.innerHTML = `
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M20 6L9 17l-5-5"/>
        </svg>
      `;
      copyBtn.style.backgroundColor = '#10b981';
      
      // Remove button after showing success
      setTimeout(() => {
        if (copyBtn && copyBtn.parentNode) {
          copyBtn.remove();
        }
      }, 1000);
      
    } catch (err) {
      console.error('Failed to copy path:', err);
      copyBtn.innerHTML = '✗';
      copyBtn.style.backgroundColor = '#ef4444';
      
      // Remove button after showing error
      setTimeout(() => {
        if (copyBtn && copyBtn.parentNode) {
          copyBtn.remove();
        }
      }, 1000);
    }
  });
  
  // Add button to line (CSS handles positioning)
  line.appendChild(copyBtn);
  
  // Auto-hide after 3 seconds if not clicked
  const autoHideTimeout = setTimeout(() => {
    if (copyBtn && copyBtn.parentNode) {
      copyBtn.remove();
    }
  }, 3000);
  
  copyBtn._autoHideTimeout = autoHideTimeout;
}

// Enhanced Parent Highlighting
function highlightParentElements(currentLine) {
  const currentPath = currentLine.getAttribute('data-path');
  const pathParts = currentPath.split('.');
  
  clearParentHighlights();
  
  // Process parent hierarchy efficiently
  for (let i = pathParts.length - 1; i > 0; i--) {
    const parentPath = pathParts.slice(0, i).join('.');
    const parentLine = getLineByPath(parentPath);
    
    if (parentLine) {
      const classes = [CONFIG.CLASSES.hasActiveChild];
      classes.push(i === pathParts.length - 1 ? 
        CONFIG.CLASSES.parentHighlight : 
        CONFIG.CLASSES.ancestorHighlight
      );
      addClasses(parentLine, ...classes);
    }
  }
}

function clearParentHighlights() {
  const selector = `${CONFIG.SELECTORS.parentHighlight}, ${CONFIG.SELECTORS.ancestorHighlight}, ${CONFIG.SELECTORS.hasActiveChild}`;
  document.querySelectorAll(selector).forEach(element => {
    removeClasses(element, 
      CONFIG.CLASSES.parentHighlight, 
      CONFIG.CLASSES.ancestorHighlight, 
      CONFIG.CLASSES.hasActiveChild
    );
  });
}

// Enhanced Hierarchical Marking System
function findParentThatIncludesPath(childPath, cardIndex) {
  // Check all marked paths to see if any is a parent of the child path
  for (const [key, data] of markedPaths) {
    // Only check paths from the same card
    if (data.cardIndex !== cardIndex) continue;
    
    const pathStr = data.path;
    if (childPath.startsWith(pathStr + '.')) {
      return pathStr;
    }
  }
  return null;
}

async function markPathWithChildren(parentPath, cardIndex) {
  const parentLine = getLineByPath(parentPath);
  if (!parentLine) return;
  
  // Use provided cardIndex or fall back to line attribute
  const actualCardIndex = cardIndex || parentLine.getAttribute('data-card-index');
  const pathStr = Array.isArray(parentPath) ? parentPath.join('.') : parentPath;
  const key = Array.isArray(parentPath) ? (parentPath[parentPath.length - 1] || 'root') : pathStr.split('.').pop();
  
  console.log(`Marking parent as favorite: ${pathStr} (cardIndex: ${actualCardIndex})`);
  
  // Mark the parent
  markedPaths.set(`${actualCardIndex}-${pathStr}`, { key, path: pathStr, cardIndex: actualCardIndex });
  removeClasses(parentLine, CONFIG.CLASSES.included);
  addClasses(parentLine, CONFIG.CLASSES.marked);
  
  const allLines = getAllLines();
  let addedCount = 0;
  
  // Process children in single iteration
  allLines.forEach((line, index) => {
    const linePath = line.getAttribute('data-path');
    const lineCardIndex = line.getAttribute('data-card-index');
    
    // Only process lines from the same card
    if (lineCardIndex !== actualCardIndex) return;
    
    // Handle child paths
    if (isChildPath(linePath, pathStr)) {
      // Convert marked children to included
      if (markedPaths.has(`${actualCardIndex}-${linePath}`)) {
        console.log(`Converting marked child to included: ${linePath}`);
        markedPaths.delete(`${actualCardIndex}-${linePath}`);
        removeClasses(line, CONFIG.CLASSES.marked);
      }
      
      console.log(`Adding child as included: ${linePath}`);
      includedPaths.add(`${actualCardIndex}-${linePath}`);
      addClasses(line, CONFIG.CLASSES.included);
      addedCount++;
    }
    
    // Handle closing brackets for parent and children
    if ((linePath === pathStr || isChildPath(linePath, pathStr)) && 
        hasClosingBracketContent(line) && isClosingBracket(line)) {
      
      if (!line.classList.contains(CONFIG.CLASSES.marked)) {
        const closingId = `${actualCardIndex}-${linePath}_close_${index}`;
        console.log(`Adding closing bracket as included: ${closingId}`);
        includedPaths.add(closingId);
        addClasses(line, CONFIG.CLASSES.included);
        addedCount++;
      }
    }
  });
  
  console.log(`Added ${addedCount} included children for ${pathStr}`);
  
  // Save immediately after marking
  try {
    await saveMarkedPathsImmediate();
  } catch (error) {
    console.error('Failed to save marked path with children:', error);
  }
}

async function unmarkPathWithChildren(parentPath, cardIndex) {
  const parentLine = getLineByPath(parentPath);
  if (!parentLine) return;
  
  // Use provided cardIndex or fall back to line attribute
  const actualCardIndex = cardIndex || parentLine.getAttribute('data-card-index');
  const pathStr = Array.isArray(parentPath) ? parentPath.join('.') : parentPath;
  
  console.log(`Unmarking parent: ${pathStr} (cardIndex: ${actualCardIndex})`);
  
  // Unmark the parent
  markedPaths.delete(`${actualCardIndex}-${pathStr}`);
  removeClasses(parentLine, CONFIG.CLASSES.marked);
  
  const allLines = getAllLines();
  let removedCount = 0;
  
  // First pass: Remove child paths and collect all affected line indices
  const affectedIndices = new Set();
  allLines.forEach((line, index) => {
    const linePath = line.getAttribute('data-path');
    const lineCardIndex = line.getAttribute('data-card-index');
    
    // Only process lines from the same card
    if (lineCardIndex !== actualCardIndex || !linePath) return;
    
    // Handle child paths - remove ANY path that starts with parent path + "."
    if (isChildPath(linePath, pathStr)) {
      const childKey = `${actualCardIndex}-${linePath}`;
      if (includedPaths.has(childKey)) {
        console.log(`Removing included child: ${linePath}`);
        includedPaths.delete(childKey);
        removeClasses(line, CONFIG.CLASSES.included);
        removedCount++;
      }
      
      // Track this index for closing bracket cleanup
      affectedIndices.add(index);
    }
    
    // Also track the parent path index
    if (linePath === pathStr) {
      affectedIndices.add(index);
    }
  });
  
  // Second pass: Clean up ALL closing brackets that were included by this parent
  // This includes checking all closing bracket IDs that might have been created
  const keysToRemove = [];
  includedPaths.forEach(includedId => {
    // Remove any closing bracket ID that belongs to this card and starts with our path
    if (includedId.includes('_close_') && includedId.startsWith(`${actualCardIndex}-`)) {
      const pathPart = includedId.split('_close_')[0].replace(`${actualCardIndex}-`, '');
      
      // Remove if it's the parent path or a child of the parent path
      // Special handling for root path (empty string)
      if (pathPart === pathStr || 
          isChildPath(pathPart, pathStr) || 
          (pathStr === '' && pathPart === '') ||
          (pathStr === '' && pathPart.length > 0)) {
        keysToRemove.push(includedId);
      }
    }
  });
  
  // Remove the collected closing bracket keys
  keysToRemove.forEach(key => {
    console.log(`Removing included closing bracket: ${key}`);
    includedPaths.delete(key);
    removedCount++;
  });
  
  // Special cleanup for root path - remove ALL closing bracket classes
  if (pathStr === '' || pathStr === 'root') {
    console.log('Root path unmarked - cleaning up all closing brackets');
    allLines.forEach(line => {
      const lineCardIndex = line.getAttribute('data-card-index');
      if (lineCardIndex === actualCardIndex && 
          hasClosingBracketContent(line) && 
          isClosingBracket(line) &&
          line.classList.contains(CONFIG.CLASSES.included)) {
        console.log(`Force removing included class from closing bracket`);
        removeClasses(line, CONFIG.CLASSES.included);
      }
    });
  }
  
  // Third pass: Remove visual classes from all closing bracket lines
  allLines.forEach((line, index) => {
    const linePath = line.getAttribute('data-path');
    const lineCardIndex = line.getAttribute('data-card-index');
    
    if (lineCardIndex !== actualCardIndex || linePath === null || linePath === undefined) return;
    
    // Remove included class from any closing bracket that was part of this parent
    // Special handling for root path (empty string)
    const isPartOfParent = (linePath === pathStr || 
                           isChildPath(linePath, pathStr) || 
                           (pathStr === '' && linePath === '') ||
                           (pathStr === '' && linePath.length >= 0));
    
    if (isPartOfParent && hasClosingBracketContent(line) && isClosingBracket(line)) {
      if (line.classList.contains(CONFIG.CLASSES.included)) {
        console.log(`Removing included class from closing bracket line: ${linePath} (parent: ${pathStr})`);
        removeClasses(line, CONFIG.CLASSES.included);
      }
    }
  });
  
  console.log(`Removed ${removedCount} included children of ${pathStr}`);
  
  // Save immediately after unmarking
  try {
    await saveMarkedPathsImmediate();
  } catch (error) {
    console.error('Failed to save after unmarking path with children:', error);
  }
}

// Modal System
function showConfirmModal(title, message, confirmText = 'Delete', confirmAction) {
  return new Promise((resolve) => {
    const modal = document.getElementById('modal-overlay');
    const modalTitle = document.getElementById('modal-title');
    const modalMessage = document.getElementById('modal-message');
    const modalConfirm = document.getElementById('modal-confirm');
    const modalCancel = document.getElementById('modal-cancel');
    
    modalTitle.textContent = title;
    modalMessage.textContent = message;
    modalConfirm.textContent = confirmText;
    
    // Show modal
    modal.classList.add('show');
    
    // Handle confirm
    const handleConfirm = () => {
      modal.classList.remove('show');
      cleanup();
      resolve(true);
    };
    
    // Handle cancel
    const handleCancel = () => {
      modal.classList.remove('show');
      cleanup();
      resolve(false);
    };
    
    // Handle escape key
    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        handleCancel();
      }
    };
    
    // Handle backdrop click
    const handleBackdrop = (e) => {
      if (e.target === modal) {
        handleCancel();
      }
    };
    
    // Cleanup function
    const cleanup = () => {
      modalConfirm.removeEventListener('click', handleConfirm);
      modalCancel.removeEventListener('click', handleCancel);
      document.removeEventListener('keydown', handleEscape);
      modal.removeEventListener('click', handleBackdrop);
    };
    
    // Add event listeners
    modalConfirm.addEventListener('click', handleConfirm);
    modalCancel.addEventListener('click', handleCancel);
    document.addEventListener('keydown', handleEscape);
    modal.addEventListener('click', handleBackdrop);
  });
}

// Toast System
function showToast(type, title, message, duration = 4000) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  
  toast.className = `toast ${type}`;
  
  let icon = '';
  switch (type) {
    case 'success':
      icon = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/>';
      break;
    case 'error':
      icon = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>';
      break;
    case 'warning':
      icon = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z"/>';
      break;
    case 'info':
      icon = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>';
      break;
  }
  
  toast.innerHTML = `
    <svg class="toast-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      ${icon}
    </svg>
    <div class="toast-content">
      <div class="toast-title">${title}</div>
      <div class="toast-message">${message}</div>
    </div>
  `;
  
  container.appendChild(toast);
  
  // Animate in
  setTimeout(() => toast.classList.add('show'), 100);
  
  // Auto remove
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => {
      if (container.contains(toast)) {
        container.removeChild(toast);
      }
    }, 300);
  }, duration);
}

// Utility function to show success toast
function showSuccessToast(title, message) {
  showToast('success', title, message);
}

// Utility function to show error toast
function showErrorToast(title, message) {
  showToast('error', title, message);
}

// Utility function to show info toast
function showInfoToast(title, message) {
  showToast('info', title, message);
}

function showWarningToast(title, message) {
  showToast('warning', title, message);
}

// Marked Paths Management System
let markedPaths = new Map(); // key: unique identifier, value: {key, path, cardIndex}
let includedPaths = new Set(); // Hierarchical included paths (children of marked parents)

// Configuration Constants for Enhanced JSON Viewer
const CONFIG = {
  COLORS: {
    primary: '#f59e0b',
    blue: '#3b82f6',
    green: '#059669',
    gray: '#64748b'
  },
  SELECTORS: {
    allLines: '.json-path-line',
    marked: '.marked',
    included: '.included',
    parentHighlight: '.parent-highlight',
    ancestorHighlight: '.ancestor-highlight',
    hasActiveChild: '.has-active-child'
  },
  CLASSES: {
    marked: 'marked',
    included: 'included',
    parentHighlight: 'parent-highlight',
    ancestorHighlight: 'ancestor-highlight',
    hasActiveChild: 'has-active-child'
  }
};

// Cache DOM elements for performance
let cachedElements = {
  container: null,
  pathDisplay: null,
  pathText: null,
  markedList: null
};

// Save marked paths to Chrome storage
// Debounced save to prevent race conditions when marking multiple paths quickly
let saveTimeout = null;

function saveMarkedPaths() {
  // Clear any pending save
  if (saveTimeout) {
    clearTimeout(saveTimeout);
  }
  
  // Debounce saves to prevent race conditions
  saveTimeout = setTimeout(() => {
    const markedPathsArray = Array.from(markedPaths.entries());
    console.log(`DEBOUNCED SAVE: Saving ${markedPathsArray.length} paths`);
    console.log('DEBOUNCED SAVE: Paths being saved:', markedPathsArray);
    
    chrome.storage.local.set({ markedPaths: markedPathsArray }, () => {
      console.log(`DEBOUNCED SAVE COMPLETED: ${markedPathsArray.length} paths saved to storage`);
    });
    saveTimeout = null;
  }, 100); // 100ms debounce
}

// Immediate save for critical operations (like cleanup)
function saveMarkedPathsImmediate() {
  // Clear any pending debounced save
  if (saveTimeout) {
    clearTimeout(saveTimeout);
    saveTimeout = null;
  }
  
  const markedPathsArray = Array.from(markedPaths.entries());
  console.log(`IMMEDIATE SAVE: Saving ${markedPathsArray.length} paths`);
  console.log('IMMEDIATE SAVE: Paths being saved:', markedPathsArray);
  
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ markedPaths: markedPathsArray }, () => {
      if (chrome.runtime.lastError) {
        console.error('IMMEDIATE SAVE FAILED:', chrome.runtime.lastError);
        reject(chrome.runtime.lastError);
      } else {
        console.log(`IMMEDIATE SAVE COMPLETED: ${markedPathsArray.length} paths saved to storage`);
        resolve();
      }
    });
  });
}

// Load marked paths from Chrome storage
function loadMarkedPaths() {
  chrome.storage.local.get(['markedPaths'], (result) => {
    if (result.markedPaths && Array.isArray(result.markedPaths)) {
      markedPaths = new Map(result.markedPaths);
      console.log('📥 Loaded marked paths from storage:', markedPaths.size, 'paths');
      console.log('Loaded paths:', Array.from(markedPaths.entries()));
      
      // Don't update display immediately - wait for JSON content to be rendered
      // updateMarkedPathsDisplay() will be called when content is actually available
    } else {
      console.log('📥 No marked paths found in storage');
    }
  });
}

// Clean up marked paths that reference non-existent cards
function cleanupOrphanedMarkedPaths() {
  console.log('Starting cleanup - current marked paths:', markedPaths.size);
  
  const validCardIndexes = new Set();
  
  // Collect all valid card indexes from API call cards that exist in the DOM
  document.querySelectorAll('.spaces-api-call-card[data-card-index]').forEach(card => {
    const cardIndex = card.getAttribute('data-card-index');
    if (cardIndex) {
      validCardIndexes.add(cardIndex);
      
      // Also check for live response versions - only add if they have actual response data
      const responseSection = card.querySelector('.response-section');
      if (responseSection) {
        const jsonContainer = responseSection.querySelector('.json-interactive');
        if (jsonContainer && jsonContainer.hasAttribute('data-json-content')) {
          // If there's response data, the live version is valid
          validCardIndexes.add(`${cardIndex}-live`);
        }
        
        // Also check for existing live elements
        const liveElements = responseSection.querySelectorAll('[data-card-index*="-live"]');
        liveElements.forEach(element => {
          const liveCardIndex = element.getAttribute('data-card-index');
          if (liveCardIndex) {
            validCardIndexes.add(liveCardIndex);
          }
        });
      }
    }
  });
  
  console.log('Valid card indexes found:', Array.from(validCardIndexes));
  
  // During page load/render, be very conservative - only remove if we're absolutely sure
  // Check if this is during initial load by seeing if JSON content hasn't rendered yet
  const hasRenderedJson = document.querySelectorAll('.json-path-line').length > 0;
  
  if (!hasRenderedJson) {
    console.log('⏳ JSON not rendered yet, skipping aggressive cleanup to preserve loaded paths');
    return; // Don't cleanup during initial render before JSON is displayed
  }
  
  // Remove marked paths that reference non-existent cards
  // BUT preserve paths for cards that still exist, even if they don't have response data yet
  let removedCount = 0;
  const pathsToRemove = [];
  
  markedPaths.forEach((data, id) => {
    // Extract base cardIndex (remove -live suffix for comparison)
    const baseCardIndex = data.cardIndex.replace('-live', '');
    
    // Check if either the base cardIndex or live version exists
    const hasBaseCard = validCardIndexes.has(baseCardIndex);
    const hasLiveCard = validCardIndexes.has(data.cardIndex);
    
    // Only remove if NEITHER the base card NOR the live version exists
    // This preserves marked paths for cards that exist but don't have response data yet
    if (!hasBaseCard && !hasLiveCard) {
      pathsToRemove.push(id);
      removedCount++;
      console.log(`🗑️ Will remove path for non-existent card: ${data.cardIndex}`);
    }
  });
  
  // Remove the orphaned paths
  pathsToRemove.forEach(id => markedPaths.delete(id));
  
  if (removedCount > 0) {
    console.log(`Cleaned up ${removedCount} orphaned marked paths`);
    saveMarkedPathsImmediate(); // Use immediate save for cleanup
    
    // Update all marked path displays after cleanup
    setTimeout(() => {
      document.querySelectorAll('.spaces-api-call-card').forEach(card => {
        const cardIndex = card.getAttribute('data-card-index');
        if (cardIndex) {
          updateMarkedPathsDisplay(cardIndex);
          // Also update live version if it exists
          updateMarkedPathsDisplay(`${cardIndex}-live`);
        }
      });
    }, 100);
  } else {
    console.log('No orphaned paths found');
  }
}

// Initialize marked paths display on page load
function initializeMarkedPaths() {
  // Load marked paths from storage first
  loadMarkedPaths();
}

// Restore marked state for a specific card after JSON rendering
function restoreMarkedStateForCard(cardIndex) {
  // Find all marked paths for this card and restore their marked class
  markedPaths.forEach((data, id) => {
    if (data.cardIndex === cardIndex) {
      const line = document.querySelector(`[data-path="${data.path}"][data-card-index="${cardIndex}"]`);
      if (line) {
        line.classList.add('marked');
        // CSS pseudo-elements handle the star display automatically
      }
    }
  });
  
  // Also restore included paths - includedPaths is a Set of "cardIndex-path" strings
  includedPaths.forEach(includedId => {
    if (includedId.startsWith(`${cardIndex}-`)) {
      // Extract path from "cardIndex-path" format
      const path = includedId.replace(`${cardIndex}-`, '');
      const line = document.querySelector(`[data-path="${path}"][data-card-index="${cardIndex}"]`);
      if (line) {
        line.classList.add('included');
        // CSS pseudo-elements handle the star display automatically
      }
    }
  });
}

async function markPath(key, path, cardIndex) {
  const id = `${cardIndex}-${path}`;
  markedPaths.set(id, { key, path, cardIndex });
  try {
    await saveMarkedPathsImmediate(); // Wait for save to complete
    updateMarkedPathsDisplay();
  } catch (error) {
    console.error('Failed to save marked path:', error);
  }
}

async function unmarkPath(key, path, cardIndex) {
  const id = `${cardIndex}-${path}`;
  markedPaths.delete(id);
  try {
    await saveMarkedPathsImmediate(); // Wait for save to complete
    updateMarkedPathsDisplay();
  } catch (error) {
    console.error('Failed to save unmarked path:', error);
  }
  
  // Update the DOM element
  const line = document.querySelector(`[data-path="${path}"][data-card-index="${cardIndex}"]`);
  if (line) {
    line.classList.remove('marked');
    // No need to update button content - CSS handles star visibility
  }
}

function clearAllMarkedPaths() {
  // Clear visual markers for both marked and included paths
  document.querySelectorAll('.json-path-line.marked, .json-path-line.included').forEach(line => {
    removeClasses(line, CONFIG.CLASSES.marked, CONFIG.CLASSES.included);
  });
  
  markedPaths.clear();
  includedPaths.clear();
  updateMarkedPathsDisplay();
  showInfoToast('Paths Cleared', 'All marked and included paths have been cleared');
}

// Function to explicitly trigger cleanup when needed
function forceCleanupMarkedPaths() {
  cleanupOrphanedMarkedPaths();
}

// Restore visual classes for marked and included paths after page refresh
function restoreVisualMarkedState(cardIndexFilter = null) {
  console.log('Restoring visual marked state...');
  
  // Clear existing included paths if we're restoring everything
  if (!cardIndexFilter) {
    includedPaths.clear();
  }
  
  // Process each marked path to restore visual state and rebuild included paths
  markedPaths.forEach((data, id) => {
    const { path, cardIndex } = data;
    
    // Skip if we're filtering by specific card and this doesn't match
    if (cardIndexFilter && cardIndex !== cardIndexFilter) {
      return;
    }
    
    console.log(`Restoring marked path: ${path} for card: ${cardIndex}`);
    
    // Find and mark the parent line
    const parentLine = document.querySelector(`[data-path="${path}"][data-card-index="${cardIndex}"]`);
    if (parentLine) {
      parentLine.classList.add('marked');
      console.log(`Applied marked class to: ${path}`);
      
      // Find and mark all children as included
      const allLines = document.querySelectorAll(`[data-card-index="${cardIndex}"]`);
      let includedCount = 0;
      
      allLines.forEach((line, index) => {
        const linePath = line.getAttribute('data-path');
        
        // Skip lines without data-path attribute
        if (!linePath) {
          return;
        }
        
        // Check if this line is a child of the marked path
        if (isChildPath(linePath, path)) {
          // Add to included paths set
          const childKey = `${cardIndex}-${linePath}`;
          includedPaths.add(childKey);
          
          // Apply visual class
          line.classList.add('included');
          includedCount++;
          
          console.log(`Applied included class to child: ${linePath}`);
        }
        
        // Handle closing brackets for parent and children
        if ((linePath === path || isChildPath(linePath, path)) && 
            hasClosingBracketContent(line) && isClosingBracket(line)) {
          
          if (!line.classList.contains('marked')) {
            const closingId = `${cardIndex}-${linePath}_close_${index}`;
            includedPaths.add(closingId);
            line.classList.add('included');
            includedCount++;
            console.log(`Applied included class to closing bracket: ${closingId}`);
          }
        }
      });
      
      console.log(`Restored ${includedCount} included children for ${path}`);
    } else {
      console.log(`⚠️ Could not find line for marked path: ${path} in card: ${cardIndex}`);
    }
  });
  
  console.log('Visual marked state restoration complete');
}

// Update API Explorer marked paths display
function updateApiExplorerMarkedPaths() {
  const markedPathsSection = document.getElementById('marked-paths-section');
  const markedPathsDisplay = document.getElementById('marked-paths-display');
  
  if (!markedPathsSection || !markedPathsDisplay) {
    return;
  }
  
  // Get all marked paths for API Explorer cards
  const apiExplorerCardIndexes = Array.from(document.querySelectorAll('.explorer-card')).map(card => card.getAttribute('data-card-index'));
  let allMarkedData = [];
  
  for (const cardIndex of apiExplorerCardIndexes) {
    const cardMarkedPaths = getMarkedPathsForCard(cardIndex);
    if (cardMarkedPaths.length > 0) {
      // Get the response data for this card
      const card = document.querySelector(`[data-card-index="${cardIndex}"]`);
      const jsonContainer = card?.querySelector('.json-interactive');
      
      if (jsonContainer) {
        const encodedData = jsonContainer.getAttribute('data-json-content');
        if (encodedData) {
          try {
            const responseData = JSON.parse(decodeURIComponent(encodedData));
            
            cardMarkedPaths.forEach(path => {
              const value = getValueByPath(responseData, path);
              allMarkedData.push({
                path: path,
                value: value,
                cardIndex: cardIndex
              });
            });
          } catch (error) {
            console.error('Error parsing response data for marked paths:', error);
          }
        }
      }
    }
  }
  
  // Show or hide the section based on whether there are marked paths
  if (allMarkedData.length === 0) {
    markedPathsSection.style.display = 'none';
  } else {
    markedPathsSection.style.display = 'block';
    
    // Build the display HTML with expandable values
    const displayHtml = allMarkedData.map((item, index) => {
      const valueDisplay = createValueDisplay(item.value, `marked-item-${index}`);
      
      return `
        <div class="marked-path-item" data-path="${item.path}">
          <div class="marked-path-key">${item.path}</div>
          <div class="marked-path-value-container">
            ${valueDisplay}
          </div>
        </div>
      `;
    }).join('');
    
    markedPathsDisplay.innerHTML = displayHtml;
    
    // Setup expand/collapse handlers
    setupMarkedPathsHandlers();
  }
}

// Create expandable value display
function createValueDisplay(value, itemId) {
  if (value === null) {
    return '<span class="value-null">null</span>';
  } else if (value === undefined) {
    return '<span class="value-undefined">undefined</span>';
  } else if (typeof value === 'boolean') {
    return `<span class="value-boolean">${value}</span>`;
  } else if (typeof value === 'number') {
    return `<span class="value-number">${value}</span>`;
  } else if (typeof value === 'string') {
    return `<span class="value-string">"${escapeHtml(value)}"</span>`;
  } else if (Array.isArray(value)) {
    if (value.length === 0) {
      return '<span class="value-array">[]</span>';
    } else if (value.length <= 3 && value.every(item => typeof item !== 'object' || item === null)) {
      // Show small arrays with primitive values inline
      const items = value.map(item => {
        if (typeof item === 'string') return `"${escapeHtml(item)}"`;
        return String(item);
      }).join(', ');
      return `<span class="value-array">[${items}]</span>`;
    } else {
      // Show expandable array
      return `
        <div class="expandable-value">
          <button class="expand-toggle" data-target="${itemId}">
            <svg class="expand-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="m9 18 6-6-6-6"/>
            </svg>
            <span class="value-array">Array(${value.length})</span>
          </button>
          <div class="expanded-content" id="${itemId}" style="display: none;">
            ${formatExpandedArray(value)}
          </div>
        </div>
      `;
    }
  } else if (typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length === 0) {
      return '<span class="value-object">{}</span>';
    } else if (keys.length <= 3 && keys.every(key => typeof value[key] !== 'object' || value[key] === null)) {
      // Show small objects with primitive values inline
      const items = keys.map(key => {
        const val = value[key];
        const valStr = typeof val === 'string' ? `"${escapeHtml(val)}"` : String(val);
        return `${key}: ${valStr}`;
      }).join(', ');
      return `<span class="value-object">{${items}}</span>`;
    } else {
      // Show expandable object
      return `
        <div class="expandable-value">
          <button class="expand-toggle" data-target="${itemId}">
            <svg class="expand-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="m9 18 6-6-6-6"/>
            </svg>
            <span class="value-object">Object(${keys.length} keys)</span>
          </button>
          <div class="expanded-content" id="${itemId}" style="display: none;">
            ${formatExpandedObject(value)}
          </div>
        </div>
      `;
    }
  } else {
    return `<span class="value-other">${escapeHtml(String(value))}</span>`;
  }
}

// Format expanded array content
function formatExpandedArray(array) {
  return array.map((item, index) => {
    const itemDisplay = createValueDisplay(item, `array-${index}-${Date.now()}`);
    return `<div class="expanded-item"><span class="item-index">[${index}]</span> ${itemDisplay}</div>`;
  }).join('');
}

// Format expanded object content
function formatExpandedObject(obj) {
  return Object.entries(obj).map(([key, value]) => {
    const valueDisplay = createValueDisplay(value, `obj-${key}-${Date.now()}`);
    return `<div class="expanded-item"><span class="item-key">${key}:</span> ${valueDisplay}</div>`;
  }).join('');
}

// Setup handlers for expand/collapse
function setupMarkedPathsHandlers() {
  document.querySelectorAll('.expand-toggle').forEach(button => {
    button.addEventListener('click', (e) => {
      e.preventDefault();
      const targetId = button.getAttribute('data-target');
      const content = document.getElementById(targetId);
      const icon = button.querySelector('.expand-icon');
      
      if (content.style.display === 'none') {
        content.style.display = 'block';
        icon.style.transform = 'rotate(90deg)';
      } else {
        content.style.display = 'none';
        icon.style.transform = 'rotate(0deg)';
      }
    });
  });
}

// HTML escape utility
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Helper function to get CSS class for value type
// Helper function to get marked paths for a specific card
function getMarkedPathsForCard(cardIndex) {
  const paths = [];
  markedPaths.forEach((data, id) => {
    if (data.cardIndex === cardIndex) {
      paths.push(data.path);
    }
  });
  return paths;
}

function updateMarkedPathsDisplay(cardIndexFilter = null) {
  // Only run cleanup if specifically requested, not on every update
  // This prevents aggressive cleanup during normal operations
  if (cardIndexFilter === 'cleanup') {
    cleanupOrphanedMarkedPaths();
    return;
  }
  
  // First, restore visual classes for all marked and included paths
  restoreVisualMarkedState(cardIndexFilter);
  
  // Update all response header indicators
  document.querySelectorAll('.marked-paths-indicator').forEach(indicator => {
    // Handle both "marked-count-X" and "marked-count-X-live" formats
    let cardIndex = indicator.id.replace('marked-count-', '');
    if (cardIndex.endsWith('-live')) {
      cardIndex = cardIndex.replace('-live', '');
    }
    
    // Skip this indicator if we're filtering by card index and it doesn't match
    if (cardIndexFilter && cardIndex !== cardIndexFilter && cardIndex !== `${cardIndexFilter}-live`) {
      return;
    }
    
    // Check if there's actually rendered JSON content for this card
    // Look for interactive JSON content (not just placeholder text)
    const responseSection = indicator.closest('.response-section');
    let hasRenderedJson = false;
    
    if (responseSection) {
      const jsonContainer = responseSection.querySelector('.json-interactive');
      if (jsonContainer && jsonContainer.hasAttribute('data-json-content')) {
        // Check if it has actual JSON content, not just empty container
        const jsonContent = responseSection.querySelector('.json-interactive-content');
        hasRenderedJson = jsonContent && jsonContent.children.length > 0;
      }
    }
    
    // Count both marked paths and included paths for this card
    let markedCount = 0;
    let includedCount = 0;
    
    if (hasRenderedJson) {
      // Count marked paths
      markedPaths.forEach((data) => {
        if (data.cardIndex === cardIndex) {
          markedCount++;
        }
      });
      
      // Count included paths (excluding closing bracket identifiers)
      Array.from(includedPaths).forEach(id => {
        if (id.startsWith(`${cardIndex}-`) && !id.includes('_close_')) {
          includedCount++;
        }
      });
    }
    
    const totalCount = markedCount + includedCount;
    const countSpan = indicator.querySelector('.marked-count');
    if (countSpan) {
      countSpan.textContent = totalCount;
    }
    
    // Update indicator text to show breakdown if there are included paths
    const pathText = indicator.querySelector('.marked-paths-text') || indicator;
    if (includedCount > 0) {
      pathText.title = `${markedCount} marked, ${includedCount} included`;
    } else {
      pathText.title = `${markedCount} marked`;
    }
    
    // Use CSS class instead of direct style manipulation
    if (totalCount > 0) {
      indicator.classList.add('show');
    } else {
      indicator.classList.remove('show');
    }
  });
  
  // Update API Explorer marked paths display
  updateApiExplorerMarkedPaths();
}

function removeMarkedPath(id) {
  const data = markedPaths.get(id);
  if (data) {
    unmarkPath(data.key, data.path, data.cardIndex);
  }
}

// Global function for mark button clicks with hierarchical support
function toggleMarkPath(cardIndex, path) {
  const pathStr = Array.isArray(path) ? path.join('.') : path;
  const id = `${cardIndex}-${pathStr}`;
  
  if (markedPaths.has(id)) {
    unmarkPathWithChildren(pathStr, cardIndex);
  } else {
    markPathWithChildren(pathStr, cardIndex);
  }
}

// Hierarchical function for parent element marking
async function toggleMarkPathHierarchical(cardIndex, path) {
  const pathStr = Array.isArray(path) ? path.join('.') : path;
  const key = Array.isArray(path) ? (path[path.length - 1] || 'root') : path.split('.').pop();
  const id = `${cardIndex}-${pathStr}`;
  
  if (markedPaths.has(id)) {
    // Unmarking parent - just unmark the parent, children will be inferred as unmarked
    await unmarkPath(key, pathStr, cardIndex);
    // Update visual state of children
    updateChildrenVisualState(cardIndex, pathStr, false);
  } else {
    // Marking parent - just mark the parent, children will be inferred as marked
    await markPath(key, pathStr, cardIndex);
    // Update visual state of children
    updateChildrenVisualState(cardIndex, pathStr, true);
  }
}

// Update visual state of child elements without actually marking them in the data
function updateChildrenVisualState(cardIndex, parentPath, isMarked) {
  const allLines = document.querySelectorAll(`[data-card-index="${cardIndex}"].json-path-line`);
  let hasChildren = false;
  
  allLines.forEach(line => {
    const linePath = line.getAttribute('data-path');
    if (linePath && linePath.startsWith(parentPath + '.')) {
      hasChildren = true; // Found at least one child
      // This is a child path - update visual state only using CSS classes
      if (isMarked) {
        line.classList.add('included'); // Children of marked parents are "included"
        line.classList.remove('marked'); // Remove actual marked state
      } else {
        line.classList.remove('included');
        line.classList.remove('marked');
      }
      // CSS pseudo-elements automatically handle star display
    }
  });
  
  // If no children found, this shouldn't be treated as hierarchical
  return hasChildren;
}

function exportMarkedPaths() {
  const actualIncludedPaths = Array.from(includedPaths).filter(path => !path.includes('_close_'));
  
  if (markedPaths.size === 0 && actualIncludedPaths.length === 0) {
    showErrorToast('No Data', 'No marked or included paths to export');
    return;
  }
  
  const markedDatapaths = {};
  markedPaths.forEach((data) => {
    markedDatapaths[data.key] = data.path;
  });
  
  const includedDatapaths = {};
  actualIncludedPaths.forEach(id => {
    const path = id.replace(/^[^-]+-/, ''); // Remove cardIndex prefix
    const key = path.split('.').pop() || 'root';
    includedDatapaths[key] = path;
  });
  
  const exportData = {
    timestamp: new Date().toISOString(),
    markedPaths: markedDatapaths,
    includedPaths: includedDatapaths,
    allSelectedPaths: Array.from(new Set([...Object.values(markedDatapaths), ...Object.values(includedDatapaths)])),
    totalMarked: markedPaths.size,
    totalIncluded: actualIncludedPaths.length,
    totalAll: markedPaths.size + actualIncludedPaths.length
  };
  
  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `marked-data-paths-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  
  const totalCount = markedPaths.size + actualIncludedPaths.length;
  showSuccessToast('Export Complete', `Exported ${totalCount} paths (${markedPaths.size} marked, ${actualIncludedPaths.length} included)`);
}

// Trigger migration from old apiCallsByTab to dual storage system
function triggerDataMigration() {
  chrome.storage.local.get(['apiCallsByTab'], (data) => {
    if (chrome.runtime.lastError) {
      console.error('[SpacesAPIExplorer] Migration check failed:', chrome.runtime.lastError);
      return;
    }
    
    const existingApiCalls = data.apiCallsByTab;
    
    if (existingApiCalls && Object.keys(existingApiCalls).length > 0) {
      console.log('[SpacesAPIExplorer] Found old apiCallsByTab data, migrating to dual storage...');
      
      chrome.storage.local.set({ 
        recordedApiCalls: existingApiCalls,
        trackedApiCalls: {}  // Start with empty tracked calls
      }, () => {
        if (chrome.runtime.lastError) {
          console.error('[SpacesAPIExplorer] Migration failed:', chrome.runtime.lastError);
        } else {
          console.log('[SpacesAPIExplorer] Migration completed successfully');
          // Remove the old storage key
          chrome.storage.local.remove(['apiCallsByTab'], () => {
            console.log('[SpacesAPIExplorer] Old apiCallsByTab storage removed');
          });
        }
      });
    } else {
      console.log('[SpacesAPIExplorer] No old data to migrate, removing apiCallsByTab key if present');
      chrome.storage.local.remove(['apiCallsByTab']);
    }
  });
}

// Call migration on load
triggerDataMigration();
