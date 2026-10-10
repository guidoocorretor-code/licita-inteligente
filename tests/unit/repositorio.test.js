import test from 'node:test';
import assert from 'node:assert/strict';
import { bancoMemoria, fixture, clonar } from '../helpers.js';
import { normalizarPncp, normalizarCompras14133, normalizarItemPncp } from '../../server/services/normalizacao.js';
import { salvarLicitacao, salvarItens, salvarDocumentos, recalcularStatusTemporais } from '../../server/services/repositorio.js';

const AGORA = '2026-10-10T12:00:00';

test('importação e persistência do registro real', () => {
  const db = bancoMemoria();
  const bruto = fixture('pncp-contratacao-real');
  const r = salvarLicitacao(db, normalizarPncp(bruto), 'pncp', bruto, AGORA);
  assert.equal(r.acao, 'inserido');
  const l = db.prepare('SELECT * FROM licitacoes WHERE id=?').get(r.id);
  assert.equal(l.status_calculado, 'aberta');
  assert.equal(l.segmento, 'Financeiro e seguros');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM licitacao_eventos WHERE tipo=?').get('publicacao').n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM orgaos').get().n, 1);
});

test('deduplicação: mesma contratação vinda do PNCP e do Compras.gov.br vira um único registro com duas origens', () => {
  const db = bancoMemoria();
  const compras = fixture('compras14133-real');
  // Dado de TESTE derivado: o mesmo processo no formato PNCP (construído a partir do registro real do Compras.gov.br)
  const pncp = {
    numeroControlePNCP: compras.numeroControlePNCP, anoCompra: 2026, sequencialCompra: 108, numeroCompra: '34',
    orgaoEntidade: { cnpj: compras.orgaoEntidadeCnpj, razaoSocial: compras.orgaoEntidadeRazaoSocial, esferaId: 'F', poderId: 'E' },
    unidadeOrgao: { ufSigla: 'PB', municipioNome: 'Pombal', codigoUnidade: '158301', nomeUnidade: compras.unidadeOrgaoNomeUnidade, codigoIbge: '2512101' },
    modalidadeId: 8, modalidadeNome: 'Dispensa', objetoCompra: compras.objetoCompra, valorTotalEstimado: 6351.15,
    situacaoCompraId: 1, situacaoCompraNome: 'Divulgada no PNCP', dataPublicacaoPncp: '2026-09-01T07:26:01',
    dataAberturaProposta: '2026-09-01T08:00:00', dataEncerramentoProposta: '2026-09-04T08:00:00', usuarioNome: 'Compras.gov.br',
    amparoLegal: { nome: 'Lei 14.133/2021, Art. 75, III, a' },
  };
  const a = salvarLicitacao(db, normalizarPncp(pncp), 'pncp', pncp, AGORA);
  const b = salvarLicitacao(db, normalizarCompras14133(compras), 'comprasgov_14133', compras, AGORA);
  assert.equal(a.id, b.id);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM licitacoes').get().n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM licitacao_fontes WHERE licitacao_id=?').get(a.id).n, 2);
  const l = db.prepare('SELECT * FROM licitacoes WHERE id=?').get(a.id);
  assert.equal(l.municipio, 'Pombal');               // fonte secundária NÃO sobrescreve PNCP
  assert.equal(l.valor_homologado, 6195.2);           // mas complementa o que faltava
  assert.equal(l.fonte_principal, 'pncp');
  // reimportar a mesma coisa não duplica nem gera alteração
  assert.equal(salvarLicitacao(db, normalizarPncp(pncp), 'pncp', pncp, AGORA).acao, 'inalterado');
});

test('atualização: alteração de prazo gera evento e recalcula status', () => {
  const db = bancoMemoria();
  const bruto = fixture('pncp-contratacao-real');
  const { id } = salvarLicitacao(db, normalizarPncp(bruto), 'pncp', bruto, AGORA);
  const mod = clonar(bruto); mod.dataEncerramentoProposta = '2026-10-05T10:00:00';
  const r = salvarLicitacao(db, normalizarPncp(mod), 'pncp', mod, AGORA);
  assert.equal(r.acao, 'atualizado');
  const ev = db.prepare("SELECT * FROM licitacao_eventos WHERE licitacao_id=? AND campo='data_encerramento_proposta'").get(id);
  assert.equal(ev.valor_anterior, '2026-10-23T13:30:00');
  assert.equal(ev.valor_novo, '2026-10-05T10:00:00');
  assert.equal(db.prepare('SELECT status_calculado s FROM licitacoes WHERE id=?').get(id).s, 'prazo_encerrado');
  // suspensão oficial
  const susp = clonar(mod); susp.situacaoCompraId = 4; susp.situacaoCompraNome = 'Suspensa';
  salvarLicitacao(db, normalizarPncp(susp), 'pncp', susp, AGORA);
  assert.equal(db.prepare('SELECT status_calculado s FROM licitacoes WHERE id=?').get(id).s, 'suspensa');
  assert.ok(db.prepare("SELECT 1 FROM licitacao_eventos WHERE licitacao_id=? AND tipo='situacao'").get(id));
});

test('itens oficiais desertos levam à classificação deserta, com evento de resultado', () => {
  const db = bancoMemoria();
  const bruto = fixture('pncp-contratacao-real');
  const { id } = salvarLicitacao(db, normalizarPncp(bruto), 'pncp', bruto, '2026-11-01T00:00:00');
  const item = fixture('pncp-item-real');
  salvarItens(db, id, [normalizarItemPncp(item)], 'pncp', '2026-11-01T00:00:00');
  let l = db.prepare('SELECT * FROM licitacoes WHERE id=?').get(id);
  assert.equal(l.status_calculado, 'em_disputa');
  assert.equal(l.valor_estimado, null);               // orçamento sigiloso em todos os itens
  assert.equal(l.valor_estimado_situacao, 'sigiloso');
  assert.equal(l.me_epp_exclusivo, 0);
  const deserto = { ...item, situacaoCompraItem: 4, situacaoCompraItemNome: 'Deserto' };
  salvarItens(db, id, [normalizarItemPncp(deserto)], 'pncp', '2026-11-01T00:00:00');
  l = db.prepare('SELECT * FROM licitacoes WHERE id=?').get(id);
  assert.equal(l.status_calculado, 'deserta');
  assert.ok(db.prepare("SELECT 1 FROM licitacao_eventos WHERE licitacao_id=? AND tipo='resultado'").get(id));
});

test('documentos: primeira carga sem eventos; documento novo gera evento', () => {
  const db = bancoMemoria();
  const bruto = fixture('pncp-contratacao-real');
  const { id } = salvarLicitacao(db, normalizarPncp(bruto), 'pncp', bruto, AGORA);
  salvarDocumentos(db, id, [{ sequencial: 1, url: 'https://x/1', tipo: 'Edital' }]);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM licitacao_eventos WHERE tipo='documento'").get().n, 0);
  salvarDocumentos(db, id, [{ sequencial: 1, url: 'https://x/1', tipo: 'Edital' }, { sequencial: 2, url: 'https://x/2', tipo: 'Errata' }]);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM licitacao_eventos WHERE tipo='documento'").get().n, 1);
  assert.equal(db.prepare('SELECT tem_documentos t FROM licitacoes WHERE id=?').get(id).t, 1);
});

test('status temporais são reavaliados com o passar do tempo', () => {
  const db = bancoMemoria();
  const bruto = fixture('pncp-contratacao-real');
  const { id } = salvarLicitacao(db, normalizarPncp(bruto), 'pncp', bruto, AGORA);
  recalcularStatusTemporais(db, '2026-10-24T00:00:00');
  assert.equal(db.prepare('SELECT status_calculado s FROM licitacoes WHERE id=?').get(id).s, 'prazo_encerrado');
});
