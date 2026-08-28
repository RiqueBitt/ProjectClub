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
