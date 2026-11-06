"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.STAGE_PLAYS = void 0;
exports.getStagePlayMusic = getStagePlayMusic;
/** Data for each stage play */
exports.STAGE_PLAYS = [
    {
        name: 'Space Adventure',
        // we know this music was not the same in the second premiere,
        // but that SWF is completely lost, possibly it wasn't in the normal music directory
        musicId: 30
    },
    {
        name: 'The Twelfth Fish',
        musicId: 31
    },
    {
        name: 'Team Blue\'s Rally Debut',
        musicId: 33
    },
    {
        name: 'Team Blue\'s Rally 2',
        musicId: 36
    },
    {
        name: 'Quest for the Golden Puffle',
        musicId: 34
    },
    {
        name: 'The Penguins that Time Forgot',
        musicId: 35
    },
    {
        name: 'Team Blue vs. Team Red',
        musicId: 36
    },
    {
        name: 'The Haunting of the Viking Opera',
        musicId: 41
    },
    {
        name: 'Ruby and the Ruby',
        musicId: 37
    },
    {
        name: 'Underwater Adventure',
        musicId: 230
    },
    {
        name: 'Squidzoid vs. Shadow Guy and Gamma Gal',
        musicId: 32
    },
    {
        name: 'Fairy Fables',
        musicId: 39
    },
    {
        name: 'Norman Swarm Has Been Transformed',
        musicId: 42
    },
    {
        name: 'Secrets of the Bamboo Forest',
        musicId: 43
    },
    {
        name: 'Space Adventure Planet Y',
        musicId: 38
    },
    {
        name: 'Night of the Living Sled: Live',
        musicId: 253
    },
    {
        name: 'Battle of the Ancient Shadows',
        musicId: 314
    },
    {
        name: 'A Humbug Holiday',
        musicId: 255
    },
    {
        name: 'The Vikings That Time Forgot',
        musicId: 41
    }
];
function getStagePlayMusic(name) {
    return exports.STAGE_PLAYS.find((stage) => stage.name === name)?.musicId ?? 0;
}
