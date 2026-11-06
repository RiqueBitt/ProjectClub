"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getNewspaperName = getNewspaperName;
exports.getNewsTxt = getNewsTxt;
function getNewspaperName(year, month, day) {
    return `${year}|${String(month).padStart(2, '0')}${String(day).padStart(2, '0')}`;
}
/** Handles the news.txt file from the Pre-CPIP rewrite */
function getNewsTxt(d) {
    const papers = d.getActiveIssues();
    const paper = papers[0];
    const paperString = `&p0=${getNewspaperName(paper.year, paper.month, paper.day)}|82|${paper.title}`;
    return `
&archive=1&


${paperString}

&a0=&
&a1=&
&a2=&
&a3=&

&e=0&`;
}
