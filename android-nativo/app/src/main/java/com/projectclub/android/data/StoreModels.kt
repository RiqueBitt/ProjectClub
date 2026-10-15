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

@Serializable
data class StoreShop(
    val decorations: List<StoreDecoration> = emptyList(),
    val effects: List<StoreEffect> = emptyList(),
    val collections: List<StoreCollection> = emptyList(),
    val coins: Int = 0,
    val gems: Int = 0,
    val equippedId: String? = null,
    val equippedEffectId: String? = null,
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
