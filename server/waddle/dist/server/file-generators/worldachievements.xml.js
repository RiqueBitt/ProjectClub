"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getWorldAchievementsXml = getWorldAchievementsXml;
class WorldAchievementsXml {
    _worldAchievements = [];
    addWorldStamps(stamps) {
        stamps.forEach(stamp => {
            stamp.declarations.forEach((declaration, i) => {
                this._worldAchievements.push({
                    stamp: stamp.id,
                    name: stamp.name,
                    subId: stamp.declarations.length > 1 ? i : undefined,
                    conditions: declaration.conditions,
                    event: declaration.event,
                    optionalConditions: declaration.optionalConditions
                });
            });
        });
    }
    serialize() {
        return `<achievementDocument>
      ${this._worldAchievements.map(a => {
            return `<achievement name="${a.name}" id="${a.stamp}${a.subId === undefined ? '' : `.${a.subId}`}">
      <event>${a.event}</event>
      ${a.conditions.map(c => {
                return `<condition>${c}</condition>`;
            }).join('\n')}
      ${a.optionalConditions?.map(c => {
                return `<optionalCondition>${c}</optionalCondition>`;
            })?.join('\n') ?? ''}
      <result>stampEarned ${a.stamp}</result>
    </achievement>`;
        }).join('\n')}
    </achievementDocument>`;
    }
}
function getWorldAchievementsXml(d) {
    const worldAchievements = new WorldAchievementsXml();
    const worldStamps = d.getWorldStamps();
    worldAchievements.addWorldStamps(worldStamps);
    return worldAchievements.serialize();
}
