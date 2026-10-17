package com.projectclub.android.voice

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log

/**
 * Áudio da chamada pelo servidor PRÓPRIO (o SDK da Agora já cuida disso
 * sozinho): modo de comunicação, foco de áudio e pra onde vai o som —
 * viva-voz, fone do ouvido, fone com fio ou Bluetooth.
 *
 * Antes o modo de comunicação só era ligado na PRIMEIRA chamada (junto com a
 * fábrica do WebRTC) e o viva-voz usava só o isSpeakerphoneOn (que no
 * Android 12+ não manda mais na rota de chamada) — em vários aparelhos o som
 * dos outros saía baixinho ou não saía.
 *
 * Tudo aqui roda na thread principal.
 */
class CallAudio(context: Context, private val onRouteChanged: (speaker: Boolean) -> Unit) {
    private val am = context.applicationContext.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    private val main = Handler(Looper.getMainLooper())
    private var active = false
    private var wantSpeaker = true
    private var savedMode = AudioManager.MODE_NORMAL
    private var focus: AudioFocusRequest? = null
    private var scoOn = false

    private val focusListener = AudioManager.OnAudioFocusChangeListener { change ->
        // Voltou o foco (ex.: depois de uma ligação do telefone): reaplica a rota.
        if (change == AudioManager.AUDIOFOCUS_GAIN && active) applyRoute()
    }

    private val devices = object : AudioDeviceCallback() {
        override fun onAudioDevicesAdded(added: Array<out AudioDeviceInfo>?) {
            if (!active || added.orEmpty().none { isHeadset(it.type) }) return
            // Conectou fone/Bluetooth: o som vai pra ele.
            if (wantSpeaker) { wantSpeaker = false; onRouteChanged(false) }
            applyRoute()
        }

        override fun onAudioDevicesRemoved(removed: Array<out AudioDeviceInfo>?) {
            if (!active || removed.orEmpty().none { isHeadset(it.type) }) return
            // Tirou o fone: volta pro viva-voz (senão o som iria pro ouvido sem ninguém perceber).
            if (!hasHeadset()) { wantSpeaker = true; onRouteChanged(true) }
            applyRoute()
        }
    }

    /** Começa a chamada: foco de áudio + modo de comunicação + rota. */
    fun start(speaker: Boolean) {
        if (active) { setSpeaker(speaker); return }
        active = true
        savedMode = runCatching { am.mode }.getOrDefault(AudioManager.MODE_NORMAL)
        requestFocus()
        runCatching { am.mode = AudioManager.MODE_IN_COMMUNICATION }
        wantSpeaker = if (hasHeadset()) false else speaker
        if (wantSpeaker != speaker) onRouteChanged(wantSpeaker)
        applyRoute()
        runCatching { am.registerAudioDeviceCallback(devices, main) }
    }

    /** Viva-voz (true) ou fone do ouvido/fone conectado (false). */
    fun setSpeaker(on: Boolean) {
        wantSpeaker = on
        if (active) applyRoute()
    }

    /** Fim da chamada: devolve o áudio do aparelho como estava. */
    fun stop() {
        if (!active) return
        active = false
        runCatching { am.unregisterAudioDeviceCallback(devices) }
        if (Build.VERSION.SDK_INT >= 31) runCatching { am.clearCommunicationDevice() }
        else {
            @Suppress("DEPRECATION") runCatching {
                if (scoOn) { am.isBluetoothScoOn = false; am.stopBluetoothSco() }
                am.isSpeakerphoneOn = false
            }
        }
        scoOn = false
        runCatching { am.mode = if (savedMode == AudioManager.MODE_IN_COMMUNICATION) AudioManager.MODE_NORMAL else savedMode }
        focus?.let { f -> runCatching { am.abandonAudioFocusRequest(f) } }
        focus = null
    }

    private fun requestFocus() {
        val req = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build(),
            )
            .setAcceptsDelayedFocusGain(false)
            .setOnAudioFocusChangeListener(focusListener, main)
            .build()
        focus = req
        val r = runCatching { am.requestAudioFocus(req) }.getOrDefault(AudioManager.AUDIOFOCUS_REQUEST_FAILED)
        if (r != AudioManager.AUDIOFOCUS_REQUEST_GRANTED) Log.w(TAG, "foco de áudio negado ($r)")
    }

    private fun applyRoute() {
        if (Build.VERSION.SDK_INT >= 31) {
            runCatching {
                val list = am.availableCommunicationDevices
                val target = if (wantSpeaker) list.firstOrNull { it.type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER }
                else list.firstOrNull { it.type in BLUETOOTH } ?: list.firstOrNull { it.type in WIRED }
                    ?: list.firstOrNull { it.type == AudioDeviceInfo.TYPE_BUILTIN_EARPIECE }
                if (target == null) am.clearCommunicationDevice()
                else if (am.communicationDevice?.id != target.id && !am.setCommunicationDevice(target)) {
                    // Recomendação do Android: limpa e tenta de novo.
                    am.clearCommunicationDevice()
                    am.setCommunicationDevice(target)
                }
            }.onFailure { Log.w(TAG, "rota de áudio", it) }
        } else {
            @Suppress("DEPRECATION") runCatching {
                val bt = !wantSpeaker && hasBluetooth()
                if (bt && !scoOn) { am.startBluetoothSco(); am.isBluetoothScoOn = true; scoOn = true }
                if (!bt && scoOn) { am.isBluetoothScoOn = false; am.stopBluetoothSco(); scoOn = false }
                am.isSpeakerphoneOn = wantSpeaker
            }.onFailure { Log.w(TAG, "rota de áudio", it) }
        }
    }

    private fun outputs(): Array<AudioDeviceInfo> =
        runCatching { am.getDevices(AudioManager.GET_DEVICES_OUTPUTS) }.getOrDefault(emptyArray())

    private fun hasHeadset() = outputs().any { isHeadset(it.type) }
    private fun hasBluetooth() = outputs().any { it.type in BLUETOOTH }

    private companion object {
        const val TAG = "PCAudio"
        val BLUETOOTH: Set<Int> = buildSet {
            add(AudioDeviceInfo.TYPE_BLUETOOTH_SCO)
            if (Build.VERSION.SDK_INT >= 31) { add(AudioDeviceInfo.TYPE_BLE_HEADSET) }
            if (Build.VERSION.SDK_INT >= 28) add(AudioDeviceInfo.TYPE_HEARING_AID)
        }
        val WIRED: Set<Int> = setOf(
            AudioDeviceInfo.TYPE_WIRED_HEADSET,
            AudioDeviceInfo.TYPE_WIRED_HEADPHONES,
            AudioDeviceInfo.TYPE_USB_HEADSET,
        )
        fun isHeadset(type: Int) = type in BLUETOOTH || type in WIRED
    }
}
