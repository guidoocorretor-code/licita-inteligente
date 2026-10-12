// Estratégia do robô de lance (a mesma regra na área de teste e, depois, na extensão do navegador).
// Regras do Compras.gov.br para lances (IN SLTI 3/2011, art. 2º; TCU, Acórdão 86/2017): no mínimo 20 s entre lances
// do mesmo licitante e 3 s depois do melhor lance de outro licitante; fora disso o portal descarta o lance.
// Regras do Guido (12/10/2026): o robô só dá lance nos últimos 40 s e nunca abaixo do preço mínimo (piso).

export const PADRAO = { disparo: 40, intervaloProprio: 20, intervaloMelhor: 3 };

const centavos = (v) => Math.round(v * 100) / 100;
const paraBaixo = (v) => Math.floor(v * 100 + 1e-6) / 100;

/** Valor do próximo lance: o melhor lance menos o decremento (em R$ ou %), arredondado para baixo no centavo. */
export function proximoValor(melhor, { decremento = 0.01, decrementoPct = null } = {}) {
  const d = decrementoPct != null ? melhor * (decrementoPct / 100) : decremento;
  return paraBaixo(melhor - Math.max(0.01, d));
}

/**
 * Decide o que fazer agora.
 * estado: { restante (s), agora (s), piso, meuLance, meuLanceEm (s), melhor, melhorEhMeu, melhorEm (s) }
 * config: { decremento | decrementoPct, disparo, intervaloProprio, intervaloMelhor }
 * Devolve { acao: 'aguardar' | 'lance' | 'parar', valor?, motivo }.
 */
export function decidir(estado, config = {}) {
  const c = { ...PADRAO, ...config };
  const { restante, agora, piso, meuLance, meuLanceEm, melhor, melhorEhMeu, melhorEm } = estado;
  if (!(piso > 0)) return { acao: 'parar', motivo: 'Informe o preço mínimo (piso) antes de ligar o robô.' };
  if (restante <= 0) return { acao: 'parar', motivo: 'Disputa encerrada.' };
  if (melhorEhMeu) return { acao: 'aguardar', motivo: 'Você está em 1º lugar.' };
  if (melhor != null && melhor <= piso) return { acao: 'parar', motivo: `Melhor lance (${melhor.toFixed(2)}) está no seu piso ou abaixo: o robô não acompanha.` };
  if (restante > c.disparo) return { acao: 'aguardar', motivo: `Aguardando os últimos ${c.disparo} s.` };
  if (meuLanceEm != null && agora - meuLanceEm < c.intervaloProprio) return { acao: 'aguardar', motivo: `Intervalo de ${c.intervaloProprio} s entre os seus lances.` };
  if (melhorEm != null && agora - melhorEm < c.intervaloMelhor) return { acao: 'aguardar', motivo: `Intervalo de ${c.intervaloMelhor} s depois do melhor lance.` };
  const alvo = melhor != null ? proximoValor(melhor, c) : meuLance;
  const valor = centavos(Math.max(piso, alvo));
  if (meuLance != null && valor >= meuLance) return { acao: 'parar', motivo: 'Não há valor abaixo do seu último lance acima do piso.' };
  return { acao: 'lance', valor, motivo: valor === piso ? 'Lance no seu piso.' : `Cobrindo o melhor lance (${melhor?.toFixed(2)}).` };
}
