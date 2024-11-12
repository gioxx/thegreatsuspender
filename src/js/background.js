/* global gsStorage, gsChrome, gsIndexedDb, gsUtils, gsFavicon, gsSession, gsMessages, gsTabSuspendManager, gsTabDiscardManager, gsTabCheckManager, gsSuspendedTab, chrome, XMLHttpRequest */
/*
 * The Great Suspender
 * Copyright (C) 2017 Dean Oemcke
 * Available under GNU GENERAL PUBLIC LICENSE v2
 * http://github.com/greatsuspender/thegreatsuspender
 * ༼ つ ◕_◕ ༽つ
*/

importScripts(
  'js/gsUtils.js',
  'js/gsChrome.js',
  'js/gsStorage.js',
  'js/db.js',
  'js/gsIndexedDb.js',
  'js/gsMessages.js',
  'js/gsSession.js',
  'js/gsTabQueue.js',
  'js/gsTabCheckManager.js',
  'js/gsFavicon.js',
  'js/gsTabSuspendManager.js',
  'js/gsTabDiscardManager.js',
  'js/gsSuspendedTab.js'
);

const tgs = (function() {
  'use strict';

  const ICON_SUSPENSION_ACTIVE = {
    '16': 'img/ic_suspendy_16x16.png',
    '32': 'img/ic_suspendy_32x32.png',
  };
  const ICON_SUSPENSION_PAUSED = {
    '16': 'img/ic_suspendy_16x16_grey.png',
    '32': 'img/ic_suspendy_32x32_grey.png',
  };

  // Unsuspended tab props
  const STATE_TIMER_DETAILS = 'timerDetails';

  // Suspended tab props
  const STATE_TEMP_WHITELIST_ON_RELOAD = 'whitelistOnReload';
  const STATE_DISABLE_UNSUSPEND_ON_RELOAD = 'disableUnsuspendOnReload';
  const STATE_INITIALISE_SUSPENDED_TAB = 'initialiseSuspendedTab';
  const STATE_UNLOADED_URL = 'unloadedUrl';
  const STATE_HISTORY_URL_TO_REMOVE = 'historyUrlToRemove';
  const STATE_SET_AUTODISCARDABLE = 'setAutodiscardable';
  const STATE_SUSPEND_REASON = 'suspendReason'; // 1=auto-suspend, 2=manual-suspend, 3=discarded
  const STATE_SCROLL_POS = 'scrollPos';

  const focusDelay = 500;

  const _tabStateByTabId = {};
  const _currentFocusedTabIdByWindowId = {};
  const _currentStationaryTabIdByWindowId = {};

  let _currentFocusedWindowId;
  let _currentStationaryWindowId;
  let _sessionSaveTimer;
  let _newTabFocusTimer;
  let _newWindowFocusTimer;
  let _noticeToDisplay;
  let _isCharging = false;
  let _triggerHotkeyUpdate = false;
  let _suspensionToggleHotkey;

  function getExtensionGlobals() {
    const globals = {
      tgs,
      gsUtils,
      gsChrome,
      gsStorage,
      gsIndexedDb,
      gsMessages,
      gsSession,
      gsFavicon,
      gsTabCheckManager,
      gsTabSuspendManager,
      gsTabDiscardManager,
      gsSuspendedTab,
    };
    for (const lib of Object.values(globals)) {
      if (!lib) {
        return null;
      }
    }
    return globals;
  }

  function setViewGlobals(_window) {
    const globals = getExtensionGlobals();
    if (!globals) {
      throw new Error('Lib not ready');
    }
    Object.assign(_window, globals);
  }

  function backgroundScriptsReadyAsPromised(retries) {
    retries = retries || 0;
    if (retries > 300) {
      // allow 30 seconds :scream:
      chrome.tabs.create({ url: chrome.runtime.getURL('broken.html') });
      return Promise.reject('Failed to initialise background scripts');
    }
    return new Promise(function(resolve) {
      const isReady = getExtensionGlobals() !== null;
      resolve(isReady);
    }).then(function(isReady) {
      if (isReady) {
        return Promise.resolve();
      }
      return new Promise(function(resolve) {
        setTimeout(resolve, 100);
      }).then(function() {
        retries += 1;
        return backgroundScriptsReadyAsPromised(retries);
      });
    });
  }

  async function initAsPromised() {
    gsUtils.log('background', 'PERFORMING BACKGROUND INIT...');
    addCommandListeners();
    addMessageListeners();
    addChromeListeners();
    addMiscListeners();

    //initialise unsuspended tab props
    resetAutoSuspendTimerForAllTabs();

    //add context menu items
    //TODO: Report chrome bug where adding context menu in incognito removes it from main windows
    if (!chrome.extension.inIncognitoContext) {
      buildContextMenu(false);
      const contextMenus = await new Promise(resolve =>
        gsStorage.getOption(gsStorage.ADD_CONTEXT, resolve)
      );
      buildContextMenu(contextMenus);
    }

    //initialise currentStationary and currentFocused vars
    const activeTabs = await gsChrome.tabsQuery({ active: true });
    const currentWindow = await gsChrome.windowsGetLastFocused();
    for (let activeTab of activeTabs) {
      _currentStationaryTabIdByWindowId[activeTab.windowId] = activeTab.id;
      _currentFocusedTabIdByWindowId[activeTab.windowId] = activeTab.id;
      if (currentWindow && currentWindow.id === activeTab.windowId) {
        _currentStationaryWindowId = activeTab.windowId;
        _currentFocusedWindowId = activeTab.windowId;
      }
    }
    gsUtils.log('background', 'init successful');
  }

  function getInternalViewByTabId(tabId) {
    const internalViews = chrome.runtime.getViews({ tabId: tabId });
    if (internalViews.length === 1) {
      return internalViews[0];
    }
    return null;
  }

  function buildContextMenu(contextMenus) {
    // Example implementation of buildContextMenu
    chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create({
        id: 'suspendTab',
        title: 'Suspend Tab',
        contexts: ['all'],
      });
      if (contextMenus) {
        // Add additional context menu items based on contextMenus parameter
      }
    });
  }

  function getTabStatePropForTabId(tabId, prop) {
    // Example implementation of getTabStatePropForTabId
    if (_tabStateByTabId[tabId]) {
      return _tabStateByTabId[tabId][prop];
    }
    return null;
  }

  function clearAutoSuspendTimerForTabId(tabId) {
    const timerDetails = getTabStatePropForTabId(tabId, STATE_TIMER_DETAILS);
    if (timerDetails && timerDetails.timerId) {
      clearTimeout(timerDetails.timerId);
      delete timerDetails.timerId;
    }
  }

  function resetAutoSuspendTimerForTab(tab) {
    clearAutoSuspendTimerForTabId(tab.id);
    const timerDetails = getTabStatePropForTabId(tab.id, STATE_TIMER_DETAILS);
    if (timerDetails) {
      timerDetails.timerId = setTimeout(() => {
        gsTabSuspendManager.queueTabForSuspension(tab, 1);
      }, timerDetails.delay);
    }
  }

  function resetAutoSuspendTimerForAllTabs() {
    chrome.tabs.query({}, tabs => {
      for (const tab of tabs) {
        resetAutoSuspendTimerForTab(tab);
      }
    });
  }

  function isCurrentFocusedTab(tabId) {
    return _currentFocusedTabIdByWindowId[_currentFocusedWindowId] === tabId;
  }

  // Other functions and event listeners...

  return {
    initAsPromised,
    isCurrentFocusedTab, // Add the function to the returned object
    // Other exported functions...
  };
})();
