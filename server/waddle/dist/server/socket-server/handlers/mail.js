"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleDeletePostcard = exports.handleDeleteMailFromPenguin = exports.handleSendMail = exports.handleReceiveMail = exports.handleSetMailCheck = exports.handleSendCard = exports.handleGetMail = exports.handleMailTotal = void 0;
const world_penguin_1 = require("../world/world-penguin");
const handleMailTotal = ({ penguin, msg }) => {
    msg.send(penguin, 'mst', penguin.mail.unread, penguin.mail.total);
};
exports.handleMailTotal = handleMailTotal;
const handleGetMail = ({ penguin, msg }) => {
    const postcards = penguin.mail.mail.map(m => [
        m.sender.name,
        m.sender.id,
        m.postcard.postcardId,
        m.postcard.details,
        m.postcard.timestamp,
        m.postcard.uid,
        m.postcard.read ? 1 : 0
    ].join('|')).reverse();
    msg.send(penguin, 'mg', ...postcards);
};
exports.handleGetMail = handleGetMail;
const handleSendCard = (ctx, recipientId, cardId, cost) => {
    const { msg, prst, penguin, world } = ctx;
    const postcardCost = 10;
    const recipient = world.getById(recipientId);
    if (recipient !== undefined) {
        recipient.mail.receivePostcard(cardId, { senderId: penguin.id, senderName: penguin.name });
        msg.send(recipient, 'sc', penguin.id, penguin.name, cardId);
        prst(recipient);
    }
    msg.send(penguin, 'gc', penguin.currency.discount(postcardCost));
    prst(penguin);
};
exports.handleSendCard = handleSendCard;
const handleSetMailCheck = (ctx) => {
    const { prst, penguin } = ctx;
    penguin.mail.setRead();
    prst(penguin);
};
exports.handleSetMailCheck = handleSetMailCheck;
const handleReceiveMail = ({ msg, penguin, data }, mail) => {
    msg.send(penguin, 'mr', mail.sender.name, mail.sender.id, mail.postcard.postcardId, mail.postcard.details, ...data.isNewShell2009() ? [mail.postcard.timestamp] : [], // timestamp wasn't given before this shell
    mail.postcard.uid);
};
exports.handleReceiveMail = handleReceiveMail;
const handleSendMail = async (ctx, receiverId, postcardId) => {
    const { msg, penguin, world, off, prst } = ctx;
    const postcardCost = 10;
    const inboxFull = 0;
    const successful = 1;
    const notEnoughCoins = 2;
    if (penguin.currency.coins < postcardCost) {
        msg.send(penguin, 'ms', penguin.currency.coins, notEnoughCoins);
    }
    else {
        // TODO -> offline mail
        const receiver = world.getById(receiverId) ?? await off.getPenguin(receiverId);
        if (receiver === undefined) {
            return;
        }
        if (receiver.mail.total >= 50) {
            msg.send(penguin, 'ms', penguin.currency.coins, inboxFull);
        }
        else {
            const mail = receiver.mail.receivePostcard(postcardId, { senderId: penguin.id, senderName: penguin.name });
            if (receiver instanceof world_penguin_1.WorldPenguin) {
                (0, exports.handleReceiveMail)({ ...ctx, penguin: receiver }, mail);
            }
            msg.send(penguin, 'ms', penguin.currency.discount(postcardCost), successful);
            prst(receiver);
        }
    }
};
exports.handleSendMail = handleSendMail;
const handleDeleteMailFromPenguin = ({ penguin, msg, prst }, penguinId) => {
    penguin.mail.deleteMail(m => m.sender.id === penguinId);
    msg.send(penguin, 'mdp', penguin.mail.total);
    prst(penguin);
};
exports.handleDeleteMailFromPenguin = handleDeleteMailFromPenguin;
const handleDeletePostcard = ({ penguin, prst }, postcardUid) => {
    penguin.mail.deleteMail(m => m.postcard.uid === postcardUid);
    prst(penguin);
};
exports.handleDeletePostcard = handleDeletePostcard;
