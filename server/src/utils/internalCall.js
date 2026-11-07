// Executa um handler de rota já existente "por dentro" (sem HTTP), com um
// `res` falso que só captura status + corpo. Usado pelos endpoints que
// juntam várias respostas numa só (GET /api/bootstrap, GET
// /api/users/:id/summary): cada seção continua vindo EXATAMENTE do mesmo
// código das rotas antigas (mesmas permissões, mesmo formato), só que
// numa única requisição — e com uma única checagem de login (requireAuth
// busca o usuário no banco a cada requisição).
function runHandler(handler, req, { params, query } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (status, body) => {
      if (done) return;
      done = true;
      resolve({ status, body });
    };
    const headers = {};
    const res = {
      statusCode: 200,
      locals: {},
      status(code) { this.statusCode = code; return this; },
      json(body) { finish(this.statusCode, body); return this; },
      send(body) { finish(this.statusCode, body); return this; },
      end() { finish(this.statusCode, undefined); return this; },
      sendStatus(code) { this.statusCode = code; finish(code, undefined); return this; },
      set(k, v) { if (typeof k === 'string') headers[k.toLowerCase()] = v; return this; },
      setHeader(k, v) { headers[String(k).toLowerCase()] = v; return this; },
      header(k, v) { return this.set(k, v); },
      get(k) { return headers[String(k).toLowerCase()]; },
      getHeader(k) { return headers[String(k).toLowerCase()]; },
      append() { return this; },
      vary() { return this; },
    };
    // Objeto derivado do req real: mantém user/app/headers/ip etc, mas com
    // params/query próprios da seção (sem vazar entre seções).
    const subReq = Object.create(req);
    subReq.params = params || {};
    subReq.query = query || {};
    subReq.body = {};
    const next = (err) => {
      if (err) finish(err.status || err.statusCode || 500, { error: err.expose === false ? 'Erro interno.' : (err.message || 'Erro interno.') });
      else finish(404, undefined);
    };
    try {
      const out = handler(subReq, res, next);
      if (out && typeof out.catch === 'function') out.catch((err) => next(err || new Error('erro')));
    } catch (err) {
      next(err);
    }
  });
}

module.exports = { runHandler };
