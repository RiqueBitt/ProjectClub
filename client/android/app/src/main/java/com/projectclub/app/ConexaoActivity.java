package com.projectclub.app;

import android.app.Activity;
import android.content.Context;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.ConnectivityManager;
import android.net.Network;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.window.OnBackInvokedDispatcher;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * "Project Club · Conexão" — tela de sem conexão como um app à parte.
 *
 * Roda em processo próprio (android:process=":conexao" no manifesto) e não
 * usa nada do site: só confere a rede do aparelho e o servidor do Project
 * Club (/api/health). Fica testando sozinha (a cada 5 s e sempre que o
 * Android avisa que a rede voltou) e, quando o servidor responde, fecha —
 * o Project Club recarrega no lugar onde estava.
 */
public class ConexaoActivity extends Activity {
    private static final int BG = Color.parseColor("#111318");
    private static final int TEXT = Color.parseColor("#E8E9EE");
    private static final int MUTED = Color.parseColor("#A6A9B6");
    private static final int ACCENT = Color.parseColor("#4C9FFF");
    private static final int WARN = Color.parseColor("#F0B232");
    private static final long INTERVAL_MS = 5000;

    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private ConnectivityManager.NetworkCallback networkCallback;
    private String appUrl;
    private TextView title;
    private TextView message;
    private TextView status;
    private Button retry;
    private ProgressBar spinner;
    private boolean checking = false;
    private boolean visible = false;

    private final Runnable tick = new Runnable() {
        @Override
        public void run() {
            check();
            if (visible) main.postDelayed(this, INTERVAL_MS);
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        appUrl = getIntent().getStringExtra(ConnectionGuard.EXTRA_APP_URL);
        if (appUrl == null || appUrl.isEmpty()) appUrl = "https://projectclub.shardweb.app";
        getWindow().setStatusBarColor(BG);
        getWindow().setNavigationBarColor(BG);
        setContentView(buildView(getIntent().getStringExtra(ConnectionGuard.EXTRA_KIND), getIntent().getStringExtra(ConnectionGuard.EXTRA_DETAIL)));
        // Android 13+ (e obrigatório no 16): o "voltar" chega por aqui.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, () -> moveTaskToBack(true));
        }
    }

    private int dp(float v) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics()));
    }

    private View buildView(String kind, String detail) {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER);
        root.setBackgroundColor(BG);
        root.setPadding(dp(28), dp(48), dp(28), dp(48));

        TextView brand = new TextView(this);
        brand.setText("PROJECT CLUB · CONEXÃO");
        brand.setTextColor(ACCENT);
        brand.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        brand.setLetterSpacing(0.12f);
        brand.setTypeface(Typeface.DEFAULT_BOLD);
        brand.setGravity(Gravity.CENTER);

        View dot = new View(this);
        GradientDrawable dotShape = new GradientDrawable();
        dotShape.setShape(GradientDrawable.OVAL);
        dotShape.setColor(WARN);
        dot.setBackground(dotShape);
        LinearLayout.LayoutParams dotLp = new LinearLayout.LayoutParams(dp(12), dp(12));
        dotLp.topMargin = dp(22);
        dotLp.bottomMargin = dp(14);

        title = new TextView(this);
        title.setTextColor(TEXT);
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 21);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        title.setGravity(Gravity.CENTER);

        message = new TextView(this);
        message.setTextColor(MUTED);
        message.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        message.setGravity(Gravity.CENTER);
        message.setLineSpacing(0, 1.2f);
        LinearLayout.LayoutParams msgLp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        msgLp.topMargin = dp(8);

        LinearLayout statusRow = new LinearLayout(this);
        statusRow.setOrientation(LinearLayout.HORIZONTAL);
        statusRow.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams rowLp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        rowLp.topMargin = dp(22);
        spinner = new ProgressBar(this);
        spinner.setIndeterminate(true);
        spinner.setVisibility(View.INVISIBLE);
        LinearLayout.LayoutParams spLp = new LinearLayout.LayoutParams(dp(18), dp(18));
        spLp.rightMargin = dp(8);
        status = new TextView(this);
        status.setTextColor(MUTED);
        status.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        statusRow.addView(spinner, spLp);
        statusRow.addView(status);

        retry = new Button(this);
        retry.setText("Tentar agora");
        retry.setAllCaps(false);
        retry.setTextColor(Color.WHITE);
        retry.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        retry.setTypeface(Typeface.DEFAULT_BOLD);
        GradientDrawable btn = new GradientDrawable();
        btn.setColor(ACCENT);
        btn.setCornerRadius(dp(12));
        retry.setBackground(btn);
        retry.setPadding(dp(28), dp(12), dp(28), dp(12));
        retry.setOnClickListener(v -> check());
        LinearLayout.LayoutParams btnLp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        btnLp.topMargin = dp(18);

        TextView code = new TextView(this);
        code.setText(detail == null ? "" : "Detalhe: " + detail);
        code.setTextColor(Color.parseColor("#6B6F7C"));
        code.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
        code.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams codeLp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        codeLp.topMargin = dp(28);

        root.addView(brand);
        root.addView(dot, dotLp);
        root.addView(title);
        root.addView(message, msgLp);
        root.addView(statusRow, rowLp);
        root.addView(retry, btnLp);
        root.addView(code, codeLp);
        showState("offline".equals(kind) ? State.NO_INTERNET : State.NO_SERVER);
        return root;
    }

    private enum State { NO_INTERNET, NO_SERVER }

    private void showState(State state) {
        if (state == State.NO_INTERNET) {
            title.setText("Sem internet");
            message.setText("Seu aparelho está sem conexão. Assim que a internet voltar, o Project Club abre sozinho.");
        } else {
            title.setText("Sem conexão com o Project Club");
            message.setText("A internet está funcionando, mas o servidor não respondeu. O app tenta de novo sozinho.");
        }
    }

    private void check() {
        if (checking) return;
        checking = true;
        spinner.setVisibility(View.VISIBLE);
        status.setText("Verificando…");
        retry.setEnabled(false);
        final String base = appUrl;
        io.execute(() -> {
            final boolean network = ConnectionGuard.hasNetwork(this);
            final boolean server = network && ConnectionGuard.serverResponds(base);
            main.post(() -> {
                checking = false;
                if (isFinishing() || isDestroyed()) return;
                if (server) {
                    status.setText("Conectado! Voltando ao Project Club…");
                    finish();
                    overridePendingTransition(0, android.R.anim.fade_out);
                    return;
                }
                spinner.setVisibility(View.INVISIBLE);
                retry.setEnabled(true);
                showState(network ? State.NO_SERVER : State.NO_INTERNET);
                status.setText("Tentando de novo a cada 5 segundos");
            });
        });
    }

    @Override
    protected void onResume() {
        super.onResume();
        visible = true;
        main.removeCallbacks(tick);
        main.post(tick);
        // A rede voltou → testa na hora, sem esperar os 5 s.
        try {
            ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
            if (cm != null && networkCallback == null) {
                networkCallback = new ConnectivityManager.NetworkCallback() {
                    @Override
                    public void onAvailable(Network network) {
                        main.post(ConexaoActivity.this::check);
                    }
                };
                cm.registerDefaultNetworkCallback(networkCallback);
            }
        } catch (Exception ignored) {
            // sem aviso de rede: o teste a cada 5 s continua
        }
    }

    @Override
    protected void onPause() {
        super.onPause();
        visible = false;
        main.removeCallbacks(tick);
        try {
            ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
            if (cm != null && networkCallback != null) cm.unregisterNetworkCallback(networkCallback);
        } catch (Exception ignored) {
            // já estava desregistrado
        }
        networkCallback = null;
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        io.shutdownNow();
    }

    // Voltar não leva pra página quebrada: manda o app pro fundo (Android < 13).
    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        moveTaskToBack(true);
    }
}
