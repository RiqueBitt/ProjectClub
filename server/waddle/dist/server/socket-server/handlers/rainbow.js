"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleSendRainbowQuestBonusCoins = exports.handleSendRainbowQuestItemCollect = exports.handleSendRainbowQuestCollectCoins = exports.handleSendRainbowTaskComplete = exports.handleGetRainbowQuestData = void 0;
exports.isRainbowStage = isRainbowStage;
function isRainbowStage(str) {
    return str === '0' || str === '1' || str === '2' || str === '3' || str === 'bonus';
}
/** Status of the item and coin rewards of each task */
var ItemStatus;
(function (ItemStatus) {
    // can't because is a non-member or haven't done task
    ItemStatus[ItemStatus["CannotCollect"] = 0] = "CannotCollect";
    ItemStatus[ItemStatus["NotCollected"] = 1] = "NotCollected";
    ItemStatus[ItemStatus["Collected"] = 2] = "Collected";
})(ItemStatus || (ItemStatus = {}));
/** Item reward obtained at the end of each quest in order */
const RAINBOW_QUEST_REWARDS = [6158, 4809, 1560, 3159];
/** Item obtained from the bonus reward */
const RAINBOW_BONUS_REWARD = 5220;
function getTaskAvailability(last, wait) {
    const available = Math.floor(last + wait * 60);
    const secondsRemaining = available - Date.now() / 1000;
    return [available, Math.floor(secondsRemaining / 60), Math.floor(secondsRemaining / 60 / 60)];
}
const handleGetRainbowQuestData = ({ settings, penguin, msg }) => {
    // time in minutes between each task
    // TODO this changed with time, by 2014 it was already 20 minutes
    // but at some point in 2013 it was 18 hours
    const waitTime = settings.settings.no_rainbow_quest_wait ? 0 : 20;
    const currentTask = penguin.rainbow.task;
    // // TODO unsure of why this condition is needed
    // if (currentTask === RAINBOW_QUEST_REWARDS.length && !client.penguin.rainbowQuestInfo.adoptability) {
    //   currentTask = 0;
    // }
    // default values if haven't completed anything before (doesn't need to wait)
    // must use timestamp in seconds for the client
    // if have completed task, update the waiting times accordingly
    const taskCompletion = penguin.rainbow.lastCompletionTime;
    const [taskAvail, minutesRemaining, hoursRemaining] = taskCompletion === null
        ? [0, 0, 0]
        : getTaskAvailability(taskCompletion, waitTime);
    const bonus = Number(currentTask === RAINBOW_QUEST_REWARDS.length && !penguin.rainbow.coinsCollected.includes('bonus'));
    const tasks = {};
    for (let taskId = 0; taskId < RAINBOW_QUEST_REWARDS.length; taskId++) {
        const strTask = String(taskId);
        tasks[taskId] = {
            item: penguin.inventory.has(RAINBOW_QUEST_REWARDS[taskId])
                ? 2
                : penguin.membership.isMember
                    ? 1
                    : 0,
            coin: isRainbowStage(strTask) && penguin.rainbow.coinsCollected.includes(strTask)
                ? 2
                : taskId < currentTask
                    ? 1
                    : 0,
            completed: taskId < currentTask
        };
    }
    const rainbowQuestStatus = {
        currTask: Math.min(currentTask, RAINBOW_QUEST_REWARDS.length - 1),
        taskAvail,
        bonus,
        cannon: penguin.rainbow.canAdopt,
        questsDone: currentTask,
        hoursRemaining: String(hoursRemaining),
        minutesRemaining: String(Math.max(0, minutesRemaining + 1)),
        tasks
    };
    msg.send(penguin, 'rpqd', JSON.stringify(rainbowQuestStatus));
};
exports.handleGetRainbowQuestData = handleGetRainbowQuestData;
const handleSendRainbowTaskComplete = ({ penguin, prst }, task) => {
    // completing last quest, can adopt
    if (task === RAINBOW_QUEST_REWARDS.length - 1) {
        penguin.rainbow.setAdoptable();
    }
    penguin.rainbow.setCompleted(task);
    prst(penguin);
};
exports.handleSendRainbowTaskComplete = handleSendRainbowTaskComplete;
const handleSendRainbowQuestCollectCoins = ({ penguin, msg, prst }, task) => {
    if (isRainbowStage(task)) {
        penguin.rainbow.setCollected(task);
    }
    msg.send(penguin, 'rpqcc', task, ItemStatus.Collected, penguin.currency.add(150));
    prst(penguin);
};
exports.handleSendRainbowQuestCollectCoins = handleSendRainbowQuestCollectCoins;
const handleSendRainbowQuestItemCollect = ({ penguin, prst, msg }, task) => {
    penguin.inventory.add(RAINBOW_QUEST_REWARDS[task]);
    msg.send(penguin, 'rpqic', task, ItemStatus.Collected);
    prst(penguin);
};
exports.handleSendRainbowQuestItemCollect = handleSendRainbowQuestItemCollect;
const handleSendRainbowQuestBonusCoins = ({ penguin, msg, prst }) => {
    // if have item, already completed the quest once
    if (penguin.inventory.has(RAINBOW_BONUS_REWARD)) {
        // TODO get evidence this reward amount is correct
        // TODO unsure why these 2 zeros
        msg.send(penguin, 'rpqbc', 0, 0, penguin.currency.add(500));
    }
    else {
        penguin.inventory.add(RAINBOW_BONUS_REWARD);
        msg.send(penguin, 'ai', RAINBOW_BONUS_REWARD, penguin.currency.coins);
    }
    penguin.rainbow.setCollected('bonus');
    prst(penguin);
};
exports.handleSendRainbowQuestBonusCoins = handleSendRainbowQuestBonusCoins;
