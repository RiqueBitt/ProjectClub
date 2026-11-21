"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const boot_1 = require("./boot");
// load user data
const failedMods = (0, boot_1.startMods)();
if (failedMods.length > 0) {
    console.log('Error turning on the following mods:');
    failedMods.forEach(mod => console.log(`- ${mod}`));
}
(0, boot_1.startServices)();
