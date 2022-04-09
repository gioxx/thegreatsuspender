/* global chrome, gsUtils */
(function(global) {
  'use strict';

  try {
    chrome.extension.getBackgroundPage().tgs.setViewGlobals(global);
  } catch (e) {
    window.setTimeout(() => window.location.reload(), 1000);
    return;
  }

  function init() {
    document
      .getElementById('restartExtension')
      .addEventListener('click', function() {
        chrome.runtime.reload();
      });
  }
  if (document.readyState !== 'loading') {
    init();
  } else {
    document.addEventListener('DOMContentLoaded', function() {
      init();
    });
  }

  gsUtils.documentReadyAndLocalisedAsPromised(document);

})(this);
