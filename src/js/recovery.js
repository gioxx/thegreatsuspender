/*global chrome, historyItems, gsMessages, gsSession, gsStorage, gsIndexedDb, gsChrome, gsUtils */
(function(global) {
  'use strict';

  try {
    chrome.extension.getBackgroundPage().tgs.setViewGlobals(global);
  } catch (e) {
    window.setTimeout(() => window.location.reload(), 1000);
    return;
  }

  let restoreAttempted = false;
  let tabsToRecover = [];

  async function getRecoverableTabs(currentTabs) {
    const lastSession = await gsIndexedDb.fetchLastSession();
    //check to see if they still exist in current session
    if (lastSession) {
      gsUtils.removeInternalUrlsFromSession(lastSession);
      for (const window of lastSession.windows) {
        for (const tabProperties of window.tabs) {
          if (gsUtils.isSuspendedTab(tabProperties)) {
            let originalUrl = gsUtils.getOriginalUrl(tabProperties.url);
            // Ignore suspended tabs from previous session that exist unsuspended now
            const originalTab = currentTabs.find(o => o.url === originalUrl);
            if (!originalTab) {
              tabProperties.windowId = window.id;
              tabProperties.sessionId = lastSession.sessionId;
              tabsToRecover.push(tabProperties);
            }
          }
        }
      }
      return tabsToRecover;
    }
  }

  function removeTabFromList(tabToRemove) {
    const recoveryTabsEl = document.getElementById('recoveryTabs');
    const childLinks = recoveryTabsEl.children;

    for (let i = 0; i < childLinks.length; i++) {
      const element = childLinks[i];
      const url = tabToRemove.url || tabToRemove.pendingUrl;
      const originalUrl = gsUtils.isSuspendedUrl(url)
        ? gsUtils.getOriginalUrl(url)
        : url;

      if (
        element.getAttribute('data-url') === originalUrl ||
        element.getAttribute('data-tabId') === tabToRemove.id
      ) {
        // eslint-disable-line eqeqeq
        recoveryTabsEl.removeChild(element);
      }
    }

    //if removing the last element.. (re-get the element this function gets called asynchronously
    if (document.getElementById('recoveryTabs').children.length === 0) {
      //if we have already clicked the restore button then redirect to success page
      if (restoreAttempted) {
        document.getElementById('suspendy-guy-inprogress').style.display =
          'none';
        document.getElementById('recovery-inprogress').style.display = 'none';
        document.getElementById('suspendy-guy-complete').style.display =
          'inline-block';
        document.getElementById('recovery-complete').style.display =
          'inline-block';

        //otherwise we have no tabs to recover so just hide references to recovery
      } else {
        hideRecoverySection();
      }
    }
  }

  function showTabSpinners() {
    let recoveryTabsEl = document.getElementById('recoveryTabs'),
      childLinks = recoveryTabsEl.children;

    for (let i = 0; i < childLinks.length; i++) {
      let tabContainerEl = childLinks[i];
      tabContainerEl.removeChild(tabContainerEl.firstChild);
      let spinnerEl = document.createElement('span');
      spinnerEl.classList.add('faviconSpinner');
      tabContainerEl.insertBefore(spinnerEl, tabContainerEl.firstChild);
    }
  }

  function hideRecoverySection() {
    let recoverySectionEls = document.getElementsByClassName('recoverySection');
    for (let i = 0; i < recoverySectionEls.length; i++) {
      recoverySectionEls[i].style.display = 'none';
    }
    document.getElementById('restoreSession').style.display = 'none';
  }

  gsUtils.documentReadyAndLocalisedAsPromised(document).then(async function() {
    let restoreEl = document.getElementById('restoreSession'),
      previewsEl = document.getElementById('previewsOffBtn'),
      recoveryEl = document.getElementById('recoveryTabs'),
      warningEl = document.getElementById('screenCaptureNotice'),
      tabEl;

    if (previewsEl) {
      previewsEl.onclick = function() {
        gsStorage.setOptionAndSync(gsStorage.SCREEN_CAPTURE, '0');
        window.location.reload();
      };

      //show warning if screen capturing turned on
      if (gsStorage.getOption(gsStorage.SCREEN_CAPTURE) !== '0') {
        warningEl.style.display = 'block';
      }
    }

    let performRestore = async function() {
      restoreAttempted = true;
      restoreEl.className += ' btnDisabled';
      restoreEl.removeEventListener('click', performRestore);
      showTabSpinners();
      while (gsSession.isInitialising()) {
        await gsUtils.setTimeout(200);
      }
      await gsSession.recoverLostTabs();
    };

    restoreEl.addEventListener('click', performRestore);

    const currentTabs = await gsChrome.tabsQuery();
    const tabsToRecover = await getRecoverableTabs(currentTabs);
    if (tabsToRecover.length === 0) {
      hideRecoverySection();
      return;
    }

    for (let tabToRecover of tabsToRecover) {
      tabToRecover.title = gsUtils.getCleanTabTitle(tabToRecover);
      tabToRecover.url = gsUtils.getOriginalUrl(tabToRecover.url);
      tabEl = await historyItems.createTabHtml(tabToRecover, false);
      tabEl.onclick = function() {
        return function(e) {
          e.preventDefault();
          chrome.tabs.create({ url: tabToRecover.url, active: false });
          removeTabFromList(tabToRecover);
        };
      };
      recoveryEl.appendChild(tabEl);
    }

    let currentSuspendedTabs = currentTabs.filter(o =>
      gsUtils.isSuspendedTab(o),
    );
    for (const suspendedTab of currentSuspendedTabs) {
      gsMessages.sendPingToTab(suspendedTab.id, function(error) {
        if (error) {
          gsUtils.warning(suspendedTab.id, 'Failed to sendPingToTab', error);
        } else {
          removeTabFromList(suspendedTab);
        }
      });
    }
  });

  global.exports = {};
})(this);
