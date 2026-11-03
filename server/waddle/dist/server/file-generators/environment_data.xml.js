"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getEnvironmentDataXml = getEnvironmentDataXml;
/** XML file for AS3 client that records each of the relevant paths */
function getEnvironmentDataXml(_, s) {
    const URL = `http://${s.targetIP}:${s.targetPort}/`;
    return `<environmentData>

	<!-- CP General Environment -->
	<data name="play" value="${URL}play"></data>
	<data name="client" value="${URL}play/v2/client/"></data>
	<data name="content" value="${URL}play/v2/content/"></data>
	<data name="games" value="${URL}play/v2/games/"></data>
	<data name="drupal" value="${URL}"></data>
	<data name="secured" value="${URL}"></data>
	<data name="config" value="${URL}play/"></data>

</environmentData>`;
}
