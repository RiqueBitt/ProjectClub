package com.projectclub.android.data

import kotlinx.serialization.Serializable

/*
 * Fórum (/comunidades no site): Temas (Community no servidor), categorias de
 * post dentro de cada Tema, posts, enquetes dos posts e comentários.
 * Rotas: /api/communities e /api/posts.
 */

/** Categoria de post dentro de um Tema (Discussão, Meme, Dúvida...). */
@Serializable
data class ForumCategory(
    val id: String = "",
    val communityId: String? = null,
    val name: String = "",
    val iconUrl: String? = null,
    val bannerUrl: String? = null,
    val description: String? = null,
    val position: Int = 0,
)

/** Tema do Fórum (o servidor chama de "community"/Clube). */
@Serializable
data class ForumCommunity(
    val id: String = "",
    val slug: String = "",
    val name: String = "",
    val description: String? = null,
    val iconUrl: String? = null,
    val bannerUrl: String? = null,
    val createdAt: String? = null,
    val createdBy: User? = null,
    val categories: List<ForumCategory> = emptyList(),
    val postTags: List<String> = emptyList(),
    val postCount: Int = 0,
)

@Serializable
data class ForumCommunitiesResponse(val communities: List<ForumCommunity> = emptyList())

@Serializable
data class ForumCommunityResponse(val community: ForumCommunity? = null)

/** Resumo do Tema que vem dentro de cada post. */
@Serializable
data class ForumCommunityRef(
    val id: String = "",
    val slug: String = "",
    val name: String = "",
    val iconUrl: String? = null,
)

@Serializable
data class ForumPollOption(
    val id: String = "",
    val text: String = "",
    val votes: Int = 0,
    val percent: Int = 0,
)

@Serializable
data class ForumPoll(
    val id: String = "",
    val question: String? = null,
    val totalVotes: Int = 0,
    val myVoteOptionId: String? = null,
    val options: List<ForumPollOption> = emptyList(),
)

@Serializable
data class ForumPost(
    val id: String = "",
    val communityId: String? = null,
    val categoryId: String? = null,
    val authorId: String? = null,
    val title: String = "",
    /** TEXT | IMAGE | LINK */
    val type: String = "TEXT",
    val content: String? = null,
    val imageUrl: String? = null,
    val linkUrl: String? = null,
    val score: Int = 0,
    val commentCount: Int = 0,
    val tags: List<String> = emptyList(),
    val pinned: Boolean = false,
    val pinnedAt: String? = null,
    val createdAt: String? = null,
    val author: User? = null,
    val community: ForumCommunityRef? = null,
    val category: ForumCategory? = null,
    val myVote: Int = 0,
    val poll: ForumPoll? = null,
) {
    val isPinned: Boolean get() = pinned || pinnedAt != null
}

@Serializable
data class ForumPostsResponse(val posts: List<ForumPost> = emptyList())

@Serializable
data class ForumPostResponse(val post: ForumPost? = null)

@Serializable
data class ForumVoteResponse(val score: Int = 0, val myVote: Int = 0)

@Serializable
data class ForumPollResponse(val poll: ForumPoll? = null)

@Serializable
data class ForumPinResponse(val pinned: Boolean = false, val pinnedAt: String? = null)

@Serializable
data class ForumUploadResponse(val url: String? = null)

/** Comentário (o servidor já manda em árvore: replies dentro de cada um). */
@Serializable
data class ForumComment(
    val id: String = "",
    val postId: String? = null,
    val authorId: String? = null,
    val parentId: String? = null,
    val content: String = "",
    val score: Int = 0,
    val deleted: Boolean = false,
    val createdAt: String? = null,
    val author: User? = null,
    val myVote: Int = 0,
    val replies: List<ForumComment> = emptyList(),
)

@Serializable
data class ForumCommentsResponse(val comments: List<ForumComment> = emptyList())

@Serializable
data class ForumCommentResponse(val comment: ForumComment? = null)
