const nodemailer = require('nodemailer');
const env = require('../config/env');

let transporter = null;

// Unfilled placeholder from the .env template — treated the same as "not
// configured" so a deploy that forgot to fill in real SMTP settings falls
// back to console-logging emails instead of crashing every register/login
// flow with `getaddrinfo ENOTFOUND smtp.seuservico.com`.
const PLACEHOLDER_HOSTS = new Set(['smtp.seuservico.com']);

function getTransporter() {
  if (transporter) return transporter;

  if (!env.SMTP_HOST || !env.SMTP_USER || PLACEHOLDER_HOSTS.has(env.SMTP_HOST)) {
    // No (real) SMTP configured (e.g. local dev, or a deploy that hasn't
    // filled in SMTP_HOST/SMTP_USER yet). Fall back to a transport that just
    // logs the email to the console so the flow is still testable end-to-end
    // instead of throwing and taking down register/login/password-reset.
    transporter = {
      sendMail: async (options) => {
        console.log('\n[email:dev-fallback] SMTP não configurado (ou ainda no placeholder) — imprimindo o e-mail em vez de enviá-lo.');
        console.log(`  To:      ${options.to}`);
        console.log(`  Subject: ${options.subject}`);
        console.log(`  Body:\n${options.text || options.html}\n`);
        return { messageId: 'dev-fallback' };
      },
    };
    return transporter;
  }

  transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
  });
  return transporter;
}

async function sendMail({ to, subject, text, html }) {
  const t = getTransporter();
  try {
    return await t.sendMail({ from: env.SMTP_FROM, to, subject, text, html });
  } catch (err) {
    // Give a concrete, actionable hint in the server log for the two most
    // common SMTP misconfigurations, instead of just the raw driver error.
    if (err.code === 'EAUTH') {
      console.error('[email] Falha de autenticação SMTP. Se estiver usando Gmail: a senha normal da conta NÃO funciona com SMTP — gere uma "senha de app" em https://myaccount.google.com/apppasswords (exige verificação em duas etapas ativada) e use ela em SMTP_PASS.');
    } else if (err.code === 'ENOTFOUND' || err.code === 'EDNS' || err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') {
      console.error(`[email] Não foi possível conectar ao host SMTP "${env.SMTP_HOST}:${env.SMTP_PORT}". Confira SMTP_HOST/SMTP_PORT no .env.`);
    }
    throw err;
  }
}

// Shared branded wrapper for every outgoing e-mail — table-based layout
// with inline styles on purpose (not a <style> block, not flexbox/grid):
// email clients (Outlook especially) strip or ignore modern CSS, so this is
// the boring-but-actually-renders-everywhere approach. Visually mirrors the
// app's brand color (--brand: #1877F2) on a plain white card since a dark
// background is unreliable across clients (Outlook/Gmail dark-mode both
// have a habit of inverting or clipping dark HTML emails unpredictably).
function emailLayout(bodyHtml) {
  return `<!DOCTYPE html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  </head>
  <body style="margin:0; padding:0; background-color:#e3e5e8; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#e3e5e8; padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px; background-color:#ffffff; border-radius:12px; overflow:hidden; box-shadow:0 2px 10px rgba(0,0,0,0.08);">
            <tr>
              <td style="background:linear-gradient(135deg,#1877F2,#145DBF); padding:32px; text-align:center;">
                <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 10px;">
                  <tr>
                    <td style="width:44px; height:44px; background-color:#ffffff; border-radius:12px; text-align:center; vertical-align:middle; font-size:20px; font-weight:800; color:#1877F2;">PC</td>
                  </tr>
                </table>
                <span style="font-size:20px; font-weight:800; color:#ffffff; letter-spacing:0.3px;">Project Club</span>
              </td>
            </tr>
            <tr>
              <td style="padding:36px 32px;">
                ${bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:18px 32px; background-color:#f7f7f8; text-align:center;">
                <span style="font-size:12px; color:#8a8f98; line-height:1.5;">
                  Você recebeu este e-mail porque uma conta do Project Club usa este endereço.<br />Se não foi você, pode ignorar com segurança.
                </span>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

async function sendVerificationCode(to, code) {
  const bodyHtml = `
    <p style="margin:0 0 8px; font-size:15px; color:#2e3338;">Olá! 👋</p>
    <p style="margin:0 0 24px; font-size:15px; color:#2e3338; line-height:1.5;">Use o código abaixo para confirmar seu e-mail e concluir seu cadastro no Project Club:</p>
    <div style="text-align:center; margin:0 0 24px;">
      <span style="display:inline-block; font-family:'Courier New',monospace; font-size:32px; font-weight:700; letter-spacing:8px; color:#1877F2; background-color:#fff4ec; padding:16px 20px; border-radius:8px;">${code}</span>
    </div>
    <p style="margin:0; font-size:13px; color:#8a8f98; line-height:1.5;">Este código expira em 15 minutos. Se você não solicitou isso, pode ignorar este e-mail com segurança — sua conta continua protegida.</p>
  `;
  return sendMail({
    to,
    subject: 'Confirme seu e-mail — Project Club',
    text: `Seu código de verificação é: ${code}

Este código expira em 15 minutos.

Se você não solicitou isso, ignore este e-mail.`,
    html: emailLayout(bodyHtml),
  });
}

async function sendPasswordReset(to, resetUrl) {
  const bodyHtml = `
    <p style="margin:0 0 8px; font-size:15px; color:#2e3338;">Olá!</p>
    <p style="margin:0 0 24px; font-size:15px; color:#2e3338; line-height:1.5;">Recebemos um pedido para redefinir a senha da sua conta Project Club. Clique no botão abaixo para escolher uma nova senha:</p>
    <div style="text-align:center; margin:0 0 24px;">
      <a href="${resetUrl}" style="display:inline-block; background:linear-gradient(135deg,#1877F2,#145DBF); color:#ffffff; text-decoration:none; font-weight:700; font-size:15px; padding:14px 36px; border-radius:8px;">Redefinir senha</a>
    </div>
    <p style="margin:0 0 6px; font-size:13px; color:#8a8f98;">Ou copie e cole este link no navegador:</p>
    <p style="margin:0 0 24px; font-size:13px; word-break:break-all;"><a href="${resetUrl}" style="color:#1877F2;">${resetUrl}</a></p>
    <p style="margin:0; font-size:13px; color:#8a8f98; line-height:1.5;">Este link expira em 1 hora. Se você não solicitou isso, ignore este e-mail — sua senha continua a mesma.</p>
  `;
  return sendMail({
    to,
    subject: 'Redefinição de senha — Project Club',
    text: `Clique no link para redefinir sua senha: ${resetUrl}

Este link expira em 1 hora. Se você não solicitou isso, ignore este e-mail.`,
    html: emailLayout(bodyHtml),
  });
}

async function sendApplicationApproved(to, loginUrl) {
  const bodyHtml = `
    <p style="margin:0 0 8px; font-size:15px; color:#2e3338;">Boas notícias! 🎉</p>
    <p style="margin:0 0 24px; font-size:15px; color:#2e3338; line-height:1.5;">Sua inscrição no Project Club foi <b>aprovada</b>! Sua conta já está ativa — clique no botão abaixo pra fazer login com o e-mail e a senha que você cadastrou no formulário.</p>
    <div style="text-align:center; margin:0 0 24px;">
      <a href="${loginUrl}" style="display:inline-block; background:linear-gradient(135deg,#1877F2,#145DBF); color:#ffffff; text-decoration:none; font-weight:700; font-size:15px; padding:14px 36px; border-radius:8px;">Entrar no Project Club</a>
    </div>
    <p style="margin:0; font-size:13px; color:#8a8f98; line-height:1.5;">Até já!</p>
  `;
  return sendMail({
    to,
    subject: 'Sua inscrição foi aprovada — Project Club',
    text: `Sua inscrição no Project Club foi aprovada! Sua conta já está ativa. Entre em: ${loginUrl}`,
    html: emailLayout(bodyHtml),
  });
}

async function sendApplicationRejected(to, reason) {
  const bodyHtml = `
    <p style="margin:0 0 8px; font-size:15px; color:#2e3338;">Olá,</p>
    <p style="margin:0 0 16px; font-size:15px; color:#2e3338; line-height:1.5;">Depois de analisar sua inscrição, não conseguimos aprovar sua entrada no Project Club desta vez.</p>
    ${reason ? `<p style="margin:0 0 24px; font-size:14px; color:#2e3338; background-color:#f7f7f8; padding:14px 16px; border-radius:8px; line-height:1.5;">${reason}</p>` : ''}
    <p style="margin:0; font-size:13px; color:#8a8f98; line-height:1.5;">Se quiser, você pode se inscrever novamente no futuro.</p>
  `;
  return sendMail({
    to,
    subject: 'Sobre sua inscrição — Project Club',
    text: `Depois de analisar sua inscrição, não conseguimos aprovar sua entrada no Project Club desta vez.${reason ? `\n\nMotivo: ${reason}` : ''}`,
    html: emailLayout(bodyHtml),
  });
}

module.exports = { sendMail, sendVerificationCode, sendPasswordReset, sendApplicationApproved, sendApplicationRejected };
