"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.overrideIndexHtml = overrideIndexHtml;
const files_1 = require("../../game-data/files.js");
function injectRuffleIntoHtml(html, ip, loginPort, worldPort) {
    const socketProxy = JSON.stringify([
        {
            host: ip,
            port: loginPort,
            proxyUrl: `ws://${ip}:${loginPort}`,
        },
        {
            host: ip,
            port: worldPort,
            proxyUrl: `ws://${ip}:${worldPort}`,
        },
    ]);
    const injectedScript = `
    <script>
      window.RufflePlayer = window.RufflePlayer || {};
      window.RufflePlayer.config = {
        ...window.RufflePlayer.config,
        socketProxy: ${socketProxy}
      };
    </script>
  `;
    return html.replace('</head>', `${injectedScript}</head>`);
}
async function overrideIndexHtml(d, s, b) {
    let newFileRef = null;
    if (s.settings.minified_website && !d.isVanillaEngine()) {
        if (d.getAs3()) {
            newFileRef = 'websites:minified/minified-classic-as3.html';
        }
        else if (d.isPreCpip()) {
            newFileRef = 'websites:minified/minified-precpip.html';
        }
        else if (d.useCompositePaths()) {
            newFileRef = 'websites:minified/minified-early-cpip.html';
        }
        else {
            newFileRef = 'websites:minified/minified-cpip.html';
        }
    }
    if (newFileRef !== null) {
        b = await (0, files_1.getMediaFile)(newFileRef);
    }
    if (typeof b !== 'string') {
        b = b.toString();
    }
    return injectRuffleIntoHtml(b, s.targetIP, s.loginPort, s.worldPort);
}
