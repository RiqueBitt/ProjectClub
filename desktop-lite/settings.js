'use strict';
// Configurações locais do Project Club Lite (um JSON pequeno na pasta do
// usuário): aceleração por hardware e se a placa de vídeo já travou antes.
// Separado do main.js pra dar pra testar sem o Electron.
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  // null = automático: liga, e desliga sozinho se a placa de vídeo travar.
  gpu: null,
  gpuCrashes: 0,
  startWithSystem: false,
};

function createSettings(dir) {
  const file = path.join(dir, 'lite-settings.json');
  let data = { ...DEFAULTS };
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (raw && typeof raw === 'object') data = { ...DEFAULTS, ...raw };
  } catch { /* primeira vez ou arquivo estragado: usa o padrão */ }

  const save = () => {
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(data, null, 2));
    } catch { /* sem disco: fica só na memória */ }
  };

  return {
    get: (key) => data[key],
    set(key, value) { data[key] = value; save(); },
    // Usar a placa de vídeo? Desligado à mão, ou automático depois de 2 travadas.
    useGpu: () => (data.gpu === null ? data.gpuCrashes < 2 : !!data.gpu),
    noteGpuCrash() { data.gpuCrashes = (data.gpuCrashes || 0) + 1; save(); return data.gpuCrashes; },
  };
}

module.exports = { createSettings, DEFAULTS };
