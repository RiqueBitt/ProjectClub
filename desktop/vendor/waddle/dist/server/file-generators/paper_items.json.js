"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPaperItemsJson = getPaperItemsJson;
function getPaperItemsJson(d) {
    const costs = d.getItemPrices();
    const items = d.getItems().map(i => {
        return ({
            paper_item_id: i.id,
            cost: costs.get(i.id) ?? i.cost,
            label: i.label ?? i.name,
            layer: i.layer,
            is_epf: i.isEPF ? "1" : undefined,
            has_translations: i.hasTranslations ? "1" : undefined,
            has_back: i.hasBack ? "1" : undefined,
            make_secret_agent: i.makeAgent ? "1" : undefined,
            is_gift: i.isGift ? "1" : undefined,
            exclusive: i.exclusive === 0 ? undefined : "1",
            type: i.type,
            is_member: i.isMember,
            prompt: i.name,
            is_bait: i.isBait ? "1" : undefined,
            customDepth: String(i.customDepth) ?? undefined,
            is_back: i.isBack ? "1" : undefined,
            make_tour_guide: i.isTour ? "1" : undefined,
            is_medal: i.isMedal ? "1" : undefined,
            noPurchasPopup: i.noPurchasePopup ? "1" : undefined,
            is_game_achieavable: i.isGameAchievable ? "1" : undefined
        });
    });
    return JSON.stringify(items);
}
