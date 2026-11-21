"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UPDATES = exports.allUpdates = void 0;
exports.getUpdates = getUpdates;
const _1 = require(".");
const constants_1 = require("../../common/constants.js");
const versions_1 = require("../routes/versions");
const _2005_1 = require("./2005");
const _2006_1 = require("./2006");
const _2007_1 = require("./2007");
const _2008_1 = require("./2008");
const _2009_1 = require("./2009");
const _2010_1 = require("./2010");
const _2011_1 = require("./2011");
const _2012_1 = require("./2012");
const _2013_1 = require("./2013");
const _2014_1 = require("./2014");
const _2016_1 = require("./2016");
const _2015_1 = require("./2015");
exports.allUpdates = [
    ..._2005_1.UPDATES_2005,
    ..._2006_1.UPDATES_2006,
    ..._2007_1.UPDATES_2007,
    ..._2008_1.UPDATES_2008,
    ..._2009_1.UPDATES_2009,
    ..._2010_1.UPDATES_2010,
    ..._2011_1.UPDATES_2011,
    ..._2012_1.UPDATES_2012,
    ..._2013_1.UPDATES_2013,
    ..._2014_1.UPDATES_2014,
    ..._2015_1.UPDATES_2015,
    ..._2016_1.UPDATES_2016
];
function enforceCorrectness() {
    let greatest = undefined;
    const seen = new Set();
    for (let i = 0; i < exports.allUpdates.length; i++) {
        const update = exports.allUpdates[i];
        if (greatest === undefined) {
            greatest = update.date;
        }
        else {
            if ((0, versions_1.isGreater)(greatest, update.date)) {
                throw new Error(`Date out of order: ${update.date}`);
            }
            else {
                greatest = update.date;
            }
        }
        if (seen.has(update.date)) {
            throw new Error(`Duplicate date: ${update.date}`);
        }
        seen.add(update.date);
    }
}
if (constants_1.IS_DEV) {
    enforceCorrectness();
}
function getUpdates() {
    return (0, _1.consumeUpdates)(exports.allUpdates);
}
exports.UPDATES = (0, _1.consumeUpdates)(exports.allUpdates);
