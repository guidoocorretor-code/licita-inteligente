// Gestão de lances · ÁREA DE TESTE: simulador de disputa com concorrentes FICTÍCIOS para treinar a estratégia
// do robô (mesma regra que a extensão vai usar no portal: web/js/robo-estrategia.js). Nada aqui envia lance real.
import { h, render, toast } from './ui.js';
import { decidir, PADRAO } from './robo-estrategia.js';

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const brl = (v) => (v == null ? '—' : BRL.format(v));
const lerNum = (t) => { const s = String(t ?? '').trim(); if (!s) return null; const n = Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s); return Number.isFinite(n) ? n : null; };
const fmtNum = (v) => (v == null ? '' : String(v).replace('.', ','));
const relogio = (s) => `${String(Math.floor(Math.max(0, s) / 60)).padStart(2, '0')}:${String(Math.max(0, s) % 60).padStart(2, '0')}`;

export async function lances(alvo, rota) {
  const q = rota.query;
  const campo = (rot, valor, dica) => { const i = h('input', { type: 'text', inputmode: 'decimal', value: valor, title: dica || '' }); return [i, h('div', {}, h('label', { class: 'pequeno' }, rot), i)]; };
  const [inProposta, cProposta] = campo('Minha proposta inicial (R$)', q.get('proposta') || '1000,00');
  const [inPiso, cPiso] = campo('Meu preço mínimo / piso (R$)', q.get('piso') || '850,00', 'O robô nunca dá lance abaixo disso. Use o preço mínimo de venda da cotação.');
  const [inDec, cDec] = campo('Diminuir a cada lance (R$)', '1,00', 'Quanto abaixo do melhor lance o robô oferece');
  const modoSel = h('select', {}, h('option', { value: 'aberto' }, 'Aberto: lance nos últimos 2 min prorroga 2 min'), h('option', { value: 'fixo' }, 'Fim fixo (sem prorrogação)'));
  const durSel = h('select', {}, [[120, '2 min'], [180, '3 min'], [300, '5 min'], [600, '10 min']].map(([v, t]) => h('option', { value: v, selected: v === 180 }, t)));
  const velSel = h('select', {}, [[1, 'tempo real'], [5, '5× mais rápido'], [10, '10× mais rápido']].map(([v, t]) => h('option', { value: v, selected: v === 5 }, t)));
  // Concorrentes fictícios: proposta inicial, piso e agressividade (chance de dar lance a cada segundo quando perde)
  const conc = [
    { nome: 'Concorrente A (fictício)', proposta: 1020, piso: 880, agress: 0.25 },
    { nome: 'Concorrente B (fictício)', proposta: 990, piso: 905, agress: 0.15 },
    { nome: 'Concorrente C (fictício)', proposta: 1050, piso: 860, agress: 0.08 },
  ];
  const linhasConc = conc.map((c) => {
    const p = h('input', { type: 'text', value: fmtNum(c.proposta), style: { width: '90px' } });
    const pi = h('input', { type: 'text', value: fmtNum(c.piso), style: { width: '90px' } });
    const ag = h('select', {}, [[0.05, 'calmo'], [0.15, 'médio'], [0.3, 'agressivo']].map(([v, t]) => h('option', { value: v, selected: Math.abs(v - c.agress) < 0.06 }, t)));
    return { c, p, pi, ag, el: h('tr', {}, h('td', {}, c.nome), h('td', {}, p), h('td', {}, pi), h('td', {}, ag)) };
  });

  const painel = h('div', {});
  const log = h('ol', { class: 'log-lances', reversed: true });
  let timer = null; let sim = null;

  const parar = (motivo) => { clearInterval(timer); timer = null; if (sim) sim.ativo = false; if (motivo) registrar(`⏹ ${motivo}`, 'fim'); desenhar(); };
  const registrar = (txt, tipo = '') => { log.prepend(h('li', { class: tipo }, h('span', { class: 'suave' }, sim ? `${relogio(sim.restante)} · ` : ''), txt)); };

  const iniciar = () => {
    const proposta = lerNum(inProposta.value); const piso = lerNum(inPiso.value); const dec = lerNum(inDec.value);
    if (!(proposta > 0) || !(piso > 0) || piso > proposta) return toast('Confira: proposta e piso maiores que zero, e piso menor ou igual à proposta.', 6000);
    if (linhasConc.some((l) => !(lerNum(l.p.value) > 0) || !(lerNum(l.pi.value) > 0) || lerNum(l.pi.value) > lerNum(l.p.value))) return toast('Confira os concorrentes: proposta e piso maiores que zero, e piso menor ou igual à proposta.', 6000);
    log.replaceChildren();
    sim = { ativo: true, robo: true, agora: 0, restante: Number(durSel.value), modo: modoSel.value, piso, dec: dec || 0.01,
      participantes: [{ nome: 'Você', eu: true, lance: proposta, em: null },
        ...linhasConc.map((l) => ({ nome: l.c.nome, lance: lerNum(l.p.value), proposta: lerNum(l.p.value), piso: lerNum(l.pi.value), agress: Number(l.ag.value), em: null }))],
      melhorEm: null, lancesMeus: 0 };
    registrar('▶ Disputa simulada iniciada (concorrentes fictícios).');
    clearInterval(timer);
    timer = setInterval(passo, 1000 / Number(velSel.value));
    desenhar();
  };

  const melhor = () => sim.participantes.reduce((m, p) => (p.lance != null && (m == null || p.lance < m.lance) ? p : m), null);
  const darLance = (p, valor) => {
    p.lance = Math.round(valor * 100) / 100; p.em = sim.agora; sim.melhorEm = sim.agora;
    if (p.eu) sim.lancesMeus++;
    registrar(`${p.eu ? '🤖 Robô' : p.nome}: ${brl(p.lance)}`, p.eu ? 'meu' : '');
    // Modo aberto: lance nos últimos 2 minutos prorroga a disputa por 2 minutos
    // (só registra quando a prorrogação devolve 30 s ou mais, para o registro não ficar poluído)
    if (sim.modo === 'aberto' && sim.restante <= 120) { if (sim.restante <= 90) registrar(`⏱ Prorrogação: relógio volta a 02:00.`, 'info'); sim.restante = 120; }
  };

  const passo = () => {
    sim.agora++; sim.restante--;
    if (sim.restante <= 0) { const m = melhor(); parar(m.eu ? `Encerrada: você venceu com ${brl(m.lance)} (${sim.lancesMeus} lance(s) do robô).` : `Encerrada: ${m.nome} venceu com ${brl(m.lance)}. Seu último lance: ${brl(sim.participantes[0].lance)}.`); return; }
    // Concorrentes: dão lance com alguma chance quando não estão em 1º, respeitando 20 s e o próprio piso
    for (const p of sim.participantes.filter((x) => !x.eu)) {
      const m = melhor();
      if (m === p || (p.em != null && sim.agora - p.em < PADRAO.intervaloProprio) || (sim.melhorEm != null && sim.agora - sim.melhorEm < PADRAO.intervaloMelhor)) continue;
      // Quanto mais perto do próprio piso, menos o concorrente arrisca (senão a disputa nunca chega aos últimos 40 s)
      const folga = Math.max(0, (p.lance - p.piso) / Math.max(1, p.proposta - p.piso));
      const urgencia = sim.restante <= 40 ? 2 : 1;
      if (Math.random() < p.agress * urgencia * folga * folga) {
        const v = Math.max(p.piso, m.lance - (0.5 + Math.random() * 4));
        if (v < p.lance && v < m.lance) darLance(p, v);
      }
    }
    // Robô
    const eu = sim.participantes[0]; const m = melhor();
    if (sim.robo) {
      const d = decidir({ restante: sim.restante, agora: sim.agora, piso: sim.piso, meuLance: eu.lance, meuLanceEm: eu.em, melhor: m.lance, melhorEhMeu: m === eu, melhorEm: sim.melhorEm }, { decremento: sim.dec });
      sim.ultimaDecisao = d;
      if (d.acao === 'lance') darLance(eu, d.valor);
      else if (d.acao === 'parar' && d.motivo !== sim.ultimoAviso) { registrar(`⚠ Robô parou: ${d.motivo}`, 'alerta'); sim.robo = false; sim.ultimoAviso = d.motivo; }
    }
    desenhar();
  };

  const desenhar = () => {
    if (!sim) { render(painel, h('div', { class: 'vazio' }, 'Configure e clique em "Iniciar simulação".')); return; }
    const ranking = [...sim.participantes].sort((a, b) => a.lance - b.lance);
    render(painel,
      h('div', { class: 'placar-lances' },
        h('div', { class: `relogio-lances ${sim.restante <= PADRAO.disparo ? 'final' : ''}` }, relogio(sim.restante)),
        h('div', {}, h('div', { class: 'pequeno suave' }, 'Robô'), h('strong', {}, sim.robo && sim.ativo ? '🟢 ligado' : '⚪ desligado'),
          sim.ultimaDecisao ? h('div', { class: 'pequeno' }, sim.ultimaDecisao.motivo) : null),
        h('div', { class: 'linha' },
          sim.ativo ? h('button', { class: 'btn', onclick: () => { sim.robo = !sim.robo; sim.ultimoAviso = null; registrar(sim.robo ? '🤖 Robô ligado.' : '✋ Robô desligado (você assume).'); desenhar(); } }, sim.robo ? 'Desligar robô' : 'Ligar robô') : null,
          sim.ativo ? h('button', { class: 'btn perigo', onclick: () => parar('Parada pelo usuário.') }, '⏹ Parar tudo') : null)),
      h('table', { class: 'ranking-lances' }, h('thead', {}, h('tr', {}, ['Posição', 'Participante', 'Lance atual', 'Piso'].map((t) => h('th', {}, t)))),
        h('tbody', {}, ranking.map((p, k) => h('tr', { class: p.eu ? 'eu' : '' }, h('td', {}, `${k + 1}º`), h('td', {}, p.nome), h('td', { class: 'num' }, brl(p.lance)),
          h('td', { class: 'num suave' }, p.eu ? brl(sim.piso) : `${brl(p.piso)} (fictício)`))))));
  };

  render(alvo,
    h('div', { class: 'cabecalho-pagina' }, h('div', {}, h('h1', {}, 'Gestão de lances'),
      h('p', { class: 'suave' }, 'Área de teste do robô: disputa simulada com concorrentes fictícios. Nada aqui envia lance ao portal.'))),
    h('div', { class: 'aviso amarelo' }, h('strong', {}, 'SIMULAÇÃO. '), `Regras do robô: só dá lance nos últimos ${PADRAO.disparo} s; espera ${PADRAO.intervaloProprio} s entre os seus lances e ${PADRAO.intervaloMelhor} s depois do melhor lance (regras do Compras.gov.br); nunca passa do seu piso. O modo real (extensão no seu navegador, com você logado no portal) vem depois desta etapa.`),
    h('div', { class: 'grade duas', style: { marginTop: '14px' } },
      h('div', { class: 'cartao' }, h('h2', {}, 'Configuração'),
        h('div', { class: 'grade duas' }, cProposta, cPiso, cDec, h('div', {}, h('label', { class: 'pequeno' }, 'Modo da disputa'), modoSel),
          h('div', {}, h('label', { class: 'pequeno' }, 'Tempo inicial'), durSel), h('div', {}, h('label', { class: 'pequeno' }, 'Velocidade'), velSel)),
        h('h3', {}, 'Concorrentes fictícios'),
        h('div', { class: 'tabela-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Nome', 'Proposta', 'Piso', 'Estilo'].map((t) => h('th', {}, t)))), h('tbody', {}, linhasConc.map((l) => l.el)))),
        h('div', { class: 'linha', style: { marginTop: '10px' } }, h('button', { class: 'btn primario', onclick: iniciar }, '▶ Iniciar simulação'))),
      h('div', { class: 'cartao' }, h('h2', {}, 'Disputa'), painel, h('h3', {}, 'Registro'), log)));
  desenhar();
  // Ao sair da página, o simulador para
  window.addEventListener('hashchange', () => { clearInterval(timer); }, { once: true });
}
