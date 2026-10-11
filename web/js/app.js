import { api, clienteSelecionado, selecionarCliente } from './api.js';
import { h, toast, definirSistemas } from './ui.js';
import * as P from './paginas.js';
import * as E from './empresas.js';
import * as F from './fornecedores.js';
import * as PR from './propostas.js';

export const estado = { usuario: null, empresa: null, meta: null, clientes: [] };

// Menu completo. Módulos ainda não implementados aparecem com a fase prevista e NÃO simulam funcionamento.
const MENU = [
  ['Cadastro'],
  ['empresas', 'Empresa'],
  ['Oportunidades'],
  ['dashboard', 'Dashboard'],
  ['buscar', 'Buscar licitações'],
  ['jornal', 'Jornal de licitações'],
  ['oportunidades', 'Minhas oportunidades'],
  ['favoritos', 'Favoritos'],
  ['kanban', 'Kanban'],
  ['notificacoes', 'Alertas'],
  ['Gestão'],
  ['calendario', 'Calendário'],
  ['documentos', 'Vencimentos'],
  ['fornecedores', 'Fornecedores'],
  ['cotacoes', 'Cotações', null, true],
  ['precos', 'Análise de mercado'],
  ['lances', 'Gestão de lances', 5],
  ['propostas', 'Propostas'],
  ['Inteligência'],
  ['pagometro', 'Pagômetro'],
  ['ia-edital', 'Análise de edital por IA', 4],
  ['ia-juridico', 'Assistente jurídico', 4],
  ['financeiro', 'Financeiro', 5],
  ['relatorios', 'Relatórios', 5],
  ['Administração'],
  ['fontes', 'Fontes de dados'],
  ['configuracoes', 'Configurações'],
];

const ROTAS = {
  dashboard: P.dashboard, buscar: P.buscar, licitacao: P.detalhe, jornal: P.jornal, favoritos: P.favoritos,
  kanban: P.kanban, empresas: E.empresas, documentos: E.vencimentos, oportunidades: P.kanban, calendario: P.calendario, fornecedores: F.fornecedores, cotacoes: F.cotacoes, cotacao: F.cotacao, propostas: PR.propostas, proposta: PR.proposta, precos: P.precos, pagometro: P.pagometro, notificacoes: P.notificacoes, fontes: P.fontes, configuracoes: P.configuracoes,
};

function rotaAtual() {
  const [nome, ...resto] = (location.hash.replace(/^#\/?/, '') || 'dashboard').split('/');
  const [base, query] = nome.split('?');
  return { nome: base, args: resto, query: new URLSearchParams(location.hash.split('?')[1] || '') , _q: query };
}

// Empresa assessorada em foco: Kanban, favoritos, alertas, calendário e vencimentos mostram só os dela
function seletorEmpresa() {
  const atual = clienteSelecionado();
  const lista = estado.clientes.filter((c) => c.ativo || String(c.id) === atual);
  const sel = h('select', { id: 'seletor-empresa', 'aria-label': 'Empresa em foco', title: 'Mostrar só o Kanban, favoritos, alertas e vencimentos desta empresa',
    onchange: (e) => { selecionarCliente(e.target.value); document.body.classList.toggle('com-empresa', !!e.target.value); navegar(); atualizarSino(); } },
  h('option', { value: '' }, 'Todas as empresas'),
  lista.map((c) => h('option', { value: c.id, selected: String(c.id) === atual }, c.nome_fantasia || c.razao_social)));
  document.body.classList.toggle('com-empresa', !!atual);
  return sel;
}
export async function recarregarEmpresas() {
  try { estado.clientes = (await api('/clientes')).clientes; } catch { estado.clientes = []; }
  if (clienteSelecionado() && !estado.clientes.some((c) => String(c.id) === clienteSelecionado())) selecionarCliente('');
  const velho = document.getElementById('seletor-empresa');
  if (velho) velho.replaceWith(seletorEmpresa());
}

function montarLayout() {
  const app = document.getElementById('app');
  const lateral = h('nav', { class: 'lateral', 'aria-label': 'Menu principal' },
    h('div', { class: 'marca' }, h('img', { src: '/icons/icon.svg', alt: '' }), estado.meta?.appName || 'Licita Inteligente'),
    h('div', { class: 'menu' }, MENU.map(([id, rot, fase, sub]) => {
      if (!rot) return h('div', { class: 'secao', role: 'heading', 'aria-level': '2' }, id);
      return h('a', { href: `#/${id}`, 'data-rota': id, class: [fase ? 'futuro' : '', sub ? 'sub' : ''].filter(Boolean).join(' ') }, rot, fase ? h('span', { class: 'fase', title: `Previsto para a Fase ${fase}` }, `Fase ${fase}`) : null);
    })));
  const busca = h('input', { type: 'search', placeholder: 'Busca rápida no objeto, órgão ou município…', 'aria-label': 'Busca global' });
  const topo = h('header', { class: 'topo' },
    h('button', { class: 'btn botao-menu', 'aria-label': 'Abrir menu', onclick: () => lateral.classList.toggle('aberta') }, '☰'),
    h('form', { onsubmit: (e) => { e.preventDefault(); location.hash = `#/buscar?q=${encodeURIComponent(busca.value)}`; } }, busca),
    h('div', { class: 'acoes-topo' },
      seletorEmpresa(),
      h('a', { class: 'btn', href: '#/notificacoes', id: 'sino', title: 'Alertas' }, '🔔'),
      h('span', { class: 'nome-usuario suave pequeno' }, `${estado.usuario.nome} · ${estado.empresa?.nome || ''}`),
      h('button', { class: 'btn', onclick: sair }, 'Sair')));
  const conteudo = h('main', { class: 'conteudo', id: 'conteudo' });
  lateral.addEventListener('click', (e) => { if (e.target.closest('a')) lateral.classList.remove('aberta'); });
  app.replaceChildren(h('div', { class: 'layout' }, lateral, h('div', { class: 'principal' }, topo, conteudo)));
}

async function navegar() {
  if (!estado.usuario) return;
  const r = rotaAtual();
  document.querySelectorAll('.menu a').forEach((a) => a.classList.toggle('ativo', a.dataset.rota === r.nome || (r.nome === 'cotacao' && a.dataset.rota === 'cotacoes') || (r.nome === 'proposta' && a.dataset.rota === 'propostas')));
  const alvo = document.getElementById('conteudo');
  const pagina = ROTAS[r.nome];
  const item = MENU.find(([id]) => id === r.nome);
  try {
    if (pagina) await pagina(alvo, r, estado);
    else if (item?.[2]) P.emDesenvolvimento(alvo, item[1], item[2]);
    else { location.hash = '#/dashboard'; }
  } catch (e) {
    alvo.replaceChildren(h('div', { class: 'aviso vermelho' }, e.message));
  }
  window.scrollTo(0, 0);
}

async function sair() {
  try { await api('/auth/logout', { metodo: 'POST', corpo: {} }); } catch { /* ignora */ }
  estado.usuario = null; telaLogin();
}

function telaLogin(msg) {
  const email = h('input', { type: 'email', required: true, autocomplete: 'username', id: 'email' });
  const senha = h('input', { type: 'password', required: true, autocomplete: 'current-password', id: 'senha' });
  const erro = h('div', { class: 'aviso vermelho', style: { display: msg ? 'block' : 'none' } }, msg || '');
  const botao = h('button', { class: 'btn primario', type: 'submit', style: { width: '100%', justifyContent: 'center' } }, 'Entrar');
  const form = h('form', {
    onsubmit: async (e) => {
      e.preventDefault(); botao.disabled = true; erro.style.display = 'none';
      try {
        await api('/auth/login', { metodo: 'POST', corpo: { email: email.value, senha: senha.value } });
        await iniciar();
      } catch (er) { erro.textContent = er.message; erro.style.display = 'block'; }
      finally { botao.disabled = false; }
    },
  },
  h('div', { class: 'marca', style: { color: 'var(--cor-primaria)', padding: '0 0 12px' } }, h('img', { src: '/icons/icon.svg', alt: '' }), 'Licita Inteligente'),
  h('p', { class: 'suave' }, 'Inteligência e gestão de licitações públicas.'),
  erro,
  h('div', { class: 'campo' }, h('label', { for: 'email' }, 'E-mail'), email),
  h('div', { class: 'campo' }, h('label', { for: 'senha' }, 'Senha'), senha),
  botao,
  h('p', { class: 'suave pequeno' }, 'Acesso restrito. Contas são criadas pelo administrador da empresa.'));
  document.getElementById('app').replaceChildren(h('div', { class: 'tela-login' }, h('div', { class: 'cartao' }, form)));
}

async function atualizarSino() {
  try {
    const n = (await api('/notificacoes')).filter((x) => !x.lida).length;
    const s = document.getElementById('sino');
    if (s) s.textContent = n ? `🔔 ${n}` : '🔔';
  } catch { /* ignora */ }
}

async function iniciar() {
  try {
    const eu = await api('/auth/eu');
    estado.usuario = eu.usuario; estado.empresa = eu.empresa;
    estado.meta = await api('/meta'); definirSistemas(estado.meta.sistemas);
  } catch { return telaLogin(); }
  await recarregarEmpresas();
  montarLayout();
  await navegar();
  atualizarSino();
}

window.addEventListener('hashchange', navegar);
window.addEventListener('sessao-expirada', () => { if (estado.usuario) { estado.usuario = null; telaLogin('Sua sessão expirou. Entre novamente.'); } });
window.addEventListener('atualizar-sino', atualizarSino);
window.addEventListener('empresas-alteradas', recarregarEmpresas);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
iniciar();
export { toast };
