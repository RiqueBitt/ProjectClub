"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = getStageScriptMessagesJson;
function getStageScriptMessagesJson(d) {
    const script = d.getStageScript();
    if (script.length === 0) {
        return JSON.stringify([{ "note": "STAGE SCRIPT NOT ADDED" }]);
    }
    return JSON.stringify(script);
}
