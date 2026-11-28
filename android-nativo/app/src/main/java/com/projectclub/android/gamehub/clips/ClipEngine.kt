package com.projectclub.android.gamehub.clips

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioPlaybackCaptureConfiguration
import android.media.AudioRecord
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.media.MediaMuxer
import android.media.projection.MediaProjection
import android.os.Build
import android.util.Log
import android.view.Surface
import androidx.core.content.ContextCompat
import com.projectclub.android.gamehub.HubLogic
import java.nio.ByteBuffer
import java.time.Instant
import kotlin.math.max
import kotlin.math.roundToInt

/** Um pedaço já codificado (H.264 ou AAC). */
internal class Sample(val track: Int, val data: ByteArray, val ptsUs: Long, val key: Boolean)

internal const val VIDEO = 0
internal const val AUDIO = 1

/**
 * Grava a tela (e o som do jogo, Android 10+) em H.264 + AAC.
 *  - modo buffer: guarda só os últimos segundos na memória e grava um MP4
 *    quando pedirem ([saveReplay]);
 *  - modo gravar: escreve direto no MP4 até [finish].
 * Tudo roda em threads próprias; os avisos saem por [ClipRecorder].
 */
internal class ClipEngine(
    private val ctx: Context,
    private val projection: MediaProjection,
    private val settings: ClipSettings,
    private val width: Int,
    private val height: Int,
    private val dpi: Int,
    private val onFatal: (String) -> Unit,
) {
    private val tag = "PCClipes"
    private var video: MediaCodec? = null
    private var inputSurface: Surface? = null
    private var display: VirtualDisplay? = null
    private var audio: MediaCodec? = null
    private var record: AudioRecord? = null
    private var videoThread: Thread? = null
    private var audioThread: Thread? = null
    @Volatile private var running = false

    @Volatile var videoFormat: MediaFormat? = null
        private set
    @Volatile var audioFormat: MediaFormat? = null
        private set
    var withAudio = false
        private set

    private val windowUs = settings.seconds * 1_000_000L
    private val ring = ArrayDeque<Sample>()
    private var file: FileSink? = null

    // ---------- início ----------

    fun start() {
        val bitrate = if (settings.quality >= 1080) 10_000_000 else 6_000_000
        val fmt = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, width, height).apply {
            setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface)
            setInteger(MediaFormat.KEY_BIT_RATE, bitrate)
            setInteger(MediaFormat.KEY_FRAME_RATE, 30)
            setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 1)
            // Tela parada também gera quadros (senão o replay fica sem quadro-chave).
            setLong(MediaFormat.KEY_REPEAT_PREVIOUS_FRAME_AFTER, 100_000L)
        }
        val v = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_VIDEO_AVC)
        v.configure(fmt, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
        inputSurface = v.createInputSurface()
        v.start()
        video = v

        withAudio = settings.audio && Build.VERSION.SDK_INT >= 29 &&
            ContextCompat.checkSelfPermission(ctx, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED &&
            runCatching { startAudio() }.onFailure { Log.w(tag, "sem som do jogo", it) }.isSuccess

        if (settings.mode == ClipSettings.MODE_RECORD) {
            val target = ClipStore.create(ctx, HubLogic.clipFileName(Instant.now()))
            file = FileSink(target, withAudio)
        }

        running = true
        display = projection.createVirtualDisplay(
            "ProjectClub-Clipes", width, height, dpi, DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR, inputSurface, null, null,
        )
        videoThread = Thread({ drain(v, VIDEO) }, "clip-video").apply { start() }
    }

    @SuppressLint("MissingPermission", "NewApi")
    private fun startAudio() {
        if (Build.VERSION.SDK_INT < 29) error("sem captura de som")
        val rate = 44_100
        val cfg = AudioPlaybackCaptureConfiguration.Builder(projection)
            .addMatchingUsage(AudioAttributes.USAGE_GAME)
            .addMatchingUsage(AudioAttributes.USAGE_MEDIA)
            .addMatchingUsage(AudioAttributes.USAGE_UNKNOWN)
            .build()
        val minBuf = AudioRecord.getMinBufferSize(rate, AudioFormat.CHANNEL_IN_STEREO, AudioFormat.ENCODING_PCM_16BIT)
        val rec = AudioRecord.Builder()
            .setAudioFormat(AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_16BIT).setSampleRate(rate).setChannelMask(AudioFormat.CHANNEL_IN_STEREO).build())
            .setBufferSizeInBytes(max(minBuf * 4, 16_384))
            .setAudioPlaybackCaptureConfig(cfg)
            .build()
        if (rec.state != AudioRecord.STATE_INITIALIZED) { rec.release(); error("AudioRecord não iniciou") }
        val aFmt = MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_AAC, rate, 2).apply {
            setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC)
            setInteger(MediaFormat.KEY_BIT_RATE, 128_000)
            setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 16_384)
        }
        val a = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_AUDIO_AAC)
        a.configure(aFmt, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
        a.start()
        rec.startRecording()
        audio = a
        record = rec
        audioThread = Thread({ audioLoop(rec, a, rate) }, "clip-audio").apply { start() }
    }

    // ---------- laços ----------

    private fun audioLoop(rec: AudioRecord, enc: MediaCodec, rate: Int) {
        val chunk = ByteArray(4096) // 1024 amostras estéreo de 16 bits (um quadro AAC)
        var startUs = -1L
        var frames = 0L
        val info = MediaCodec.BufferInfo()
        try {
            while (running) {
                val n = rec.read(chunk, 0, chunk.size)
                if (n <= 0) { if (n < 0) Thread.sleep(5); continue }
                if (startUs < 0) startUs = System.nanoTime() / 1000
                val pts = startUs + frames * 1_000_000L / rate
                frames += n / 4
                val idx = enc.dequeueInputBuffer(10_000)
                if (idx >= 0) {
                    val buf: ByteBuffer = enc.getInputBuffer(idx) ?: continue
                    buf.clear()
                    val len = minOf(n, buf.remaining())
                    buf.put(chunk, 0, len)
                    enc.queueInputBuffer(idx, 0, len, pts, 0)
                }
                drainOnce(enc, AUDIO, info, 0)
            }
        } catch (e: Exception) {
            if (running) Log.w(tag, "som parou", e)
        }
    }

    private fun drain(enc: MediaCodec, track: Int) {
        val info = MediaCodec.BufferInfo()
        try {
            while (running) drainOnce(enc, track, info, 10_000)
        } catch (e: Exception) {
            if (running) { Log.w(tag, "vídeo parou", e); onFatal("A gravação parou sozinha.") }
        }
    }

    /** Tira o que o codificador já tem pronto (até acabar ou [timeoutUs]). */
    private fun drainOnce(enc: MediaCodec, track: Int, info: MediaCodec.BufferInfo, timeoutUs: Long) {
        while (true) {
            val idx = enc.dequeueOutputBuffer(info, timeoutUs)
            when {
                idx == MediaCodec.INFO_TRY_AGAIN_LATER -> return
                idx == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                    val f = enc.outputFormat
                    if (track == VIDEO) videoFormat = f
                    else audioFormat = f
                    file?.format(track, f)
                }
                idx >= 0 -> {
                    val config = info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0
                    if (!config && info.size > 0) {
                        val buf = enc.getOutputBuffer(idx)
                        if (buf != null) {
                            buf.position(info.offset); buf.limit(info.offset + info.size)
                            val bytes = ByteArray(info.size).also { buf.get(it) }
                            val s = Sample(track, bytes, info.presentationTimeUs, track == AUDIO || info.flags and MediaCodec.BUFFER_FLAG_KEY_FRAME != 0)
                            val f = file
                            if (f != null) f.write(s) else keep(s)
                        }
                    }
                    enc.releaseOutputBuffer(idx, false)
                    if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) return
                }
                else -> return
            }
        }
    }

    // ---------- modo buffer ----------

    private fun keep(s: Sample) {
        synchronized(ring) {
            ring.addLast(s)
            // Guarda um pouco mais que a janela (pra sempre ter um quadro-chave antes dela).
            if (s.track == VIDEO) {
                val limit = s.ptsUs - windowUs - 3_000_000L
                while (ring.isNotEmpty() && ring.first().ptsUs < limit) ring.removeFirst()
            }
        }
    }

    /** Copia o buffer e grava o MP4 numa thread (não trava a gravação). */
    fun saveReplay(done: (ClipEvent) -> Unit) {
        val snapshot = synchronized(ring) { ArrayList(ring) }
        val vf = videoFormat
        val af = audioFormat
        Thread({
            done(runCatching { writeReplay(snapshot, vf, af) }.getOrElse {
                Log.w(tag, "replay falhou", it)
                ClipEvent.Failed(it.message ?: "Não deu pra salvar o clipe.")
            })
        }, "clip-save").start()
    }

    private fun writeReplay(all: List<Sample>, vf: MediaFormat?, af: MediaFormat?): ClipEvent {
        if (vf == null) return ClipEvent.Failed("Ainda não tem nada gravado. Espere uns segundos.")
        val vids = all.filter { it.track == VIDEO }
        val start = HubLogic.replayStart(LongArray(vids.size) { vids[it].ptsUs }, BooleanArray(vids.size) { vids[it].key }, windowUs)
        if (start < 0) return ClipEvent.Failed("Ainda não tem nada gravado. Espere uns segundos.")
        val base = vids[start].ptsUs
        val chosen = (vids.subList(start, vids.size) + if (af != null) all.filter { it.track == AUDIO && it.ptsUs >= base } else emptyList())
            .sortedBy { it.ptsUs }
        if (chosen.size < 2) return ClipEvent.Failed("O clipe ficou vazio.")
        val target = ClipStore.create(ctx, HubLogic.clipFileName(Instant.now()))
        try {
            val mux = target.pfd?.let { MediaMuxer(it.fileDescriptor, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4) }
                ?: MediaMuxer(target.file!!.path, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
            try {
                val vt = mux.addTrack(vf)
                val at = if (af != null) mux.addTrack(af) else -1
                mux.start()
                val info = MediaCodec.BufferInfo()
                for (s in chosen) {
                    val t = if (s.track == VIDEO) vt else at
                    if (t < 0) continue
                    info.set(0, s.data.size, s.ptsUs - base, if (s.key && s.track == VIDEO) MediaCodec.BUFFER_FLAG_KEY_FRAME else 0)
                    mux.writeSampleData(t, ByteBuffer.wrap(s.data), info)
                }
                mux.stop()
            } finally { runCatching { mux.release() } }
            target.commit(ctx)
            return ClipEvent.Saved(target.uri, target.name)
        } catch (e: Exception) {
            target.abort(ctx)
            throw e
        }
    }

    // ---------- fim ----------

    /** Para tudo. No modo gravar, fecha o MP4 e devolve o resultado. */
    fun finish(): ClipEvent? {
        running = false
        runCatching { display?.release() }
        runCatching { video?.signalEndOfInputStream() }
        runCatching { videoThread?.join(1500) }
        runCatching { audioThread?.join(1500) }
        runCatching { record?.stop() }
        runCatching { record?.release() }
        runCatching { video?.stop() }; runCatching { video?.release() }
        runCatching { audio?.stop() }; runCatching { audio?.release() }
        runCatching { inputSurface?.release() }
        val result = file?.close(ctx)
        file = null
        synchronized(ring) { ring.clear() }
        return result
    }

    companion object {
        /** Tamanho do vídeo: lado menor = [quality] (ou o da tela, se for menor), múltiplo de 16. */
        fun sizeFor(screenW: Int, screenH: Int, quality: Int): Pair<Int, Int> {
            val short = minOf(screenW, screenH).coerceAtLeast(16)
            val scale = minOf(1.0, quality.toDouble() / short)
            fun r16(x: Double) = max(16, ((x / 16).roundToInt()) * 16)
            return r16(screenW * scale) to r16(screenH * scale)
        }
    }
}

/** Modo gravar: escreve direto no MP4 (espera os formatos de vídeo e som). */
internal class FileSink(private val target: ClipStore.Target, private var expectAudio: Boolean) {
    private val mux: MediaMuxer = target.pfd?.let { MediaMuxer(it.fileDescriptor, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4) }
        ?: MediaMuxer(target.file!!.path, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
    private var vt = -1
    private var at = -1
    private var started = false
    private var base = -1L
    private var written = 0
    private var videoFmt: MediaFormat? = null
    private var audioFmt: MediaFormat? = null
    private val pending = ArrayList<Sample>()
    private val info = MediaCodec.BufferInfo()

    @Synchronized fun format(track: Int, f: MediaFormat) {
        if (started) return
        if (track == VIDEO) videoFmt = f else audioFmt = f
        tryStart()
    }

    private fun tryStart(force: Boolean = false) {
        val vf = videoFmt ?: return
        val af = audioFmt
        if (expectAudio && af == null && !force) return
        vt = mux.addTrack(vf)
        if (af != null) at = mux.addTrack(af) else expectAudio = false
        mux.start()
        started = true
        pending.sortBy { it.ptsUs }
        pending.forEach { put(it) }
        pending.clear()
    }

    @Synchronized fun write(s: Sample) {
        if (!started) {
            pending += s
            // Som não chegou em 2 s: segue só com vídeo.
            val vids = pending.filter { it.track == VIDEO }
            if (vids.size > 1 && vids.last().ptsUs - vids.first().ptsUs > 2_000_000L) tryStart(force = true)
            if (pending.size > 600) pending.removeAt(0)
            return
        }
        put(s)
    }

    private fun put(s: Sample) {
        if (base < 0) {
            if (s.track != VIDEO || !s.key) return // começa num quadro-chave
            base = s.ptsUs
        }
        if (s.ptsUs < base) return
        val t = if (s.track == VIDEO) vt else at
        if (t < 0) return
        info.set(0, s.data.size, s.ptsUs - base, if (s.key && s.track == VIDEO) MediaCodec.BUFFER_FLAG_KEY_FRAME else 0)
        runCatching { mux.writeSampleData(t, ByteBuffer.wrap(s.data), info); written++ }
    }

    @Synchronized fun close(ctx: Context): ClipEvent {
        val ok = started && written > 10
        runCatching { if (started) mux.stop() }
        runCatching { mux.release() }
        return if (ok) { target.commit(ctx); ClipEvent.Saved(target.uri, target.name) }
        else { target.abort(ctx); ClipEvent.Failed("A gravação foi curta demais.") }
    }
}
