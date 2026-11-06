"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isVersionValid = isVersionValid;
exports.addDays = addDays;
exports.processVersion = processVersion;
exports.isEqual = isEqual;
exports.isGreater = isGreater;
exports.isGreaterOrEqual = isGreaterOrEqual;
exports.isLower = isLower;
exports.isLowerOrEqual = isLowerOrEqual;
exports.inInterval = inInterval;
function getDateMatch(version) {
    return version.match(/(\d{4})\-(\d{2}|##)-(\d{2}|##)/);
}
function isVersionValid(version) {
    return getDateMatch(version) !== null;
}
function dateToVersion(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function addDays(version, days) {
    const [year, month, day] = processVersion(version);
    const date = new Date(year, month - 1, day + days);
    return dateToVersion(date);
}
/** Returns undefined if an invalid version, otherwise an array [year, month, day] */
function processVersion(version) {
    const dateMatch = getDateMatch(version);
    if (dateMatch === null) {
        throw new Error(`Invalid version: ${version}`);
    }
    const year = Number(dateMatch[1]);
    const month = dateMatch[2] == '##' ? 1 : Number(dateMatch[2]);
    const day = dateMatch[3] == '##' ? 1 : Number(dateMatch[3]);
    if (year < 2005 || year > 2017) {
        throw new Error(`Year out of range: ${year}`);
    }
    const date = new Date(year, month - 1, day);
    if (isNaN(date.getTime())) {
        throw new Error(`Version is not a real date: ${version}`);
    }
    return [year, month, day];
}
/** Get object with year, month and day of the version */
function getVersionDetails(version) {
    const decomposed = processVersion(version);
    if (decomposed === undefined) {
        throw new Error(`Invalid version date being processed: ${version}`);
    }
    const [year, month, day] = decomposed;
    return {
        year,
        month,
        day
    };
}
function isEqual(left, right) {
    const leftDetails = getVersionDetails(left);
    const rightDetails = getVersionDetails(right);
    return leftDetails.year === rightDetails.year && leftDetails.day === rightDetails.day && leftDetails.month === rightDetails.month;
}
function isGreater(left, right) {
    const leftDetails = getVersionDetails(left);
    const rightDetails = getVersionDetails(right);
    const names = ['year', 'month', 'day'];
    for (const name of names) {
        if (leftDetails[name] > rightDetails[name]) {
            return true;
        }
        else if (leftDetails[name] < rightDetails[name]) {
            return false;
        }
    }
    return false;
}
function isGreaterOrEqual(left, right) {
    return isEqual(left, right) || isGreater(left, right);
}
function isLower(left, right) {
    return !isGreaterOrEqual(left, right);
}
function isLowerOrEqual(left, right) {
    return !isGreater(left, right);
}
function inInterval(version, start, end, params) {
    const startOpen = params?.startOpen ?? false;
    const endOpen = params?.endOpen ?? true;
    if (isLower(version, start)) {
        return false;
    }
    if (!startOpen && isEqual(version, start)) {
        return true;
    }
    if (isLower(version, end)) {
        return true;
    }
    if (!endOpen && isEqual(version, end)) {
        return true;
    }
    return false;
}
