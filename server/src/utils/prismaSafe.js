// Gravações idempotentes contra corrida de UNIQUE (erro P2002 do Prisma).
//
// No MySQL o prisma.X.upsert() NÃO vira um "INSERT ... ON DUPLICATE KEY
// UPDATE" de verdade: o Prisma faz SELECT → (INSERT | UPDATE) em passos
// separados. Duas requisições iguais chegando juntas (clique duplo, app
// reenviando, dois aparelhos) passam as duas pelo SELECT "não existe" e a
// segunda estoura "Unique constraint failed" (P2002) → erro 500 à toa.
// Foi o que aconteceu em produção no POST /api/push/register.
//
// safeUpsert faz o upsert normal e, se perder a corrida (P2002), aplica o
// `update` na linha que o outro acabou de criar — o resultado final é o
// mesmo que teria sido com um upsert atômico. Se a linha sumir entre um
// passo e outro (P2025, alguém apagou), tenta o upsert inteiro de novo.

const isUniqueViolation = (err) => err?.code === 'P2002';
const isNotFound = (err) => err?.code === 'P2025';

async function safeUpsert(delegate, args, { retries = 2 } = {}) {
  const { where, update, select, include } = args;
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await delegate.upsert(args);
    } catch (err) {
      if (!isUniqueViolation(err) || attempt >= retries) throw err;
      try {
        return await delegate.update({ where, data: update || {}, ...(select ? { select } : {}), ...(include ? { include } : {}) });
      } catch (err2) {
        if (!isNotFound(err2) || attempt + 1 >= retries) throw err2;
        // a linha que causou o P2002 foi apagada no meio — tenta de novo.
      }
    }
  }
}

// create que pode ser "repetido" (curtir/reagir/favoritar duas vezes):
// se já existir, não é erro — devolve null (ou o que `onDuplicate` der).
async function createIgnoreDuplicate(delegate, args, onDuplicate) {
  try {
    return await delegate.create(args);
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    return onDuplicate ? onDuplicate(err) : null;
  }
}

module.exports = { safeUpsert, createIgnoreDuplicate, isUniqueViolation };
