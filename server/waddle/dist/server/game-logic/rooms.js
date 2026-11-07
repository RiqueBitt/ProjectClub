"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isGameRoom = exports.isLiteralScoreGame = exports.Room = void 0;
var Room;
(function (Room) {
    Room[Room["Town"] = 100] = "Town";
    Room[Room["GiftShop"] = 130] = "GiftShop";
    Room[Room["VRRoom"] = 213] = "VRRoom";
    Room[Room["PizzaParlor"] = 330] = "PizzaParlor";
    Room[Room["AstroBarrier"] = 900] = "AstroBarrier";
    Room[Room["BeanCounters"] = 901] = "BeanCounters";
    Room[Room["PuffleRoundup"] = 902] = "PuffleRoundup";
    Room[Room["HydroHopper"] = 903] = "HydroHopper";
    Room[Room["IceFishing"] = 904] = "IceFishing";
    Room[Room["CartSurfer"] = 905] = "CartSurfer";
    Room[Room["JetPackAdventure"] = 906] = "JetPackAdventure";
    Room[Room["Mission1"] = 907] = "Mission1";
    Room[Room["Mission2"] = 908] = "Mission2";
    Room[Room["ThinIce"] = 909] = "ThinIce";
    Room[Room["Pizzatron"] = 910] = "Pizzatron";
    Room[Room["Mission3"] = 911] = "Mission3";
    Room[Room["CatchinWaves"] = 912] = "CatchinWaves";
    Room[Room["Mission4"] = 913] = "Mission4";
    Room[Room["Mission5"] = 914] = "Mission5";
    Room[Room["Mission6"] = 915] = "Mission6";
    Room[Room["AquaGrabber"] = 916] = "AquaGrabber";
    Room[Room["MyPuffle"] = 917] = "MyPuffle";
    Room[Room["BurntOutBulbs"] = 918] = "BurntOutBulbs";
    Room[Room["LimeGreenDojoClean"] = 919] = "LimeGreenDojoClean";
    Room[Room["Mission7"] = 920] = "Mission7";
    Room[Room["Mission8"] = 921] = "Mission8";
    Room[Room["Mission9"] = 922] = "Mission9";
    Room[Room["Mission10"] = 923] = "Mission10";
    Room[Room["DJ3K"] = 926] = "DJ3K";
    Room[Room["Mission11"] = 927] = "Mission11";
    Room[Room["PuffleSoaker"] = 941] = "PuffleSoaker";
    Room[Room["BalloonPop"] = 942] = "BalloonPop";
    Room[Room["RingTheBell"] = 943] = "RingTheBell";
    Room[Room["FeedAPuffle"] = 944] = "FeedAPuffle";
    Room[Room["MemoryCardGame"] = 945] = "MemoryCardGame";
    Room[Room["PufflePaddle"] = 946] = "PufflePaddle";
    Room[Room["PuffleShuffle"] = 947] = "PuffleShuffle";
    Room[Room["PuffleRescue"] = 949] = "PuffleRescue";
    Room[Room["SystemDefender"] = 950] = "SystemDefender";
    Room[Room["DanceContest"] = 952] = "DanceContest";
    Room[Room["PuffleLaunch"] = 955] = "PuffleLaunch";
    Room[Room["PuffleScape"] = 957] = "PuffleScape";
    Room[Room["CardJitsuWater"] = 995] = "CardJitsuWater";
    Room[Room["CardJitsuFire"] = 997] = "CardJitsuFire";
    Room[Room["CardJitsu"] = 998] = "CardJitsu";
})(Room || (exports.Room = Room = {}));
/** If the game's score is converted to coins exactly */
const isLiteralScoreGame = (room) => {
    return [
        Room.IceFishing,
        Room.CartSurfer,
        Room.JetPackAdventure,
        Room.CatchinWaves,
        Room.AquaGrabber,
        Room.DanceContest,
        Room.MyPuffle,
        Room.BurntOutBulbs,
        Room.LimeGreenDojoClean,
        Room.PuffleScape
    ].includes(room);
};
exports.isLiteralScoreGame = isLiteralScoreGame;
const isGameRoom = (room) => {
    // from what I know, 900 and forward is only minigames
    // 1000 and above however is reserved for igloos
    return room >= 900 && room < 1000;
};
exports.isGameRoom = isGameRoom;
