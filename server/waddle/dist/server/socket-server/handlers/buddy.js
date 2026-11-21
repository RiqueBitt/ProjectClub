"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleRemoveIgnore = exports.handleAddIgnore = exports.handleGetIgnoreList = void 0;
const join_1 = require("./join");
const handleGetIgnoreList = async ({ msg, penguin, world, db }) => {
    const ignored = await Promise.all(penguin.buddy.ignored.map(id => {
        return (0, join_1.formatBuddyEntry)(id, world, db, true);
    }));
    msg.send(penguin, 'gn', ...ignored);
};
exports.handleGetIgnoreList = handleGetIgnoreList;
const handleAddIgnore = ({ penguin, prst }, ignoreId) => {
    penguin.buddy.ignore(ignoreId);
    prst(penguin);
};
exports.handleAddIgnore = handleAddIgnore;
const handleRemoveIgnore = ({ penguin, prst }, ignoreId) => {
    penguin.buddy.unignore(ignoreId);
    prst(penguin);
};
exports.handleRemoveIgnore = handleRemoveIgnore;
