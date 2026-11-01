// Texto simples de anúncio: parágrafos por linha em branco, quebras de linha
// mantidas e links http(s) clicáveis. Sem HTML do usuário.
const URL_RE = /(https?:\/\/[^\s<]+)/g;
export default function AnunciosRichText({ text }) {
  const paras = String(text || '').split(/\n{2,}/);
  return (
    <div className="an-text">
      {paras.map((p, i) => (
        <p key={i}>
          {p.split(URL_RE).map((part, j) => (/^https?:\/\//.test(part)
            ? <a key={j} href={part} target="_blank" rel="noreferrer">{part}</a>
            : <span key={j}>{part}</span>))}
        </p>
      ))}
    </div>
  );
}
