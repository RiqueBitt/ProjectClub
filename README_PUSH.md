# Como ativar push notification real no Android

O código já está todo pronto (banco de dados, servidor, app) — só falta
um projeto Firebase de verdade, que só você pode criar (é grátis).

## 1. Criar o projeto Firebase
1. Acesse https://console.firebase.google.com e crie um projeto novo
   (qualquer nome, ex: "Project Club")
2. Dentro do projeto, clique em "Adicionar app" → ícone do Android
3. Nome do pacote Android: `com.projectclub.app` (tem que ser exatamente
   esse, é o que já está configurado no app)
4. Baixe o arquivo `google-services.json` que ele oferece no final

## 2. Gerar a chave de conta de serviço (pro servidor conseguir enviar)
1. No Firebase, vá em ⚙️ (engrenagem) → **Configurações do projeto** →
   aba **Contas de serviço**
2. Clique em **Gerar nova chave privada** — baixa um arquivo `.json`

## 3. Me passar os dois arquivos
Me mande o conteúdo dos dois arquivos (`google-services.json` e a chave
de conta de serviço) que eu configuro os 2 Secrets que faltam:

- `GOOGLE_SERVICES_JSON_BASE64` (no repositório **ProjectClub**) — o
  `google-services.json` codificado em base64
- `FIREBASE_SERVICE_ACCOUNT_JSON` (no servidor, variável de ambiente
  `.env` — não é Secret do GitHub, é do servidor mesmo) — o conteúdo
  inteiro do arquivo da chave de conta de serviço, numa linha só

Depois disso, o próximo build do Android já sai com push notification
funcionando — não precisa mexer em mais nada.

---

## Web Push (navegador / PWA) — sem Firebase

Além do FCM do Android, o site e o app instalado (PWA) recebem push pelo padrão
**Web Push (VAPID)** — Chrome, Edge, Firefox, Samsung Internet e Safari 16+
(no iPhone só com o site adicionado à Tela de Início).

- **Não precisa configurar nada**: na primeira vez o servidor gera o par de
  chaves VAPID e guarda na tabela `WebPushKeys`. Se preferir fixar, defina
  `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` e `VAPID_SUBJECT` (`mailto:...`).
- A pessoa liga em **Configurações → Notificações → Notificações push**.
- O service worker `client/public/sw.js` só cuida de push (não faz cache)
  e **não mostra** a notificação se alguma aba do app estiver visível.
- Rotas: `GET /api/push/web/public-key`, `POST /api/push/web/subscribe`,
  `POST /api/push/web/unsubscribe`. Assinaturas mortas (404/410) são
  apagadas sozinhas no envio.
- Instalar como app: **Configurações → Sistema → Instalar como aplicativo**
  (ou a sugestão que aparece a partir do 3º uso).
