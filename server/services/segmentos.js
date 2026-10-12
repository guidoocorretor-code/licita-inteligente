// Classificação automática de segmento por palavras-chave do objeto.
// É uma ESTIMATIVA (exibida como tal na interface) — não substitui CATMAT/CATSER.
import { semAcento } from '../lib/texto.js';

// Obras: palavra inteira, no texto sem acento. Antes era pedaço de palavra e errava muito:
// "mão de obra" (portaria), "manobra", "Construction" (software), "obras pirotécnicas" (fogos).
const OBRAS = /(?<![a-z])(obras?|engenharia|paviment\w*|reforma\w*|construc(ao|oes)|construir|construid\w*|construtora|drenagem|edifica\w*|asfalt\w*|terraplen\w*|pontes?|calcament\w*|recapeament\w*|servicos remanescentes|forros?|manutencao predial|alvenaria|impermeabiliza\w*|demolic\w*|revitaliza\w*|urbaniza\w*)(?![a-z])/;
// Nome de órgão no objeto também não é obra ("para a Secretaria de Obras", "DER-ES, Departamento de Edificações")
const NAO_E_OBRA = /m[aã]o[- ]de[- ]obra|secretaria(?: \w+)? de obras|departamento de edificacoes(?: e (?:de )?rodovias)?|obras? pirotecnic\w*|obras? (literari|audiovisua|de arte\b(?! especia))\w*/g;
// Seguro de imóvel/edificação é seguro, não obra
const SEGURO = /(?<![a-z])seguros?(?![a-z])/;
const REGRAS = [
  ['Financeiro e seguros', (t) => SEGURO.test(t)],
  ['Obras e engenharia', (t) => OBRAS.test(t.replace(NAO_E_OBRA, ' '))],
  ['Saúde', /medicament|hospitalar|odontol|saude|saúde|enfermag|laborat|insumos? medic|vacina|ortese|prótese|protese|farmac/i],
  ['Tecnologia da informação', /software|informática|informatica|computador|notebook|licenç|sistema de gest|rede lógica|servidor|ti\b|tecnologia da informa|impressora|toner|nobreak/i],
  ['Alimentação', /aliment|merenda|gênero|genero alimen|refeiç|hortifr|carne|lanche|café|cafe\b|água mineral|agua mineral/i],
  ['Limpeza e conservação', /limpeza|higien|conservação|conservacao|zeladoria|dedetiza|copeiragem/i],
  ['Veículos e combustíveis', /veícul|veicul|combust|pneu|automot|ônibus|onibus|ambulância|ambulancia|locação de veic|manutenção de frota|frota/i],
  ['Material de escritório e expediente', /expediente|escritório|escritorio|papel|papelaria|material de consumo/i],
  ['Mobiliário e equipamentos', /mobili|cadeira|mesa\b|armário|armario|eletrodom|ar[- ]condicionado|climatiza/i],
  ['Educação e cultura', /escolar|didátic|didatic|pedagóg|pedagog|livro|uniforme|cultural|esport/i],
  ['Segurança e vigilância', /vigilânc|vigilanc|segurança patrimonial|monitoramento|câmera|camera|cftv|alarme/i],
  ['Serviços gerais e terceirização', /mão de obra|mao de obra|terceiriz|recepç|portaria|motorista|apoio administrativ/i],
  ['Comunicação e eventos', /publicidade|evento|gráfic|grafic|comunicação|comunicacao|sonoriza|palco|show/i],
  ['Agro e meio ambiente', /agrícol|agricol|semente|adubo|fertiliz|ambiental|resíduo|residuo|coleta de lixo|poda/i],
  ['Financeiro e seguros', /seguro|cartões|cartoes|cartão|cartao|bancári|bancari|consórcio|consorcio/i],
];

export function classificarSegmento(objeto) {
  if (!objeto) return null;
  const t = semAcento(objeto);
  for (const [nome, re] of REGRAS) if (typeof re === 'function' ? re(t) : re.test(objeto)) return nome;
  return 'Outros';
}
export const SEGMENTOS = [...new Set(REGRAS.slice(1).map(([n]) => n)), 'Outros']; // 1ª regra (seguro) é só prioridade
// Mudou a regra: reclassifica o que já está no banco (uma vez, em segundo plano)
export const VERSAO_SEGMENTOS = 202610122;

/** Reclassifica um lote; devolve o último id visto (null = acabou). */
export function reclassificarSegmentos(conn, aposId = 0, lote = 2000) {
  const linhas = conn.prepare('SELECT id, objeto, segmento FROM licitacoes WHERE id > ? ORDER BY id LIMIT ?').all(aposId, lote);
  const up = conn.prepare('UPDATE licitacoes SET segmento=? WHERE id=?');
  let mudou = 0;
  for (const l of linhas) { const s = classificarSegmento(l.objeto); if (s !== l.segmento) { up.run(s, l.id); mudou++; } }
  return { ultimoId: linhas.length ? linhas[linhas.length - 1].id : null, mudou, fim: linhas.length < lote };
}

export function reclassificarSegmentosEmSegundoPlano(conn, { lote = 2000, log = console.log } = {}) {
  if (conn.prepare('SELECT 1 FROM schema_migrations WHERE versao=?').get(VERSAO_SEGMENTOS)) return;
  let aposId = 0; let total = 0;
  const passo = () => {
    try {
      const r = reclassificarSegmentos(conn, aposId, lote);
      total += r.mudou; if (r.ultimoId != null) aposId = r.ultimoId;
      if (!r.fim) return setTimeout(passo, 30);
      conn.prepare('INSERT OR IGNORE INTO schema_migrations (versao) VALUES (?)').run(VERSAO_SEGMENTOS);
      log(`Segmentos revisados: ${total} licitação(ões) mudaram de nicho.`);
    } catch (e) { log(`Falha ao revisar segmentos: ${e.message}`); }
  };
  setTimeout(passo, 2000);
}
