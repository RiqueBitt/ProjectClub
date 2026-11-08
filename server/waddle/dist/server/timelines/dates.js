"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.START_DATE = void 0;
exports.getDate = getDate;
exports.isEngine1 = isEngine1;
exports.isEngine2 = isEngine2;
exports.isEngine3 = isEngine3;
exports.isAS3 = isAS3;
exports.isPreCpip = isPreCpip;
exports.isPostCpip = isPostCpip;
const utils_1 = require("../../common/utils.js");
const versions_1 = require("../routes/versions");
const updates_1 = require("../updates/updates");
exports.START_DATE = updates_1.UPDATES[0].date;
const dateRefRecord = {
    'as3': undefined,
    'as3-startscreen': undefined,
    'cpip': undefined,
    'igloo-music': undefined,
    'stamps-release': undefined,
    'vanilla-engine': undefined,
    'placeholder-2016': undefined,
    'vr-room': undefined,
    'old-rink': undefined,
    'string-verify': undefined,
    'composite-paths': undefined,
    'igloo-catalog-name': undefined,
    'adopt-catalog-name': undefined,
    'pet-furniture-rename1': undefined,
    'pet-furniture-rename2': undefined,
    'furniture-catalog-name': undefined,
    'mall': undefined,
    'owned-igloos': undefined
};
const dateRefMap = new Map();
function getDate(ref) {
    const value = dateRefMap.get(ref);
    if (value === undefined) {
        throw new Error(`Could not find date reference: ${ref}`);
    }
    return value;
}
for (let i = 0; i < updates_1.UPDATES.length; i++) {
    const update = updates_1.UPDATES[i];
    if (update.update.dateReference !== undefined) {
        dateRefRecord[update.update.dateReference] = update.date;
    }
}
(0, utils_1.iterateEntries)(dateRefRecord, (key, value) => {
    if (value === undefined) {
        throw new Error(`Did not set value for reference: ${key}`);
    }
    dateRefMap.set(key, value);
});
function isEngine1(version) {
    return (0, versions_1.isLower)(version, getDate('cpip'));
}
function isEngine2(version) {
    return (0, versions_1.isGreaterOrEqual)(version, getDate('cpip')) && (0, versions_1.isLower)(version, getDate('vanilla-engine'));
}
function isEngine3(version) {
    return (0, versions_1.isGreaterOrEqual)(version, getDate('vanilla-engine'));
}
function isAS3(version) {
    return (0, versions_1.isGreaterOrEqual)(version, getDate('as3'));
}
function isPreCpip(version) {
    return (0, versions_1.isLower)(version, getDate('cpip'));
}
function isPostCpip(version) {
    return (0, versions_1.isGreaterOrEqual)(version, getDate('cpip'));
}
