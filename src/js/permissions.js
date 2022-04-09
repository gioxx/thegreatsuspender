/*global chrome, gsChrome, gsUtils */
(function(global) {
  'use strict';

  try {
    chrome.extension.getBackgroundPage().tgs.setViewGlobals(global);
  } catch (e) {
    window.setTimeout(() => window.location.reload(), 1000);
    return;
  }

  gsUtils.documentReadyAndLocalisedAsPromised(document).then(function() {
    document.getElementById('setFilePermissionsBtn').onclick = async function() {
      await gsChrome.tabsCreate({
        url: 'chrome://extensions?id=' + chrome.runtime.id,
      });
    };
  });
})(this);
