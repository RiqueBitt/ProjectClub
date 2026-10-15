package com.projectclub.android.ui.forum

import android.content.Context
import android.net.Uri
import android.widget.Toast
import com.projectclub.android.data.AppJson
import com.projectclub.android.data.ForumComment
import com.projectclub.android.data.ForumCommentResponse
import com.projectclub.android.data.ForumCommentsResponse
import com.projectclub.android.data.ForumCommunitiesResponse
import com.projectclub.android.data.ForumCommunity
import com.projectclub.android.data.ForumCommunityResponse
import com.projectclub.android.data.ForumPinResponse
import com.projectclub.android.data.ForumPoll
import com.projectclub.android.data.ForumPollResponse
import com.projectclub.android.data.ForumPost
import com.projectclub.android.data.ForumPostResponse
import com.projectclub.android.data.ForumPostsResponse
import com.projectclub.android.data.ForumUploadResponse
import com.projectclub.android.data.ForumVoteResponse
import com.projectclub.android.data.Repository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.toRequestBody
import java.net.URLEncoder

/** Chamadas do Fórum (/api/communities e /api/posts). */
internal object ForumApi {
    private fun enc(s: String) = URLEncoder.encode(s, "UTF-8")

    suspend fun communities(repo: Repository): List<ForumCommunity> =
        repo.api.get<ForumCommunitiesResponse>("/api/communities").communities

    suspend fun community(repo: Repository, slug: String): ForumCommunity? =
        repo.api.get<ForumCommunityResponse>("/api/communities/${enc(slug)}").community

    suspend fun posts(
        repo: Repository,
        sort: String,
        tag: String? = null,
        communitySlug: String? = null,
        categoryId: String? = null,
    ): List<ForumPost> {
        val q = StringBuilder("/api/posts?sort=").append(enc(sort))
        if (!tag.isNullOrBlank()) q.append("&tag=").append(enc(tag))
        if (!communitySlug.isNullOrBlank()) q.append("&communitySlug=").append(enc(communitySlug))
        if (!categoryId.isNullOrBlank()) q.append("&categoryId=").append(enc(categoryId))
        return repo.api.get<ForumPostsResponse>(q.toString()).posts
    }

    suspend fun post(repo: Repository, id: String): ForumPost? =
        repo.api.get<ForumPostResponse>("/api/posts/${enc(id)}").post

    suspend fun vote(repo: Repository, postId: String, value: Int): ForumVoteResponse =
        repo.api.post("/api/posts/${enc(postId)}/vote", buildJsonObject { put("value", value) })

    suspend fun pollVote(repo: Repository, postId: String, optionId: String): ForumPoll? =
        repo.api.post<ForumPollResponse>("/api/posts/${enc(postId)}/poll/vote", buildJsonObject { put("optionId", optionId) }).poll

    suspend fun pin(repo: Repository, postId: String, pinned: Boolean): ForumPinResponse =
        repo.api.post("/api/posts/${enc(postId)}/pin", buildJsonObject { put("pinned", pinned) })

    suspend fun deletePost(repo: Repository, postId: String) = repo.api.delete("/api/posts/${enc(postId)}")

    suspend fun comments(repo: Repository, postId: String): List<ForumComment> =
        repo.api.get<ForumCommentsResponse>("/api/posts/${enc(postId)}/comments").comments

    suspend fun addComment(repo: Repository, postId: String, content: String, parentId: String?): ForumComment? =
        repo.api.post<ForumCommentResponse>(
            "/api/posts/${enc(postId)}/comments",
            buildJsonObject {
                put("content", content)
                if (parentId != null) put("parentId", parentId)
            },
        ).comment

    suspend fun voteComment(repo: Repository, commentId: String, value: Int): ForumVoteResponse =
        repo.api.post("/api/posts/comments/${enc(commentId)}/vote", buildJsonObject { put("value", value) })

    suspend fun deleteComment(repo: Repository, commentId: String) = repo.api.delete("/api/posts/comments/${enc(commentId)}")

    /** Envia a imagem do post (campo "image") e devolve a URL que vai no POST /api/posts. */
    suspend fun uploadImage(repo: Repository, context: Context, uri: Uri): String {
        val picked = repo.describe(uri)
        val bytes = withContext(Dispatchers.IO) {
            context.contentResolver.openInputStream(uri)?.use { it.readBytes() }
        } ?: throw java.io.IOException("Não deu pra ler a imagem.")
        if (bytes.size > 25 * 1024 * 1024) throw java.io.IOException("Imagem grande demais.")
        val body = MultipartBody.Builder().setType(MultipartBody.FORM)
            .addFormDataPart("image", picked.name, bytes.toRequestBody(picked.mime.toMediaTypeOrNull()))
            .build()
        val text = repo.api.postBody("/api/posts/upload-image", body)
        return AppJson.decodeFromString(ForumUploadResponse.serializer(), text).url
            ?: throw java.io.IOException("O servidor não devolveu a imagem.")
    }

    suspend fun createPost(repo: Repository, body: JsonObject): ForumPost? =
        repo.api.post<ForumPostResponse>("/api/posts", body).post
}

internal fun toast(context: Context, text: String?) {
    if (text.isNullOrBlank()) return
    Toast.makeText(context, text, Toast.LENGTH_SHORT).show()
}

/** Mensagem amigável do erro (ApiException já vem em português). */
internal fun errorText(e: Throwable, fallback: String = "Não deu certo. Tente de novo."): String =
    e.message?.takeIf { it.isNotBlank() && e !is kotlinx.serialization.SerializationException } ?: fallback
