// Cliente da API REST da Shard Cloud (https://shardcloud.app/api).
// Rotas e formatos vêm do CLI oficial (github.com/shard-cloud/cli), que usa
// exatamente esta API: Bearer token no header Authorization.
const BASE = process.env.SHARDCLOUD_API_BASE || 'https://shardcloud.app/api';

export class ShardError extends Error {
  constructor(status, body, path) { super(`Shard Cloud ${status} em ${path}: ${typeof body === 'string' ? body.slice(0, 400) : JSON.stringify(body).slice(0, 400)}`); this.status = status; this.body = body; }
}

export function createShard(token = process.env.SHARDCLOUD_API_KEY) {
  if (!token) throw new Error('SHARDCLOUD_API_KEY não configurada.');

  async function call(method, path, { json, body, headers = {}, raw = false, timeoutMs = 60000 } = {}) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(BASE + path, {
        method,
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
        body: json !== undefined ? JSON.stringify(json) : body,
        signal: ctrl.signal,
      });
      if (raw) return res;
      const text = await res.text();
      let data = text;
      try { data = text ? JSON.parse(text) : null; } catch { /* texto cru */ }
      if (!res.ok) throw new ShardError(res.status, data, path);
      return data;
    } finally { clearTimeout(t); }
  }

  const multipartZip = (zipBuffer, field = 'project', filename = 'app.zip') => {
    const fd = new FormData();
    fd.append(field, new Blob([zipBuffer], { type: 'application/zip' }), filename);
    return fd;
  };

  return {
    // ---- conta ----
    me: () => call('GET', '/user/me'),
    // ---- apps ----
    listApps: () => call('GET', '/apps?q=true'),
    getApp: (id) => call('GET', `/apps/${id}?q=true`),
    createAppFromZip: (zipBuffer) => call('POST', '/apps', { body: multipartZip(zipBuffer), timeoutMs: 300000 }),
    updateAppCode: (id, zipBuffer) => call('PUT', `/apps/${id}/file`, { body: multipartZip(zipBuffer), timeoutMs: 300000 }),
    deleteApp: (id) => call('DELETE', `/apps/${id}`),
    appStatus: (id) => call('GET', `/apps/${id}/status`),
    setAppStatus: (id, status) => call('POST', `/apps/${id}/status`, { json: { status } }), // start | stop | restart
    appMetrics: (id, minutes) => call('GET', `/apps/${id}/metrics${minutes ? `?minutes=${minutes}` : ''}`),
    appDeploys: (id) => call('GET', `/apps/${id}/deploys`),
    restoreDeploy: (id, deployId) => call('POST', `/apps/${id}/deploys/${deployId}/restore`),
    updateAppResources: (id, req) => call('PUT', `/apps/${id}/resources`, { json: req }),
    updateAppVersion: (id, language, version) => call('PUT', `/apps/${id}/version`, { json: { language, version } }),
    languageVersions: (language) => call('GET', `/apps/versions?language=${encodeURIComponent(language)}`),
    enableWeb: (id, subdomain) => call('POST', `/apps/${id}/web`, { json: { subdomain } }),
    disableWeb: (id) => call('DELETE', `/apps/${id}/web`),
    getEnvs: (id) => call('GET', `/apps/${id}/envs`),
    putEnvs: (id, envs) => call('PUT', `/apps/${id}/envs`, { json: envs }),
    httpLogs: (id, startHoursAgo = 24, endHoursAgo = 0, cursor = '') => call('GET', `/apps/${id}/http-logs?start_time=${startHoursAgo}&end_time=${endHoursAgo}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`),
    // SSE: coleta por alguns segundos e devolve o texto.
    async logs(id, seconds = 5) {
      const res = await call('GET', `/apps/${id}/logs`, { raw: true, headers: { Accept: 'text/event-stream' }, timeoutMs: (seconds + 5) * 1000 });
      if (!res.ok) throw new ShardError(res.status, await res.text(), `/apps/${id}/logs`);
      return readSse(res, seconds * 1000);
    },
    async exec(id, command, seconds = 60) {
      const res = await call('POST', `/apps/${id}/exec`, { json: { command }, raw: true, headers: { Accept: 'text/event-stream' }, timeoutMs: (seconds + 5) * 1000 });
      if (!res.ok) throw new ShardError(res.status, await res.text(), `/apps/${id}/exec`);
      return readSse(res, seconds * 1000, (ev) => ev && ev.done);
    },
    // ---- bancos ----
    listDatabases: () => call('GET', '/databases'),
    getDatabase: (id) => call('GET', `/databases/${id}/`),
    createDatabase: (req) => call('POST', '/databases', { json: req }), // { type: postgres|mysql|mongo|redis, ram, password, visualizer, name }
    deleteDatabase: (id) => call('DELETE', `/databases/${id}/`),
    stopDatabase: (id) => call('POST', `/databases/${id}/stop`),
    startDatabase: (id) => call('POST', `/databases/${id}/initialize`),
    databaseStatus: (id) => call('GET', `/databases/${id}/status`),
    databaseMetrics: (id, minutes) => call('GET', `/databases/${id}/metrics${minutes ? `?minutes=${minutes}` : ''}`),
    changeDatabasePassword: (id, password) => call('PUT', `/databases/${id}/password`, { json: { password } }),
    databaseConnectionUrl: (id) => call('GET', `/databases/${id}/connection-url`),
    updateDatabaseResources: (id, ram, vcpu) => call('PUT', `/databases/${id}/resources`, { json: { ram, vcpu } }),
    enableVisualizer: (id) => call('POST', `/databases/${id}/visualizer`),
    // ---- backups (apps, bancos e VMs usam a mesma rota) ----
    listBackups: (resourceId) => call('GET', `/project/${resourceId}/backups`),
    createBackup: (resourceId, req = {}) => call('POST', `/project/${resourceId}/backups`, { json: req }),
    restoreBackup: (resourceId, backupId, req = {}) => call('POST', `/project/${resourceId}/backups/${backupId}/restore`, { json: req }),
    deleteBackup: (resourceId, backupId) => call('DELETE', `/project/${resourceId}/backups/${backupId}`),
    backupDownloadUrl: (resourceId, backupId) => call('GET', `/project/${resourceId}/backups/${backupId}/download`),
    // ---- VMs (básico) ----
    listVms: () => call('GET', '/vms'),
    getVm: (id) => call('GET', `/vms/${id}`),
    _call: call,
  };
}

// Lê um stream SSE até `ms` ou até `stop(evento)` devolver true.
async function readSse(res, ms, stop) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = ''; const lines = [];
  const deadline = Date.now() + ms;
  try {
    while (Date.now() < deadline) {
      const remaining = deadline - Date.now();
      const chunk = await Promise.race([reader.read(), new Promise((r) => setTimeout(() => r({ done: true, timeout: true }), remaining))]);
      if (chunk.done) break;
      buf += dec.decode(chunk.value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, i).trimEnd(); buf = buf.slice(i + 1);
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        let ev = payload;
        try { ev = JSON.parse(payload); } catch { /* texto */ }
        lines.push(typeof ev === 'string' ? ev : (ev.output ?? ev.message ?? JSON.stringify(ev)));
        if (stop && stop(ev)) return lines.join('\n');
      }
    }
  } finally { try { await reader.cancel(); } catch { /* ok */ } }
  return lines.join('\n');
}
