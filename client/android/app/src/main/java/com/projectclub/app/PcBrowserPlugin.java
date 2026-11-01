package com.projectclub.app;

import android.annotation.SuppressLint;
import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.net.Uri;
import android.os.Environment;
import android.os.Message;
import android.util.Base64;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.PermissionRequest;
import android.webkit.SslErrorHandler;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.net.http.SslError;
import android.widget.FrameLayout;
import androidx.activity.result.ActivityResultLauncher;
import androidx.core.content.ContextCompat;
import android.content.pm.PackageManager;
import android.Manifest;
import androidx.activity.result.contract.ActivityResultContracts;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.BufferedReader;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

// Navegador do Project Club no Android: abas de verdade (WebView nativo)
// DENTRO do layout do app — a página do Project Club diz onde fica a área
// de navegação (setRect) e o plugin encaixa a aba ativa ali. Mesma
// proteção do app de computador, no que o Android permite:
//   - bloqueio de anúncios/rastreadores (domínios das listas EasyList,
//     EasyPrivacy e Peter Lowe, as mesmas do LibreWolf/uBlock) e aviso de
//     sites de phishing/malware (listas URLhaus e phishing-filter);
//   - só HTTPS (menos endereços locais), links sem utm/fbclid/gclid,
//     cookies de terceiros bloqueados, sem conteúdo misto;
//   - downloads pela pasta Downloads (DownloadManager), envio de arquivos,
//     câmera/microfone com permissão perguntada no app, vídeo em tela cheia;
//   - o botão voltar do celular volta na aba quando o navegador está aberto.
// Senhas: o preenchimento automático do próprio Android funciona aqui.
@CapacitorPlugin(name = "PcBrowser")
public class PcBrowserPlugin extends Plugin {

  private FrameLayout container;
  private final Map<String, WebView> tabs = new HashMap<>();
  private final Map<String, String> tabHost = new ConcurrentHashMap<>();
  private final Map<String, Integer> blockedCount = new ConcurrentHashMap<>();
  private String activeId = null;
  private boolean visible = false;
  private int rectX = 0, rectY = 0, rectW = 0, rectH = 0;

  private volatile Set<String> blockSet = new HashSet<>();
  private volatile Set<String> dangerSet = new HashSet<>();
  private final Set<String> siteAllow = ConcurrentHashMap.newKeySet();
  private final Set<String> dangerOk = ConcurrentHashMap.newKeySet();
  private final Set<String> httpOk = ConcurrentHashMap.newKeySet();
  private volatile boolean adblock = true, httpsOnly = true, stripTracking = true, block3pCookies = true;
  private volatile String engineState = "loading";
  private volatile long blockedTotal = 0;

  private ActivityResultLauncher<Intent> fileLauncher;
  private ValueCallback<Uri[]> fileCallback;
  private View customView;
  private WebChromeClient.CustomViewCallback customViewCallback;
  private final Map<String, PermissionRequest> pendingMedia = new HashMap<>();
  private int permSeq = 0;
  private ActivityResultLauncher<String[]> permLauncher;
  private Runnable afterPerm;

  private static final String[] AD_LISTS = {
    "https://cdn.jsdelivr.net/gh/uBlockOrigin/uAssetsCDN@main/thirdparties/easylist.txt",
    "https://cdn.jsdelivr.net/gh/uBlockOrigin/uAssetsCDN@main/thirdparties/easyprivacy.txt",
    "https://pgl.yoyo.org/adservers/serverlist.php?hostformat=hosts&showintro=0&mimetype=plaintext",
  };
  private static final String[] AD_MIRRORS = {
    "https://raw.githubusercontent.com/uBlockOrigin/uAssetsCDN/main/thirdparties/easylist.txt",
    "https://raw.githubusercontent.com/uBlockOrigin/uAssetsCDN/main/thirdparties/easyprivacy.txt",
    null,
  };
  private static final String[] DANGER_LISTS = {
    "https://curbengh.github.io/malware-filter/urlhaus-filter-ag-online.txt",
    "https://curbengh.github.io/phishing-filter/phishing-filter.txt",
  };
  private static final long LIST_MAX_AGE = 4L * 24 * 3600 * 1000;
  private static final Pattern ABP_DOMAIN = Pattern.compile("^\\|\\|([a-z0-9.-]+\\.[a-z0-9-]+)\\^(\\$third-party|\\$3p|\\$all|\\$doc|\\$document)?$");
  private static final Pattern HOSTS_LINE = Pattern.compile("^(?:0\\.0\\.0\\.0|127\\.0\\.0\\.1)\\s+([a-z0-9.-]+\\.[a-z0-9-]+)");
  private static final Pattern LOCAL_HOST = Pattern.compile("^(localhost|127\\.\\d+\\.\\d+\\.\\d+|10\\.\\d+\\.\\d+\\.\\d+|192\\.168\\.\\d+\\.\\d+|172\\.(1[6-9]|2\\d|3[01])\\.\\d+\\.\\d+|[^.]+\\.local)$");
  private static final Pattern TRACK_PARAM = Pattern.compile("^(utm_[a-z_]+|fbclid|gclid|gclsrc|dclid|gbraid|wbraid|msclkid|mc_eid|mc_cid|igshid|yclid|twclid|ttclid|li_fat_id|_hsenc|_hsmi|mkt_tok|srsltid|pk_campaign|pk_kwd|pk_source|pk_medium|mtm_source|mtm_medium|mtm_campaign)$", Pattern.CASE_INSENSITIVE);

  @Override
  public void load() {
    fileLauncher = getActivity().registerForActivityResult(new ActivityResultContracts.StartActivityForResult(), result -> {
      if (fileCallback == null) return;
      Uri[] uris = WebChromeClient.FileChooserParams.parseResult(result.getResultCode(), result.getData());
      fileCallback.onReceiveValue(uris);
      fileCallback = null;
    });
    // Câmera/microfone pedidos por um site: o Android precisa liberar para o
    // app antes (uma vez); depois o site recebe o que a pessoa permitiu.
    permLauncher = getActivity().registerForActivityResult(new ActivityResultContracts.RequestMultiplePermissions(), result -> {
      Runnable r = afterPerm;
      afterPerm = null;
      if (r != null) r.run();
    });
    new Thread(this::loadLists, "pcb-lists").start();
  }

  // ---------------- listas ----------------
  private File listFile(String name) { return new File(getContext().getFilesDir(), "pcbrowser-" + name + ".txt"); }

  private String fetch(String url) {
    HttpURLConnection c = null;
    try {
      c = (HttpURLConnection) new URL(url).openConnection();
      c.setConnectTimeout(15000);
      c.setReadTimeout(30000);
      if (c.getResponseCode() != 200) return null;
      BufferedReader r = new BufferedReader(new InputStreamReader(c.getInputStream(), StandardCharsets.UTF_8));
      StringBuilder sb = new StringBuilder();
      String line;
      while ((line = r.readLine()) != null) sb.append(line).append('\n');
      r.close();
      return sb.length() > 50 ? sb.toString() : null;
    } catch (Exception e) {
      return null;
    } finally {
      if (c != null) c.disconnect();
    }
  }

  private Set<String> parseDomains(String text) {
    Set<String> out = new HashSet<>();
    for (String raw : text.split("\n")) {
      String line = raw.trim().toLowerCase();
      if (line.isEmpty() || line.startsWith("!") || line.startsWith("#")) continue;
      Matcher m = ABP_DOMAIN.matcher(line);
      if (m.find()) { out.add(m.group(1)); continue; }
      Matcher h = HOSTS_LINE.matcher(line);
      if (h.find()) out.add(h.group(1));
    }
    return out;
  }

  private Set<String> loadSet(String name, String[] urls, String[] mirrors) {
    File f = listFile(name);
    boolean fresh = f.exists() && System.currentTimeMillis() - f.lastModified() < LIST_MAX_AGE;
    if (!fresh) {
      StringBuilder all = new StringBuilder();
      for (int i = 0; i < urls.length; i++) {
        String t = fetch(urls[i]);
        if (t == null && mirrors != null && mirrors[i] != null) t = fetch(mirrors[i]);
        if (t != null) all.append(t).append('\n');
      }
      if (all.length() > 0) {
        Set<String> s = parseDomains(all.toString());
        try (OutputStreamWriter w = new OutputStreamWriter(new FileOutputStream(f), StandardCharsets.UTF_8)) {
          for (String d : s) { w.write(d); w.write('\n'); }
        } catch (Exception ignored) { }
        return s;
      }
    }
    Set<String> s = new HashSet<>();
    if (f.exists()) {
      try (BufferedReader r = new BufferedReader(new InputStreamReader(new java.io.FileInputStream(f), StandardCharsets.UTF_8))) {
        String line;
        while ((line = r.readLine()) != null) if (!line.isEmpty()) s.add(line);
      } catch (Exception ignored) { }
    }
    return s;
  }

  private void loadLists() {
    try {
      blockSet = loadSet("ads", AD_LISTS, AD_MIRRORS);
      dangerSet = loadSet("danger", DANGER_LISTS, null);
      engineState = blockSet.isEmpty() ? "error" : "on";
    } catch (Exception e) {
      engineState = "error";
    }
    JSObject ev = new JSObject();
    ev.put("type", "engine");
    ev.put("state", engineState);
    ev.put("domains", blockSet.size());
    emit(ev);
  }

  private static String registrable(String host) {
    String[] p = host.split("\\.");
    if (p.length <= 2) return host;
    String last2 = p[p.length - 2] + "." + p[p.length - 1];
    // com.br, co.uk, gov.br...: pega 3 partes.
    if (p[p.length - 2].length() <= 3 && p[p.length - 1].length() == 2) return p[p.length - 3] + "." + last2;
    return last2;
  }

  private static boolean inSet(Set<String> set, String host) {
    String h = host;
    while (true) {
      if (set.contains(h)) return true;
      int i = h.indexOf('.');
      if (i < 0 || h.indexOf('.', i + 1) < 0) return false;
      h = h.substring(i + 1);
    }
  }

  private static String stripTracking(String url) {
    try {
      Uri u = Uri.parse(url);
      if (u.getQuery() == null) return url;
      Uri.Builder b = u.buildUpon().clearQuery();
      boolean changed = false;
      for (String k : u.getQueryParameterNames()) {
        if (TRACK_PARAM.matcher(k).matches()) { changed = true; continue; }
        for (String v : u.getQueryParameters(k)) b.appendQueryParameter(k, v);
      }
      return changed ? b.build().toString() : url;
    } catch (Exception e) {
      return url;
    }
  }

  private String prepareUrl(String url) {
    String u = url;
    if (stripTracking) u = stripTracking(u);
    if (httpsOnly && u.startsWith("http://")) {
      String host = Uri.parse(u).getHost();
      if (host != null && !LOCAL_HOST.matcher(host).matches() && !httpOk.contains(host)) u = "https://" + u.substring(7);
    }
    return u;
  }

  // ---------------- eventos para a página ----------------
  private void emit(JSObject data) { notifyListeners("browserEvent", data); }
  private JSObject ev(String type, String tabId) { JSObject o = new JSObject(); o.put("type", type); o.put("tabId", tabId); return o; }

  // O botão voltar do celular é tratado pela página (App backButton), que
  // pergunta aqui primeiro: tela cheia → sai dela; aba com histórico → volta.
  private void updateBack() { }

  // ---------------- abas ----------------
  private FrameLayout ensureContainer() {
    if (container != null) return container;
    WebView main = getBridge().getWebView();
    ViewGroup parent = (ViewGroup) main.getParent();
    container = new FrameLayout(getContext());
    container.setBackgroundColor(Color.WHITE);
    container.setVisibility(View.GONE);
    parent.addView(container, new ViewGroup.LayoutParams(1, 1));
    return container;
  }

  private void applyLayout() {
    if (container == null) return;
    WebView main = getBridge().getWebView();
    boolean show = visible && activeId != null && tabs.containsKey(activeId) && rectW > 0 && rectH > 0 && customView == null;
    container.setVisibility(show ? View.VISIBLE : View.GONE);
    if (show) {
      ViewGroup.LayoutParams lp = container.getLayoutParams();
      lp.width = rectW;
      lp.height = rectH;
      container.setLayoutParams(lp);
      container.setX(main.getX() + rectX);
      container.setY(main.getY() + rectY);
      container.bringToFront();
    }
    for (Map.Entry<String, WebView> e : tabs.entrySet()) {
      boolean on = e.getKey().equals(activeId);
      e.getValue().setVisibility(on ? View.VISIBLE : View.GONE);
      if (on) e.getValue().onResume(); else e.getValue().onPause();
    }
    updateBack();
  }

  @SuppressLint("SetJavaScriptEnabled")
  private WebView createTab(String tabId) {
    WebView wv = new WebView(getContext());
    WebSettings s = wv.getSettings();
    s.setJavaScriptEnabled(true);
    s.setDomStorageEnabled(true);
    s.setDatabaseEnabled(true);
    s.setSupportMultipleWindows(true);
    s.setJavaScriptCanOpenWindowsAutomatically(false);
    s.setLoadWithOverviewMode(true);
    s.setUseWideViewPort(true);
    s.setBuiltInZoomControls(true);
    s.setDisplayZoomControls(false);
    s.setAllowFileAccess(false);
    s.setAllowContentAccess(false);
    s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
    s.setMediaPlaybackRequiresUserGesture(true);
    // Sem o marcador "; wv": sites tratam como Chrome comum.
    s.setUserAgentString(s.getUserAgentString().replace("; wv)", ")"));
    CookieManager.getInstance().setAcceptCookie(true);
    CookieManager.getInstance().setAcceptThirdPartyCookies(wv, !block3pCookies);
    wv.setWebViewClient(new TabClient(tabId));
    wv.setWebChromeClient(new TabChrome(tabId));
    wv.setDownloadListener((url, userAgent, contentDisposition, mimeType, length) -> download(tabId, url, userAgent, contentDisposition, mimeType));
    wv.setFindListener((active, count, done) -> {
      if (!done) return;
      JSObject o = ev("find", tabId);
      o.put("active", count == 0 ? 0 : active + 1);
      o.put("total", count);
      emit(o);
    });
    ensureContainer().addView(wv, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    tabs.put(tabId, wv);
    return wv;
  }

  private void download(String tabId, String url, String ua, String cd, String mime) {
    JSObject o = ev("download", tabId);
    o.put("url", url);
    try {
      String name = URLUtil.guessFileName(url, cd, mime);
      DownloadManager.Request req = new DownloadManager.Request(Uri.parse(url));
      String cookies = CookieManager.getInstance().getCookie(url);
      if (cookies != null) req.addRequestHeader("Cookie", cookies);
      if (ua != null) req.addRequestHeader("User-Agent", ua);
      req.setMimeType(mime);
      req.setTitle(name);
      req.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
      req.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name);
      DownloadManager dm = (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
      dm.enqueue(req);
      o.put("filename", name);
      o.put("state", "started");
    } catch (Exception e) {
      o.put("state", "failed");
      o.put("error", e.getMessage());
    }
    emit(o);
  }

  private class TabClient extends WebViewClient {
    private final String tabId;
    TabClient(String tabId) { this.tabId = tabId; }

    @Override
    public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
      String url = request.getUrl().toString();
      String scheme = request.getUrl().getScheme();
      if (scheme == null) return true;
      if (!scheme.equals("http") && !scheme.equals("https")) {
        // intent:, mailto:, tel:, market:… → aplicativo do celular.
        try {
          Intent i = scheme.equals("intent") ? Intent.parseUri(url, Intent.URI_INTENT_SCHEME) : new Intent(Intent.ACTION_VIEW, Uri.parse(url));
          i.addCategory(Intent.CATEGORY_BROWSABLE);
          i.setComponent(null);
          i.setSelector(null);
          getActivity().startActivity(i);
        } catch (ActivityNotFoundException | java.net.URISyntaxException e) {
          if (scheme.equals("intent")) {
            try {
              String fb = Intent.parseUri(url, Intent.URI_INTENT_SCHEME).getStringExtra("browser_fallback_url");
              if (fb != null && (fb.startsWith("https://") || fb.startsWith("http://"))) view.loadUrl(prepareUrl(fb));
            } catch (Exception ignored) { }
          }
        }
        return true;
      }
      if (!request.isForMainFrame()) return false;
      String host = request.getUrl().getHost();
      if (adblock && host != null && !dangerOk.contains(host) && inSet(dangerSet, host)) {
        JSObject o = ev("dangerous", tabId);
        o.put("url", url);
        o.put("host", host);
        emit(o);
        return true;
      }
      String prepared = prepareUrl(url);
      if (!prepared.equals(url)) {
        if (prepared.startsWith("https://") && url.startsWith("http://")) {
          JSObject o = ev("httpsUpgraded", tabId);
          o.put("host", host);
          emit(o);
        }
        view.loadUrl(prepared);
        return true;
      }
      return false;
    }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
      if (!adblock || request.isForMainFrame()) return null;
      String host = request.getUrl().getHost();
      if (host == null) return null;
      String top = tabHost.get(tabId);
      if (top != null) {
        if (siteAllow.contains(top) || siteAllow.contains(registrable(top))) return null;
        if (registrable(top).equals(registrable(host))) return null; // o próprio site nunca é bloqueado
      }
      if (inSet(blockSet, host)) {
        int n = blockedCount.containsKey(tabId) ? blockedCount.get(tabId) + 1 : 1;
        blockedCount.put(tabId, n);
        blockedTotal++;
        if (n == 1 || n % 5 == 0) {
          JSObject o = ev("blocked", tabId);
          o.put("count", n);
          o.put("total", blockedTotal);
          emit(o);
        }
        return new WebResourceResponse("text/plain", "utf-8", new ByteArrayInputStream(new byte[0]));
      }
      return null;
    }

    @Override
    public void onPageStarted(WebView view, String url, Bitmap favicon) {
      String host = Uri.parse(url).getHost();
      if (host != null) tabHost.put(tabId, host);
      blockedCount.put(tabId, 0);
      JSObject o = ev("start", tabId);
      o.put("url", url);
      emit(o);
    }

    @Override
    public void onPageFinished(WebView view, String url) {
      JSObject o = ev("stop", tabId);
      o.put("url", url);
      o.put("title", view.getTitle());
      o.put("canBack", view.canGoBack());
      o.put("canForward", view.canGoForward());
      emit(o);
      updateBack();
    }

    @Override
    public void doUpdateVisitedHistory(WebView view, String url, boolean isReload) {
      JSObject o = ev("navigate", tabId);
      o.put("url", url);
      o.put("canBack", view.canGoBack());
      o.put("canForward", view.canGoForward());
      emit(o);
      updateBack();
    }

    @Override
    public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
      if (!request.isForMainFrame()) return;
      JSObject o = ev("error", tabId);
      o.put("url", request.getUrl().toString());
      o.put("host", request.getUrl().getHost());
      o.put("code", error.getErrorCode());
      o.put("desc", String.valueOf(error.getDescription()));
      emit(o);
    }

    @Override
    public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
      handler.cancel(); // certificado inválido: nunca segue
      JSObject o = ev("error", tabId);
      o.put("url", error.getUrl());
      o.put("code", -200);
      o.put("desc", "Certificado de segurança inválido");
      emit(o);
    }
  }

  private class TabChrome extends WebChromeClient {
    private final String tabId;
    TabChrome(String tabId) { this.tabId = tabId; }

    @Override
    public void onProgressChanged(WebView view, int progress) {
      if (progress != 100 && progress % 20 != 0) return;
      JSObject o = ev("progress", tabId);
      o.put("progress", progress);
      emit(o);
    }

    @Override
    public void onReceivedTitle(WebView view, String title) {
      JSObject o = ev("title", tabId);
      o.put("title", title);
      emit(o);
    }

    @Override
    public void onReceivedIcon(WebView view, Bitmap icon) {
      try {
        Bitmap small = Bitmap.createScaledBitmap(icon, 32, 32, true);
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        small.compress(Bitmap.CompressFormat.PNG, 100, out);
        JSObject o = ev("favicon", tabId);
        o.put("favicon", "data:image/png;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP));
        emit(o);
      } catch (Exception ignored) { }
    }

    // target=_blank / window.open → aba nova do Project Club.
    @Override
    public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, Message resultMsg) {
      if (!isUserGesture) return false; // popup sem clique: bloqueado
      WebView temp = new WebView(getContext());
      temp.setWebViewClient(new WebViewClient() {
        private boolean done = false;
        private void open(String url) {
          if (done || url == null || url.equals("about:blank")) return;
          done = true;
          JSObject o = ev("openTab", tabId);
          o.put("url", url);
          emit(o);
          temp.post(temp::destroy);
        }
        @Override
        public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) { open(r.getUrl().toString()); return true; }
        @Override
        public void onPageStarted(WebView v, String url, Bitmap f) { open(url); }
      });
      WebView.WebViewTransport transport = (WebView.WebViewTransport) resultMsg.obj;
      transport.setWebView(temp);
      resultMsg.sendToTarget();
      return true;
    }

    @Override
    public void onPermissionRequest(PermissionRequest request) {
      List<String> wanted = new ArrayList<>();
      for (String r : request.getResources()) {
        if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r) || PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r)) wanted.add(r);
      }
      if (wanted.isEmpty()) { request.deny(); return; }
      String id = "m" + (++permSeq);
      pendingMedia.put(id, request);
      JSObject o = ev("permission", tabId);
      o.put("id", id);
      o.put("permission", "media");
      o.put("origin", request.getOrigin().toString());
      o.put("extra", android.text.TextUtils.join(",", wanted).replace(PermissionRequest.RESOURCE_VIDEO_CAPTURE, "video").replace(PermissionRequest.RESOURCE_AUDIO_CAPTURE, "audio"));
      emit(o);
    }

    @Override
    public void onGeolocationPermissionsShowPrompt(String origin, android.webkit.GeolocationPermissions.Callback callback) {
      callback.invoke(origin, false, false); // o app não pede localização
    }

    @Override
    public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> filePathCallback, FileChooserParams params) {
      if (fileCallback != null) fileCallback.onReceiveValue(null);
      fileCallback = filePathCallback;
      try {
        fileLauncher.launch(params.createIntent());
      } catch (Exception e) {
        fileCallback = null;
        return false;
      }
      return true;
    }

    @Override
    public void onShowCustomView(View view, CustomViewCallback callback) {
      if (customView != null) { callback.onCustomViewHidden(); return; }
      customView = view;
      customViewCallback = callback;
      ViewGroup decor = (ViewGroup) getActivity().getWindow().getDecorView();
      decor.addView(view, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
      view.setBackgroundColor(Color.BLACK);
      decor.setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
      getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
      updateBack();
    }

    @Override
    public void onHideCustomView() { hideCustomView(); }
  }

  private void hideCustomView() {
    if (customView == null) return;
    ViewGroup decor = (ViewGroup) getActivity().getWindow().getDecorView();
    decor.removeView(customView);
    decor.setSystemUiVisibility(View.SYSTEM_UI_FLAG_VISIBLE);
    getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    customView = null;
    if (customViewCallback != null) customViewCallback.onCustomViewHidden();
    customViewCallback = null;
    applyLayout();
  }

  // ---------------- métodos chamados pela página ----------------
  private void ui(Runnable r) { getActivity().runOnUiThread(r); }

  @PluginMethod
  public void open(PluginCall call) {
    String tabId = call.getString("tabId");
    String url = call.getString("url", "about:blank");
    boolean activate = call.getBoolean("activate", true);
    if (tabId == null) { call.reject("tabId"); return; }
    ui(() -> {
      WebView wv = tabs.get(tabId);
      if (wv == null) wv = createTab(tabId);
      if (activate) activeId = tabId;
      loadChecked(tabId, wv, url);
      applyLayout();
      call.resolve();
    });
  }

  @PluginMethod
  public void navigate(PluginCall call) {
    String tabId = call.getString("tabId");
    String url = call.getString("url", "");
    ui(() -> {
      WebView wv = tabs.get(tabId);
      if (wv == null) wv = createTab(tabId);
      loadChecked(tabId, wv, url);
      call.resolve();
    });
  }

  // Abre um endereço pedido pela página (barra de endereço, links do app),
  // conferindo antes as listas de sites perigosos.
  private void loadChecked(String tabId, WebView wv, String url) {
    if (!url.startsWith("http://") && !url.startsWith("https://")) return;
    String host = Uri.parse(url).getHost();
    if (host != null && adblock && !dangerOk.contains(host) && inSet(dangerSet, host)) {
      JSObject o = ev("dangerous", tabId);
      o.put("url", url);
      o.put("host", host);
      emit(o);
      return;
    }
    String prepared = prepareUrl(url);
    if (prepared.startsWith("https://") && url.startsWith("http://")) {
      JSObject o = ev("httpsUpgraded", tabId);
      o.put("host", host);
      emit(o);
    }
    wv.loadUrl(prepared);
  }

  @PluginMethod
  public void close(PluginCall call) {
    String tabId = call.getString("tabId");
    ui(() -> {
      WebView wv = tabs.remove(tabId);
      tabHost.remove(tabId);
      blockedCount.remove(tabId);
      if (wv != null) {
        if (container != null) container.removeView(wv);
        wv.stopLoading();
        wv.destroy();
      }
      if (tabId != null && tabId.equals(activeId)) activeId = null;
      applyLayout();
      call.resolve();
    });
  }

  @PluginMethod
  public void activate(PluginCall call) {
    String tabId = call.getString("tabId");
    ui(() -> { activeId = tabs.containsKey(tabId) ? tabId : null; applyLayout(); call.resolve(); });
  }

  @PluginMethod
  public void setRect(PluginCall call) {
    int x = call.getInt("x", 0), y = call.getInt("y", 0), w = call.getInt("width", 0), h = call.getInt("height", 0);
    boolean v = call.getBoolean("visible", false);
    ui(() -> { rectX = x; rectY = y; rectW = w; rectH = h; visible = v; applyLayout(); call.resolve(); });
  }

  private void withTab(PluginCall call, java.util.function.Consumer<WebView> fn) {
    String tabId = call.getString("tabId");
    ui(() -> {
      WebView wv = tabs.get(tabId);
      if (wv != null) fn.accept(wv);
      call.resolve();
    });
  }

  @PluginMethod public void back(PluginCall call) { withTab(call, wv -> { if (wv.canGoBack()) wv.goBack(); }); }
  @PluginMethod public void forward(PluginCall call) { withTab(call, wv -> { if (wv.canGoForward()) wv.goForward(); }); }
  @PluginMethod public void reload(PluginCall call) { withTab(call, WebView::reload); }
  @PluginMethod public void stop(PluginCall call) { withTab(call, WebView::stopLoading); }
  @PluginMethod public void pauseMedia(PluginCall call) { withTab(call, wv -> wv.evaluateJavascript("document.querySelectorAll('video,audio').forEach(function(v){v.pause()})", null)); }

  @PluginMethod
  public void find(PluginCall call) {
    String text = call.getString("text", "");
    boolean next = call.getBoolean("next", false);
    boolean forward = call.getBoolean("forward", true);
    withTab(call, wv -> { if (next) wv.findNext(forward); else wv.findAllAsync(text); });
  }

  @PluginMethod public void clearFind(PluginCall call) { withTab(call, wv -> wv.clearMatches()); }

  @PluginMethod
  public void permissionReply(PluginCall call) {
    String id = call.getString("id");
    boolean allow = call.getBoolean("allow", false);
    ui(() -> {
      PermissionRequest r = pendingMedia.remove(id);
      if (r != null) {
        if (allow) {
          List<String> res = new ArrayList<>();
          List<String> need = new ArrayList<>();
          for (String x : r.getResources()) {
            if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(x)) { res.add(x); if (!granted(Manifest.permission.CAMERA)) need.add(Manifest.permission.CAMERA); }
            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(x)) { res.add(x); if (!granted(Manifest.permission.RECORD_AUDIO)) need.add(Manifest.permission.RECORD_AUDIO); }
          }
          if (need.isEmpty()) r.grant(res.toArray(new String[0]));
          else {
            afterPerm = () -> {
              List<String> ok = new ArrayList<>();
              for (String x : res) {
                if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(x) && granted(Manifest.permission.CAMERA)) ok.add(x);
                if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(x) && granted(Manifest.permission.RECORD_AUDIO)) ok.add(x);
              }
              if (ok.isEmpty()) r.deny(); else r.grant(ok.toArray(new String[0]));
            };
            permLauncher.launch(need.toArray(new String[0]));
          }
        } else r.deny();
      }
      call.resolve();
    });
  }

  private boolean granted(String perm) { return ContextCompat.checkSelfPermission(getContext(), perm) == PackageManager.PERMISSION_GRANTED; }

  @PluginMethod
  public void handleBack(PluginCall call) {
    ui(() -> {
      JSObject o = new JSObject();
      if (customView != null) { hideCustomView(); o.put("handled", true); call.resolve(o); return; }
      WebView wv = activeId != null ? tabs.get(activeId) : null;
      boolean can = visible && container != null && container.getVisibility() == View.VISIBLE && wv != null && wv.canGoBack();
      if (can) wv.goBack();
      o.put("handled", can);
      call.resolve(o);
    });
  }

  @PluginMethod
  public void allowHost(PluginCall call) {
    String host = call.getString("host", "");
    String kind = call.getString("kind", "http");
    if ("danger".equals(kind)) dangerOk.add(host); else httpOk.add(host);
    call.resolve();
  }

  @PluginMethod
  public void setPrefs(PluginCall call) {
    adblock = call.getBoolean("adblock", adblock);
    httpsOnly = call.getBoolean("httpsOnly", httpsOnly);
    stripTracking = call.getBoolean("stripTracking", stripTracking);
    boolean b3 = call.getBoolean("block3pCookies", block3pCookies);
    JSArray allow = call.getArray("siteAllow");
    if (allow != null) {
      siteAllow.clear();
      try { for (Object o : allow.toList()) siteAllow.add(String.valueOf(o)); } catch (Exception ignored) { }
    }
    ui(() -> {
      if (b3 != block3pCookies) {
        block3pCookies = b3;
        for (WebView wv : tabs.values()) CookieManager.getInstance().setAcceptThirdPartyCookies(wv, !b3);
      }
      call.resolve();
    });
  }

  @PluginMethod
  public void getState(PluginCall call) {
    JSObject o = new JSObject();
    o.put("engine", engineState);
    o.put("domains", blockSet.size());
    o.put("total", blockedTotal);
    call.resolve(o);
  }

  @PluginMethod
  public void openExternal(PluginCall call) {
    String url = call.getString("url", "");
    if (!url.startsWith("https://") && !url.startsWith("http://")) { call.reject("url"); return; }
    try {
      Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
      i.addCategory(Intent.CATEGORY_BROWSABLE);
      getActivity().startActivity(i);
      call.resolve();
    } catch (Exception e) {
      call.reject("Nenhum navegador encontrado");
    }
  }

  // Apaga cookies e dados SÓ dos sites visitados no navegador (a lista vem
  // do histórico). Os cookies/dados do WebView são do app inteiro — limpar
  // tudo desconectaria a pessoa do próprio Project Club, então o domínio do
  // app nunca é tocado.
  @PluginMethod
  public void clearData(PluginCall call) {
    boolean cookies = call.getBoolean("cookies", true);
    boolean cache = call.getBoolean("cache", true);
    boolean storage = call.getBoolean("storage", true);
    JSArray hostsArr = call.getArray("hosts");
    List<String> hosts = new ArrayList<>();
    try { if (hostsArr != null) for (Object o : hostsArr.toList()) hosts.add(String.valueOf(o)); } catch (Exception ignored) { }
    String appHost = Uri.parse(getBridge().getServerUrl() != null ? getBridge().getServerUrl() : "").getHost();
    ui(() -> {
      CookieManager cm = CookieManager.getInstance();
      for (String h : hosts) {
        if (h == null || h.isEmpty() || (appHost != null && (h.equals(appHost) || appHost.endsWith("." + h)))) continue;
        String[] origins = { "https://" + h, "http://" + h };
        for (String origin : origins) {
          if (storage) android.webkit.WebStorage.getInstance().deleteOrigin(origin);
          if (!cookies) continue;
          String c = cm.getCookie(origin);
          if (c == null) continue;
          for (String part : c.split(";")) {
            String name = part.split("=", 2)[0].trim();
            if (name.isEmpty()) continue;
            String reg = registrable(h);
            cm.setCookie(origin, name + "=; Max-Age=0; Path=/");
            cm.setCookie(origin, name + "=; Max-Age=0; Path=/; Domain=" + h);
            cm.setCookie(origin, name + "=; Max-Age=0; Path=/; Domain=." + reg);
          }
        }
      }
      cm.flush();
      if (cache) {
        WebView t = tabs.isEmpty() ? new WebView(getContext()) : tabs.values().iterator().next();
        t.clearCache(true);
        if (tabs.isEmpty()) t.destroy();
      }
      call.resolve();
    });
  }

  @PluginMethod
  public void updateLists(PluginCall call) {
    new Thread(() -> {
      listFile("ads").delete();
      listFile("danger").delete();
      engineState = "loading";
      loadLists();
      JSObject o = new JSObject();
      o.put("engine", engineState);
      o.put("domains", blockSet.size());
      call.resolve(o);
    }, "pcb-lists-update").start();
  }

  @PluginMethod
  public void clearCache(PluginCall call) {
    ui(() -> {
      for (WebView wv : tabs.values()) wv.clearCache(true);
      if (tabs.isEmpty()) { WebView t = new WebView(getContext()); t.clearCache(true); t.destroy(); }
      call.resolve();
    });
  }

  @Override
  protected void handleOnDestroy() {
    for (Iterator<WebView> it = tabs.values().iterator(); it.hasNext(); ) { WebView wv = it.next(); wv.destroy(); it.remove(); }
  }
}
