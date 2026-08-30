package com.projectclub.app;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.media.projection.MediaProjectionManager;
import androidx.activity.result.ActivityResult;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

// Item pedido: "o jeito mais fácil de conseguir fazer o celular
// compartilhar a tela" — o caminho escolhido evita de propósito a parte
// mais arriscada de uma implementação nativa "completa" (renderização
// gráfica de baixo nível com OpenGL/EGL, do jeito que o próprio exemplo
// oficial do Agora faz): aqui, esse plugin só entrega os PIXELS da tela
// (como imagens JPEG, uma a cada intervalo curto) pro lado JavaScript —
// é lá que a mágica de virar um vídeo de verdade acontece, desenhando
// cada imagem recebida num <canvas> e usando canvas.captureStream()
// (uma função padrão de navegador, documentada oficialmente pelo Agora
// como forma válida de alimentar uma chamada com uma fonte de vídeo
// customizada). Menos performático que a via 100% nativa/gráfica, mas
// MUITO mais simples de implementar corretamente sem poder testar num
// aparelho real — o que é exatamente a troca que foi pedida.
//
// IMPORTANTE: esta parte (plugin Android nativo) é código que eu não
// tenho como compilar nem testar sem um dispositivo Android físico —
// segui a documentação oficial do Capacitor e do Android à risca, mas
// só um teste de verdade no aparelho confirma se funciona.
@CapacitorPlugin(name = "ScreenShare")
public class ScreenSharePlugin extends Plugin {

  @PluginMethod
  public void requestPermission(PluginCall call) {
    MediaProjectionManager manager =
      (MediaProjectionManager) getActivity().getSystemService(Context.MEDIA_PROJECTION_SERVICE);
    Intent intent = manager.createScreenCaptureIntent();
    startActivityForResult(call, intent, "handlePermissionResult");
  }

  @ActivityCallback
  private void handlePermissionResult(PluginCall call, ActivityResult result) {
    if (call == null) return;
    JSObject ret = new JSObject();
    if (result.getResultCode() == Activity.RESULT_OK && result.getData() != null) {
      // Guarda o código+Intent de permissão pra usar DEPOIS, só quando
      // startCapture() for chamado — regra do Android 14+ (API 34+, e
      // esse app mira API 36): o Foreground Service do tipo
      // "mediaProjection" precisa já estar RODANDO antes de pegar a
      // MediaProjection de verdade a partir desse resultado. Pegar ela
      // aqui, cedo demais, faz o app derrubar com SecurityException.
      ScreenCaptureService.pendingResultCode = result.getResultCode();
      ScreenCaptureService.pendingResultData = result.getData();
      ret.put("granted", true);
    } else {
      ret.put("granted", false);
    }
    call.resolve(ret);
  }

  @PluginMethod
  public void startCapture(PluginCall call) {
    if (ScreenCaptureService.pendingResultData == null) {
      call.reject("Permissão de captura de tela ainda não foi concedida.");
      return;
    }
    int fps = call.getInt("fps", 6);
    int quality = call.getInt("quality", 55);
    // Repassa os frames capturados pelo Service de volta pro
    // JavaScript, um evento por frame — o próprio Service não sabe
    // nada sobre o Capacitor, só chama esse callback. Classe anônima
    // em vez de lambda de propósito: garante compatibilidade sem
    // depender de nenhuma configuração extra de versão do Java no
    // Gradle, que este projeto não declara explicitamente.
    ScreenCaptureService.frameListener = new ScreenCaptureService.FrameListener() {
      @Override
      public void onFrame(String base64Jpeg) {
        JSObject data = new JSObject();
        data.put("data", base64Jpeg);
        notifyListeners("frame", data);
      }
    };
    Intent intent = new Intent(getContext(), ScreenCaptureService.class);
    intent.putExtra("fps", fps);
    intent.putExtra("quality", quality);
    ContextCompat.startForegroundService(getContext(), intent);
    call.resolve();
  }

  @PluginMethod
  public void stopCapture(PluginCall call) {
    ScreenCaptureService.frameListener = null;
    getContext().stopService(new Intent(getContext(), ScreenCaptureService.class));
    call.resolve();
  }
}
