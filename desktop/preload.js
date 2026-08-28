// Preload vazio de propósito — a janela só carrega o site hospedado
// normal (mesmo HTML/JS/CSS de quem acessa pelo navegador), sem nenhuma
// ponte extra entre o site e o sistema operacional. contextIsolation
// ligado (ver main.js) já garante que o conteúdo da página nunca tem
// acesso direto a APIs do Node/Electron — só o próprio Chromium comum.
