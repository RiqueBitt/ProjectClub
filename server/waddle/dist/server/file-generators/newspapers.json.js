"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getNewspapersJson = getNewspapersJson;
const game_data_1 = require("../timelines/game-data.js");
const news_crumbs_swf_1 = require("./news_crumbs.swf");
function getNewspapersJson(d) {
    const papers = d.getActiveIssues();
    const json = {};
    papers.forEach((paper, i) => {
        const { year, month, day } = paper;
        json[String(i)] = {
            title: paper.title,
            path: `news\/papers\/${(0, game_data_1.getNewspaperDate)(year, month, day)}`,
            issue: `Issue:${Number(paper.edition)}`,
            date: (0, news_crumbs_swf_1.getFullDate)(year, month, day),
            key: i === 0 ? 'current_news' : `old_news${i - 1}`
        };
    });
    return JSON.stringify(json);
}
