package com.projectclub.android.data

import kotlinx.serialization.Serializable

/*
 * Modelos da Loja (GET /api/decorations/shop e compras).
 * Molduras de avatar, efeitos de perfil e coleções (pacotes com oferta).
 * Todos os campos têm padrão: o servidor manda bem mais coisa do que usamos.
 * Os campos subscriber* só aparecem se o servidor um dia mandar desconto de Assinante.
 */

@Serializable
data class StoreDecoration(
    val id: String,
    val name: String = "",
    val imageUrl: String? = null,
    val priceCoins: Int? = null,
    val priceGems: Int? = null,
    val subscriberPriceCoins: Int? = null,
    val subscriberPriceGems: Int? = null,
    val scale: Float = 1.2f,
    val offsetX: Float = 0f,
    val offsetY: Float = 0f,
    val sortOrder: Int = 0,
    val collectionId: String? = null,
    val createdAt: String? = null,
    val owned: Boolean = false,
    /** Item limitado: estoque, vendidos, quanto resta e o número da sua cópia. */
    val limited: Boolean = false,
    val stock: Int? = null,
    val sold: Int = 0,
    val remaining: Int? = null,
    val serial: Int? = null,
    val locked: Boolean = false,
    val exclusiveTier: String? = null,
    val description: String? = null,
)

@Serializable
data class StoreEffect(
    val id: String,
    val name: String = "",
    val imageUrl: String? = null,
    val priceCoins: Int? = null,
    val priceGems: Int? = null,
    val subscriberPriceCoins: Int? = null,
    val subscriberPriceGems: Int? = null,
    val scale: Float = 1f,
    val offsetX: Float = 0f,
    val offsetY: Float = 0f,
    val opacity: Float = 0.85f,
    val mScale: Float = 1f,
    val mOffsetX: Float = 0f,
    val mOffsetY: Float = 0f,
    val mOpacity: Float = 0.85f,
    val sortOrder: Int = 0,
    val collectionId: String? = null,
    val createdAt: String? = null,
    val owned: Boolean = false,
    /** Item limitado: estoque, vendidos, quanto resta e o número da sua cópia. */
    val limited: Boolean = false,
    val stock: Int? = null,
    val sold: Int = 0,
    val remaining: Int? = null,
    val serial: Int? = null,
    val locked: Boolean = false,
    val exclusiveTier: String? = null,
    val description: String? = null,
)

/** Oferta por tempo limitado numa coleção (desconto % no pacote). */
@Serializable
data class StoreOffer(
    val discount: Int = 0,
    val startsAt: String? = null,
    val endsAt: String? = null,
    val active: Boolean = false,
)

@Serializable
data class StoreCollection(
    val id: String,
    val name: String = "",
    val description: String? = null,
    val bannerUrl: String? = null,
    val logoUrl: String? = null,
    val accentColor: String? = null,
    val featured: Boolean = false,
    val sortOrder: Int = 0,
    val bundlePriceCoins: Int? = null,
    val bundlePriceGems: Int? = null,
    /** O que se paga agora (com a oferta, se ativa). */
    val finalBundleCoins: Int? = null,
    val finalBundleGems: Int? = null,
    val offer: StoreOffer? = null,
    val createdAt: String? = null,
)

/** Fonte do nome / estilo de perfil (ShopItem). data: {family, url} ou {style}. */
@Serializable
data class StoreItemData(val family: String? = null, val url: String? = null, val source: String? = null, val style: String? = null)

@Serializable
data class StoreShopItem(
    val id: String,
    val kind: String = "",
    val key: String? = null,
    val name: String = "",
    val previewUrl: String? = null,
    val data: StoreItemData? = null,
    val priceCoins: Int? = null,
    val priceGems: Int? = null,
    val sortOrder: Int = 0,
    val collectionId: String? = null,
    val createdAt: String? = null,
    val owned: Boolean = false,
    /** Item limitado: estoque, vendidos, quanto resta e o número da sua cópia. */
    val limited: Boolean = false,
    val stock: Int? = null,
    val sold: Int = 0,
    val remaining: Int? = null,
    val serial: Int? = null,
    val locked: Boolean = false,
    val exclusiveTier: String? = null,
    val description: String? = null,
) {
    val styleKey: String? get() = data?.style ?: key?.removePrefix("style:")
    /** O mesmo JSON que fica em User.profileFont (pra prévia). */
    val fontJson: String? get() = data?.family?.let { org.json.JSONObject().put("id", id).put("family", it).put("url", data.url ?: "").toString() }
}

@Serializable
data class StoreShop(
    val decorations: List<StoreDecoration> = emptyList(),
    val effects: List<StoreEffect> = emptyList(),
    val collections: List<StoreCollection> = emptyList(),
    val coins: Int = 0,
    val gems: Int = 0,
    val equippedId: String? = null,
    val equippedEffectId: String? = null,
    val fonts: List<StoreShopItem> = emptyList(),
    val styles: List<StoreShopItem> = emptyList(),
    val equippedFontId: String? = null,
    val equippedStyle: String? = null,
    /** Opcional: o servidor ainda não manda; se mandar, a tela mostra o selo de Assinante. */
    val subscriber: Boolean = false,
)

/** Resposta das compras ({ ok, coins, gems, paid? }). */
@Serializable
data class StoreBuyResult(
    val ok: Boolean = false,
    val coins: Int? = null,
    val gems: Int? = null,
    val paid: Int? = null,
)

// ---------- Trocas de itens limitados ----------
@Serializable
data class TradeItem(
    val kind: String = "", val id: String = "", val name: String = "", val imageUrl: String? = null,
    val data: StoreItemData? = null, val serial: Int? = null, val stock: Int? = null,
)

@Serializable
data class TradeSide(val items: List<TradeItem> = emptyList(), val coins: Int = 0, val gems: Int = 0)

@Serializable
data class Trade(
    val id: String, val status: String = "PENDING", val message: String? = null, val createdAt: String? = null,
    val from: User? = null, val to: User? = null, val offer: TradeSide = TradeSide(), val request: TradeSide = TradeSide(),
)

@Serializable
data class TradesResponse(val incoming: List<Trade> = emptyList(), val outgoing: List<Trade> = emptyList(), val history: List<Trade> = emptyList())

@Serializable
data class LimitedsResponse(val user: User? = null, val items: List<TradeItem> = emptyList())
