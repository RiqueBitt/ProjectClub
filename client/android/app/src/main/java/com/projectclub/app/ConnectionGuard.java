package com.projectclub.app;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.webkit.WebView;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;

/**
 * Guarda de conexão do app Android.
 *
 * Antes, o Capacitor trocava a tela inteira pela página "Sem conexão com o
 * Project Club" (server.errorPath) a QUALQUER falha da página principal —
 * sem conferir se a internet ou o servidor estavam mesmo fora. Um falso
 * alarme deixava o app preso nessa tela com o servidor funcionando.
 *
 * Agora, quando a página principal falha, o guarda confere de verdade:
 *  - o aparelho tem rede? e o servidor responde em /api/health?
 *  - Respondeu: era falso alarme → recarrega em silêncio (até 2 vezes por
 *    minuto, pra nunca entrar em loop) e relata o motivo exato ao servidor
 *    (/api/system/client-error), pra a staff ver o que aconteceu.
 *  - Não respondeu: abre a tela de conexão, que é um app à parte
 *    (ConexaoActivity, em processo próprio, sem nada do site).
 */
public class ConnectionGuard {
    static final String TAG = "PCConexao";
    static final String EXTRA_APP_URL = "appUrl";
    static final String EXTRA_KIND = "motivo";
    static final String EXTRA_DETAIL = "detalhe";

    /** A tela de conexão foi aberta: ao voltar pro app, recarrega o Project Club. */
    static volatile boolean reloadWhenBack = false;

    private static final int SILENT_RELOADS_PER_MINUTE = 2;

    private final MainActivity activity;
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ArrayDeque<Long> silentReloads = new ArrayDeque<>();
    private boolean checking = false;

    ConnectionGuard(MainActivity activity) {
        this.activity = activity;
    }

    /** Endereço do Project Club (server.url do capacitor.config.json), sem "/" no fim. */
    String appUrl() {
        String url = activity.getBridge().getServerUrl();
        if (url == null || url.isEmpty()) url = activity.getBridge().getAppUrl();
        while (url.endsWith("/")) url = url.substring(0, url.length() - 1);
        return url;
    }

    /** A página principal falhou (rede ou erro 5xx do servidor). */
    void mainFrameFailed(final String reason, final String failedUrl) {
        Log.w(TAG, "página principal falhou: " + reason + " em " + failedUrl);
        if (checking) return;
        checking = true;
        final String base = appUrl();
        io.execute(() -> {
            final boolean network = hasNetwork(activity);
            final boolean server = network && serverResponds(base);
            main.post(() -> {
                checking = false;
                if (activity.isFinishing() || activity.isDestroyed()) return;
                if (server && allowSilentReload()) {
                    report(base, reason, failedUrl, "falso alarme: servidor respondeu, recarregando");
                    WebView webView = activity.getBridge().getWebView();
                    if (webView != null) webView.loadUrl(sameSiteOr(base, failedUrl));
                    return;
                }
                if (server) report(base, reason, failedUrl, "falhas repetidas com o servidor respondendo");
                openConnectionScreen(base, network ? "server" : "offline", reason);
            });
        });
    }

    private boolean allowSilentReload() {
        long now = System.currentTimeMillis();
        while (!silentReloads.isEmpty() && now - silentReloads.peekFirst() > 60_000L) silentReloads.pollFirst();
        if (silentReloads.size() >= SILENT_RELOADS_PER_MINUTE) return false;
        silentReloads.addLast(now);
        return true;
    }

    private void openConnectionScreen(String base, String kind, String detail) {
        reloadWhenBack = true;
        Intent intent = new Intent(activity, ConexaoActivity.class);
        intent.putExtra(EXTRA_APP_URL, base);
        intent.putExtra(EXTRA_KIND, kind);
        intent.putExtra(EXTRA_DETAIL, detail);
        activity.startActivity(intent);
    }

    /** Só recarrega endereços do próprio Project Club; o resto volta pro início. */
    static String sameSiteOr(String base, String url) {
        try {
            Uri a = Uri.parse(base);
            Uri b = Uri.parse(url);
            if (b.getHost() != null && b.getHost().equalsIgnoreCase(a.getHost()) && "https".equalsIgnoreCase(b.getScheme())) return url;
        } catch (Exception ignored) {
            // endereço inválido: cai no início
        }
        return base + "/";
    }

    // ---------- verificações (usadas aqui e na tela de conexão) ----------

    static boolean hasNetwork(Context context) {
        try {
            ConnectivityManager cm = (ConnectivityManager) context.getSystemService(Context.CONNECTIVITY_SERVICE);
            if (cm == null) return true; // sem como saber: deixa o teste do servidor decidir
            Network network = cm.getActiveNetwork();
            if (network == null) return false;
            NetworkCapabilities caps = cm.getNetworkCapabilities(network);
            return caps != null && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
        } catch (Exception e) {
            return true;
        }
    }

    /** O servidor respondeu alguma coisa (qualquer status < 500) em até 6 s? */
    static boolean serverResponds(String base) {
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(base + "/api/health").openConnection();
            conn.setConnectTimeout(6000);
            conn.setReadTimeout(6000);
            conn.setUseCaches(false);
            conn.setRequestProperty("Cache-Control", "no-cache");
            int status = conn.getResponseCode();
            try (InputStream in = status < 400 ? conn.getInputStream() : conn.getErrorStream()) {
                if (in != null) while (in.read() != -1) { /* esvazia pra reaproveitar a conexão */ }
            }
            return status > 0 && status < 500;
        } catch (Exception e) {
            Log.w(TAG, "servidor não respondeu: " + e);
            return false;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    /** Relata ao servidor o motivo exato da falha (aparece no painel em Saúde/erros). */
    void report(final String base, final String reason, final String url, final String outcome) {
        final String version = versionName(activity);
        io.execute(() -> {
            HttpURLConnection conn = null;
            try {
                JSONObject body = new JSONObject();
                body.put("where", "android-conexao");
                body.put("path", url == null ? "" : url);
                body.put("message", reason + " — " + outcome);
                body.put("version", version);
                byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
                conn = (HttpURLConnection) new URL(base + "/api/system/client-error").openConnection();
                conn.setConnectTimeout(6000);
                conn.setReadTimeout(6000);
                conn.setRequestMethod("POST");
                conn.setDoOutput(true);
                conn.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                try (OutputStream out = conn.getOutputStream()) {
                    out.write(bytes);
                }
                conn.getResponseCode();
            } catch (Exception e) {
                Log.w(TAG, "não deu pra relatar a falha: " + e);
            } finally {
                if (conn != null) conn.disconnect();
            }
        });
    }

    static String versionName(Context context) {
        try {
            PackageInfo info = context.getPackageManager().getPackageInfo(context.getPackageName(), 0);
            return info.versionName == null ? "" : info.versionName;
        } catch (Exception e) {
            return "";
        }
    }

    void shutdown() {
        io.shutdownNow();
    }
}
