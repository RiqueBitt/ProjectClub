"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getFullDate = getFullDate;
exports.getNewsCrumbsSwf = getNewsCrumbsSwf;
const emitter_1 = require("../../common/flash/emitter.js");
const utils_1 = require("../../common/utils.js");
const avm1_1 = require("../../common/flash/avm1.js");
const game_data_1 = require("../timelines/game-data.js");
function generateNewsPathAssign(n, year, month, day, as3, compositePaths) {
    let varname = '';
    if (n === -1) {
        varname = 'current_news';
    }
    else {
        varname = `old_news${n}`;
    }
    const minifiedDate = (0, game_data_1.getNewspaperDate)(year, month, day);
    const newspaperPath = as3 ? (minifiedDate) : (
    // TODO not sure why legacy media was setup like this, local_crumbs
    // from Dec 2010 show just news/date.swf
    `${minifiedDate}/${minifiedDate}.swf`);
    if (compositePaths) {
        return [
            [avm1_1.Action.Push, "news_paths"],
            avm1_1.Action.GetVariable,
            [avm1_1.Action.Push, varname, 'local_content'],
            avm1_1.Action.GetVariable,
            [avm1_1.Action.Push, `/news/${newspaperPath}`],
            avm1_1.Action.Add2,
            avm1_1.Action.SetMember
        ];
    }
    return [
        [avm1_1.Action.Push, "news_paths"],
        avm1_1.Action.GetVariable,
        [avm1_1.Action.Push, varname, `news/${newspaperPath}`],
        avm1_1.Action.SetMember,
    ];
}
function getFullDate(year, month, day) {
    let monthname = utils_1.monthNames[month - 1];
    return `${monthname} ${day}, ${year}`;
}
function generateNewsArrayAdd(index, issue, year, month, day, title) {
    return [
        [avm1_1.Action.Push, "news_crumbs"],
        avm1_1.Action.GetVariable,
        [avm1_1.Action.Push, index, "key", `old_news${index}`, "issue", `Issue:${issue}`, "date", getFullDate(year, month, day), "title", title, 4],
        avm1_1.Action.InitObject,
        avm1_1.Action.SetMember
    ];
}
function getNewsCrumbsSwf(d) {
    const issues = d.getActiveIssues();
    const useCompositePaths = d.useCompositePaths();
    const code = [
        [avm1_1.Action.Push, "SHELL", 0, "_global"],
        avm1_1.Action.GetVariable,
        [avm1_1.Action.Push, "getCurrentShell"],
        avm1_1.Action.CallMethod,
        avm1_1.Action.DefineLocal,
        [avm1_1.Action.Push, "root_path", 0, "SHELL"],
        avm1_1.Action.GetVariable,
        [avm1_1.Action.Push, "getRootPath"],
        avm1_1.Action.CallMethod,
        avm1_1.Action.DefineLocal,
        [avm1_1.Action.Push, "language_folder", 0, "SHELL"],
        avm1_1.Action.GetVariable,
        [avm1_1.Action.Push, "getLocalizedFolder"],
        avm1_1.Action.CallMethod,
        avm1_1.Action.DefineLocal
    ];
    if (useCompositePaths) {
        code.push([avm1_1.Action.Push, "local_content", "root_path"], avm1_1.Action.GetVariable, [avm1_1.Action.Push, "content/local/"], avm1_1.Action.Add2, [avm1_1.Action.Push, "language_folder"], avm1_1.Action.GetVariable, avm1_1.Action.Add2, avm1_1.Action.DefineLocal);
    }
    code.push([avm1_1.Action.Push, "news_paths", 0, "Object"], avm1_1.Action.NewObject, avm1_1.Action.DefineLocal);
    for (let i = 0; i < issues.length; i++) {
        const newspaper = issues[i];
        code.push(...generateNewsPathAssign(i - 1, newspaper.year, newspaper.month, newspaper.day, newspaper.as3, useCompositePaths));
    }
    code.push([avm1_1.Action.Push, "news_crumbs", 0, "Array"], avm1_1.Action.NewObject, avm1_1.Action.DefineLocal);
    for (let i = 1; i < issues.length; i++) {
        const newspaper = issues[i];
        code.push(...generateNewsArrayAdd(i - 1, Number(newspaper.edition), newspaper.year, newspaper.month, newspaper.day, newspaper.title));
    }
    return Buffer.from((0, emitter_1.emitCrumbSwf)((0, avm1_1.createBytecode)(code)));
}
