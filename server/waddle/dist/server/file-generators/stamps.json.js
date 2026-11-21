"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getStampsJson = getStampsJson;
const versions_1 = require("../routes/versions.js");
const dates_1 = require("../timelines/dates.js");
function getOriginalStampbookJson(stampbook) {
    const json = {};
    stampbook.forEach(category => {
        const stamps = {};
        category.stamps.forEach((stamp) => {
            stamps[String(stamp.stamp_id)] = stamp;
        });
        json[String(category.group_id)] = {
            ...category,
            stamps: stamps
        };
    });
    return JSON.stringify(json);
}
function getStampsJson(d) {
    const stampbook = d.getStampbook();
    if ((0, versions_1.isLower)(d.getDate(), (0, dates_1.getDate)('vanilla-engine'))) {
        return getOriginalStampbookJson(stampbook);
    }
    return JSON.stringify(stampbook);
}
