# Abre o instalador como uma pessoa abriria (com as telas), clica em "Instalar", espera terminar e
# fecha na última tela sem abrir o app. Devolve em JSON os textos que apareceram em cada tela e
# salva uma foto de cada uma. Usado pelo check-installer.js (cenário "telas"), no CI.
param(
  [Parameter(Mandatory = $true)][string]$Installer,
  [Parameter(Mandatory = $true)][string]$Shots,
  [Parameter(Mandatory = $true)][string]$InstalledExe,
  [int]$TimeoutSec = 420
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class PcWin {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern IntPtr GetDlgItem(IntPtr h, int id);
  [DllImport("user32.dll")] public static extern int GetDlgCtrlID(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindowEnabled(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr h, EnumProc cb, IntPtr l);
  [DllImport("user32.dll", CharSet = CharSet.Unicode, EntryPoint = "SendMessageW")] public static extern IntPtr SendText(IntPtr h, uint msg, IntPtr w, StringBuilder l);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  // WM_GETTEXT: é o jeito de ler o texto de um controle de OUTRO programa (GetWindowText só lê o título).
  public static string Text(IntPtr h) { var s = new StringBuilder(4096); SendText(h, 0x000D, (IntPtr)s.Capacity, s); return s.ToString(); }
  public static string Class(IntPtr h) { var s = new StringBuilder(256); GetClassName(h, s, s.Capacity); return s.ToString(); }
  public static List<IntPtr> Children(IntPtr h) {
    var list = new List<IntPtr>();
    EnumChildWindows(h, (c, l) => { list.Add(c); return true; }, IntPtr.Zero);
    return list;
  }
}
"@

$WM_COMMAND = 0x0111; $BM_SETCHECK = 0x00F1; $NEXT_BUTTON = 1
New-Item -ItemType Directory -Force -Path $Shots | Out-Null

function Get-Texts([IntPtr]$window) {
  $texts = @()
  foreach ($child in [PcWin]::Children($window)) {
    if (-not [PcWin]::IsWindowVisible($child)) { continue }
    $text = [PcWin]::Text($child)
    if ($text.Trim()) { $texts += $text }
  }
  return $texts
}

function Save-Shot([IntPtr]$window, [string]$name) {
  try {
    [PcWin]::SetForegroundWindow($window) | Out-Null
    Start-Sleep -Milliseconds 400
    $rect = New-Object PcWin+RECT
    [PcWin]::GetWindowRect($window, [ref]$rect) | Out-Null
    $width = $rect.Right - $rect.Left; $height = $rect.Bottom - $rect.Top
    if ($width -le 0 -or $height -le 0) { return }
    $bitmap = New-Object System.Drawing.Bitmap $width, $height
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bitmap.Size)
    $bitmap.Save((Join-Path $Shots "$name.png"), [System.Drawing.Imaging.ImageFormat]::Png)
    $graphics.Dispose(); $bitmap.Dispose()
  } catch { [Console]::Error.WriteLine("foto ${name}: $($_.Exception.Message)") }
}

$deadline = (Get-Date).AddSeconds($TimeoutSec)
$process = Start-Process -FilePath $Installer -PassThru
try {
  # 1) A janela do instalador aparece.
  $window = [IntPtr]::Zero
  while ($window -eq [IntPtr]::Zero) {
    if ((Get-Date) -gt $deadline) { throw 'a janela do instalador não apareceu' }
    if ($process.HasExited) { throw "o instalador fechou sozinho antes de mostrar a janela (código $($process.ExitCode))" }
    Start-Sleep -Milliseconds 500
    $process.Refresh()
    $window = $process.MainWindowHandle
  }
  Start-Sleep -Seconds 2
  $title = [PcWin]::Text($window)
  $startTexts = Get-Texts $window
  $startButton = [PcWin]::Text([PcWin]::GetDlgItem($window, $NEXT_BUTTON))
  Save-Shot $window 'instalador-1-inicio'

  # 2) Clica no botão da frente ("Instalar").
  [PcWin]::PostMessage($window, $WM_COMMAND, [IntPtr]$NEXT_BUTTON, [IntPtr]::Zero) | Out-Null
  Start-Sleep -Seconds 2
  Save-Shot $window 'instalador-2-instalando'
  $progressTexts = Get-Texts $window

  # 3) Espera a instalação acabar: o app está no lugar e o botão da frente voltou a ficar ativo.
  while ($true) {
    if ((Get-Date) -gt $deadline) { throw 'a instalação não terminou a tempo' }
    if ($process.HasExited) { throw "o instalador fechou antes da tela final (código $($process.ExitCode))" }
    $button = [PcWin]::GetDlgItem($window, $NEXT_BUTTON)
    if ((Test-Path -LiteralPath $InstalledExe) -and [PcWin]::IsWindowEnabled($button) -and ([PcWin]::Text($button) -ne $startButton)) { break }
    Start-Sleep -Seconds 1
  }
  Start-Sleep -Seconds 2
  $finishTexts = Get-Texts $window
  $finishButton = [PcWin]::Text([PcWin]::GetDlgItem($window, $NEXT_BUTTON))
  Save-Shot $window 'instalador-3-fim'

  # 4) Desmarca "abrir o Project Club" e conclui (no CI o app não deve abrir aqui).
  $unchecked = 0
  foreach ($child in [PcWin]::Children($window)) {
    if ([PcWin]::Class($child) -ne 'Button' -or -not [PcWin]::IsWindowVisible($child)) { continue }
    if ([PcWin]::GetDlgCtrlID($child) -in 1, 2, 3) { continue }
    [PcWin]::SendMessage($child, $BM_SETCHECK, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
    $unchecked++
  }
  $closedByItself = $false
  if ($unchecked -gt 0) {
    [PcWin]::PostMessage($window, $WM_COMMAND, [IntPtr]$NEXT_BUTTON, [IntPtr]::Zero) | Out-Null
    $closedByItself = $process.WaitForExit(20000)
  }
  if (-not $closedByItself -and -not $process.HasExited) { Stop-Process -Id $process.Id -Force }

  [pscustomobject]@{
    title = $title; startButton = $startButton; finishButton = $finishButton
    start = @($startTexts); progress = @($progressTexts); finish = @($finishTexts)
    closedByItself = $closedByItself
  } | ConvertTo-Json -Compress -Depth 4
} catch {
  if (-not $process.HasExited) {
    try { Save-Shot $process.MainWindowHandle 'instalador-erro' } catch { }
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
  }
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}
