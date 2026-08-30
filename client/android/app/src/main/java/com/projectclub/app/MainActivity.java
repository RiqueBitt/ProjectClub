package com.projectclub.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    // Item pedido: compartilhamento de tela no Android — registra o
    // plugin nativo criado especificamente pra isso (ScreenSharePlugin.
    // java + ScreenCaptureService.java, nesta mesma pasta).
    registerPlugin(ScreenSharePlugin.class);
    super.onCreate(savedInstanceState);
  }
}
