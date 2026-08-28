const prisma = require('../config/prisma');

const DEFAULTS = {
  PC: { railOrder: [], railHidden: [], sidebarWidth: 280, membersWidth: 240, membersDefaultOpen: true },
  MOBILE: { railOrder: [], railHidden: [], sidebarWidth: 280, membersWidth: 240, membersDefaultOpen: true },
};

function parseRow(row, device) {
  if (!row) return { device, ...DEFAULTS[device], panelPositions: {} };
  return {
    device,
    railOrder: JSON.parse(row.railOrder || '[]'),
    railHidden: JSON.parse(row.railHidden || '[]'),
    sidebarWidth: row.sidebarWidth,
    membersWidth: row.membersWidth,
    membersDefaultOpen: row.membersDefaultOpen,
    panelPositions: JSON.parse(row.panelPositions || '{}'),
  };
}

// Pública — todo mundo carrega isso ao abrir o site, pra aplicar o layout
// que a staff configurou (não é só uma preferência pessoal de quem edita).
async function getUiLayout(req, res, next) {
  try {
    const rows = await prisma.uiLayoutConfig.findMany();
    const byDevice = Object.fromEntries(rows.map((r) => [r.device, r]));
    res.json({
      PC: parseRow(byDevice.PC, 'PC'),
      MOBILE: parseRow(byDevice.MOBILE, 'MOBILE'),
    });
  } catch (err) { next(err); }
}

// Só staff — salva a configuração de um dos dois modos (PC ou Mobile) de
// uma vez, sobrescrevendo o que já tinha.
async function updateUiLayout(req, res, next) {
  try {
    const { device } = req.params;
    if (!['PC', 'MOBILE'].includes(device)) return res.status(400).json({ error: 'Dispositivo inválido.' });
    const { railOrder, railHidden, sidebarWidth, membersWidth, membersDefaultOpen, panelPositions } = req.body;

    const data = {
      railOrder: JSON.stringify(railOrder || []),
      railHidden: JSON.stringify(railHidden || []),
      sidebarWidth: parseInt(sidebarWidth, 10) || 280,
      membersWidth: parseInt(membersWidth, 10) || 240,
      membersDefaultOpen: !!membersDefaultOpen,
      panelPositions: JSON.stringify(panelPositions || {}),
    };
    const row = await prisma.uiLayoutConfig.upsert({
      where: { device }, update: data, create: { device, ...data },
    });

    req.app.get('io')?.emit('ui-layout:update', { device, config: parseRow(row, device) });
    res.json({ config: parseRow(row, device) });
  } catch (err) { next(err); }
}

async function resetUiLayout(req, res, next) {
  try {
    const { device } = req.params;
    if (!['PC', 'MOBILE'].includes(device)) return res.status(400).json({ error: 'Dispositivo inválido.' });
    await prisma.uiLayoutConfig.deleteMany({ where: { device } });
    const config = { device, ...DEFAULTS[device], panelPositions: {} };
    req.app.get('io')?.emit('ui-layout:update', { device, config });
    res.json({ config });
  } catch (err) { next(err); }
}

module.exports = { getUiLayout, updateUiLayout, resetUiLayout };
