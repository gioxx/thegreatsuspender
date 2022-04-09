/*global chrome, gsSession, gsIndexedDb, gsUtils */
(function(global) {
  'use strict';

  try {
    chrome.extension.getBackgroundPage().tgs.setViewGlobals(global);
  } catch (e) {
    window.setTimeout(() => window.location.reload(), 1000);
    return;
  }

  function setRestartExtensionClickHandler() {
    document.getElementById('restartExtensionBtn').onclick = async function() {
      document.getElementById('restartExtensionBtn').className += ' btnDisabled';
      document.getElementById('restartExtensionBtn').onclick = null;

      const currentSession = await gsSession.buildCurrentSession();
      if (currentSession) {
        let currentVersion = chrome.runtime.getManifest().version;
        await gsIndexedDb.createOrUpdateSessionRestorePoint(
          currentSession,
          currentVersion,
        );
      }

      //ensure we don't leave any windows with no unsuspended tabs
      await gsSession.unsuspendActiveTabInEachWindow();

      //update current session to ensure the new tab ids are saved before
      //we restart the extension
      await gsSession.updateCurrentSession();

      chrome.runtime.reload();
      // }
    };
  }

  gsUtils.documentReadyAndLocalisedAsPromised(document).then(function() {
    setRestartExtensionClickHandler(true);

    let currentVersion = chrome.runtime.getManifest().version;
    gsIndexedDb
      .fetchSessionRestorePoint(currentVersion)
      .then(function(sessionRestorePoint) {
        if (!sessionRestorePoint) {
          gsUtils.warning(
            'update',
            'Couldnt find session restore point. Something has gone horribly wrong!!',
          );
          document.getElementById('noBackupInfo').style.display = 'block';
          document.getElementById('backupInfo').style.display = 'none';
          document.getElementById('exportBackupBtn').style.display = 'none';
        }
      });
  });
})(this);
