package com.projectclub.android

import com.projectclub.android.data.AppJson
import com.projectclub.android.data.DealsResponse
import com.projectclub.android.data.GameParty
import com.projectclub.android.data.LolBuildData
import com.projectclub.android.data.ModdableGame
import com.projectclub.android.data.PartiesResponse
import com.projectclub.android.gamehub.HubLogic
import com.projectclub.android.gamehub.clips.ClipEngine
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant
import java.time.ZoneId

/** Regras do Game Hub no celular (sem Android). */
class GameHubLogicTest {
    private val sp = ZoneId.of("America/Sao_Paulo")
    private val now = Instant.parse("2026-11-26T18:00:00Z") // 15:00 em SP, quinta

    @Test fun precos() {
        assertEquals("R$ 74,97", HubLogic.money(74.97, "BRL"))
        assertEquals("US$ 12,49", HubLogic.money(12.49, "USD"))
        assertEquals("Grátis", HubLogic.money(0.0, "BRL"))
        assertEquals("", HubLogic.money(null, "BRL"))
    }

    @Test fun contagensETamanhos() {
        assertEquals("350", HubLogic.count(350))
        assertEquals("98,8 mil", HubLogic.count(98_765))
        assertEquals("1,2 mi", HubLogic.count(1_200_000))
        assertEquals("830 KB", HubLogic.size(830L * 1024))
        assertEquals("2,5 MB", HubLogic.size((2.5 * 1024 * 1024).toLong()))
        assertEquals("0:07", HubLogic.duration(7_400))
        assertEquals("1:32", HubLogic.duration(92_000))
    }

    @Test fun horarioDaPartida() {
        assertEquals("Agora", HubLogic.whenLabel(null, now, sp))
        assertEquals("Agora", HubLogic.whenLabel("2026-11-26T18:00:30Z", now, sp))
        assertEquals("Hoje às 21:00", HubLogic.whenLabel("2026-11-27T00:00:00Z", now, sp))
        assertEquals("Amanhã às 20:30", HubLogic.whenLabel("2026-11-27T23:30:00Z", now, sp))
        assertTrue(HubLogic.whenLabel("2026-11-30T22:00:00Z", now, sp).endsWith("às 19:00"))
    }

    @Test fun fimDaPromocao() {
        assertEquals("acaba hoje", HubLogic.untilLabel("2026-11-26T23:00:00Z", now, sp))
        assertEquals("acaba em 2 dias", HubLogic.untilLabel("2026-11-28T20:00:00Z", now, sp))
        assertEquals("acaba amanhã", HubLogic.untilLabel("2026-11-27T12:00:00Z", now, sp))
        assertTrue(HubLogic.untilLabel("2026-12-10T16:00:00Z", now, sp).startsWith("até 10"))
        assertEquals("acabou", HubLogic.untilLabel("2026-11-20T00:00:00Z", now, sp))
    }

    @Test fun haQuantoTempo() {
        assertEquals("agora", HubLogic.ago("2026-11-26T17:59:40Z", now))
        assertEquals("há 5 min", HubLogic.ago("2026-11-26T17:55:00Z", now))
        assertEquals("há 3 h", HubLogic.ago("2026-11-26T15:00:00Z", now))
        assertEquals("há 1 dia", HubLogic.ago("2026-11-25T17:00:00Z", now))
        assertEquals("há 2 sem.", HubLogic.ago("2026-11-10T18:00:00Z", now))
    }

    private val curated = listOf(
        ModdableGame("mindustry", "Mindustry", listOf("io.anuke.mindustry"), "ingame", "Mods → Procurar"),
        ModdableGame("minecraft", "Minecraft", listOf("com.mojang.minecraftpe"), "install", "Addons"),
        ModdableGame("gd", "Geometry Dash", listOf("com.robtopx.geometryjump"), "loader", "Geode", loaderName = "Geode", loaderPackages = listOf("com.geode.launcher")),
        ModdableGame("java", "Minecraft Java", listOf("net.kdt.pojavlaunch"), "ingame", "Launcher"),
    )

    @Test fun jogosInstaladosComModsPrimeiro() {
        val apps = listOf(
            HubLogic.InstalledApp("com.supercell.brawlstars", "Brawl Stars", true),
            HubLogic.InstalledApp("io.anuke.mindustry", "Mindustry", true),
            HubLogic.InstalledApp("com.robtopx.geometryjump", "Geometry Dash", true),
            HubLogic.InstalledApp("com.geode.launcher", "Geode", false),
            HubLogic.InstalledApp("com.mojang.minecraftpe", "Minecraft", true),
            HubLogic.InstalledApp("net.kdt.pojavlaunch", "PojavLauncher", false), // não é jogo, mas está na lista
            HubLogic.InstalledApp("com.whatsapp", "WhatsApp", false),
            HubLogic.InstalledApp("com.projectclub.android", "Project Club", false),
            HubLogic.InstalledApp("com.roblox.client", "Roblox", true),
        )
        val out = HubLogic.matchInstalled(apps, curated, ownPackage = "com.projectclub.android")
        assertEquals(
            listOf("com.mojang.minecraftpe", "com.robtopx.geometryjump", "io.anuke.mindustry", "net.kdt.pojavlaunch", "com.supercell.brawlstars", "com.roblox.client"),
            out.map { it.app.packageName },
        )
        assertTrue(out.first { it.app.packageName == "com.robtopx.geometryjump" }.loaderInstalled)
        assertFalse(out.first { it.app.packageName == "com.roblox.client" }.moddable)
        // o carregador não aparece sozinho e apps que não são jogo ficam de fora
        assertFalse(out.any { it.app.packageName == "com.geode.launcher" || it.app.packageName == "com.whatsapp" })
    }

    @Test fun arquivosDoBedrock() {
        assertTrue(HubLogic.isBedrockFile("Actions & Stuff.MCADDON"))
        assertTrue(HubLogic.isBedrockFile("mundo.mcworld"))
        assertFalse(HubLogic.isBedrockFile("pack.zip"))
        assertFalse(HubLogic.isBedrockFile(null))
        assertEquals("Actions _ Stuff.mcaddon", HubLogic.safeFileName("../../Actions & Stuff.mcaddon"))
        assertEquals("addon.mcpack", HubLogic.safeFileName("///"))
        assertEquals("evil.mcpack", HubLogic.safeFileName("..evil.mcpack"))
    }

    @Test fun replayComecaNumQuadroChave() {
        // quadros a cada 0,5 s; quadro-chave a cada 1 s
        val times = LongArray(41) { it * 500_000L } // 0..20 s
        val keys = BooleanArray(41) { it % 2 == 0 }
        val start = HubLogic.replayStart(times, keys, windowUs = 10_000_000L)
        assertEquals(20, start) // 10 s
        assertTrue(keys[start])
        // janela maior que o que tem: começa do primeiro quadro-chave
        assertEquals(0, HubLogic.replayStart(times, keys, 60_000_000L))
        // sem quadro-chave dentro da janela: usa o último antes dela
        val sparse = BooleanArray(41) { it == 4 }
        assertEquals(4, HubLogic.replayStart(times, sparse, 2_000_000L))
        assertEquals(-1, HubLogic.replayStart(LongArray(0), BooleanArray(0), 1L))
    }

    @Test fun tamanhoDoVideo() {
        assertEquals(1600 to 720, ClipEngine.sizeFor(2400, 1080, 720))
        assertEquals(720 to 1600, ClipEngine.sizeFor(1080, 2400, 720))
        assertEquals(2400 to 1088, ClipEngine.sizeFor(2400, 1080, 1080))
        // tela menor que a qualidade: fica no tamanho da tela (múltiplo de 16)
        assertEquals(800 to 480, ClipEngine.sizeFor(800, 480, 720))
    }

    @Test fun nomeDoClipe() {
        assertEquals("Clipe 2026-11-26 15-00-00.mp4", HubLogic.clipFileName(now, sp))
    }

    @Test fun modelosLeemORespostaDoServidor() {
        val deals = AppJson.decodeFromString(
            DealsResponse.serializer(),
            """{"free":[{"store":"epic","id":"epic:a","title":"Jogo","price":{"final":0,"base":59.99,"currency":"BRL","discount":100},"free":true,"endsAt":"2026-12-03T16:00:00.000Z"}],
               "upcoming":[],"deals":[{"store":"steam","id":"steam:1","title":"RDR2","price":{"final":74.97,"base":299.9,"currency":"BRL","discount":75}}],
               "stores":{"steam":true,"gog":false,"epic":true},"updatedAt":"2026-11-26T18:00:00Z"}""",
        )
        assertEquals(74.97, deals.deals[0].price.finalPrice!!, 0.001)
        assertTrue(deals.stores.epic)
        val parties = AppJson.decodeFromString(
            PartiesResponse.serializer(),
            """{"parties":[{"id":"p1","title":"Ranked","note":null,"slots":5,"game":{"key":"valorant","name":"VALORANT","steamAppId":null},
               "startsAt":null,"status":"open","host":{"id":"u1","displayName":"Lia"},"hasCall":true,"members":[{"id":"u1","displayName":"Lia"}],
               "filled":1,"myStatus":"joined"}]}""",
        )
        val p: GameParty = parties.parties.single()
        assertTrue(p.inside && p.hasCall && !p.isFull)
        val lol = AppJson.decodeFromJsonElement(
            LolBuildData.serializer(),
            AppJson.parseToJsonElement("""{"champion":"Jinx","role":"adc","primaryTree":8000,"keystone":8008,"spells":["SummonerFlash"],"core":["3031"],"skills":"QWEQ"}"""),
        )
        assertEquals("Jinx", lol.champion)
        assertEquals(8008, lol.keystone)
    }
}
