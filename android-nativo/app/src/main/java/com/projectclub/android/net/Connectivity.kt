package com.projectclub.android.net

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/**
 * Tem internet agora? Acompanha a rede padrão do aparelho pelo
 * ConnectivityManager.NetworkCallback (Wi-Fi ↔ dados móveis, modo avião...).
 */
class Connectivity(context: Context) {
    private val cm: ConnectivityManager? = runCatching {
        context.applicationContext.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
    }.getOrNull()

    private val _online = MutableStateFlow(initial())
    val online: StateFlow<Boolean> = _online

    @Volatile private var current: Network? = null

    init {
        runCatching {
            cm?.registerDefaultNetworkCallback(object : ConnectivityManager.NetworkCallback() {
                override fun onAvailable(network: Network) {
                    current = network
                    // A capacidade "validada" chega logo depois em onCapabilitiesChanged.
                    val caps = runCatching { cm?.getNetworkCapabilities(network) }.getOrNull()
                    _online.value = caps == null || hasInternet(caps)
                }

                override fun onCapabilitiesChanged(network: Network, caps: NetworkCapabilities) {
                    current = network
                    _online.value = hasInternet(caps)
                }

                override fun onLost(network: Network) {
                    // Trocou de rede (ex.: Wi-Fi → dados): o aviso da rede antiga chega
                    // depois da nova — só fica offline se a perdida era a atual.
                    if (current == null || current == network) { current = null; _online.value = false }
                }

                override fun onUnavailable() { current = null; _online.value = false }
            })
        }
    }

    private fun initial(): Boolean {
        val m = cm ?: return true
        return runCatching {
            val n = m.activeNetwork ?: return@runCatching false
            val caps = m.getNetworkCapabilities(n) ?: return@runCatching false
            hasInternet(caps)
        }.getOrDefault(true)
    }

    private fun hasInternet(caps: NetworkCapabilities): Boolean =
        caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) &&
            caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
}
