/* global chrome, gsIndexedDb, gsUtils */
// eslint-disable-next-line no-unused-vars
const historyUtils = (function(global) {
  'use strict';

  if (
    !chrome.extension.getBackgroundPage() ||
    !chrome.extension.getBackgroundPage().tgs
  ) {
    return;
  }
  chrome.extension.getBackgroundPage().tgs.setViewGlobals(global);

  const noop = function() {
  };

  function importSession(e) {
    const f = e.target.files[0];
    if (f) {
      let r = new FileReader();
      r.onload = function(e) {
        let contents = e.target.result;
        if (f.type !== 'text/plain') {
          alert(chrome.i18n.getMessage('js_history_import_fail'));
        } else {
          handleImport(f.name, contents).then(function() {
            window.location.reload();
          });
        }
      };
      r.readAsText(f);
    } else {
      alert(chrome.i18n.getMessage('js_history_import_fail'));
    }
  }

  async function handleImport(sessionName, textContents) {
    sessionName = window.prompt(
      chrome.i18n.getMessage('js_history_enter_name_for_session'),
      sessionName,
    );
    if (sessionName) {
      const shouldSave = await new Promise(resolve => {
        validateNewSessionName(sessionName, function(result) {
          resolve(result);
        });
      });
      if (!shouldSave) {
        return;
      }

      let sessionId = '_' + gsUtils.generateHashCode(sessionName);
      let windows = [];

      let createNextWindow = function() {
        return {
          id: sessionId + '_' + windows.length,
          tabs: [],
        };
      };
      let curWindow = createNextWindow();

      for (const line of textContents.split('\n')) {
        if (typeof line !== 'string') {
          continue;
        }
        if (line === '') {
          if (curWindow.tabs.length > 0) {
            windows.push(curWindow);
            curWindow = createNextWindow();
          }
          continue;
        }
        if (line.indexOf('://') < 0) {
          continue;
        }
        const tabInfo = {
          windowId: curWindow.id,
          sessionId: sessionId,
          id: curWindow.id + '_' + curWindow.tabs.length,
          url: line,
          title: line,
          index: curWindow.tabs.length,
          pinned: false,
        };
        const savedTabInfo = await gsIndexedDb.fetchTabInfo(line);
        if (savedTabInfo) {
          tabInfo.title = savedTabInfo.title;
          tabInfo.favIconUrl = savedTabInfo.favIconUrl;
        }
        curWindow.tabs.push(tabInfo);
      }
      if (curWindow.tabs.length > 0) {
        windows.push(curWindow);
      }

      let session = {
        name: sessionName,
        sessionId: sessionId,
        windows: windows,
        date: new Date().toISOString(),
      };
      await gsIndexedDb.updateSession(session);
    }
  }

  function exportSessionWithId(windowId, sessionId, callback) {
    callback = typeof callback !== 'function' ? noop : callback;

    // document.getElementById('debugWindowId').innerText = document.getElementById('debugWindowId').innerText + ' - Window ID retrieved: ' + windowId;
    gsIndexedDb.fetchSessionBySessionId(sessionId).then(function(session) {
      if (!session || !session.windows) {
        callback();
      } else {
        exportSession(session, callback, windowId);
      }
    });
  }

  function exportSession(session, callback, windowId) {
    function _exInternalExport(curWindow) {

      curWindow.tabs.forEach(function(curTab) {
        if (gsUtils.isSuspendedTab(curTab)) {
          sessionString += gsUtils.getOriginalUrl(curTab.url) + '\n';
        } else {
          sessionString += curTab.url + '\n';
        }
      });
      //add an extra newline to separate windows
      sessionString += '\n';
    }

    let sessionString = '';

    session.windows.forEach(function(curWindow) {
      if (windowId != null) {
        if (curWindow.id === windowId) {
          _exInternalExport(curWindow);
        }
      } else {
        _exInternalExport(curWindow);
      }

    });

    const blob = new Blob([sessionString], { type: 'text/plain' });
    const blobUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', blobUrl);
    link.setAttribute('download', 'session.txt');
    link.click();

    callback();
  }

  function validateNewSessionName(sessionName, callback) {
    gsIndexedDb.fetchSavedSessions().then(function(savedSessions) {
      let nameExists = savedSessions.some(function(savedSession) {
        return savedSession.name === sessionName;
      });
      if (nameExists) {
        let overwrite = window.confirm(
          chrome.i18n.getMessage('js_history_confirm_session_overwrite'),
        );
        if (!overwrite) {
          callback(false);
          return;
        }
      }
      callback(true);
    });
  }

  function saveSession(sessionId, windowId) {
    // document.getElementById('debugWindowId').innerText = document.getElementById('debugWindowId').innerText + ' - Window ID retrieved: ' + windowId;
    gsIndexedDb.fetchSessionBySessionId(sessionId).then(function(session) {
      if (!session) {
        gsUtils.warning(
          'historyUtils',
          'Could not find session with sessionId: ' +
          sessionId +
          '. Save aborted',
        );
        return;
      }
      let sessionName = window.prompt(
        chrome.i18n.getMessage('js_history_enter_name_for_session'),
      );
      if (sessionName) {
        historyUtils.validateNewSessionName(sessionName, function(shouldSave) {
          if (shouldSave) {
            session.name = sessionName;
            // document.getElementById('debugWindowId').innerText = document.getElementById('debugWindowId').innerText + ' - SessionData: ' + JSON.stringify(session);
            let newSession = JSON.parse(JSON.stringify(session));
            newSession.windows = (windowId !== null) ? session.windows.filter((curWindow) => (curWindow.id === windowId)) : session.windows;
            // document.getElementById('debugWindowId').innerText = JSON.stringify(newSession);

            gsIndexedDb.addToSavedSessions(newSession).then(function() {
              window.location.reload();
            });
          }
        });
      }
    });
  }

  function migrateTabs(from_id) {
    if (from_id.length === 32) {
      chrome.tabs.query({}, function(tabs) {
        let count = 0;
        let prefix_before = 'chrome-extension://' + from_id;
        let prefix_after = 'chrome-extension://' + chrome.i18n.getMessage('@@extension_id');
        for (let tab of tabs) {
          if (!tab.url.startsWith(prefix_before)) {
            continue;
          }
          count += 1;
          let migrated_url = prefix_after + tab.url.substr(prefix_before.length);
          chrome.tabs.update(tab.id, { url: migrated_url });
        }
        alert(chrome.i18n.getMessage('js_history_migrate_success', '' + count));
      });
    } else {
      alert(chrome.i18n.getMessage('js_history_migrate_fail'));
    }
  }

  return {
    importSession,
    exportSession,
    exportSessionWithId,
    validateNewSessionName,
    saveSession,
    migrateTabs,
  };
})(this);
