"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LOGIN_PORT = exports.WORLD_PORT = exports.LOGIN_DELTA = exports.WORLD_DELTA = void 0;
exports.getServerPopulation = getServerPopulation;
const constants_1 = require("../../common/constants");
exports.WORLD_DELTA = 2;
exports.LOGIN_DELTA = 1;
exports.WORLD_PORT = constants_1.HTTP_PORT + exports.WORLD_DELTA;
exports.LOGIN_PORT = constants_1.HTTP_PORT + exports.LOGIN_DELTA;
function getServerPopulation() {
    const seed = Math.random();
    if (seed < 0.1) {
        return 1;
    }
    else if (seed < 0.2) {
        return 2;
    }
    else if (seed < 0.3) {
        return 3;
    }
    else if (seed < 0.6) {
        return 4;
    }
    else if (seed < 0.8) {
        return 5;
    }
    else {
        return 6;
    }
}
const Languages = [
    { lang: 'en', servers: [
            'Blizzard',
            'Ice Berg',
            'White Out',
            'Slushy',
            'Flurry',
            'Snow Angel',
            'Snow Day',
            'Frostbite',
            'Icicle',
            'Tundra',
            'Snow Cone',
            'Alpine',
            'Ice Breaker',
            'Snow Globe',
            'Snow Fort',
            'Mammoth',
            'Grizzly',
            'Winter Land',
            'Freezer',
            'Avalanche',
            'Powder Ball',
            'Summit',
            'Flippers',
            'Yeti',
            'Sub Zero',
            'Ice Cold',
            'Crystal',
            'Snow Bank',
            'Ice Palace',
            'Tuxedo',
            'Abominable',
            'Half Pipe',
            'Snow Board',
            'Alaska',
            'Thermal',
            'Toboggan',
            'Husky',
            'Snow Plow',
            'Ice Age',
            'Sabertooth',
            'Parka',
            'Hibernate',
            'Sleet',
            'Vanilla',
            'Christmas',
            'Klondike',
            'Icebound',
            'White House',
            'Fjord',
            'Big Foot',
            'Rocky Road',
            'Rainbow',
            'Arctic',
            'Shiver',
            'Matterhorn',
            'Bobsled',
            'Ice Box',
            'Bunny Hill',
            'Walrus',
            'Deep Snow',
            'Snowmobile',
            'Northern Lights',
            'Southern Lights',
            'Ice Shelf',
            'Ascent',
            'Snowcap',
            'Hockey',
            'Jack Frost',
            'Oyster',
            'Pine Needles',
            'Hypothermia',
            'Zipline',
            'North Pole',
            'Glacier',
            'Aurora',
            'Mukluk',
            'Great White',
            'Snow Shoe',
            'Yukon',
            'Polar Bear',
            'Chinook',
            'Wool Socks',
            'Snowbound',
            'Ice Pond',
            'Snowfall',
            'Caribou',
            'Deep Freeze',
            'Cold Front',
            'Frozen',
            'Snow Flake',
            'Frosty',
            'Snow Drift',
            'Mittens',
            'Breeze',
            'Crunch',
            'Wind Chill',
            'Iceland',
            'Belly Slide',
            'Sherbet',
            'South Pole',
            'Big Surf',
            'Sasquatch',
            'Kosciuszko',
            'Down Under',
            'Beanie',
            'Outback',
            'Snowy River',
            'Big Snow',
            'Brumby',
            'Cold Snap',
            'Permafrost',
            'Below Zero',
            'Snow Ball',
            'Ice Pack',
            'Ice Cream',
            'Bubblegum',
            'Altitude',
            'Canoe',
            'Ice Rink',
            'Ice Cave',
            'Boots',
            'Ice Cube',
            'Bonza',
            'Polar',
            'Dry Ice',
            'Snow Covered',
            'Glacial',
            'Pantagonia',
            'Antarctic',
            'Downhill',
            'Elevation',
            'Tea',
            'Misty',
            'Adventure',
            'Beanbag',
            'Cream Soda',
            'Fiesta',
            'Grasshopper',
            'Hot Chocolate',
            'Jackhammer',
            'Migrator',
            'Mullet',
            'Puddle',
            'Sardine',
            'Skates',
            'Berg',
            'Cozy',
            'Sparkle',
            'Slippers',
            'Mountain',
            'Cabin',
            'Fog',
            'Cloudy',
            'Sled'
        ] },
    { lang: 'pt', servers: [
            'Avalanche'
        ] },
    { lang: 'fr', servers: [
            'Yeti'
        ] },
    { lang: 'es', servers: [
            'Glaciar'
        ] }
];
let i = 0;
const locales = Languages.map((locale) => {
    return {
        lang: locale.lang,
        servers: locale.servers.map((name) => {
            const id = 3000 + i;
            i++;
            return { name, id };
        })
    };
});
const serverList = locales.reduce((accumulator, currentValue) => {
    return [...accumulator, ...currentValue.servers];
}, []);
exports.default = serverList;
