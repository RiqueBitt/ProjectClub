"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.consumeUpdates = consumeUpdates;
const utils_1 = require("../../common/utils.js");
const newspapers_1 = require("../game-data/newspapers.js");
const pins_1 = require("../game-data/pins.js");
const stage_plays_1 = require("../game-data/stage-plays");
const versions_1 = require("../routes/versions");
function consumeNewspapers(consumed, updates) {
    const papers = [...newspapers_1.PRE_BOILER_ROOM_PAPERS, ...newspapers_1.BOILER_ROOM_PAPERS, ...newspapers_1.AS3_PAPERS];
    let issue = 1;
    let current = '';
    let inPeriod = false;
    function getIssue(date, issue, title, paper) {
        const [year, month, day] = (0, versions_1.processVersion)(date);
        let obj;
        if (typeof paper === 'string') {
            obj = { type: 'as2', file: paper };
        }
        else if ('askFront' in paper) {
            obj = { type: 'as3', ...paper };
        }
        else {
            obj = { type: 'as2', ...paper };
        }
        return {
            year,
            month,
            day,
            edition: issue,
            title: title ?? '',
            ...obj
        };
    }
    function pushPaper(irregular) {
        let next = '';
        if (irregular === undefined) {
            next = (0, versions_1.addDays)(current, 7);
        }
        const paper = papers[issue - 1];
        const title = typeof paper === 'string' ? null : paper.title;
        consumed.push({
            date: irregular ?? current,
            update: {
                issue: getIssue(irregular ?? current, issue, title, paper)
            }
        });
        if (irregular === undefined) {
            current = next;
        }
        issue++;
        if (issue > papers.length) {
            inPeriod = false;
        }
    }
    let fanDate = '';
    updates.forEach(update => {
        if (inPeriod) {
            while ((0, versions_1.isLower)(current, update.date) && inPeriod) {
                pushPaper();
            }
        }
        if (update.newspaper !== undefined) {
            if (update.newspaper === 'irregular') {
                if (inPeriod) {
                    throw new Error('Irregular newspaper in the middle of a period');
                }
                pushPaper(update.date);
            }
            else if (update.newspaper === 'period-start') {
                inPeriod = true;
                current = update.date;
                pushPaper();
            }
            else if (update.newspaper === 'period-end') {
                if (!inPeriod) {
                    throw new Error('Period of newspaper ending without having a start');
                }
                pushPaper();
                inPeriod = false;
            }
            else if (update.newspaper === 'fan') {
                fanDate = update.date;
            }
        }
    });
    if (fanDate === '') {
        throw new Error('No fan issue found');
    }
    consumed.push({
        date: fanDate,
        // todo move hardcoded file out of here
        update: { issue: getIssue(fanDate, 'fan', null, 'archives:NewsFan.swf') }
    });
}
function consumePins(consumed, updates) {
    let pinIndex = 0;
    let version = '';
    let inPeriod = false;
    function addPin(p, date, end) {
        const announcement = (!('hidden' in p) || !p.hidden) ? p.name : undefined;
        if ('file' in p) {
            consumed.push({
                date,
                end,
                update: {
                    rooms: {
                        [p.room]: p.file
                    },
                    'pinRoom': { room: p.room, frame: p.frame },
                    'hiddenPin': announcement
                }
            });
        }
        else if ('room' in p) {
            consumed.push({
                date,
                end,
                update: {
                    'pinRoom': p.room === undefined ? undefined : { room: p.room },
                    'hiddenPin': announcement
                }
            });
        }
    }
    function pushPin() {
        const pin = pins_1.PINS[pinIndex];
        const next = (0, versions_1.addDays)(version, 14);
        if (Array.isArray(pin)) {
            consumed.push();
            pin.forEach(p => {
                addPin(p, version, next);
            });
        }
        else {
            addPin(pin, version, next);
        }
        version = next;
        pinIndex++;
        if (pinIndex >= pins_1.PINS.length) {
            inPeriod = false;
        }
    }
    for (let i = 0; i < updates.length; i++) {
        if (inPeriod) {
            while ((0, versions_1.isLower)(version, updates[i].date) && inPeriod) {
                pushPin();
            }
        }
        if (updates[i].pin !== undefined) {
            switch (updates[i].pin) {
                case 'start':
                    version = updates[i].date;
                    inPeriod = true;
                    pushPin();
                    break;
                case 'end':
                    pushPin();
                    inPeriod = false;
                    break;
            }
        }
    }
}
function consumeUpdates(updates) {
    const consumed = [];
    const events = new Map();
    let stagePlay = undefined;
    for (let i = 0; i < updates.length; i++) {
        const update = updates[i];
        consumed.push({
            date: update.date,
            update: update
        });
        if (update.temp !== undefined) {
            (0, utils_1.iterateEntries)(update.temp, (e, u) => {
                if (e.startsWith('party')) {
                    const constructions = events.get('const');
                    if (constructions !== undefined) {
                        const constructionComment = 'partyName' in u ? (`Construction for the ${u.partyName} starts`) : (constructions[0].update.constructionComment);
                        if (constructionComment === undefined) {
                            throw new Error('Expected construction comment to be defined');
                        }
                        constructions.forEach(constUpdate => {
                            consumed.push({
                                date: constUpdate.date,
                                end: update.date,
                                update: { ...constUpdate.update, constructionComment }
                            });
                        });
                        events.delete('const');
                    }
                }
                const eventsArray = events.get(e) ?? [];
                eventsArray.push({
                    date: update.date,
                    update: u
                });
                events.set(e, eventsArray);
            });
        }
        if (update.stagePlay !== undefined) {
            if (stagePlay !== undefined) {
                // exceptional play that plays music in a different room
                if (stagePlay.name === 'Norman Swarm Has Been Transformed') {
                    stagePlay.update.music = {
                        party1: (0, stage_plays_1.getStagePlayMusic)(stagePlay.name)
                    };
                }
                consumed.push({
                    ...stagePlay,
                    end: update.date
                });
            }
            stagePlay = {
                date: update.date,
                update: update.stagePlay,
                name: update.stagePlay.name
            };
        }
        if (update.end !== undefined) {
            update.end.forEach(event => {
                const eventsArray = events.get(event);
                if (eventsArray === undefined) {
                    throw new Error(`No such event to end: ${event}`);
                }
                eventsArray.forEach(temp => {
                    consumed.push({
                        date: temp.date,
                        end: update.date,
                        update: temp.update
                    });
                });
                events.delete(event);
            });
        }
    }
    if (stagePlay !== undefined) {
        consumed.push(stagePlay);
    }
    consumePins(consumed, updates);
    consumeNewspapers(consumed, updates);
    return consumed.sort((a, b) => {
        // lower dates come first
        // but if on the same day, then permanent updates first
        // if both are temporary on the same day, the one with the longer window comes first
        // (this is currently happening because of pins, ideally the pin system will be reworked)
        // if both are permanent on same day, this is equal (shouldnt ever happen)
        if (a.date === b.date) {
            if (a.end === undefined) {
                if (b.end === a.end) {
                    return 0;
                }
                return -1;
            }
            else if (b.end === undefined) {
                return 1;
            }
            else if ((0, versions_1.isLower)(a.end, b.date)) {
                return 1;
            }
            else if ((0, versions_1.isLower)(b.date, a.end)) {
                return -1;
            }
        }
        else if ((0, versions_1.isLower)(a.date, b.date)) {
            return -1;
        }
        else {
            return 1;
        }
        return 0;
    });
}
