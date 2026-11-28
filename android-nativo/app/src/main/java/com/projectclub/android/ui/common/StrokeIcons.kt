package com.projectclub.android.ui.common

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.addPathNodes
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * Ícones de traço das insígnias e conquistas (mesmos do site: estilo Tabler,
 * 24x24, traço 2, pontas arredondadas — Tabler Icons, MIT). Gerado de
 * client/src/utils/tablerIcons.js e achievementIcons.js.
 */
object StrokeIcons {
    val PATHS: Map<String, List<String>> = mapOf(
        "album" to listOf("M4 6a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2l0 -12", "M12 4v7l2 -2l2 2v-7"),
        "award" to listOf("M6 9a6 6 0 1 0 12 0a6 6 0 1 0 -12 0", "M12 15l3.4 5.89l1.598 -3.233l3.598 .232l-3.4 -5.889", "M6.802 12l-3.4 5.89l3.598 -.233l1.598 3.232l3.4 -5.889"),
        "bolt" to listOf("M13 3l0 7l6 0l-8 11l0 -7l-6 0l8 -11"),
        "bug" to listOf("M9 9v-1a3 3 0 0 1 6 0v1", "M8 9h8a6 6 0 0 1 1 3v3a5 5 0 0 1 -10 0v-3a6 6 0 0 1 1 -3", "M3 13l4 0", "M17 13l4 0", "M12 20l0 -6", "M4 19l3.35 -2", "M20 19l-3.35 -2", "M4 7l3.75 2.4", "M20 7l-3.75 2.4"),
        "cake" to listOf("M3 20h18v-8a3 3 0 0 0 -3 -3h-12a3 3 0 0 0 -3 3v8", "M3 14.803c.312 .135 .654 .204 1 .197a2.4 2.4 0 0 0 2 -1a2.4 2.4 0 0 1 2 -1a2.4 2.4 0 0 1 2 1a2.4 2.4 0 0 0 2 1a2.4 2.4 0 0 0 2 -1a2.4 2.4 0 0 1 2 -1a2.4 2.4 0 0 1 2 1a2.4 2.4 0 0 0 2 1c.35 .007 .692 -.062 1 -.197", "M12 4l1.465 1.638a2 2 0 1 1 -3.015 .099l1.55 -1.737"),
        "calendar-check" to listOf("M11.5 21h-5.5a2 2 0 0 1 -2 -2v-12a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v6", "M16 3v4", "M8 3v4", "M4 11h16", "M15 19l2 2l4 -4"),
        "camera" to listOf("M5 7h1a2 2 0 0 0 2 -2a1 1 0 0 1 1 -1h6a1 1 0 0 1 1 1a2 2 0 0 0 2 2h1a2 2 0 0 1 2 2v9a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-9a2 2 0 0 1 2 -2", "M9 13a3 3 0 1 0 6 0a3 3 0 0 0 -6 0"),
        "cards" to listOf("M3.604 7.197l7.138 -3.109a.96 .96 0 0 1 1.27 .527l4.924 11.902a1 1 0 0 1 -.514 1.304l-7.137 3.109a.96 .96 0 0 1 -1.271 -.527l-4.924 -11.903a1 1 0 0 1 .514 -1.304l0 .001", "M15 4h1a1 1 0 0 1 1 1v3.5", "M20 6c.264 .112 .52 .217 .768 .315a1 1 0 0 1 .53 1.311l-2.298 5.374"),
        "coins" to listOf("M9 14c0 1.657 2.686 3 6 3s6 -1.343 6 -3s-2.686 -3 -6 -3s-6 1.343 -6 3", "M9 14v4c0 1.656 2.686 3 6 3s6 -1.344 6 -3v-4", "M3 6c0 1.072 1.144 2.062 3 2.598s4.144 .536 6 0c1.856 -.536 3 -1.526 3 -2.598c0 -1.072 -1.144 -2.062 -3 -2.598s-4.144 -.536 -6 0c-1.856 .536 -3 1.526 -3 2.598", "M3 6v10c0 .888 .772 1.45 2 2", "M3 11c0 .888 .772 1.45 2 2"),
        "confetti" to listOf("M4 5h2", "M5 4v2", "M11.5 4l-.5 2", "M18 5h2", "M19 4v2", "M15 9l-1 1", "M18 13l2 -.5", "M18 19h2", "M19 18v2", "M14 16.518l-6.518 -6.518l-4.39 9.58a1 1 0 0 0 1.329 1.329l9.579 -4.39"),
        "crown" to listOf("M12 6l4 6l5 -4l-2 10h-14l-2 -10l5 4l4 -6"),
        "diamond" to listOf("M6 5h12l3 5l-8.5 9.5a.7 .7 0 0 1 -1 0l-8.5 -9.5l3 -5", "M10 12l-2 -2.2l.6 -1"),
        "diamonds" to listOf("M10.831 20.413l-5.375 -6.91c-.608 -.783 -.608 -2.223 0 -3l5.375 -6.911a1.457 1.457 0 0 1 2.338 0l5.375 6.91c.608 .783 .608 2.223 0 3l-5.375 6.911a1.457 1.457 0 0 1 -2.338 0"),
        "file-text" to listOf("M14 3v4a1 1 0 0 0 1 1h4", "M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2", "M9 9l1 0", "M9 13l6 0", "M9 17l6 0"),
        "flame" to listOf("M12 10.941c2.333 -3.308 .167 -7.823 -1 -8.941c0 3.395 -2.235 5.299 -3.667 6.706c-1.43 1.408 -2.333 3.294 -2.333 5.588c0 3.704 3.134 6.706 7 6.706c3.866 0 7 -3.002 7 -6.706c0 -1.712 -1.232 -4.403 -2.333 -5.588c-2.084 3.353 -3.257 3.353 -4.667 2.235"),
        "flask" to listOf("M9 3l6 0", "M10 9l4 0", "M10 3v6l-4 11a.7 .7 0 0 0 .5 1h11a.7 .7 0 0 0 .5 -1l-4 -11v-6"),
        "gavel" to listOf("M13 10l7.383 7.418c.823 .82 .823 2.148 0 2.967a2.11 2.11 0 0 1 -2.976 0l-7.407 -7.385", "M6 9l4 4", "M13 10l-4 -4", "M3 21h7", "M6.793 15.793l-3.586 -3.586a1 1 0 0 1 0 -1.414l2.293 -2.293l.5 .5l3 -3l-.5 -.5l2.293 -2.293a1 1 0 0 1 1.414 0l3.586 3.586a1 1 0 0 1 0 1.414l-2.293 2.293l-.5 -.5l-3 3l.5 .5l-2.293 2.293a1 1 0 0 1 -1.414 0"),
        "ghost" to listOf("M5 11a7 7 0 0 1 14 0v7a1.78 1.78 0 0 1 -3.1 1.4a1.65 1.65 0 0 0 -2.6 0a1.65 1.65 0 0 1 -2.6 0a1.65 1.65 0 0 0 -2.6 0a1.78 1.78 0 0 1 -3.1 -1.4v-7", "M10 10l.01 0", "M14 10l.01 0", "M10 14a3.5 3.5 0 0 0 4 0"),
        "heart" to listOf("M19.5 12.572l-7.5 7.428l-7.5 -7.428a5 5 0 1 1 7.5 -6.566a5 5 0 1 1 7.5 6.572"),
        "heart-broken" to listOf("M19.5 12.572l-7.5 7.428l-7.5 -7.428a5 5 0 1 1 7.5 -6.566a5 5 0 1 1 7.5 6.572", "M12 6l-2 4l4 3l-2 4v3"),
        "heart-handshake" to listOf("M19.5 12.572l-7.5 7.428l-7.5 -7.428a5 5 0 1 1 7.5 -6.566a5 5 0 1 1 7.5 6.572", "M12 6l-3.293 3.293a1 1 0 0 0 0 1.414l.543 .543c.69 .69 1.81 .69 2.5 0l1 -1a3.182 3.182 0 0 1 4.5 0l2.25 2.25", "M12.5 15.5l2 2", "M15 13l2 2"),
        "hearts" to listOf("M14.017 18l-2.017 2l-7.5 -7.428a5 5 0 1 1 7.5 -6.566a5 5 0 0 1 8.153 5.784", "M15.99 20l4.197 -4.223a2.81 2.81 0 0 0 0 -3.948a2.747 2.747 0 0 0 -3.91 -.007l-.28 .282l-.279 -.283a2.747 2.747 0 0 0 -3.91 -.007a2.81 2.81 0 0 0 -.007 3.948l4.182 4.238l.007 0"),
        "message-circle" to listOf("M3 20l1.3 -3.9c-2.324 -3.437 -1.426 -7.872 2.1 -10.374c3.526 -2.501 8.59 -2.296 11.845 .48c3.255 2.777 3.695 7.266 1.029 10.501c-2.666 3.235 -7.615 4.215 -11.574 2.293l-4.7 1"),
        "message-dots" to listOf("M12 11v.01", "M8 11v.01", "M16 11v.01", "M18 4a3 3 0 0 1 3 3v8a3 3 0 0 1 -3 3h-5l-5 3v-3h-2a3 3 0 0 1 -3 -3v-8a3 3 0 0 1 3 -3l12 0"),
        "messages" to listOf("M21 14l-3 -3h-7a1 1 0 0 1 -1 -1v-6a1 1 0 0 1 1 -1h9a1 1 0 0 1 1 1v10", "M14 15v2a1 1 0 0 1 -1 1h-7l-3 3v-10a1 1 0 0 1 1 -1h2"),
        "microphone-2" to listOf("M15 12.9a5 5 0 1 0 -3.902 -3.9", "M15 12.9l-3.902 -3.899l-7.513 8.584a2 2 0 1 0 2.827 2.83l8.588 -7.515"),
        "military-rank" to listOf("M18 7v12a2 2 0 0 1 -2 2h-8a2 2 0 0 1 -2 -2v-12l6 -4l6 4", "M10 13l2 -1l2 1", "M10 17l2 -1l2 1", "M10 9l2 -1l2 1"),
        "mood-happy" to listOf("M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0", "M9 9l.01 0", "M15 9l.01 0", "M8 13a4 4 0 1 0 8 0h-8"),
        "mood-heart" to listOf("M21 12a9 9 0 1 0 -8.012 8.946", "M9 10h.01", "M15 10h.01", "M9.5 15a3.59 3.59 0 0 0 2.774 .99", "M18.994 21.5l2.518 -2.58a1.74 1.74 0 0 0 .004 -2.413a1.627 1.627 0 0 0 -2.346 -.005l-.168 .172l-.168 -.172a1.627 1.627 0 0 0 -2.346 -.004a1.74 1.74 0 0 0 -.004 2.412l2.51 2.59"),
        "mood-plus" to listOf("M20.985 12.528a9 9 0 1 0 -8.45 8.456", "M16 19h6", "M19 16v6", "M9 10h.01", "M15 10h.01", "M9.5 15c.658 .64 1.56 1 2.5 1s1.842 -.36 2.5 -1"),
        "mood-wink" to listOf("M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0", "M15 10h.01", "M9.5 15a3.5 3.5 0 0 0 5 0", "M8.5 8.5l1.5 1.5l-1.5 1.5"),
        "notes" to listOf("M5 5a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v14a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2l0 -14", "M9 7l6 0", "M9 11l6 0", "M9 15l4 0"),
        "package" to listOf("M12 3l8 4.5l0 9l-8 4.5l-8 -4.5l0 -9l8 -4.5", "M12 12l8 -4.5", "M12 12l0 9", "M12 12l-8 -4.5", "M16 5.25l-8 4.5"),
        "palette" to listOf("M12 21a9 9 0 0 1 0 -18c4.97 0 9 3.582 9 8c0 1.06 -.474 2.078 -1.318 2.828c-.844 .75 -1.989 1.172 -3.182 1.172h-2.5a2 2 0 0 0 -1 3.75a1.3 1.3 0 0 1 -1 2.25", "M7.5 10.5a1 1 0 1 0 2 0a1 1 0 1 0 -2 0", "M11.5 7.5a1 1 0 1 0 2 0a1 1 0 1 0 -2 0", "M15.5 10.5a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"),
        "seedling" to listOf("M12 10a6 6 0 0 0 -6 -6h-3v2a6 6 0 0 0 6 6h3", "M12 14a6 6 0 0 1 6 -6h3v1a6 6 0 0 1 -6 6h-3", "M12 20l0 -10"),
        "shield-check" to listOf("M11.46 20.846a12 12 0 0 1 -7.96 -14.846a12 12 0 0 0 8.5 -3a12 12 0 0 0 8.5 3a12 12 0 0 1 -.09 7.06", "M15 19l2 2l4 -4"),
        "shield-star" to listOf("M11.143 20.743a12 12 0 0 1 -7.643 -14.743a12 12 0 0 0 8.5 -3a12 12 0 0 0 8.5 3c.504 1.716 .614 3.505 .343 5.237", "M17.8 20.817l-2.172 1.138a.392 .392 0 0 1 -.568 -.41l.415 -2.411l-1.757 -1.707a.389 .389 0 0 1 .217 -.665l2.428 -.352l1.086 -2.193a.392 .392 0 0 1 .702 0l1.086 2.193l2.428 .352a.39 .39 0 0 1 .217 .665l-1.757 1.707l.414 2.41a.39 .39 0 0 1 -.567 .411l-2.172 -1.138"),
        "skull" to listOf("M12 4c4.418 0 8 3.358 8 7.5c0 1.901 -.755 3.637 -2 4.96l0 2.54a1 1 0 0 1 -1 1h-10a1 1 0 0 1 -1 -1v-2.54c-1.245 -1.322 -2 -3.058 -2 -4.96c0 -4.142 3.582 -7.5 8 -7.5", "M10 17v3", "M14 17v3", "M8 11a1 1 0 1 0 2 0a1 1 0 1 0 -2 0", "M14 11a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"),
        "sparkles" to listOf("M16 18a2 2 0 0 1 2 2a2 2 0 0 1 2 -2a2 2 0 0 1 -2 -2a2 2 0 0 1 -2 2m0 -12a2 2 0 0 1 2 2a2 2 0 0 1 2 -2a2 2 0 0 1 -2 -2a2 2 0 0 1 -2 2m-7 12a6 6 0 0 1 6 -6a6 6 0 0 1 -6 -6a6 6 0 0 1 -6 6a6 6 0 0 1 6 6"),
        "speakerphone" to listOf("M18 8a3 3 0 0 1 0 6", "M10 8v11a1 1 0 0 1 -1 1h-1a1 1 0 0 1 -1 -1v-5", "M12 8l4.524 -3.77a.9 .9 0 0 1 1.476 .692v12.156a.9 .9 0 0 1 -1.476 .692l-4.524 -3.77h-8a1 1 0 0 1 -1 -1v-4a1 1 0 0 1 1 -1h8"),
        "stack-2" to listOf("M12 4l-8 4l8 4l8 -4l-8 -4", "M4 12l8 4l8 -4", "M4 16l8 4l8 -4"),
        "star" to listOf("M12 17.75l-6.172 3.245l1.179 -6.873l-5 -4.867l6.9 -1l3.086 -6.253l3.086 6.253l6.9 1l-5 4.867l1.179 6.873l-6.158 -3.245"),
        "sword" to listOf("M20 4v5l-9 7l-4 4l-3 -3l4 -4l7 -9l5 0", "M6.5 11.5l6 6"),
        "swords" to listOf("M21 3v5l-11 9l-4 4l-3 -3l4 -4l9 -11l5 0", "M5 13l6 6", "M14.32 17.32l3.68 3.68l3 -3l-3.365 -3.365", "M10 5.5l-2 -2.5h-5v5l3 2.5"),
        "target" to listOf("M11 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0", "M7 12a5 5 0 1 0 10 0a5 5 0 1 0 -10 0", "M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0"),
        "thumb-up" to listOf("M7 11v8a1 1 0 0 1 -1 1h-2a1 1 0 0 1 -1 -1v-7a1 1 0 0 1 1 -1h3a4 4 0 0 0 4 -4v-1a2 2 0 0 1 4 0v5h3a2 2 0 0 1 2 2l-1 5a2 3 0 0 1 -2 2h-7a3 3 0 0 1 -3 -3"),
        "tool" to listOf("M7 10h3v-3l-3.5 -3.5a6 6 0 0 1 8 8l6 6a2 2 0 0 1 -3 3l-6 -6a6 6 0 0 1 -8 -8l3.5 3.5"),
        "trophy" to listOf("M8 21l8 0", "M12 17l0 4", "M7 4l10 0", "M17 4v8a5 5 0 0 1 -10 0v-8", "M3 9a2 2 0 1 0 4 0a2 2 0 1 0 -4 0", "M17 9a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"),
        "user-heart" to listOf("M8 7a4 4 0 1 0 8 0a4 4 0 0 0 -8 0", "M6 21v-2a4 4 0 0 1 4 -4h.5", "M18 22l3.35 -3.284a2.143 2.143 0 0 0 .005 -3.071a2.242 2.242 0 0 0 -3.129 -.006l-.224 .22l-.223 -.22a2.242 2.242 0 0 0 -3.128 -.006a2.143 2.143 0 0 0 -.006 3.071l3.355 3.296"),
        "user-plus" to listOf("M8 7a4 4 0 1 0 8 0a4 4 0 0 0 -8 0", "M16 19h6", "M19 16v6", "M6 21v-2a4 4 0 0 1 4 -4h4"),
        "user-star" to listOf("M8 7a4 4 0 1 0 8 0a4 4 0 0 0 -8 0", "M6 21v-2a4 4 0 0 1 4 -4h.5", "M17.8 20.817l-2.172 1.138a.392 .392 0 0 1 -.568 -.41l.415 -2.411l-1.757 -1.707a.389 .389 0 0 1 .217 -.665l2.428 -.352l1.086 -2.193a.392 .392 0 0 1 .702 0l1.086 2.193l2.428 .352a.39 .39 0 0 1 .217 .665l-1.757 1.707l.414 2.41a.39 .39 0 0 1 -.567 .411l-2.172 -1.138"),
        "users" to listOf("M5 7a4 4 0 1 0 8 0a4 4 0 1 0 -8 0", "M3 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2", "M16 3.13a4 4 0 0 1 0 7.75", "M21 21v-2a4 4 0 0 0 -3 -3.85"),
        "users-group" to listOf("M10 13a2 2 0 1 0 4 0a2 2 0 0 0 -4 0", "M8 21v-1a2 2 0 0 1 2 -2h4a2 2 0 0 1 2 2v1", "M15 5a2 2 0 1 0 4 0a2 2 0 0 0 -4 0", "M17 10h2a2 2 0 0 1 2 2v1", "M5 5a2 2 0 1 0 4 0a2 2 0 0 0 -4 0", "M3 13v-1a2 2 0 0 1 2 -2h2"),
        "writing" to listOf("M20 17v-12c0 -1.121 -.879 -2 -2 -2s-2 .879 -2 2v12l2 2l2 -2", "M16 7h4", "M18 19h-13a2 2 0 1 1 0 -4h4a2 2 0 1 0 0 -4h-3"),
    )

    private val BADGE: Map<String, Pair<String, Long>> = mapOf(
        "PLATFORM_OWNER" to ("crown" to 0xFFF0B232),
        "STAFF" to ("tool" to 0xFF5865F2),
        "ADMIN" to ("shield-check" to 0xFFED4245),
        "MODERATOR" to ("gavel" to 0xFF3BA55C),
        "HELPER" to ("heart-handshake" to 0xFF1ABC9C),
        "BUG_HUNTER_GOLD" to ("bug" to 0xFFF0B232),
        "BUG_HUNTER" to ("bug" to 0xFF57C26A),
        "SUPPORTER" to ("heart" to 0xFFEB459E),
        "SUPPORTER_SUBSCRIBER" to ("diamond" to 0xFFB06BFF),
        "SUPPORTER_SUPER" to ("sparkles" to 0xFFF47FFF),
        "BETA_TESTER" to ("flask" to 0xFF3B9DFF),
        "NEWCOMER" to ("seedling" to 0xFF43B581),
    )
    private val ACH_BY_KEY: Map<String, String> = mapOf(
        "primeiro_post" to "file-text",
        "redator" to "writing",
        "influenciador" to "speakerphone",
        "comentarista" to "message-circle",
        "voz_da_comunidade" to "messages",
        "carismatico" to "mood-heart",
        "amado_por_todos" to "hearts",
        "primeiro_amigo" to "user-plus",
        "circulo_social" to "users",
        "rede_gigante" to "users-group",
        "veterano" to "military-rank",
        "lenda_viva" to "trophy",
        "presenca_constante" to "calendar-check",
        "inabalavel_streak" to "flame",
        "bem_recomendado" to "thumb-up",
        "referencia" to "star",
        "popular_no_mural" to "notes",
        "muito_querido" to "user-heart",
        "primeiro_fa" to "user-star",
        "celebridade" to "confetti",
        "fotografo" to "camera",
        "album_cheio" to "album",
        "criador_de_emoji" to "mood-plus",
        "artista_da_comunidade" to "palette",
        "tagarela" to "message-dots",
        "comunicador_nato" to "microphone-2",
        "voz_incansavel" to "bolt",
        "sempre_reagindo" to "mood-happy",
        "expressivo" to "mood-wink",
        "cartas_primeira_vitoria" to "sword",
        "cartas_duelista" to "swords",
        "cartas_mestre" to "cards",
        "cartas_pvp" to "target",
        "cartas_colecionador" to "stack-2",
        "cartas_completo" to "album",
        "cartas_pacotes" to "package",
        "cartas_brilho" to "diamonds",
        "cartas_lenda" to "shield-star",
        "cartas_intocavel" to "ghost",
        "cartas_por_um_fio" to "heart-broken",
        "cartas_dupla" to "users",
        "cartas_draft" to "crown",
        "cartas_cacador" to "skull",
        "cartas_ouro" to "coins",
    )
    private val ACH_BY_PROGRESS: Map<String, String> = mapOf(
        "POSTS_CREATED" to "file-text",
        "POST_UPS_RECEIVED" to "speakerphone",
        "COMMENTS_CREATED" to "message-circle",
        "COMMENT_UPS_RECEIVED" to "messages",
        "PROFILE_UPS_RECEIVED" to "mood-heart",
        "FRIENDS_COUNT" to "users",
        "ACCOUNT_LEVEL" to "military-rank",
        "DAILY_STREAK" to "flame",
        "TESTIMONIALS_RECEIVED" to "thumb-up",
        "SCRAPS_RECEIVED" to "notes",
        "FANS_COUNT" to "user-star",
        "PHOTOS_UPLOADED" to "camera",
        "EMOJIS_CREATED" to "mood-plus",
        "MESSAGES_SENT" to "message-dots",
        "REACTIONS_GIVEN" to "mood-happy",
    )

    fun rarityColor(rarity: String?): Color = Color(when (rarity) { "RARE" -> 0xFF3B9DFF; "EPIC" -> 0xFFB06BFF; "LEGENDARY" -> 0xFFF0B232; else -> 0xFF9AA1A8 })

    /** Imagem própria (enviada pela equipe) vence; as PNG padrão de /badges/ não contam. */
    fun isCustomBadgeImage(url: String?): Boolean = !url.isNullOrBlank() && !Regex("(^|/)badges/[A-Z0-9_]+\\.png$", RegexOption.IGNORE_CASE).containsMatchIn(url)

    /** Ícone + cor da insígnia, ou null se for pra mostrar a imagem própria. */
    fun badge(key: String?, iconUrl: String?, rarity: String?): Pair<String, Color>? {
        BADGE[key]?.let { (n, c) -> return n to Color(c) }
        if (isCustomBadgeImage(iconUrl)) return null
        return "award" to rarityColor(rarity)
    }

    /** Ícone + cor da conquista, ou null se ela tiver imagem própria. */
    fun achievement(key: String?, progressType: String?, rarity: String?, iconUrl: String?): Pair<String, Color>? {
        if (!iconUrl.isNullOrBlank()) return null
        val n = ACH_BY_KEY[key] ?: ACH_BY_PROGRESS[progressType] ?: "trophy"
        return n to rarityColor(rarity)
    }

    private val cache = HashMap<String, ImageVector>()
    fun vector(name: String): ImageVector = cache.getOrPut(name) {
        val b = ImageVector.Builder(name = name, defaultWidth = 24.dp, defaultHeight = 24.dp, viewportWidth = 24f, viewportHeight = 24f)
        for (d in PATHS[name] ?: PATHS.getValue("trophy")) {
            b.addPath(
                pathData = addPathNodes(d), fill = null, stroke = SolidColor(Color.White), strokeLineWidth = 2f,
                strokeLineCap = StrokeCap.Round, strokeLineJoin = StrokeJoin.Round,
            )
        }
        b.build()
    }
}

/** Ícone de traço numa plaquinha com fundo na cor (igual ao site). */
@Composable
fun StrokeIconTile(name: String, color: Color, size: Dp, modifier: Modifier = Modifier, tile: Boolean = true) {
    val v = remember(name) { StrokeIcons.vector(name) }
    if (!tile) { Icon(v, null, tint = color, modifier = modifier.size(size)); return }
    val shape = RoundedCornerShape(size * 0.3f)
    Box(
        modifier.size(size).clip(shape).background(color.copy(alpha = 0.15f)).border(1.dp, color.copy(alpha = 0.25f), shape),
        contentAlignment = Alignment.Center,
    ) { Icon(v, null, tint = color, modifier = Modifier.size(size * 0.62f)) }
}
