(function() {
    // Enhanced guard against multiple injections
    if (window.__spacesApiTrackerInjected) {
        console.log('[API Tracker] Already injected, preventing duplicate');
        return;
    }
    
    // Check if tracker window already exists
    const existingWindow = document.getElementById('spaces-api-tracker-window');
    if (existingWindow) {
        console.log('[API Tracker] Tracker window already exists, preventing duplicate');
        return;
    }
    
    window.__spacesApiTrackerInjected = true;
    console.log('[API Tracker] Content script loaded');

    // Standardized style constants
    const TRACKER_STYLES = {
        BASE_WINDOW: {
            position: 'fixed',
            top: '80px',
            right: '24px',
            zIndex: '99999',
            background: '#fff',
            border: '2px solid #0074d9',
            borderRadius: '8px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
            padding: '12px',
            width: '420px',
            maxHeight: '60vh',
            overflowY: 'auto',
            overflowX: 'hidden',
            wordWrap: 'break-word',
            fontFamily: 'Fira Mono, Menlo, Consolas, monospace'
        },
        RECORDING_MODE: {
            borderColor: 'transparent',
            animation: 'none',
            width: 'auto',
            padding: '0px',
            background: 'transparent',
            boxShadow: 'none'
        },
        NORMAL_MODE: {
            borderColor: '#0074d9',
            animation: 'none',
            width: '420px',
            padding: '12px',
            background: '#fff',
            border: '2px solid #0074d9',
            borderRadius: '8px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
            maxHeight: '60vh',
            overflowY: 'auto',
            overflowX: 'hidden',
            wordWrap: 'break-word',
            fontFamily: 'Fira Mono, Menlo, Consolas, monospace'
        },
        COLLAPSED_MODE: {
            position: 'fixed',
            bottom: '20px',
            left: '20px',
            top: 'auto',
            right: 'auto',
            width: '280px',
            height: '60px',
            maxHeight: '60px',
            minHeight: '60px',
            resize: 'none',
            overflow: 'hidden',
            transition: 'all 0.3s ease'
        },
        STOPPED_MODE: {
            border: 'none',
            borderColor: '',
            animation: '',
            width: '160px',
            padding: '4px',
            background: 'transparent',
            boxShadow: '',
            transform: 'scale(1)',
            opacity: '1'
        },
        TRANSITION: {
            transition: 'all 0.3s ease'
        },
        ANIMATION_PREP: {
            transition: 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
            transform: 'scale(0.95)',
            opacity: '0.8'
        }
    };

    // Helper function to apply style groups
    const applyStyles = (element, ...styleGroups) => {
        styleGroups.forEach(styleGroup => {
            Object.assign(element.style, styleGroup);
        });
    };

    // Standard template function for consistency
    const createStandardTemplate = () => {
        return `
            <div style='position:relative;'>
                <button id='close-api-tracker' style='position:absolute;top:2px;right:4px;background:none;border:none;cursor:pointer;padding:4px;border-radius:4px;display:flex;align-items:center;justify-content:center;transition:background 0.2s;' title='Close API Tracker' onmouseenter='this.style.background="#f3f4f6"' onmouseleave='this.style.background="none"'>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path fill-rule="evenodd" clip-rule="evenodd" d="M5.29289 5.29289C5.68342 4.90237 6.31658 4.90237 6.70711 5.29289L12 10.5858L17.2929 5.29289C17.6834 4.90237 18.3166 4.90237 18.7071 5.29289C19.0976 5.68342 19.0976 6.31658 18.7071 6.70711L13.4142 12L18.7071 17.2929C19.0976 17.6834 19.0976 18.3166 18.7071 18.7071C18.3166 19.0976 17.6834 19.0976 17.2929 18.7071L12 13.4142L6.70711 18.7071C6.31658 19.0976 5.68342 19.0976 5.29289 18.7071C4.90237 18.3166 4.90237 17.6834 5.29289 17.2929L10.5858 12L5.29289 6.70711C4.90237 6.31658 4.90237 5.68342 5.29289 5.29289Z" fill="#6b7280"/>
                    </svg>
                </button>
                <button id='collapse-tracker' style='position:absolute;top:2px;right:28px;background:none;border:none;cursor:pointer;padding:4px;border-radius:4px;display:flex;align-items:center;justify-content:center;transition:background 0.2s;' title='Collapse Tracker' onmouseenter='this.style.background="#f3f4f6"' onmouseleave='this.style.background="none"'>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M7 10L12 15L17 10" stroke="#6b7280" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                </button>
                <div style='font-weight:bold;color:#0074d9;margin-bottom:8px;padding-right:56px;display:flex;align-items:center;justify-content:space-between;'>
                    <span>API Calls</span>
                    <button id='history-btn' style='padding:4px 8px;border-radius:4px;border:1px solid #0074d9;background:#fff;color:#0074d9;cursor:pointer;font-size:11px;font-weight:normal;transition:all 0.2s;margin-right:8px;' title="View API History" onmouseenter='this.style.background="#0074d9";this.style.color="#fff"' onmouseleave='this.style.background="#fff";this.style.color="#0074d9"'>
                        History
                    </button>
                </div>
                <div id='api-list'></div>
            </div>
        `;
    };

    const createTrackerWindow = () => {
        const existingWindow = document.getElementById('spaces-api-tracker-window');
        if (existingWindow || !document.body) return;

        const apiWindow = document.createElement('div');
        apiWindow.id = 'spaces-api-tracker-window';
        applyStyles(apiWindow, TRACKER_STYLES.BASE_WINDOW);

        // Set initial content based on recording state
        chrome.storage.local.get(['isRecording'], (data) => {
            const isRecording = !!data.isRecording;
            
            if (isRecording) {
                // Recording mode - enhanced UI with stats and Recording button
                chrome.storage.local.get(['trackedApiCalls'], (data) => {
                    const trackedApiCalls = data.trackedApiCalls || {};
                    const pageUrls = new Set();
                    let totalCalls = 0;
                    
                    // Use the same counting logic as displayRecordedApisData
                    const tabIds = Object.keys(trackedApiCalls);
                    
                    for (const tabId of tabIds) {
                        const calls = trackedApiCalls[tabId];
                        
                        if (Array.isArray(calls)) {
                            totalCalls += calls.length;
                            calls.forEach((call) => {
                                if (call && call.url) {
                                    const pageUrl = call.pageUrl || 'unknown-page';
                                    
                                    // Filter out extension pages (same as main extension)
                                    if (pageUrl.startsWith('chrome-extension://') || 
                                        pageUrl.startsWith('moz-extension://') || 
                                        pageUrl.startsWith('extension://') ||
                                        pageUrl.includes('spacesAPIexplorer.html')) {
                                        return; // Skip this call
                                    }
                                    
                                    pageUrls.add(pageUrl);
                                }
                            });
                        }
                    }
                    
                    const totalPages = pageUrls.size;
                    
                    apiWindow.innerHTML = `
                        <div class='rec-button-tracker' style='display:flex;flex-direction:column;gap:4px;background:#fff;border:2px solid #ef4444;border-radius:12px;padding:8px 12px;cursor:pointer;animation:recFlash 2s infinite, redPulse 3s infinite;margin:0;min-width:140px;'>
                            <div style='display:flex;align-items:center;justify-content:center;gap:6px;'>
                                <div style='width:8px;height:8px;background:#ef4444;border-radius:50%;animation:recDotPulse 1s infinite;'></div>
                                <span style='font-weight:700;font-size:11px;color:#000;letter-spacing:0.5px;'>Recording</span>
                            </div>
                            <div style='display:flex;justify-content:space-between;font-size:9px;color:#666;font-weight:500;'>
                                <span>${totalPages} pages</span>
                                <span>${totalCalls} calls</span>
                            </div>
                            <div style='text-align:center;font-size:8px;color:#999;font-weight:400;'>Click to stop</div>
                        </div>
                        <style>
                            @keyframes recFlash {
                                0%, 100% { border-color: #ef4444; background: #ffffff; }
                                50% { border-color: #dc2626; background: #fef2f2; }
                            }
                            @keyframes recDotPulse {
                                0%, 100% { background: #ef4444; transform: scale(1); }
                                50% { background: #dc2626; transform: scale(1.2); }
                            }
                            @keyframes redPulse {
                                0%, 100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.4); }
                                50% { box-shadow: 0 0 0 8px rgba(239, 68, 68, 0); }
                            }
                        </style>
                    `;
                    // Apply recording mode styles
                    applyStyles(apiWindow, TRACKER_STYLES.RECORDING_MODE);
                });
            } else {
                // Normal mode
                apiWindow.innerHTML = createStandardTemplate();
                applyStyles(apiWindow, TRACKER_STYLES.NORMAL_MODE);
            }
            
            setupEventListeners(apiWindow, isRecording);
        });

        document.body.appendChild(apiWindow);
        setupDragging(apiWindow);
        return apiWindow;
    };

    const setupEventListeners = (apiWindow, isRecording) => {
        if (isRecording) {
            // Add click handler to the recording button to stop recording
            const recButton = apiWindow.querySelector('.rec-button-tracker');
            if (recButton) {
                recButton.onclick = () => {
                    // Stop recording
                    chrome.storage.local.set({ isRecording: false, recordedApisReady: true }, () => {
                        // Update tracker window to stopped mode
                        updateTrackerWindowMode(false);
                        // Notify popup to update its state
                        chrome.runtime.sendMessage({ type: 'recordingStopped' });
                    });
                };
            }
            
            // Legacy handler for any existing recording buttons
            const recordingBtn = apiWindow.querySelector('#recording-btn');
            if (recordingBtn) {
                recordingBtn.onclick = () => {
                    // Stop recording
                    chrome.storage.local.set({ isRecording: false, recordedApisReady: true }, () => {
                        // Update tracker window to stopped mode
                        updateTrackerWindowMode(false);
                        // Notify popup to update its state
                        chrome.runtime.sendMessage({ type: 'recordingStopped' });
                    });
                };
            }
        } else {
            // Handle stopped mode View APIs button
            const viewApisBtnStopped = apiWindow.querySelector('#view-apis-btn-stopped');
            if (viewApisBtnStopped) {
                viewApisBtnStopped.onclick = () => {
                    // Send message to background script to open recorded APIs in new tab
                    chrome.runtime.sendMessage({
                        type: 'openRecordedApis',
                        currentUrl: window.location.href
                    }, (response) => {
                        if (chrome.runtime.lastError) {
                            console.warn('[API Tracker] Message port closed, but recorded APIs should still open');
                            // Remove the tracker window even if response failed
                            apiWindow.remove();
                            if (window.__apiListInterval) clearInterval(window.__apiListInterval);
                            window.__spacesApiTrackerInjected = false;
                        } else if (response && response.success) {
                            // Remove the tracker window after opening recorded APIs
                            apiWindow.remove();
                            if (window.__apiListInterval) clearInterval(window.__apiListInterval);
                            window.__spacesApiTrackerInjected = false;
                        } else {
                            console.error('[API Tracker] Failed to open recorded APIs:', response?.error);
                        }
                    });
                };
            }
            
            window.__spacesApiTrackerApiList = apiWindow.querySelector('#api-list');
        }
        
        // Handle Close button (available in normal mode)
        const closeBtn = apiWindow.querySelector('#close-api-tracker');
        if (closeBtn) {
            closeBtn.onclick = () => {
                apiWindow.remove();
                if (window.__apiListInterval) clearInterval(window.__apiListInterval);
                window.__spacesApiTrackerInjected = false;
                
                // Send message to background script to update tracker state
                chrome.runtime.sendMessage({ 
                    type: 'trackerClosed'
                }, (response) => {
                    if (chrome.runtime.lastError) {
                        console.log('[ApiTracker] Background script not available, message not sent');
                    } else {
                        console.log('[ApiTracker] Tracker state updated via background script');
                    }
                });
            };
        }
        
        // Handle History button (available in both modes)
        const historyBtn = apiWindow.querySelector('#history-btn');
        if (historyBtn) {
            historyBtn.onclick = () => {
                showHistoryViewer();
            };
        }
        
        // Handle Collapse button (available in both modes)
        const collapseBtn = apiWindow.querySelector('#collapse-tracker');
        if (collapseBtn) {
            collapseBtn.onclick = () => {
                collapseTracker();
            };
        }
    };

    const showHistoryViewer = () => {
        // Check if history viewer already exists
        const existingHistoryViewer = document.getElementById('spaces-api-history-viewer');
        if (existingHistoryViewer) {
            existingHistoryViewer.remove();
        }
        
        // Create history viewer window
        const historyViewer = document.createElement('div');
        historyViewer.id = 'spaces-api-history-viewer';
        Object.assign(historyViewer.style, {
            position: 'fixed', top: '80px', left: '50%', transform: 'translateX(-50%)', zIndex: '100000',
            background: '#fff', border: '2px solid #0074d9', borderRadius: '8px',
            boxShadow: '0 4px 16px rgba(0,0,0,0.15)', padding: '16px',
            width: '800px', maxHeight: '80vh', overflowY: 'auto', overflowX: 'hidden',
            wordWrap: 'break-word', fontFamily: 'Fira Mono, Menlo, Consolas, monospace'
        });
        
        historyViewer.innerHTML = `
            <div style='position:relative;'>
                <button id='close-history-viewer' style='position:absolute;top:-4px;right:-4px;background:none;border:none;cursor:pointer;padding:4px;border-radius:4px;display:flex;align-items:center;justify-content:center;transition:background 0.2s;' title='Close History Viewer' onmouseenter='this.style.background="#f3f4f6"' onmouseleave='this.style.background="none"'>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path fill-rule="evenodd" clip-rule="evenodd" d="M5.29289 5.29289C5.68342 4.90237 6.31658 4.90237 6.70711 5.29289L12 10.5858L17.2929 5.29289C17.6834 4.90237 18.3166 4.90237 18.7071 5.29289C19.0976 5.68342 19.0976 6.31658 18.7071 6.70711L13.4142 12L18.7071 17.2929C19.0976 17.6834 19.0976 18.3166 18.7071 18.7071C18.3166 19.0976 17.6834 19.0976 17.2929 18.7071L12 13.4142L6.70711 18.7071C6.31658 19.0976 5.68342 19.0976 5.29289 18.7071C4.90237 18.3166 4.90237 17.6834 5.29289 17.2929L10.5858 12L5.29289 6.70711C4.90237 6.31658 4.90237 5.68342 5.29289 5.29289Z" fill="#6b7280"/>
                    </svg>
                </button>
                <div style='font-weight:bold;color:#0074d9;margin-bottom:16px;font-size:16px;'>
                    API History
                </div>
                <div id='history-content' style='max-height:calc(80vh - 100px);overflow-y:auto;'>
                    Loading history...
                </div>
            </div>
        `;
        
        document.body.appendChild(historyViewer);
        
        // Setup close button
        const closeBtn = historyViewer.querySelector('#close-history-viewer');
        closeBtn.onclick = () => {
            historyViewer.remove();
        };
        
        // Load and display history
        loadApiHistory(historyViewer.querySelector('#history-content'));
    };

    const loadApiHistory = (contentContainer) => {
        chrome.storage.local.get(['trackedApiCalls'], (data) => {
            const trackedApiCalls = data.trackedApiCalls || {};
            
            // Group API calls by page URL and timestamp
            const historyGroups = {};
            
            Object.keys(trackedApiCalls).forEach(tabId => {
                const calls = trackedApiCalls[tabId];
                if (Array.isArray(calls)) {
                    calls.forEach(call => {
                        if (call && call.url && call.pageUrl) {
                            // Skip extension pages
                            if (call.pageUrl.startsWith('chrome-extension://') || 
                                call.pageUrl.startsWith('moz-extension://') || 
                                call.pageUrl.startsWith('extension://') ||
                                call.pageUrl.includes('spacesAPIexplorer.html')) {
                                return;
                            }
                            
                            const pageUrl = call.pageUrl;
                            const timestamp = call.timestamp || Date.now();
                            const date = new Date(timestamp).toLocaleDateString();
                            const time = new Date(timestamp).toLocaleTimeString();
                            
                            if (!historyGroups[pageUrl]) {
                                historyGroups[pageUrl] = {
                                    calls: [],
                                    firstSeen: timestamp,
                                    lastSeen: timestamp
                                };
                            }
                            
                            historyGroups[pageUrl].calls.push(call);
                            historyGroups[pageUrl].firstSeen = Math.min(historyGroups[pageUrl].firstSeen, timestamp);
                            historyGroups[pageUrl].lastSeen = Math.max(historyGroups[pageUrl].lastSeen, timestamp);
                        }
                    });
                }
            });
            
            // Sort pages by most recent activity
            const sortedPages = Object.entries(historyGroups).sort((a, b) => b[1].lastSeen - a[1].lastSeen);
            
            if (sortedPages.length === 0) {
                contentContainer.innerHTML = '<div style="text-align:center;color:#6b7280;padding:20px;">No API history found</div>';
                return;
            }
            
            let historyHtml = '';
            
            sortedPages.forEach(([pageUrl, group]) => {
                const lastSeenDate = new Date(group.lastSeen).toLocaleString();
                const apiCount = group.calls.length;
                const uniqueApis = new Set(group.calls.map(call => `${call.method} ${call.url}`)).size;
                
                historyHtml += `
                    <div style='border:1px solid #e5e7eb;border-radius:8px;margin-bottom:16px;background:#f9fafb;'>
                        <div style='padding:12px;border-bottom:1px solid #e5e7eb;background:#fff;border-radius:8px 8px 0 0;'>
                            <div style='font-weight:bold;margin-bottom:4px;word-break:break-all;'>${pageUrl}</div>
                            <div style='font-size:12px;color:#6b7280;'>
                                Last visited: ${lastSeenDate} • ${apiCount} calls • ${uniqueApis} unique APIs
                            </div>
                        </div>
                        <div style='padding:12px;'>
                `;
                
                // Sort calls by timestamp (most recent first)
                const sortedCalls = group.calls.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
                
                sortedCalls.forEach(call => {
                    const method = call.method || 'GET';
                    const url = call.url || '';
                    const path = url.replace(/^https?:\/\/[^\/]+/, '') || url;
                    const timestamp = new Date(call.timestamp || Date.now()).toLocaleTimeString();
                    const requestBody = call.requestBody;
                    
                    const methodColors = {
                        'GET': '#10b981', 'POST': '#3b82f6', 'PUT': '#f59e0b', 
                        'DELETE': '#ef4444', 'PATCH': '#8b5cf6', 'HEAD': '#6b7280', 'OPTIONS': '#14b8a6'
                    };
                    
                    historyHtml += `
                        <div style='display:flex;align-items:center;padding:8px;margin-bottom:8px;background:#fff;border-radius:6px;border:1px solid #e5e7eb;'>
                            <span style='background: ${methodColors[method] || '#6b7280'}; color: white; padding: 2px 6px; border-radius: 3px; font-size: 11px; font-weight: bold; margin-right: 8px; min-width: 45px; text-align: center; flex-shrink: 0;'>${method}</span>
                            <span style='font-family:monospace;font-size:12px;flex:1;word-wrap:break-word;overflow-wrap:break-word;min-width:0;line-height:1.3;margin-right:8px;'>${path}</span>
                            <span style='font-size:11px;color:#6b7280;margin-right:8px;flex-shrink:0;'>${timestamp}</span>
                            <div style='display:flex;gap:6px;flex-shrink:0;'>
                                ${requestBody ? '<button class="history-payload-btn" style="padding:2px 6px;border-radius:3px;border:none;background:#8b5cf6;color:#fff;cursor:pointer;font-size:11px;" data-payload=\'' + JSON.stringify(requestBody).replace(/'/g, '&apos;') + '\'>Payload</button>' : ''}
                                <button class="history-navigate-btn" style='padding:4px 8px;border-radius:4px;border:none;background:#0074d9;color:#fff;cursor:pointer;font-size:12px;display:flex;align-items:center;gap:4px;' title="Open in API Explorer" data-url="${url}" data-method="${method}" data-body='${requestBody ? JSON.stringify(requestBody).replace(/'/g, '&apos;') : ''}'>
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                        <path d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22Z"/>
                                        <path d="M12 8L16 12L12 16"/>
                                        <path d="M8 12H16"/>
                                    </svg>
                                </button>
                            </div>
                        </div>
                    `;
                });
                
                historyHtml += `
                        </div>
                    </div>
                `;
            });
            
            contentContainer.innerHTML = historyHtml;
            
            // Setup event listeners for navigate buttons
            contentContainer.querySelectorAll('.history-navigate-btn').forEach(btn => {
                btn.onclick = (e) => {
                    e.stopPropagation();
                    
                    const url = btn.getAttribute('data-url');
                    const method = btn.getAttribute('data-method');
                    const bodyStr = btn.getAttribute('data-body');
                    const requestBody = bodyStr ? JSON.parse(bodyStr) : null;
                    
                    // Use the same navigation logic as the main tracker
                    navigateToApiExplorer(url, method, requestBody);
                };
            });
            
            // Setup event listeners for payload buttons
            contentContainer.querySelectorAll('.history-payload-btn').forEach(btn => {
                btn.onclick = (e) => {
                    e.stopPropagation();
                    
                    const payload = JSON.parse(btn.getAttribute('data-payload'));
                    navigator.clipboard.writeText(JSON.stringify(payload, null, 2)).then(() => {
                        const originalText = btn.textContent;
                        btn.textContent = 'Copied!';
                        btn.style.background = '#10b981';
                        setTimeout(() => {
                            btn.textContent = originalText;
                            btn.style.background = '#8b5cf6';
                        }, 1500);
                    }).catch(error => {
                        console.error('[API Tracker] Payload copy failed:', error);
                        btn.textContent = 'Failed';
                        btn.style.background = '#ef4444';
                        setTimeout(() => {
                            btn.textContent = 'Payload';
                            btn.style.background = '#8b5cf6';
                        }, 1500);
                    });
                };
            });
        });
    };

    const collapseTracker = () => {
        const apiWindow = document.getElementById('spaces-api-tracker-window');
        if (!apiWindow) return;
        
        // Store current position for restoration
        window.__trackerExpandedPosition = {
            top: apiWindow.style.top,
            right: apiWindow.style.right,
            left: apiWindow.style.left,
            width: apiWindow.style.width
        };
        
        // Get current API count
        chrome.storage.local.get(['trackedApiCalls'], (data) => {
            const trackedApiCalls = data.trackedApiCalls || {};
            let totalCalls = 0;
            
            // Count current tracked calls
            Object.keys(trackedApiCalls).forEach(tabId => {
                const calls = trackedApiCalls[tabId];
                if (Array.isArray(calls)) {
                    totalCalls += calls.length;
                }
            });
            
            // Move to bottom left and show collapsed view
            applyStyles(apiWindow, TRACKER_STYLES.COLLAPSED_MODE);
            
            // Replace content with collapsed view
            apiWindow.innerHTML = `
                <div style='position:relative;'>
                    <button id='close-api-tracker-collapsed' style='position:absolute;top:2px;right:4px;background:none;border:none;cursor:pointer;padding:4px;border-radius:4px;display:flex;align-items:center;justify-content:center;transition:background 0.2s;' title='Close API Tracker' onmouseenter='this.style.background="#f3f4f6"' onmouseleave='this.style.background="none"'>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path fill-rule="evenodd" clip-rule="evenodd" d="M5.29289 5.29289C5.68342 4.90237 6.31658 4.90237 6.70711 5.29289L12 10.5858L17.2929 5.29289C17.6834 4.90237 18.3166 4.90237 18.7071 5.29289C19.0976 5.68342 19.0976 6.31658 18.7071 6.70711L13.4142 12L18.7071 17.2929C19.0976 17.6834 19.0976 18.3166 18.7071 18.7071C18.3166 19.0976 17.6834 19.0976 17.2929 18.7071L12 13.4142L6.70711 18.7071C6.31658 19.0976 5.68342 19.0976 5.29289 18.7071C4.90237 18.3166 4.90237 17.6834 5.29289 17.2929L10.5858 12L5.29289 6.70711C4.90237 6.31658 4.90237 5.68342 5.29289 5.29289Z" fill="#6b7280"/>
                        </svg>
                    </button>
                    
                    <button id='expand-tracker' style='position:absolute;top:2px;right:28px;background:none;border:none;cursor:pointer;padding:4px;border-radius:4px;display:flex;align-items:center;justify-content:center;transition:background 0.2s;' title='Expand Tracker' onmouseenter='this.style.background="#f3f4f6"' onmouseleave='this.style.background="none"'>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M17 14L12 9L7 14" stroke="#6b7280" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                    </button>
                    
                    <div style='font-weight:bold;color:#0074d9;margin-bottom:8px;padding-right:56px;display:flex;align-items:center;justify-content:space-between;'>
                        <div style='display:flex;align-items:center;gap:8px;'>
                            <span>API Calls</span>
                            <div id='api-count-badge' style='background:#0074d9;color:#fff;border-radius:50%;width:24px;height:24px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:bold;'>${totalCalls}</div>
                        </div>
                        <button id='history-btn-collapsed' style='padding:4px 8px;border-radius:4px;border:1px solid #0074d9;background:#fff;color:#0074d9;cursor:pointer;font-size:11px;font-weight:normal;transition:all 0.2s;margin-right:8px;' title="View API History" onmouseenter='this.style.background="#0074d9";this.style.color="#fff"' onmouseleave='this.style.background="#fff";this.style.color="#0074d9"'>
                            History
                        </button>
                    </div>
                </div>
            `;
            
            // Setup event listeners for collapsed view
            setupCollapsedEventListeners(apiWindow);
            
            // Start updating the count in collapsed mode
            updateCollapsedApiCount();
        });
    };

    const expandTracker = () => {
        const apiWindow = document.getElementById('spaces-api-tracker-window');
        if (!apiWindow) return;
        
        // Clear collapsed mode interval
        if (window.__collapsedCountInterval) {
            clearInterval(window.__collapsedCountInterval);
            window.__collapsedCountInterval = null;
        }
        
        // Restore original position and styling
        const savedPosition = window.__trackerExpandedPosition;
        if (savedPosition) {
            // Apply saved position with normal mode styling
            applyStyles(apiWindow, {
                top: savedPosition.top,
                right: savedPosition.right,
                left: savedPosition.left,
                width: savedPosition.width,
                bottom: 'auto',
                height: 'auto'
            }, TRACKER_STYLES.NORMAL_MODE, TRACKER_STYLES.TRANSITION);
        } else {
            // Apply default position with normal mode styling
            applyStyles(apiWindow, TRACKER_STYLES.BASE_WINDOW, TRACKER_STYLES.TRANSITION);
        }
        
        // Check if we're in recording mode
        chrome.storage.local.get(['isRecording'], (data) => {
            const isRecording = !!data.isRecording;
            
            if (isRecording) {
                // Restore recording mode UI
                updateTrackerWindowMode(true);
            } else {
                // Restore normal tracker mode
                apiWindow.innerHTML = createStandardTemplate();
                
                window.__spacesApiTrackerApiList = apiWindow.querySelector('#api-list');
                
                // Setup event listeners
                setupEventListeners(apiWindow, false);
                
                // Update API list
                updateApiList();
            }
        });
    };

    const updateCollapsedApiCount = () => {
        const apiWindow = document.getElementById('spaces-api-tracker-window');
        const badge = apiWindow?.querySelector('#api-count-badge');
        
        if (!badge) return;
        
        // Get current tab ID
        const tabId = window.__currentTabId || 'unknown';
        
        chrome.storage.local.get(['trackedApiCalls', 'navigationTimestamp'], (data) => {
            if (chrome.runtime.lastError) {
                console.error('[API Tracker] Extension context invalidated:', chrome.runtime.lastError);
                return;
            }
            
            const trackedApiCalls = data.trackedApiCalls || {};
            const navigationTimestamp = data.navigationTimestamp || 0;
            
            // Get calls for current tab and unknown tab
            const tabCalls = trackedApiCalls[tabId] || [];
            const unknownCalls = trackedApiCalls['unknown'] || [];
            
            // Combine and filter by timestamp (same logic as main tracker)
            const allCalls = [...tabCalls, ...unknownCalls];
            const filteredCalls = allCalls.filter(call => call.timestamp >= navigationTimestamp);
            
            // Update badge with current count
            badge.textContent = filteredCalls.length;
        });
    };

    const setupCollapsedEventListeners = (apiWindow) => {
        // Close button
        const closeBtn = apiWindow.querySelector('#close-api-tracker-collapsed');
        if (closeBtn) {
            closeBtn.onclick = () => {
                apiWindow.remove();
                if (window.__apiListInterval) clearInterval(window.__apiListInterval);
                if (window.__collapsedCountInterval) clearInterval(window.__collapsedCountInterval);
                window.__spacesApiTrackerInjected = false;
                
                chrome.runtime.sendMessage({ 
                    type: 'trackerClosed'
                }, (response) => {
                    if (chrome.runtime.lastError) {
                        console.log('[ApiTracker] Background script not available, message not sent');
                    } else {
                        console.log('[ApiTracker] Tracker state updated via background script');
                    }
                });
            };
        }
        
        // History button
        const historyBtn = apiWindow.querySelector('#history-btn-collapsed');
        if (historyBtn) {
            historyBtn.onclick = () => {
                showHistoryViewer();
            };
        }
        
        // Expand button
        const expandBtn = apiWindow.querySelector('#expand-tracker');
        if (expandBtn) {
            expandBtn.onclick = () => {
                expandTracker();
            };
        }
        
        // Set up interval to update API count in collapsed mode
        if (window.__collapsedCountInterval) {
            clearInterval(window.__collapsedCountInterval);
        }
        
        window.__collapsedCountInterval = setInterval(() => {
            updateCollapsedApiCount();
        }, 1000); // Update every second
    };

    const navigateToApiExplorer = (url, method, requestBody) => {
        console.log('[API Tracker] Navigate button clicked:', { url, method, requestBody });
        
        const params = new URLSearchParams();
        params.append('apiUrl', url);
        params.append('method', method);
        params.append('autoExecute', 'true');
        
        if (requestBody) {
            params.append('requestBody', JSON.stringify(requestBody));
        }
        
        const targetUrl = 'spacesAPIexplorer.html?' + params.toString();
        
        console.log('[API Tracker] Opening URL:', targetUrl);
        
        // Send message to background script to open in new tab
        chrome.runtime.sendMessage({
            type: 'openApiExplorerWithUrl',
            targetUrl: targetUrl
        }, (response) => {
            if (chrome.runtime.lastError) {
                console.error('[API Tracker] Failed to open API Explorer:', chrome.runtime.lastError);
            } else if (response && response.success) {
                console.log('[API Tracker] Success!');
            }
        });
    };

    const updateTrackerWindowMode = (isRecording) => {
        const apiWindow = document.getElementById('spaces-api-tracker-window');
        if (!apiWindow) return;
        
        if (isRecording) {
            // Switch to recording mode with Recording button and stats
            chrome.storage.local.get(['trackedApiCalls'], (data) => {
                const trackedApiCalls = data.trackedApiCalls || {};
                const pageUrls = new Set();
                let totalCalls = 0;
                
                // Use the same counting logic as displayRecordedApisData
                const tabIds = Object.keys(trackedApiCalls);
                
                for (const tabId of tabIds) {
                    const calls = trackedApiCalls[tabId];
                    
                    if (Array.isArray(calls)) {
                        totalCalls += calls.length;
                        calls.forEach((call) => {
                            if (call && call.url) {
                                const pageUrl = call.pageUrl || 'unknown-page';
                                
                                // Filter out extension pages (same as main extension)
                                if (pageUrl.startsWith('chrome-extension://') || 
                                    pageUrl.startsWith('moz-extension://') || 
                                    pageUrl.startsWith('extension://') ||
                                    pageUrl.includes('spacesAPIexplorer.html')) {
                                    return; // Skip this call
                                }
                                
                                pageUrls.add(pageUrl);
                            }
                        });
                    }
                }
                
                const totalPages = pageUrls.size;
                
                apiWindow.innerHTML = `
                    <div class='rec-button-tracker' style='display:flex;flex-direction:column;gap:4px;background:#fff;border:2px solid #ef4444;border-radius:12px;padding:8px 12px;cursor:pointer;animation:recFlash 2s infinite, redPulse 3s infinite;margin:0;min-width:140px;'>
                        <div style='display:flex;align-items:center;justify-content:center;gap:6px;'>
                            <div style='width:8px;height:8px;background:#ef4444;border-radius:50%;animation:recDotPulse 1s infinite;'></div>
                            <span style='font-weight:700;font-size:11px;color:#000;letter-spacing:0.5px;'>Recording</span>
                        </div>
                        <div style='display:flex;justify-content:space-between;font-size:9px;color:#666;font-weight:500;'>
                            <span>${totalPages} pages</span>
                            <span>${totalCalls} calls</span>
                        </div>
                        <div style='text-align:center;font-size:8px;color:#999;font-weight:400;'>Click to stop</div>
                    </div>
                    <style>
                        @keyframes recFlash {
                            0%, 100% { border-color: #ef4444; background: #ffffff; }
                            50% { border-color: #dc2626; background: #fef2f2; }
                        }
                        @keyframes recDotPulse {
                            0%, 100% { background: #ef4444; transform: scale(1); }
                            50% { background: #dc2626; transform: scale(1.2); }
                        }
                        @keyframes redPulse {
                            0%, 100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.4); }
                            50% { box-shadow: 0 0 0 8px rgba(239, 68, 68, 0); }
                        }
                    </style>
                `;
                applyStyles(apiWindow, TRACKER_STYLES.RECORDING_MODE);
                
                // Re-setup event listeners after changing content
                setupEventListeners(apiWindow, isRecording);
            });
        } else {
            // Check if we should show "Stopped" state or normal state
            chrome.storage.local.get(['recordedApisReady'], (data) => {
                if (data.recordedApisReady) {
                    // Show "Stopped" state with View APIs button and count info
                    chrome.storage.local.get(['recordedApiCalls'], (callsData) => {
                        const recordedApiCalls = callsData.recordedApiCalls || {};
                        const pageUrls = new Set();
                        let totalCalls = 0;
                        
                        // Use the same counting logic as displayRecordedApisData
                        const tabIds = Object.keys(recordedApiCalls);
                        
                        for (const tabId of tabIds) {
                            const calls = recordedApiCalls[tabId];
                            
                            if (Array.isArray(calls)) {
                                totalCalls += calls.length;
                                calls.forEach((call) => {
                                    if (call && call.url) {
                                        const pageUrl = call.pageUrl || 'unknown-page';
                                        
                                        // Filter out extension pages (same as main extension)
                                        if (pageUrl.startsWith('chrome-extension://') || 
                                            pageUrl.startsWith('moz-extension://') || 
                                            pageUrl.startsWith('extension://') ||
                                            pageUrl.includes('spacesAPIexplorer.html')) {
                                            return; // Skip this call
                                        }
                                        
                                        pageUrls.add(pageUrl);
                                    }
                                });
                            }
                        }
                        
                        const totalPages = pageUrls.size;
                        
                        // Add transition styles for smooth morphing
                        applyStyles(apiWindow, TRACKER_STYLES.ANIMATION_PREP);
                        
                        setTimeout(() => {
                            apiWindow.innerHTML = `
                                <div class='stopped-button-tracker' style='display:flex;flex-direction:column;gap:4px;background:#fff;border:2px solid #10b981;border-radius:12px;padding:8px 12px;margin:0;min-width:140px;animation:stoppedFlash 2s infinite, greenPulse 3s infinite;position:relative;'>
                                    <button id='close-stopped-btn' style='position:absolute;top:4px;right:4px;background:none;border:none;color:#666;font-size:14px;font-weight:bold;cursor:pointer;padding:0;width:16px;height:16px;display:flex;align-items:center;justify-content:center;border-radius:50%;transition:all 0.2s;' onmouseenter='this.style.background="#f3f4f6"; this.style.color="#000";' onmouseleave='this.style.background="none"; this.style.color="#666";'>×</button>
                                    <div style='display:flex;align-items:center;justify-content:center;gap:6px;'>
                                        <div style='width:8px;height:8px;background:#10b981;border-radius:50%;'></div>
                                        <span style='font-weight:700;font-size:11px;color:#000;letter-spacing:0.5px;'>Stopped</span>
                                    </div>
                                    <div style='display:flex;justify-content:space-between;font-size:9px;color:#666;font-weight:500;'>
                                        <span>${totalPages} pages</span>
                                        <span>${totalCalls} calls</span>
                                    </div>
                                    <button id='view-apis-btn-stopped' style='background:#10b981;color:#fff;border:none;border-radius:6px;padding:6px 10px;cursor:pointer;font-size:10px;font-weight:600;width:100%;margin-top:4px;transition:background 0.2s;' onmouseenter='this.style.background="#059669"' onmouseleave='this.style.background="#10b981"'>View APIs</button>
                                </div>
                                <style>
                                    @keyframes stoppedFlash {
                                        0%, 100% { border-color: #10b981; background: #ffffff; }
                                        50% { border-color: #059669; background: #f0fdf4; }
                                    }
                                    @keyframes greenPulse {
                                        0%, 100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.4); }
                                        50% { box-shadow: 0 0 0 8px rgba(16, 185, 129, 0); }
                                    }
                                </style>
                            `;
                            
                            // Reset outer window styling to minimal (remove any border)
                            applyStyles(apiWindow, TRACKER_STYLES.STOPPED_MODE);
                            
                            // Single clean event binding method
                            setTimeout(() => {
                                const viewApisBtnStopped = apiWindow.querySelector('#view-apis-btn-stopped');
                                if (viewApisBtnStopped) {
                                    viewApisBtnStopped.addEventListener('click', () => {
                                        chrome.runtime.sendMessage({
                                            type: 'openRecordedApis',
                                            currentUrl: window.location.href
                                        }, (response) => {
                                            if (chrome.runtime.lastError) {
                                                console.warn('[API Tracker] Message port closed, but recorded APIs should still open');
                                            }
                                            // Remove the tracker window
                                            apiWindow.remove();
                                            if (window.__apiListInterval) clearInterval(window.__apiListInterval);
                                            window.__spacesApiTrackerInjected = false;
                                        });
                                    });
                                }
                                
                                // Add close button event listener
                                const closeStoppedBtn = apiWindow.querySelector('#close-stopped-btn');
                                if (closeStoppedBtn) {
                                    closeStoppedBtn.addEventListener('click', () => {
                                        // Just close the stopped window without opening anything
                                        apiWindow.remove();
                                        if (window.__apiListInterval) clearInterval(window.__apiListInterval);
                                        window.__spacesApiTrackerInjected = false;
                                    });
                                }
                            }, 100);
                        }, 150);
                    
                    // Ensure the stopped window stays within browser boundaries
                    const rect = apiWindow.getBoundingClientRect();
                    const viewportWidth = window.innerWidth;
                    const viewportHeight = window.innerHeight;
                    
                    // Check if window would be outside right edge
                    if (rect.right > viewportWidth) {
                        const newRight = Math.max(20, viewportWidth - 20);
                        apiWindow.style.right = (viewportWidth - newRight) + 'px';
                        apiWindow.style.left = 'auto';
                    }
                    
                    // Check if window would be outside bottom edge
                    if (rect.bottom > viewportHeight) {
                        const newTop = Math.max(20, viewportHeight - rect.height - 20);
                        apiWindow.style.top = newTop + 'px';
                    }
                    
                    // Check if window would be outside left edge
                    if (rect.left < 0) {
                        apiWindow.style.left = '20px';
                        apiWindow.style.right = 'auto';
                    }
                    
                    // Check if window would be outside top edge
                    if (rect.top < 0) {
                        apiWindow.style.top = '20px';
                    }
                    
                    // Setup event listeners for the stopped mode
                    setupEventListeners(apiWindow, false);
                    });
                } else {
                    // Normal tracker mode
                    apiWindow.innerHTML = createStandardTemplate();
                    applyStyles(apiWindow, TRACKER_STYLES.NORMAL_MODE);
                    window.__spacesApiTrackerApiList = apiWindow.querySelector('#api-list');
                }
                
                setupEventListeners(apiWindow, isRecording);
            });
        }
    };

    const setupDragging = (element) => {
        let isDragging = false, dragOffsetX = 0, dragOffsetY = 0;
        let startX = 0, startY = 0, hasActuallyDragged = false;
        const DRAG_THRESHOLD = 5; // pixels - minimum distance to be considered a drag

        element.addEventListener('mousedown', (e) => {
            if (e.target.id === 'close-api-tracker' || e.target.tagName === 'BUTTON') return;
            isDragging = true;
            hasActuallyDragged = false;
            const rect = element.getBoundingClientRect();
            dragOffsetX = e.clientX - rect.left;
            dragOffsetY = e.clientY - rect.top;
            startX = e.clientX;
            startY = e.clientY;
            element.style.transition = 'none';
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            
            // Calculate distance moved from start position
            const deltaX = Math.abs(e.clientX - startX);
            const deltaY = Math.abs(e.clientY - startY);
            const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
            
            // Only start actually dragging if we've moved beyond threshold
            if (distance > DRAG_THRESHOLD) {
                hasActuallyDragged = true;
                element.style.left = (e.clientX - dragOffsetX) + 'px';
                element.style.top = (e.clientY - dragOffsetY) + 'px';
                element.style.right = '';
            }
        });

        document.addEventListener('mouseup', (e) => {
            // If we actually dragged, prevent click events from bubbling
            if (hasActuallyDragged) {
                e.preventDefault();
                e.stopPropagation();
                
                // Temporarily disable pointer events to prevent click handlers
                const preventClick = (clickEvent) => {
                    clickEvent.preventDefault();
                    clickEvent.stopPropagation();
                    element.removeEventListener('click', preventClick, true);
                };
                element.addEventListener('click', preventClick, true);
            }
            
            isDragging = false;
            hasActuallyDragged = false;
            element.style.transition = '';
        });
    };

    const createApiRow = (apiCall) => {
        const url = typeof apiCall === 'string' ? apiCall : apiCall.url;
        const method = typeof apiCall === 'string' ? 'GET' : (apiCall.method || 'GET');
        const requestBody = typeof apiCall === 'string' ? null : apiCall.requestBody;
        const path = url.replace(/^https?:\/\/[^/]+/, '');

        const methodColors = {
            'GET': '#10b981', 'POST': '#3b82f6', 'PUT': '#f59e0b',
            'PATCH': '#8b5cf6', 'DELETE': '#ef4444'
        };

        const row = document.createElement('div');
        Object.assign(row.style, {
            display: 'flex', alignItems: 'flex-start', marginBottom: '8px',
            padding: '6px', borderRadius: '4px', cursor: 'pointer',
            transition: 'background-color 0.2s', wordWrap: 'break-word',
            overflowWrap: 'break-word', minWidth: '0'
        });

        row.innerHTML = `
            <span style='background: ${methodColors[method] || '#6b7280'}; color: white; padding: 2px 6px; border-radius: 3px; font-size: 11px; font-weight: bold; margin-right: 8px; min-width: 45px; text-align: center; flex-shrink: 0;'>${method}</span>
            <span style='font-family:monospace;font-size:12px;flex:1;word-wrap:break-word;overflow-wrap:break-word;min-width:0;line-height:1.3;'>${path}</span>
            <div style='display:flex;gap:6px;flex-shrink:0;margin-left:6px;'>
                ${requestBody ? '<button class="payload-btn" style="padding:2px 6px;border-radius:3px;border:none;background:#8b5cf6;color:#fff;cursor:pointer;font-size:11px;position:relative;">Payload</button>' : ''}
                <button class="navigate-btn" style='padding:4px 8px;border-radius:4px;border:none;background:#0074d9;color:#fff;cursor:pointer;font-size:12px;display:flex;align-items:center;gap:4px;' title="Open in API Explorer">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22Z"/>
                        <path d="M12 8L16 12L12 16"/>
                        <path d="M8 12H16"/>
                    </svg>
                </button>
            </div>
        `;

        const navigateBtn = row.querySelector('.navigate-btn');
        navigateBtn.onclick = async (e) => {
            e.stopPropagation();
            
            // Show loading state
            const originalHTML = navigateBtn.innerHTML;
            navigateBtn.style.background = '#f59e0b';
            navigateBtn.innerHTML = `
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M21 12a9 9 0 11-6.219-8.56"/>
                </svg>
            `;
            
            // Use shared navigation function
            navigateToApiExplorer(url, method, requestBody);
            
            // Show success state
            setTimeout(() => {
                navigateBtn.style.background = '#10b981';
                navigateBtn.innerHTML = `
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M20 6L9 17l-5-5"/>
                    </svg>
                `;
                
                // Reset button after delay
                setTimeout(() => {
                    navigateBtn.style.background = '#0074d9';
                    navigateBtn.innerHTML = originalHTML;
                }, 1500);
            }, 200);
        };

        const payloadBtn = row.querySelector('.payload-btn');
        if (payloadBtn && requestBody) {
            setupPayloadTooltip(payloadBtn, requestBody);
        }

        return row;
    };

    const setupPayloadTooltip = (button, requestBody) => {
        const payloadText = typeof requestBody === 'string' ? requestBody : JSON.stringify(requestBody, null, 2);
        
        const tooltip = document.createElement('div');
        tooltip.style.cssText = `
            position: absolute; bottom: 100%; right: 0; background: #333; color: white;
            padding: 12px 16px; border-radius: 8px; font-size: 12px;
            font-family: 'Fira Mono', 'Menlo', 'Consolas', monospace;
            min-width: 200px; max-width: 350px; max-height: 300px; overflow: auto;
            white-space: pre-wrap; z-index: 10000; box-shadow: 0 6px 20px rgba(0,0,0,0.4);
            display: none; word-break: break-word; line-height: 1.4; margin-bottom: 8px;
        `;
        tooltip.textContent = payloadText;

        const arrow = document.createElement('div');
        arrow.style.cssText = `
            position: absolute; top: 100%; right: 20px; width: 0; height: 0;
            border-left: 6px solid transparent; border-right: 6px solid transparent;
            border-top: 6px solid #333;
        `;
        tooltip.appendChild(arrow);
        button.appendChild(tooltip);

        button.onmouseenter = () => tooltip.style.display = 'block';
        button.onmouseleave = () => tooltip.style.display = 'none';
        
        button.onclick = (e) => {
            e.stopPropagation();
            navigator.clipboard.writeText(payloadText).catch(error => 
                console.error('[API Tracker] Payload copy failed:', error)
            );
            button.style.background = '#10b981';
            button.textContent = 'Copied!';
            tooltip.style.display = 'none';
            setTimeout(() => {
                button.style.background = '#8b5cf6';
                button.textContent = 'Payload';
            }, 1500);
        };
    };

    // Function to update recording window counts in real-time
    const updateRecordingCounts = () => {
        const recordingButton = document.querySelector('.rec-button-tracker');
        if (!recordingButton) return;
        
        // Use the same data source as the main extension: trackedApiCalls
        chrome.storage.local.get(['trackedApiCalls'], (data) => {
            const trackedApiCalls = data.trackedApiCalls || {};
            const pageUrls = new Set();
            let totalCalls = 0;
            
            // Use the same counting logic as displayRecordedApisData
            const tabIds = Object.keys(trackedApiCalls);
            
            for (const tabId of tabIds) {
                const calls = trackedApiCalls[tabId];
                
                if (Array.isArray(calls)) {
                    totalCalls += calls.length;
                    calls.forEach((call) => {
                        if (call && call.url) {
                            const pageUrl = call.pageUrl || 'unknown-page';
                            
                            // Filter out extension pages (same as main extension)
                            if (pageUrl.startsWith('chrome-extension://') || 
                                pageUrl.startsWith('moz-extension://') || 
                                pageUrl.startsWith('extension://') ||
                                pageUrl.includes('spacesAPIexplorer.html')) {
                                return; // Skip this call
                            }
                            
                            pageUrls.add(pageUrl);
                        }
                    });
                }
            }
            
            const totalPages = pageUrls.size;
            
            // Update the counts in the recording button - look for the counts div more specifically
            const countsDiv = recordingButton.querySelector('div[style*="justify-content:space-between"]');
            if (countsDiv) {
                countsDiv.innerHTML = `
                    <span>${totalPages} pages</span>
                    <span>${totalCalls} calls</span>
                `;
            }
        });
    };

    const updateApiList = () => {
        updateRecordingCounts(); // Update counts when API list updates
        if (!window.__spacesApiTrackerApiList) return;

        try {
            const tabId = window.__currentTabId || 'unknown';
            
            chrome.storage.local.get({ 
                trackedApiCalls: {}, 
                isRecording: false, 
                trackerEnabled: false,
                navigationTimestamp: 0
            }, (data) => {
                if (chrome.runtime.lastError) {
                    return;
                }

                const tabCalls = data.trackedApiCalls[tabId] || [];
                const unknownCalls = data.trackedApiCalls.unknown || [];
                let allCalls = [...tabCalls, ...unknownCalls];

                // If tracking (not recording), filter calls to show only those after navigation
                if (data.trackerEnabled && !data.isRecording && data.navigationTimestamp > 0) {
                    allCalls = allCalls.filter(call => {
                        const callTime = call.timestamp || 0;
                        return callTime >= data.navigationTimestamp;
                    });
                    console.log('[API Tracker] Filtered calls for current page - showing', allCalls.length, 'calls after timestamp', data.navigationTimestamp);
                }

                console.log('[API Tracker] updateApiList - tabId:', tabId, 'total calls before filter:', (tabCalls.length + unknownCalls.length), 'showing:', allCalls.length);

                // Create a map of current API calls to avoid unnecessary DOM manipulation
                const currentAPIs = new Set();
                const seen = new Set();

                allCalls.forEach(apiCall => {
                    const url = typeof apiCall === 'string' ? apiCall : apiCall.url;
                    if (url && !seen.has(url)) {
                        seen.add(url);
                        currentAPIs.add(url);
                    }
                });

                // Check if the content actually needs to be updated
                const existingItems = window.__spacesApiTrackerApiList.querySelectorAll('.api-call-row');
                const existingAPIs = new Set();
                existingItems.forEach(item => {
                    const url = item.dataset.apiUrl;
                    if (url) existingAPIs.add(url);
                });

                // Only rebuild if the APIs have changed
                const apisChanged = currentAPIs.size !== existingAPIs.size || 
                    [...currentAPIs].some(api => !existingAPIs.has(api)) ||
                    [...existingAPIs].some(api => !currentAPIs.has(api));

                if (!apisChanged) {
                    return; // No changes, skip update to prevent flash
                }

                // Rebuild the list only when necessary
                window.__spacesApiTrackerApiList.innerHTML = '';
                const seenRebuild = new Set();

                allCalls.forEach(apiCall => {
                    const url = typeof apiCall === 'string' ? apiCall : apiCall.url;
                    const method = typeof apiCall === 'string' ? 'GET' : (apiCall.method || 'GET');
                    const path = url.replace(/^https?:\/\/[^/]+/, '');
                    const callKey = `${method} ${path}`;

                    if (!seenRebuild.has(callKey)) {
                        seenRebuild.add(callKey);
                        const row = createApiRow(apiCall);
                        row.dataset.apiUrl = url; // Add data attribute for tracking
                        row.classList.add('api-call-row'); // Add class for identification
                        window.__spacesApiTrackerApiList.appendChild(row);
                    }
                });
            });
        } catch (error) {
            console.error('[API Tracker] Extension context invalidated:', error);
            if (window.__apiListInterval) clearInterval(window.__apiListInterval);
        }
    };

    const setRecordingIndicator = (active) => {
        // Only update if the recording state actually changed
        chrome.storage.local.get(['isRecording'], (data) => {
            const currentRecordingState = !!data.isRecording;
            if (currentRecordingState !== active) {
                // Update tracker window mode only if state changed
                updateTrackerWindowMode(active);
                chrome.storage.local.set({ isRecording: active });
            }
        });
    };

    createTrackerWindow();

    setTimeout(() => {
        chrome.storage.local.get(['isRecording'], (data) => {
            setRecordingIndicator(!!data.isRecording);
        });
    }, 100);

    updateApiList();
    
    // Clear any existing interval before creating a new one
    if (window.__apiListInterval) {
        clearInterval(window.__apiListInterval);
    }
    window.__apiListInterval = setInterval(updateApiList, 2000);

    // API request function for API Explorer
    async function makeApiRequest(url, method = 'GET') {
        try {
            console.log(`[API Tracker] Making ${method} request to:`, url);
            
            const response = await fetch(url, {
                method: method,
                credentials: 'include', // Include cookies
                headers: {
                    'Accept': 'application/json, text/plain, */*',
                    'Content-Type': 'application/json'
                }
            });
            
            const responseText = await response.text();
            let responseData;
            
            try {
                responseData = JSON.parse(responseText);
            } catch (e) {
                responseData = responseText;
            }
            
            const responseHeaders = {};
            response.headers.forEach((value, key) => {
                responseHeaders[key] = value;
            });
            
            return {
                status: response.status,
                statusText: response.statusText,
                data: responseData,
                headers: responseHeaders
            };
            
        } catch (error) {
            console.error('[API Tracker] API request failed:', error);
            throw error;
        }
    }

    // Ensure only one message listener is registered
    if (!window.__spacesApiTrackerMessageListener) {
        window.__spacesApiTrackerMessageListener = (request, sender, sendResponse) => {
            switch (request.type) {
                case 'setRecordingIndicator':
                    setRecordingIndicator(request.active);
                    break;
                case 'startRecording':
                    console.log('[API Tracker] Recording started');
                    updateTrackerWindowMode(true);
                    break;
                case 'stopRecording':
                    console.log('[API Tracker] Recording stopped');
                    updateTrackerWindowMode(false);
                    break;
                case 'makeApiRequest':
                    // Handle API request for API Explorer
                    makeApiRequest(request.url, request.method || 'GET')
                        .then(response => sendResponse(response))
                        .catch(error => sendResponse({ error: error.message }));
                    return true; // Keep message channel open for async response
            }
        };
        chrome.runtime.onMessage.addListener(window.__spacesApiTrackerMessageListener);
    }

    let lastUrl = window.location.href;
    const checkUrlChange = () => {
        if (window.location.href !== lastUrl) {
            const previousUrl = lastUrl;
            lastUrl = window.location.href;
            console.log(`[API Tracker] Navigation detected: ${previousUrl} → ${lastUrl}`);
            
            // Only clear display for different pages during tracking mode
            const previousPath = previousUrl ? new URL(previousUrl).pathname : '';
            const currentPath = new URL(lastUrl).pathname;
            
            if (previousPath && previousPath !== currentPath) {
                chrome.storage.local.get(['isRecording', 'trackerEnabled'], (data) => {
                    if (data.trackerEnabled && !data.isRecording) {
                        console.log('[API Tracker] Different page detected - setting navigation timestamp');
                        console.log('[API Tracker] Path changed from:', previousPath, 'to:', currentPath);
                        
                        // Set a navigation timestamp instead of clearing storage
                        const navigationTime = Date.now();
                        chrome.storage.local.set({ 
                            navigationTimestamp: navigationTime,
                            lastNavigationPath: currentPath 
                        }, () => {
                            console.log('[API Tracker] Navigation timestamp set:', navigationTime);
                            // Clear display immediately - it will repopulate with relevant calls
                            if (window.__spacesApiTrackerApiList) {
                                window.__spacesApiTrackerApiList.innerHTML = '';
                            }
                        });
                    }
                });
            } else {
                console.log('[API Tracker] Same page or hash change - keeping API calls');
            }
        }
    };

    // Prevent duplicate event listeners
    if (!window.__spacesApiTrackerEventListeners) {
        window.__spacesApiTrackerEventListeners = true;
        window.addEventListener('popstate', checkUrlChange);
        window.addEventListener('hashchange', checkUrlChange);
        
        // Clear any existing URL check interval
        if (window.__urlCheckInterval) {
            clearInterval(window.__urlCheckInterval);
        }
        window.__urlCheckInterval = setInterval(checkUrlChange, 1000);
    }
})();
