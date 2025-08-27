// Initialize clean state when extension starts
chrome.runtime.onStartup.addListener(() => {
    console.log('[Background] Extension startup - cleaning tracker state (preserving recorded data)');
    chrome.storage.local.remove(['isRecording', 'trackerEnabled', 'recordedApisReady', 'trackedApiCalls'], () => {
        console.log('[Background] Startup cleanup completed - recorded data preserved');
        // Migrate existing data if needed
        migrateApiCallsData();
    });
});

chrome.runtime.onInstalled.addListener(() => {
    console.log('[Background] Extension installed/reloaded - cleaning tracker state (preserving recorded data)');
    chrome.storage.local.remove(['isRecording', 'trackerEnabled', 'recordedApisReady', 'trackedApiCalls'], () => {
        console.log('[Background] Install/reload cleanup completed - recorded data preserved');
        // Migrate existing data if needed
        migrateApiCallsData();
    });
});

// Migrate existing apiCallsByTab data to new storage format
function migrateApiCallsData() {
    chrome.storage.local.get(['apiCallsByTab'], (data) => {
        if (chrome.runtime.lastError) {
            console.error('[Background] Migration: Storage error:', chrome.runtime.lastError);
            return;
        }
        
        const existingApiCalls = data.apiCallsByTab;
        
        // Migrate old data to new format and remove old storage
        if (existingApiCalls && Object.keys(existingApiCalls).length > 0) {
            console.log('[Background] Migrating apiCallsByTab data to dual storage...');
            
            chrome.storage.local.set({ 
                recordedApiCalls: existingApiCalls,
                trackedApiCalls: {}  // Start with empty tracked calls
            }, () => {
                if (chrome.runtime.lastError) {
                    console.error('[Background] Migration failed:', chrome.runtime.lastError);
                } else {
                    console.log('[Background] Migration completed successfully');
                    // Remove the old storage key
                    chrome.storage.local.remove(['apiCallsByTab'], () => {
                        console.log('[Background] Old apiCallsByTab storage removed');
                    });
                }
            });
        } else {
            console.log('[Background] No old data to migrate, removing apiCallsByTab key if present');
            chrome.storage.local.remove(['apiCallsByTab']);
        }
    });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'getCookie') {
        chrome.cookies.get({ url: request.url, name: request.name }, (cookie) => {
            sendResponse({ cookie });
        });
        return true;
    }
    
    if (request.type === 'recordingStopped') {
        // Update storage to turn off tracker and recording state
        chrome.storage.local.set({ 
            isRecording: false, 
            trackerEnabled: false,
            recordedApisReady: true
        });
        
        // Broadcast stop recording messages to ALL tabs with trackers
        chrome.tabs.query({}, (tabs) => {
            tabs.forEach(tab => {
                // Send both recording indicator and stop recording messages
                chrome.tabs.sendMessage(tab.id, { type: 'setRecordingIndicator', active: false }, () => {
                    if (chrome.runtime.lastError) {
                        // This is expected for tabs without our content script
                    }
                });
                
                chrome.tabs.sendMessage(tab.id, { type: 'stopRecording' }, () => {
                    if (chrome.runtime.lastError) {
                        // This is expected for tabs without our content script
                    }
                });
            });
        });
        
        sendResponse({ success: true });
        return true;
    }
    
    if (request.type === 'trackerClosed') {
        // Update storage to turn off tracker state when tracker window is closed
        chrome.storage.local.set({ trackerEnabled: false });
        sendResponse({ success: true });
        return true;
    }
    
    if (request.type === 'getRecordingStatus') {
        // Get current recording status
        chrome.storage.local.get(['isRecording'], (result) => {
            sendResponse({ isRecording: result.isRecording || false });
        });
        return true;
    }
    
    if (request.type === 'openApiExplorer') {
        console.log('[Background] ===== OPEN API EXPLORER REQUEST =====');
        console.log('[Background] Request:', request);
        
        // Check if we're already on an API Explorer tab
        chrome.tabs.query({ active: true, currentWindow: true }, (currentTabs) => {
            const currentTab = currentTabs[0];
            const apiExplorerUrl = chrome.runtime.getURL('spacesAPIexplorer.html');
            
            if (currentTab.url.startsWith(apiExplorerUrl)) {
                // We're already on the API Explorer tab, just update to explorer tab
                const currentUrl = new URL(currentTab.url);
                currentUrl.searchParams.set('tab', 'api-explorer-tab');
                
                chrome.tabs.update(currentTab.id, { 
                    url: currentUrl.toString()
                }, (updatedTab) => {
                    if (chrome.runtime.lastError) {
                        console.error('[Background] Failed to update current API Explorer tab:', chrome.runtime.lastError);
                        sendResponse({ success: false, error: chrome.runtime.lastError.message });
                    } else {
                        sendResponse({ success: true, tabId: updatedTab.id, action: 'updated current tab to explorer' });
                    }
                });
                return;
            }
            
            // Not on API Explorer tab, proceed with normal logic
            try {
                const domain = new URL(request.currentUrl).origin;
                const targetUrl = apiExplorerUrl + 
                                 `?domain=${encodeURIComponent(domain)}&tab=api-explorer-tab`;
                
                console.log('[Background] Target URL:', targetUrl);
                
                // Query for existing tabs with the API explorer
                chrome.tabs.query({ url: apiExplorerUrl + '*' }, (existingTabs) => {
                    if (chrome.runtime.lastError) {
                        console.error('[Background] Failed to query tabs:', chrome.runtime.lastError);
                        sendResponse({ success: false, error: chrome.runtime.lastError.message });
                        return;
                    }
                    
                    // Check if any existing tab matches our domain
                    const matchingTab = existingTabs.find(tab => {
                        try {
                            const tabUrl = new URL(tab.url);
                            const targetUrlObj = new URL(targetUrl);
                            return tabUrl.searchParams.get('domain') === targetUrlObj.searchParams.get('domain');
                        } catch (e) {
                            return false;
                        }
                    });
                    
                    if (matchingTab) {
                        // Focus existing tab and update URL to ensure correct tab is selected
                        chrome.tabs.update(matchingTab.id, { 
                            active: true,
                            url: targetUrl
                        }, (updatedTab) => {
                            if (chrome.runtime.lastError) {
                                console.error('[Background] Failed to focus existing tab:', chrome.runtime.lastError);
                                sendResponse({ success: false, error: chrome.runtime.lastError.message });
                            } else {
                                // Also bring the window to front
                                chrome.windows.update(updatedTab.windowId, { focused: true }, () => {
                                    if (chrome.runtime.lastError) {
                                        console.error('[Background] Failed to focus window:', chrome.runtime.lastError);
                                    }
                                    sendResponse({ success: true, tabId: updatedTab.id, action: 'focused' });
                                });
                            }
                        });
                    } else {
                        // Create new tab if no existing tab found
                        chrome.tabs.create({
                            url: targetUrl
                        }, (tab) => {
                            if (chrome.runtime.lastError) {
                                console.error('[Background] Failed to create tab:', chrome.runtime.lastError);
                                sendResponse({ success: false, error: chrome.runtime.lastError.message });
                            } else {
                                sendResponse({ success: true, tabId: tab.id, action: 'created' });
                            }
                        });
                    }
                });
            } catch (error) {
                console.error('[Background] Failed to open API Explorer:', error);
                sendResponse({ success: false, error: error.message });
            }
        });
        return true;
    }
    
    if (request.type === 'openRecordedApis') {
        console.log('[Background] ===== OPEN RECORDED APIS REQUEST =====');
        console.log('[Background] Request:', request);
        
        // Check if we're already on an API Explorer tab
        chrome.tabs.query({ active: true, currentWindow: true }, (currentTabs) => {
            const currentTab = currentTabs[0];
            const apiExplorerUrl = chrome.runtime.getURL('spacesAPIexplorer.html');
            
            if (currentTab.url.startsWith(apiExplorerUrl)) {
                // We're already on the API Explorer tab, just update the tab parameter
                const currentUrl = new URL(currentTab.url);
                currentUrl.searchParams.set('tab', 'recorded-apis-tab');
                
                chrome.tabs.update(currentTab.id, { 
                    url: currentUrl.toString()
                }, (updatedTab) => {
                    if (chrome.runtime.lastError) {
                        console.error('[Background] Failed to update current API Explorer tab:', chrome.runtime.lastError);
                        sendResponse({ success: false, error: chrome.runtime.lastError.message });
                    } else {
                        sendResponse({ success: true, tabId: updatedTab.id, action: 'updated current tab' });
                    }
                });
                return;
            }
            
            // Not on API Explorer tab, proceed with normal logic
            try {
                const domain = new URL(request.currentUrl).origin;
                const targetUrl = apiExplorerUrl + 
                                 `?domain=${encodeURIComponent(domain)}&tab=recorded-apis-tab`;
                
                console.log('[Background] Target URL:', targetUrl);
                
                // Query for existing tabs with the API explorer
                chrome.tabs.query({ url: apiExplorerUrl + '*' }, (existingTabs) => {
                if (chrome.runtime.lastError) {
                    console.error('[Background] Failed to query tabs:', chrome.runtime.lastError);
                    sendResponse({ success: false, error: chrome.runtime.lastError.message });
                    return;
                }
                
                // Check if any existing tab matches our domain
                const matchingTab = existingTabs.find(tab => {
                    try {
                        const tabUrl = new URL(tab.url);
                        const targetUrlObj = new URL(targetUrl);
                        return tabUrl.searchParams.get('domain') === targetUrlObj.searchParams.get('domain');
                    } catch (e) {
                        return false;
                    }
                });
                
                if (matchingTab) {
                    // Focus existing tab and update URL to ensure correct tab is selected
                    chrome.tabs.update(matchingTab.id, { 
                        active: true,
                        url: targetUrl
                    }, (updatedTab) => {
                        if (chrome.runtime.lastError) {
                            console.error('[Background] Failed to focus existing tab:', chrome.runtime.lastError);
                            sendResponse({ success: false, error: chrome.runtime.lastError.message });
                        } else {
                            // Also bring the window to front
                            chrome.windows.update(updatedTab.windowId, { focused: true }, () => {
                                if (chrome.runtime.lastError) {
                                    console.error('[Background] Failed to focus window:', chrome.runtime.lastError);
                                }
                                sendResponse({ success: true, tabId: updatedTab.id, action: 'focused' });
                            });
                        }
                    });
                } else {
                    // Create new tab if no existing tab found
                    chrome.tabs.create({
                        url: targetUrl
                    }, (tab) => {
                        if (chrome.runtime.lastError) {
                            console.error('[Background] Failed to create tab:', chrome.runtime.lastError);
                            sendResponse({ success: false, error: chrome.runtime.lastError.message });
                        } else {
                            sendResponse({ success: true, tabId: tab.id, action: 'created' });
                        }
                    });
                }
            });
            } catch (error) {
                console.error('[Background] Failed to open recorded APIs:', error);
                sendResponse({ success: false, error: error.message });
            }
        });
        return true;
    }
    
    if (request.type === 'apiResponse') {
        // Store response data for API calls in BOTH storage locations
        const tabId = sender.tab?.id;
        if (tabId) {
            chrome.storage.local.get({ trackedApiCalls: {}, recordedApiCalls: {} }, (data) => {
                const trackedApiCalls = data.trackedApiCalls;
                const recordedApiCalls = data.recordedApiCalls;
                
                // Update tracked calls
                if (trackedApiCalls[tabId]) {
                    const matchingTrackedCall = trackedApiCalls[tabId].find(call => 
                        call.url === request.url && call.method === request.method
                    );
                    if (matchingTrackedCall) {
                        matchingTrackedCall.responseData = request.responseData;
                        matchingTrackedCall.responseStatus = request.responseStatus;
                        matchingTrackedCall.responseTimestamp = request.responseTimestamp;
                    }
                }
                
                // Update recorded calls
                if (recordedApiCalls[tabId]) {
                    const matchingRecordedCall = recordedApiCalls[tabId].find(call => 
                        call.url === request.url && call.method === request.method
                    );
                    if (matchingRecordedCall) {
                        matchingRecordedCall.responseData = request.responseData;
                        matchingRecordedCall.responseStatus = request.responseStatus;
                        matchingRecordedCall.responseTimestamp = request.responseTimestamp;
                    }
                }
                
                chrome.storage.local.set({ trackedApiCalls, recordedApiCalls });
                console.log('[Background] Response data stored in both tracking and recording storage');
            });
        }
        sendResponse({ success: true });
        return true;
    }
    
    if (request.type === 'openApiExplorerWithUrl') {
        const fullUrl = chrome.runtime.getURL(request.targetUrl);
        console.log('[Background] Opening API Explorer with URL:', fullUrl);
        
        // Check if API Explorer tab is already open
        chrome.tabs.query({ url: chrome.runtime.getURL('spacesAPIexplorer.html') + '*' }, (existingTabs) => {
            if (chrome.runtime.lastError) {
                console.error('[Background] Error querying tabs:', chrome.runtime.lastError);
                sendResponse({ success: false, error: chrome.runtime.lastError.message });
                return;
            }
            
            if (existingTabs.length > 0) {
                // Focus existing tab and update URL
                chrome.tabs.update(existingTabs[0].id, { 
                    active: true,
                    url: fullUrl
                }, () => {
                    if (chrome.runtime.lastError) {
                        console.error('[Background] Error updating tab:', chrome.runtime.lastError);
                        sendResponse({ success: false, error: chrome.runtime.lastError.message });
                    } else {
                        sendResponse({ success: true });
                    }
                });
            } else {
                // Create new tab
                chrome.tabs.create({ url: fullUrl }, (tab) => {
                    if (chrome.runtime.lastError) {
                        console.error('[Background] Error creating tab:', chrome.runtime.lastError);
                        sendResponse({ success: false, error: chrome.runtime.lastError.message });
                    } else {
                        sendResponse({ success: true });
                    }
                });
            }
        });
        return true;
    }
});

const requestDetails = new Map();
const API_URL_PATTERN = /\/(api|apimonitor)\//;

const captureRequestBody = (details) => {
    if (!details.requestBody) return null;
    
    if (details.requestBody.formData) {
        return details.requestBody.formData;
    }
    
    if (details.requestBody.raw) {
        try {
            const decoder = new TextDecoder();
            return details.requestBody.raw.map(data => decoder.decode(data.bytes)).join('');
        } catch (error) {
            console.error('[Background] Failed to decode request body:', error);
            return null;
        }
    }
    
    return null;
};

chrome.webRequest.onBeforeRequest.addListener(
    (details) => {
        if (API_URL_PATTERN.test(details.url)) {
            console.log('[Background] API call detected:', details.method, details.url);
            requestDetails.set(details.requestId, {
                method: details.method,
                requestBody: captureRequestBody(details),
                url: details.url
            });
        }
    },
    { urls: ["<all_urls>"] },
    ["requestBody"]
);

chrome.webRequest.onCompleted.addListener(
    (details) => {
        if (!API_URL_PATTERN.test(details.url)) return;

        console.log('[Background] API call completed:', details.method, details.url, '- checking if recording enabled...');
        
        const tabId = details.tabId >= 0 ? details.tabId : 'unknown';
        const storedDetails = requestDetails.get(details.requestId);

        // Get the actual tab URL for better page tracking
        if (tabId !== 'unknown') {
            chrome.tabs.get(tabId, (tab) => {
                if (chrome.runtime.lastError) {
                    console.error('[Background] Failed to get tab info:', chrome.runtime.lastError);
                    return;
                }

                const actualPageUrl = tab.url || details.initiator || 'unknown';
                storeApiCall(tabId, details, storedDetails, actualPageUrl);
            });
        } else {
            storeApiCall(tabId, details, storedDetails, details.initiator || 'unknown');
        }
    },
    { urls: ["<all_urls>"] }
);

function storeApiCall(tabId, details, storedDetails, pageUrl) {
    // Check if either recording OR tracking is enabled
    chrome.storage.local.get(['isRecording', 'trackerEnabled'], (data) => {
        if (chrome.runtime.lastError) {
            console.error('[Background] Storage error checking recording/tracking state:', chrome.runtime.lastError);
            return;
        }
        
        if (!data.isRecording && !data.trackerEnabled) {
            console.log('[Background] Neither recording nor tracking enabled, skipping API call storage');
            return;
        }
        
        // Filter out extension pages
        if (pageUrl && (pageUrl.startsWith('chrome-extension://') || 
                        pageUrl.startsWith('moz-extension://') || 
                        pageUrl.startsWith('extension://') ||
                        pageUrl.includes('spacesAPIexplorer.html'))) {
            console.log('[Background] Skipping API call from extension page:', pageUrl);
            return;
        }
        
        console.log('[Background] Recording or tracking enabled, storing API call - isRecording:', !!data.isRecording, 'trackerEnabled:', !!data.trackerEnabled);
        
        // Store in BOTH tracking and recording storage
        chrome.storage.local.get({ trackedApiCalls: {}, recordedApiCalls: {} }, (data) => {
            if (chrome.runtime.lastError) {
                console.error('[Background] Storage error:', chrome.runtime.lastError);
                return;
            }

            const trackedApiCalls = data.trackedApiCalls;
            const recordedApiCalls = data.recordedApiCalls;
            
            // Initialize arrays for this tab if they don't exist
            if (!trackedApiCalls[tabId]) trackedApiCalls[tabId] = [];
            if (!recordedApiCalls[tabId]) recordedApiCalls[tabId] = [];

            const method = storedDetails?.method || details.method;
            const requestBody = storedDetails?.requestBody;
            const callKey = `${method} ${details.url}`;

            // Check if call already exists in recorded calls
            const exists = recordedApiCalls[tabId].some(call => 
                `${call.method} ${call.url}` === callKey
            );

            if (!exists) {
                console.log('[Background] Storing API call:', method, details.url, 'for page:', pageUrl);
                
                // Enhanced API call data structure
                const apiCallData = {
                    url: details.url,
                    method,
                    timestamp: Date.now(),
                    requestId: details.requestId,
                    requestBody,
                    pageUrl: pageUrl,
                    tabUrl: pageUrl
                };
                
                // Add to both storage locations
                trackedApiCalls[tabId].push({ ...apiCallData });
                recordedApiCalls[tabId].push({ ...apiCallData });
                
                chrome.storage.local.set({ trackedApiCalls, recordedApiCalls }, () => {
                    if (chrome.runtime.lastError) {
                        console.error('[Background] Failed to save API call:', chrome.runtime.lastError);
                    } else {
                        console.log('[Background] API call saved to both tracking and recording storage for page:', pageUrl);
                    }
                });
            } else {
                console.log('[Background] Duplicate API call, skipping:', method, details.url);
            }

            requestDetails.delete(details.requestId);
        });
    });
}

const clearApiCallsForTab = (tabId) => {
    // Clear only tracked calls for the tab, preserve recorded calls
    chrome.storage.local.get({ trackedApiCalls: {} }, (data) => {
        const trackedApiCalls = data.trackedApiCalls;
        trackedApiCalls[tabId] = [];
        trackedApiCalls.unknown = [];
        chrome.storage.local.set({ trackedApiCalls });
        console.log('[Background] Cleared tracked API calls for tab:', tabId);
    });
};

const reinjectTracker = (tabId, isRecording) => {
    // Get tab URL first to avoid injecting into extension pages
    chrome.tabs.get(tabId, (tab) => {
        if (chrome.runtime.lastError) {
            console.log('[Background] Could not get tab info, skipping injection');
            return;
        }
        
        // Skip injection for extension pages and non-web pages
        if (!tab.url || !tab.url.startsWith('http')) {
            console.log('[Background] Skipping tracker injection for:', tab.url);
            return;
        }
        
        // Now proceed with the original injection logic
        doReinjectTracker(tabId, isRecording);
    });
};

const doReinjectTracker = (tabId, isRecording) => {
    // First check if tracker is already injected to avoid duplicates
    chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
            return {
                hasTracker: !!window.__spacesApiTrackerInjected,
                hasWindow: !!document.getElementById('spaces-api-tracker-window')
            };
        }
    }, (results) => {
        if (chrome.runtime.lastError) {
            console.error('[Background] Failed to check tracker status:', JSON.stringify(chrome.runtime.lastError));
            return;
        }

        const trackerStatus = results?.[0]?.result;
        if (trackerStatus?.hasTracker && trackerStatus?.hasWindow) {
            console.log('[Background] Tracker already present, skipping injection');
            
            // Just restore recording indicator if needed
            if (isRecording) {
                setTimeout(() => {
                    chrome.tabs.sendMessage(tabId, { type: 'setRecordingIndicator', active: true }, () => {
                        if (chrome.runtime.lastError) {
                            console.error('[Background] Failed to restore recording indicator:', JSON.stringify(chrome.runtime.lastError));
                        }
                    });
                }, 200);
            }
            return;
        }

        // Proceed with injection only if tracker is not present
        chrome.scripting.executeScript({
            target: { tabId },
            func: (currentTabId) => { window.__currentTabId = currentTabId; },
            args: [tabId]
        }, () => {
            if (chrome.runtime.lastError) {
                console.error('[Background] Failed to inject tab ID:', chrome.runtime.lastError);
                return;
            }

            chrome.scripting.executeScript({
                target: { tabId },
                files: ['apiTracker.js']
            }, () => {
                if (chrome.runtime.lastError) {
                    console.error('[Background] Failed to inject tracker:', chrome.runtime.lastError);
                    return;
                }

                console.log('[Background] Tracker re-injected after navigation');

                if (isRecording) {
                    setTimeout(() => {
                        chrome.tabs.sendMessage(tabId, { type: 'setRecordingIndicator', active: true }, () => {
                            if (chrome.runtime.lastError) {
                                console.error('[Background] Failed to restore recording indicator:', JSON.stringify(chrome.runtime.lastError));
                            }
                        });
                    }, 200);
                }
            });
        });
    });
};

chrome.webNavigation.onCommitted.addListener((details) => {
    const tabId = details.tabId;
    if (tabId < 0) return;

    // Only process main frame navigations, not sub-frames
    if (details.frameId !== 0) return;

    chrome.storage.local.get(['isRecording', 'trackerEnabled'], (data) => {
        if (chrome.runtime.lastError) {
            console.error('[Background] Storage error during navigation:', chrome.runtime.lastError);
            return;
        }

        // If only tracking (not recording), set navigation timestamp for filtering
        if (data.trackerEnabled && !data.isRecording) {
            console.log('[Background] Navigation detected during tracking - setting timestamp for filtering');
            
            // Set navigation timestamp instead of clearing data
            const navigationTime = Date.now();
            chrome.storage.local.set({ 
                navigationTimestamp: navigationTime 
            }, () => {
                console.log('[Background] Navigation timestamp set for tracking filter:', navigationTime);
            });
        } else {
            console.log('[Background] Navigation detected - preserving all API calls');
        }

        // Only auto-inject tracker if currently recording OR tracking
        if (data.isRecording || data.trackerEnabled) {
            console.log('[Background] Auto-injecting tracker due to active recording/tracking');
            reinjectTracker(tabId, data.isRecording);
        }
    });
});

chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
    const tabId = details.tabId;
    if (tabId >= 0 && details.frameId === 0) {
        // NOTE: No longer clearing on history updates - data persists until user explicitly clears it
        // This preserves recorded data when using browser back/forward buttons after stopping recording
        console.log('[Background] History state updated - preserving recorded API calls');
    }
});

// Periodic cleanup of old tracked API calls to prevent indefinite storage growth
function cleanupOldTrackedApiCalls() {
    const MAX_AGE_HOURS = 24; // Remove calls older than 24 hours
    const MAX_CALLS_PER_TAB = 100; // Keep only the newest 100 calls per tab
    const cutoffTime = Date.now() - (MAX_AGE_HOURS * 60 * 60 * 1000);
    
    chrome.storage.local.get({ trackedApiCalls: {} }, (data) => {
        if (chrome.runtime.lastError) {
            console.error('[Background] Error getting tracked calls for cleanup:', chrome.runtime.lastError);
            return;
        }
        
        const trackedApiCalls = data.trackedApiCalls;
        let needsUpdate = false;
        
        // Clean up each tab's tracked calls
        for (const tabId in trackedApiCalls) {
            if (trackedApiCalls[tabId] && Array.isArray(trackedApiCalls[tabId])) {
                const originalLength = trackedApiCalls[tabId].length;
                
                // Remove calls older than cutoff time
                trackedApiCalls[tabId] = trackedApiCalls[tabId].filter(call => 
                    call.timestamp && call.timestamp > cutoffTime
                );
                
                // Keep only the newest MAX_CALLS_PER_TAB calls
                if (trackedApiCalls[tabId].length > MAX_CALLS_PER_TAB) {
                    trackedApiCalls[tabId].sort((a, b) => b.timestamp - a.timestamp);
                    trackedApiCalls[tabId] = trackedApiCalls[tabId].slice(0, MAX_CALLS_PER_TAB);
                }
                
                if (trackedApiCalls[tabId].length !== originalLength) {
                    needsUpdate = true;
                    console.log(`[Background] Cleaned up ${originalLength - trackedApiCalls[tabId].length} old tracked calls for tab ${tabId}`);
                }
                
                // Remove empty tab entries
                if (trackedApiCalls[tabId].length === 0) {
                    delete trackedApiCalls[tabId];
                    needsUpdate = true;
                }
            }
        }
        
        if (needsUpdate) {
            chrome.storage.local.set({ trackedApiCalls }, () => {
                if (chrome.runtime.lastError) {
                    console.error('[Background] Error saving cleaned tracked calls:', chrome.runtime.lastError);
                } else {
                    console.log('[Background] Tracked API calls cleanup completed');
                }
            });
        }
    });
}

// Run cleanup every hour
setInterval(cleanupOldTrackedApiCalls, 60 * 60 * 1000);

// Run cleanup on startup
cleanupOldTrackedApiCalls();
