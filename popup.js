document.addEventListener('DOMContentLoaded', () => {
    const elements = {
        openTab: document.getElementById('open-tab'),
        toggle: document.getElementById('toggle-api-tracker'),
        recordingToggle: document.getElementById('toggle-recording'),
        viewApis: document.getElementById('view-apis-btn'),
        recordingText: document.getElementById('recording-text'),
        viewApisSection: document.getElementById('view-apis-section'),
        recButton: null // Will be set when recording starts
    };

    // Debug: Log if elements are found
    console.log('[Popup] Elements found:', {
        openTab: !!elements.openTab,
        toggle: !!elements.toggle,
        recordingToggle: !!elements.recordingToggle,
        viewApis: !!elements.viewApis,
        viewApisSection: !!elements.viewApisSection,
        recordingText: !!elements.recordingText
    });
    
    // Additional check for View APIs button
    if (elements.viewApis) {
        console.log('[Popup] View APIs button found:', elements.viewApis);
        console.log('[Popup] View APIs button ID:', elements.viewApis.id);
        console.log('[Popup] View APIs button classes:', elements.viewApis.className);
    } else {
        console.error('[Popup] View APIs button NOT found!');
    }

    let state = { trackerEnabled: false, isRecording: false };
    
    // Only disable if element exists, and clear any stale attributes
    if (elements.viewApis) {
        elements.viewApis.disabled = false; // Enable the button
        elements.viewApis.removeAttribute('data-listener-attached'); // Clear stale listener flag
        console.log('[Popup] Reset View APIs button state');
    }

    // Listen for messages from content scripts
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.type === 'trackerClosed') {
            console.log('[Popup] Tracker window closed, disabling toggle');
            state.trackerEnabled = false;
            updateTrackerUI(false);
            updateState({ trackerEnabled: false });
        }
    });

    const updateRecordingUI = (active) => {
        elements.recordingText.classList.toggle('active', active);
        elements.recordingToggle.classList.toggle('active', active);
        
        // Disable/enable API tracker toggle based on recording state
        if (active) {
            elements.toggle.classList.remove('active');
            elements.toggle.classList.add('recording-locked');
        } else {
            elements.toggle.classList.remove('recording-locked');
        }
    };

    const updateTrackerUI = (active) => {
        elements.toggle.classList.toggle('active', active);
        
        // Disable/enable recording toggle based on tracker state
        if (active && !state.isRecording) {
            elements.recordingToggle.classList.add('disabled');
        } else {
            elements.recordingToggle.classList.remove('disabled');
        }
    };

    const stopRecordingFromButton = () => {
        console.log('[Popup] Recording stopped via REC button');
        state.isRecording = false;
        
        // Update UI immediately to show "View APIs" 
        elements.recordingText.classList.remove('active');
        elements.recordingToggle.classList.remove('active');
        elements.toggle.classList.remove('recording-locked');
        
        // Send recordingStopped message to background script to handle all tabs
        chrome.runtime.sendMessage({ type: 'recordingStopped' }, (response) => {
            if (chrome.runtime.lastError) {
                console.error('[Popup] Failed to send recordingStopped message:', chrome.runtime.lastError);
            } else {
                console.log('[Popup] recordingStopped message sent successfully');
            }
        });

        // Clear tracked API calls since recording is complete
        chrome.storage.local.remove('trackedApiCalls', () => {
            console.log('[Popup] Tracked API calls cleared on recording stop');
        });

        updateState({ isRecording: false, recordedApisReady: true, trackerEnabled: false });
    };

    const updateViewApisButton = (shouldShow) => {
        console.log('[Popup] updateViewApisButton called with shouldShow:', shouldShow);
        
        if (!elements.viewApisSection || !elements.viewApis) {
            console.log('[Popup] View APIs elements not found');
            return;
        }

        if (shouldShow) {
            // Check if there's actually data stored before showing the button
            chrome.storage.local.get(['recordedApiCalls'], (result) => {
                const recordedApiCalls = result.recordedApiCalls || {};
                const hasData = Object.keys(recordedApiCalls).some(tabId => {
                    const calls = recordedApiCalls[tabId] || [];
                    return Array.isArray(calls) && calls.length > 0;
                });
                
                console.log('[Popup] Data check - hasData:', hasData, 'tabIds:', Object.keys(recordedApiCalls), 'recordedApiCalls:', recordedApiCalls);
                
                if (hasData) {
                    elements.viewApisSection.style.display = 'block';
                    elements.viewApis.disabled = false; // Ensure button is enabled
                    console.log('[Popup] Showing View APIs button');
                    
                    // Remove old listener and add fresh one to ensure it works
                    const newButton = elements.viewApis.cloneNode(true);
                    elements.viewApis.parentNode.replaceChild(newButton, elements.viewApis);
                    elements.viewApis = newButton; // Update reference
                    
                    console.log('[Popup] Attaching fresh click event listener to View APIs button');
                    elements.viewApis.addEventListener('click', (event) => {
                        console.log('[Popup] View APIs button clicked! Event:', event);
                        event.preventDefault();
                        viewRecordedApis();
                    });
                    console.log('[Popup] Fresh event listener attached successfully');
                } else {
                    elements.viewApisSection.style.display = 'none';
                    console.log('[Popup] Hiding View APIs button - no data');
                }
            });
        } else {
            elements.viewApisSection.style.display = 'none';
            console.log('[Popup] Hiding View APIs button - shouldShow is false');
        }
    };

    // Function to open API Explorer (to explorer tab)
    const openApiExplorer = () => {
        console.log('[Popup] ===== OPEN API EXPLORER BUTTON CLICKED =====');
        chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
            console.log('[Popup] Current tab:', tabs[0]?.url);
            try {
                const message = {
                    type: 'openApiExplorer',
                    currentUrl: tabs[0].url
                };
                console.log('[Popup] Sending message:', message);
                
                chrome.runtime.sendMessage(message, (response) => {
                    console.log('[Popup] Response received:', response);
                    if (chrome.runtime.lastError) {
                        console.error('[Popup] Failed to send openApiExplorer message:', chrome.runtime.lastError);
                    } else if (response && response.success) {
                        console.log(`[Popup] API Explorer ${response.action}:`, response.tabId);
                    } else {
                        console.error('[Popup] Failed to open API Explorer:', response?.error);
                    }
                });
            } catch (error) {
                console.error('[Popup] Failed to open API Explorer:', error);
            }
        });
    };

    // Function to view recorded APIs (to recorded tab)
    const viewRecordedApis = () => {
        console.log('[Popup] ===== VIEW APIs BUTTON CLICKED =====');
        chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
            console.log('[Popup] Current tab:', tabs[0]?.url);
            try {
                const message = {
                    type: 'openRecordedApis',
                    currentUrl: tabs[0].url
                };
                console.log('[Popup] Sending message:', message);
                
                chrome.runtime.sendMessage(message, (response) => {
                    console.log('[Popup] Response received:', response);
                    if (chrome.runtime.lastError) {
                        console.error('[Popup] Failed to send openRecordedApis message:', chrome.runtime.lastError);
                    } else if (response && response.success) {
                        console.log(`[Popup] API Explorer ${response.action}:`, response.tabId);
                    } else {
                        console.error('[Popup] Failed to open API Explorer:', response?.error);
                    }
                });
            } catch (error) {
                console.error('[Popup] Failed to open API Explorer:', error);
            }
        });
    };

    const sendMessage = (tabId, message, callback) => {
        chrome.tabs.sendMessage(tabId, message, response => {
            if (chrome.runtime.lastError) {
                // Only auto-inject tracker if:
                // 1. We're recording, OR
                // 2. Tracker is explicitly enabled, OR  
                // 3. This is a message that requires tracker functionality
                const requiresTracker = state.isRecording || state.trackerEnabled || 
                    (message.type === 'startRecording') ||
                    (message.type === 'setRecordingIndicator' && message.active);
                
                if (!requiresTracker) {
                    console.log('[Popup] Skipping tracker injection - not needed for message:', message.type);
                    if (callback) callback();
                    return;
                }
                
                console.log('[Popup] Content script not found, injecting tracker for message:', message.type);
                chrome.scripting.executeScript({
                    target: { tabId },
                    files: ['apiTracker.js']
                }, () => {
                    if (chrome.runtime.lastError) {
                        console.error('[Popup] Failed to inject tracker:', JSON.stringify(chrome.runtime.lastError));
                        if (callback) callback();
                    } else {
                        chrome.tabs.sendMessage(tabId, message, callback);
                    }
                });
            } else if (callback) callback(response);
        });
    };

    const clearApiCalls = (tabId) => {
        chrome.storage.local.get({ trackedApiCalls: {}, recordedApiCalls: {} }, data => {
            data.trackedApiCalls[tabId] = [];
            data.trackedApiCalls.unknown = [];
            data.recordedApiCalls[tabId] = [];
            data.recordedApiCalls.unknown = [];
            chrome.storage.local.set({ trackedApiCalls: data.trackedApiCalls, recordedApiCalls: data.recordedApiCalls });
        });
    };

    const injectTracker = (tabId, callback) => {
        // First get tab info to check URL
        chrome.tabs.get(tabId, (tab) => {
            if (chrome.runtime.lastError) {
                console.error('[Popup] Failed to get tab info:', JSON.stringify(chrome.runtime.lastError));
                if (callback) callback();
                return;
            }
            
            // Skip injection for extension pages
            if (tab.url && tab.url.startsWith('chrome-extension://')) {
                console.log('[Popup] Skipping tracker injection for extension page:', tab.url);
                if (callback) callback();
                return;
            }
            
            // Skip injection for chrome:// pages and other non-web pages
            if (tab.url && !tab.url.startsWith('http')) {
                console.log('[Popup] Skipping tracker injection for non-web page:', tab.url);
                if (callback) callback();
                return;
            }
            
            // Check if tracker is already present to avoid duplicates
            chrome.scripting.executeScript({
                target: { tabId },
                func: () => {
                    return {
                        hasTracker: !!window.__spacesApiTrackerInjected,
                        hasWindow: !!document.getElementById('spaces-api-tracker-window'),
                        isCollapsed: !!document.getElementById('expand-tracker') // Check if in collapsed state
                    };
                }
            }, (results) => {
            if (chrome.runtime.lastError) {
                console.error('[Popup] Failed to check tracker status:', chrome.runtime.lastError);
                if (callback) callback();
                return;
            }

            const trackerStatus = results?.[0]?.result;
            if (trackerStatus?.hasTracker && trackerStatus?.hasWindow) {
                console.log('[Popup] Tracker already present, skipping injection. Collapsed:', trackerStatus.isCollapsed);
                if (callback) callback();
                return;
            }

            // Proceed with injection only if tracker is not present
            chrome.scripting.executeScript({
                target: { tabId },
                func: currentTabId => { window.__currentTabId = currentTabId; },
                args: [tabId]
            }, () => {
                if (chrome.runtime.lastError) {
                    console.error('[Popup] Failed to inject tab ID:', chrome.runtime.lastError);
                    if (callback) callback();
                    return;
                }

                chrome.scripting.executeScript({
                    target: { tabId },
                    files: ['apiTracker.js']
                }, () => {
                    if (chrome.runtime.lastError) {
                        console.error('[Popup] Failed to inject tracker:', JSON.stringify(chrome.runtime.lastError));
                    } else {
                        console.log('[Popup] Tracker injected successfully');
                    }
                    if (callback) callback();
                });
            });
        });
    }); // Close chrome.tabs.get
    };

    const updateState = (updates) => {
        Object.assign(state, updates);
        chrome.storage.local.set(updates);
    };

    elements.openTab?.addEventListener('click', () => {
        chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
            try {
                chrome.runtime.sendMessage({
                    type: 'openApiExplorer',
                    currentUrl: tabs[0].url
                }, (response) => {
                    if (chrome.runtime.lastError) {
                        console.error('[Popup] Failed to send openApiExplorer message:', chrome.runtime.lastError);
                    } else if (response && response.success) {
                        console.log(`[Popup] API Explorer ${response.action}:`, response.tabId);
                    } else {
                        console.error('[Popup] Failed to open API Explorer:', response?.error);
                    }
                });
            } catch (error) {
                console.error('[Popup] Failed to open API Explorer:', error);
            }
        });
    });

        chrome.storage.local.get(['trackerEnabled', 'isRecording', 'recordedApisReady'], async data => {
        console.log('[Popup] INIT - Storage data:', data);
        console.log('[Popup] INIT - recordedApisReady specifically:', data.recordedApisReady);
        
        state.trackerEnabled = !!data.trackerEnabled;
        state.isRecording = !!data.isRecording;

        if (state.trackerEnabled) {
            updateTrackerUI(true);
        }

        // Set recording-locked class if currently recording
        if (state.isRecording && state.trackerEnabled) {
            elements.toggle.classList.add('recording-locked');
        }
        
        updateRecordingUI(state.isRecording);
        
        // Check if we should show the button
        const shouldShowButton = !!data.recordedApisReady && !state.isRecording;
        console.log('[Popup] INIT - Should show button:', shouldShowButton, 'recordedApisReady:', !!data.recordedApisReady, 'isRecording:', state.isRecording);
        
        updateViewApisButton(shouldShowButton);

        // Only send recording indicator if tracker is enabled or recording is active
        // Don't auto-inject tracker just for setting indicator
        if (state.trackerEnabled || state.isRecording) {
            chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
                sendMessage(tabs[0].id, { type: 'setRecordingIndicator', active: state.isRecording });
            });
        }
    });

    elements.recordingToggle.addEventListener('click', () => {
        // Prevent clicking if disabled
        if (elements.recordingToggle.classList.contains('disabled')) {
            elements.recordingToggle.classList.add('toggle-feedback');
            setTimeout(() => { elements.recordingToggle.classList.remove('toggle-feedback'); }, 150);
            return;
        }

        if (state.isRecording) {
            // Stop recording
            console.log('[Popup] Recording stopped');
            state.isRecording = false;
            updateRecordingUI(false);

            // Send recordingStopped message to background script to handle all tabs
            chrome.runtime.sendMessage({ type: 'recordingStopped' }, (response) => {
                if (chrome.runtime.lastError) {
                    console.error('[Popup] Failed to send recordingStopped message:', chrome.runtime.lastError);
                } else {
                    console.log('[Popup] recordingStopped message sent successfully');
                }
            });

            // Clear tracked API calls since recording is complete
            chrome.storage.local.remove('trackedApiCalls', () => {
                console.log('[Popup] Tracked API calls cleared on recording stop');
            });

            updateState({ isRecording: false, recordedApisReady: true, trackerEnabled: false });
            updateTrackerUI(false);
            updateViewApisButton(true); // Show button after recording stops
        } else {
            // Start recording - disable API Tracker if active
            console.log('[Popup] Recording started');
            
            chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
                const tabId = tabs[0].id;
                
                // If API Tracker is currently enabled, disable it first
                if (state.trackerEnabled) {
                    chrome.scripting.executeScript({
                        target: { tabId },
                        func: () => {
                            const win = document.getElementById('spaces-api-tracker-window');
                            if (win) win.remove();
                            window.__spacesApiTrackerInjected = false;
                        }
                    });
                    updateTrackerUI(false);
                    console.log('[Popup] API Tracker disabled for recording mode');
                }
                
                // Always clear any existing windows before starting recording
                chrome.scripting.executeScript({
                    target: { tabId },
                    func: () => {
                        const existingWindow = document.getElementById('spaces-api-tracker-window');
                        if (existingWindow) {
                            existingWindow.remove();
                        }
                        window.__spacesApiTrackerInjected = false;
                    }
                }, () => {
                    state.isRecording = true;
                    state.trackerEnabled = true; // Enable tracker for recording
                    updateRecordingUI(true);
                    clearApiCalls(tabId);
                    
                    // Clear tracked API calls to start fresh recording
                    chrome.storage.local.remove('trackedApiCalls', () => {
                        console.log('[Popup] Tracked API calls cleared on recording start');
                    });
                    
                    injectTracker(tabId, () => {
                        sendMessage(tabId, { type: 'setRecordingIndicator', active: true });
                        sendMessage(tabId, { type: 'startRecording' });
                    });
                });
            });

            updateState({ isRecording: true, trackerEnabled: true, recordedApisReady: false });
            updateViewApisButton(false);
        }
    });

    elements.toggle.addEventListener('click', () => {
        // Prevent clicking if disabled or locked during recording
        if (elements.toggle.classList.contains('recording-locked') || 
            elements.toggle.classList.contains('disabled')) {
            elements.toggle.classList.add('toggle-feedback');
            setTimeout(() => { elements.toggle.classList.remove('toggle-feedback'); }, 150);
            return;
        }

        chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
            const tabId = tabs[0].id;

            if (!state.trackerEnabled) {
                // Enabling API Tracker - disable Recording Mode if active and close any existing windows
                if (state.isRecording) {
                    // Stop recording first
                    state.isRecording = false;
                    updateRecordingUI(false);
                    
                    // Send recordingStopped message to background script to handle all tabs
                    chrome.runtime.sendMessage({ type: 'recordingStopped' }, (response) => {
                        if (chrome.runtime.lastError) {
                            console.error('[Popup] Failed to send recordingStopped message:', chrome.runtime.lastError);
                        }
                    });
                }
                
                // Always remove any existing tracker windows (including stopped windows)
                chrome.scripting.executeScript({
                    target: { tabId },
                    func: () => {
                        const existingWindow = document.getElementById('spaces-api-tracker-window');
                        if (existingWindow) {
                            existingWindow.remove();
                        }
                        window.__spacesApiTrackerInjected = false;
                    }
                }, () => {
                    // Now inject fresh tracker
                    clearApiCalls(tabId);
                    injectTracker(tabId);
                    state.trackerEnabled = true;
                    updateTrackerUI(true);
                    
                    // Set initial navigation timestamp for tracking filter
                    const trackingStartTime = Date.now();
                    updateState({ 
                        trackerEnabled: true, 
                        isRecording: false, 
                        recordedApisReady: false,
                        navigationTimestamp: trackingStartTime
                    });
                    updateViewApisButton(false);
                    console.log('[Popup] API Tracker enabled, tracking timestamp set:', trackingStartTime);
                });
            } else {
                // Disabling API Tracker
                chrome.scripting.executeScript({
                    target: { tabId },
                    func: () => {
                        const win = document.getElementById('spaces-api-tracker-window');
                        if (win) win.remove();
                        window.__spacesApiTrackerInjected = false;
                    }
                });
                
                // Clear tracked API calls to prevent indefinite storage accumulation
                chrome.storage.local.remove('trackedApiCalls', () => {
                    console.log('[Popup] Tracked API calls cleared on tracker disable');
                });
                
                state.trackerEnabled = false;
                updateTrackerUI(false);
                updateState({ trackerEnabled: false });
                console.log('[Popup] API Tracker disabled');
            }
        });
    });

    // Listen for storage changes to update UI when data is cleared by background script
    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace === 'local') {
            console.log('[Popup] Storage changed:', changes);
            
            // If storage was cleared or key data changed, update UI
            if ('recordedApisReady' in changes || 'isRecording' in changes || 'trackerEnabled' in changes) {
                console.log('[Popup] Key storage data changed, reinitializing...');
                
                // Get fresh data and update state
                chrome.storage.local.get(['trackerEnabled', 'isRecording', 'recordedApisReady'], (data) => {
                    console.log('[Popup] Fresh storage data:', data);
                    
                    state.trackerEnabled = !!data.trackerEnabled;
                    state.isRecording = !!data.isRecording;
                    
                    updateTrackerUI(state.trackerEnabled);
                    updateRecordingUI(state.isRecording);
                    
                    const shouldShowButton = !!data.recordedApisReady && !state.isRecording;
                    updateViewApisButton(shouldShowButton);
                    
                    // Remove recording-locked class if recording stopped
                    if (!state.isRecording) {
                        elements.toggle.classList.remove('recording-locked');
                    }
                });
            }
        }
    });
});
