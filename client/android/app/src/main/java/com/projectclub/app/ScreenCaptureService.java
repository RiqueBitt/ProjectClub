package com.projectclub.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.PixelFormat;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.Image;
import android.media.ImageReader;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.util.DisplayMetrics;
import androidx.core.app.NotificationCompat;
import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import android.util.Base64;

// Serviço em primeiro plano que faz a captura de tela de verdade — TEM
// que ser um Foreground Service (o Android mata qualquer captura de
// tela feita fora de um serviço assim, e desde a API 34/Android 14
// TEM que ser desse tipo específico "mediaProjection", declarado no
// AndroidManifest.xml).
//
// ORDEM CRÍTICA (regra rígida do Android 14+, quebrar ela faz o app
// derrubar com SecurityException, sem chance de recuperar):
//   1) já ter a permissão concedida (Intent guardado pelo
//      ScreenSharePlugin, ver pendingResultCode/pendingResultData)
//   2) chamar startForeground() AQUI PRIMEIRO
//   3) só DEPOIS pegar a MediaProjection de verdade a partir do
//      Intent guardado
// Essa ordem é respeitada abaixo em onStartCommand().
//
// Item pedido ("jeito mais fácil"): em vez da abordagem gráfica de
// baixo nível (OpenGL/EGL, como o próprio exemplo oficial do Agora
// faz), esse serviço só entrega os PIXELS da tela como imagens JPEG
// simples (via ImageReader — bem mais simples de implementar
// corretamente do que renderização de superfície com OpenGL) — quem
// transforma isso num vídeo de verdade é o lado JavaScript, desenhando
// cada imagem recebida num <canvas> (ver client/src/native/
// androidScreenShare.js).
public class ScreenCaptureService extends Service {

  public interface FrameListener {
    void onFrame(String base64Jpeg);
  }

  // Preenchidos pelo ScreenSharePlugin assim que a permissão do
  // sistema é concedida — este Service os lê ao iniciar.
  public static int pendingResultCode;
  public static Intent pendingResultData;
  public static FrameListener frameListener;

  private static final String CHANNEL_ID = "screen_share_channel";
  private static final int NOTIFICATION_ID = 9901;

  private MediaProjection mediaProjection;
  private VirtualDisplay virtualDisplay;
  private ImageReader imageReader;
  private HandlerThread captureThread;
  private Handler captureHandler;
  private long lastFrameSentAt = 0;
  private long minFrameIntervalMs = 166; // ~6 fps por padrão, ajustado pelo fps pedido

  @Override
  public IBinder onBind(Intent intent) {
    return null; // serviço "iniciado", não "vinculado" — ninguém precisa de uma conexão direta com ele
  }

  @Override
  public int onStartCommand(Intent intent, int flags, int startId) {
    createNotificationChannelIfNeeded();
    Notification notification = new NotificationCompat.Builder(this, CHANNEL_ID)
      .setContentTitle("Compartilhando sua tela")
      .setContentText("Toque para voltar ao Project Club")
      .setSmallIcon(android.R.drawable.ic_menu_camera)
      .setOngoing(true)
      .build();

    // PASSO 2 da ordem crítica: startForeground ANTES de pegar a
    // MediaProjection de verdade.
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      startForeground(NOTIFICATION_ID, notification, android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION);
    } else {
      startForeground(NOTIFICATION_ID, notification);
    }

    if (pendingResultData == null) {
      stopSelf();
      return START_NOT_STICKY;
    }

    int fps = intent != null ? intent.getIntExtra("fps", 6) : 6;
    final int quality = intent != null ? intent.getIntExtra("quality", 55) : 55;
    minFrameIntervalMs = 1000L / Math.max(1, fps);

    // PASSO 3: só agora, com o serviço já em primeiro plano, pega a
    // MediaProjection de verdade a partir da permissão concedida.
    MediaProjectionManager manager =
      (MediaProjectionManager) getSystemService(MEDIA_PROJECTION_SERVICE);
    mediaProjection = manager.getMediaProjection(pendingResultCode, pendingResultData);
    if (mediaProjection == null) {
      stopSelf();
      return START_NOT_STICKY;
    }
    // Callback vazio, só pra registrar — o Android recomenda/exige ter
    // um callback registrado antes de criar a VirtualDisplay, mesmo
    // sem nenhuma ação especial nele.
    mediaProjection.registerCallback(new MediaProjection.Callback() {
      @Override
      public void onStop() {
        stopSelf();
      }
    }, null);

    DisplayMetrics metrics = getResources().getDisplayMetrics();
    int width = metrics.widthPixels;
    int height = metrics.heightPixels;
    int densityDpi = metrics.densityDpi;

    captureThread = new HandlerThread("ScreenCaptureThread");
    captureThread.start();
    captureHandler = new Handler(captureThread.getLooper());

    imageReader = ImageReader.newInstance(width, height, PixelFormat.RGBA_8888, 2);
    imageReader.setOnImageAvailableListener(new ImageReader.OnImageAvailableListener() {
      @Override
      public void onImageAvailable(ImageReader reader) {
        handleNewFrame(reader, quality);
      }
    }, captureHandler);

    virtualDisplay = mediaProjection.createVirtualDisplay(
      "ProjectClubScreenShare", width, height, densityDpi,
      DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
      imageReader.getSurface(), null, captureHandler
    );

    return START_NOT_STICKY;
  }

  // Chamado toda vez que a tela muda e um novo frame fica pronto pra
  // ler — não vale a pena processar TODOS eles (a tela pode mudar
  // dezenas de vezes por segundo), então só processa quando já passou
  // tempo suficiente desde o último frame ENVIADO (throttle manual do
  // fps pedido).
  private void handleNewFrame(ImageReader reader, int quality) {
    Image image = null;
    try {
      image = reader.acquireLatestImage();
      if (image == null) return;

      long now = System.currentTimeMillis();
      if (now - lastFrameSentAt < minFrameIntervalMs || frameListener == null) {
        return; // descarta esse frame — ainda não é hora do próximo
      }
      lastFrameSentAt = now;

      Image.Plane plane = image.getPlanes()[0];
      ByteBuffer buffer = plane.getBuffer();
      int pixelStride = plane.getPixelStride();
      int rowStride = plane.getRowStride();
      int rowPadding = rowStride - pixelStride * image.getWidth();

      Bitmap rawBitmap = Bitmap.createBitmap(
        image.getWidth() + rowPadding / pixelStride, image.getHeight(), Bitmap.Config.ARGB_8888
      );
      rawBitmap.copyPixelsFromBuffer(buffer);
      // A largura "crua" acima inclui uma faixa extra de pixels de
      // preenchimento (row padding) que o ImageReader costuma
      // adicionar por alinhamento de memória — sem cortar ela fora,
      // sobra uma tira de pixels de lixo colada na borda direita da
      // imagem. Recorta pra largura EXATA da tela antes de comprimir.
      Bitmap bitmap = Bitmap.createBitmap(rawBitmap, 0, 0, image.getWidth(), image.getHeight());
      rawBitmap.recycle();

      ByteArrayOutputStream out = new ByteArrayOutputStream();
      bitmap.compress(Bitmap.CompressFormat.JPEG, quality, out);
      String base64 = Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
      bitmap.recycle();

      if (frameListener != null) {
        frameListener.onFrame(base64);
      }
    } catch (Exception e) {
      // Um frame ocasional falhando (ex: buffer temporariamente
      // indisponível) não deveria derrubar a captura inteira — só
      // pula esse frame e segue pro próximo.
    } finally {
      if (image != null) image.close();
    }
  }

  private void createNotificationChannelIfNeeded() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      NotificationChannel channel = new NotificationChannel(
        CHANNEL_ID, "Compartilhamento de tela", NotificationManager.IMPORTANCE_LOW
      );
      NotificationManager manager = getSystemService(NotificationManager.class);
      if (manager != null) manager.createNotificationChannel(channel);
    }
  }

  @Override
  public void onDestroy() {
    super.onDestroy();
    if (virtualDisplay != null) virtualDisplay.release();
    if (imageReader != null) imageReader.close();
    if (mediaProjection != null) mediaProjection.stop();
    if (captureThread != null) captureThread.quitSafely();
    virtualDisplay = null;
    imageReader = null;
    mediaProjection = null;
    pendingResultData = null;
    frameListener = null;
  }
}
