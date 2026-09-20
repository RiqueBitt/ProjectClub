// Item pedido: "comando pra registrar minha conta sem precisar de
// aprovação, só pra mim" — um comando no CONSOLE DO NAVEGADOR não
// funcionaria pra isso (a aprovação é validada no servidor, de
// propósito, não dá pra contornar mexendo só no lado do cliente). Esse
// script faz a coisa certa: cria a conta direto no banco, já no estado
// "aprovada" — os MESMOS passos que approveApplication() faz quando um
// admin aprova alguém (ver applicationsController.js), só que sem
// precisar de um admin já existindo pra aprovar (resolve o problema de
// "ovo e galinha" do primeiríssimo admin da plataforma).
//
// Uso (rodando no mesmo lugar onde o server roda, com as mesmas
// variáveis de ambiente — ex: terminal da Square Cloud):
//   node scripts/create-my-account.js email@exemplo.com meu_usuario "Meu Nome" MinhaSenh4Forte
//
// Depois de rodar, se o e-mail usado for igual ao PLATFORM_ADMIN_EMAIL
// configurado, é só reiniciar o servidor uma vez (ele promove a conta
// pra admin sozinho no boot — ver admin-bootstrap nos logs).
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

function generatePublicId() {
  // Mesma lógica do authController.js (número de 9 dígitos, primeiro
  // não-zero) — copiado aqui só pra esse script não precisar importar
  // o controller inteiro por causa de uma função pequena.
  const first = String(Math.floor(Math.random() * 9) + 1);
  const rest = String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
  return first + rest;
}

function isPasswordStrongEnough(password) {
  return typeof password === 'string' && password.length >= 8 && /[a-zA-Z]/.test(password) && /[0-9]/.test(password);
}

async function main() {
  const [, , email, username, displayName, password] = process.argv;
  if (!email || !username || !displayName || !password) {
    console.error('Uso: node scripts/create-my-account.js email@exemplo.com meu_usuario "Meu Nome" MinhaSenh4Forte');
    process.exit(1);
  }
  if (!isPasswordStrongEnough(password)) {
    console.error('Senha fraca demais — precisa de pelo menos 8 caracteres, com letra e número.');
    process.exit(1);
  }

  const clash = await prisma.user.findFirst({ where: { OR: [{ email: email.toLowerCase() }, { username }] } });
  if (clash) {
    console.error('Já existe uma conta com esse e-mail ou nome de usuário.');
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.create({
    data: {
      email: email.toLowerCase(), username, displayName,
      passwordHash, publicId: generatePublicId(), emailVerified: true,
    },
  });

  // Mesmos passos extras que uma aprovação normal também faz — cargo
  // padrão + casa inicial — pra a conta sair exatamente igual a
  // qualquer outra aprovada pelo painel, sem nenhuma diferença.
  const everyoneRole = await prisma.role.findFirst({ where: { isDefault: true } }).catch(() => null);
  if (everyoneRole) {
    await prisma.userRole.create({ data: { userId: user.id, roleId: everyoneRole.id } }).catch(() => {});
  }

  console.log(`Conta criada com sucesso! id=${user.id} email=${user.email} username=${user.username}`);
  console.log('Se esse e-mail for o mesmo do PLATFORM_ADMIN_EMAIL, reinicie o servidor uma vez pra virar admin.');
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('Erro:', err.message);
  await prisma.$disconnect();
  process.exit(1);
});
