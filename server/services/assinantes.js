// Quem assina pela empresa assessorada. Não há mais um "responsável legal" digitado à parte no cadastro:
// os assinantes saem da lista de sócios (nome, CPF, sócio administrador, assina sozinho ou em conjunto)
// e são escolhidos em cada documento. Cadastros antigos com resp_nome/resp_cpf continuam funcionando.
const t = (v) => String(v ?? '').trim();
const soDigitos = (v) => String(v ?? '').replace(/\D/g, '');
const mesmoNome = (a, b) => t(a).toLowerCase().replace(/\s+/g, ' ') === t(b).toLowerCase().replace(/\s+/g, ' ');

/** Sócios do cadastro; o CPF do antigo "responsável legal" completa o sócio de mesmo nome que estiver sem CPF. */
export function sociosDoCliente(c) {
  let lista = [];
  try { lista = c?.socios_json ? JSON.parse(c.socios_json) : []; } catch { lista = []; }
  if (!Array.isArray(lista)) lista = [];
  return lista.filter((s) => t(s?.nome)).map((s) => ({
    nome: t(s.nome),
    cpf: soDigitos(s.cpf) || (mesmoNome(s.nome, c.resp_nome) ? soDigitos(c.resp_cpf) : ''),
    qualificacao: t(s.qualificacao) || null,
    administrador: !!s.administrador || /administrador/i.test(s.qualificacao || ''),
    assinatura: s.assinatura === 'isolada' || s.assinatura === 'conjunta' ? s.assinatura : null,
    email: t(s.email) || null, telefone: t(s.telefone) || null,
  }));
}

const comoAssinante = (s) => ({ nome: s.nome, cpf: s.cpf || '', cargo: s.qualificacao || (s.administrador ? 'Sócio-Administrador' : 'Sócio'),
  email: s.email || null, telefone: s.telefone || null });

/**
 * Sugestão de quem assina, pelo que está marcado nos sócios:
 * sócio administrador que assina sozinho > os administradores que assinam em conjunto > o primeiro administrador
 * > o antigo responsável legal > o primeiro sócio.
 */
export function assinantesPadrao(c) {
  const socios = sociosDoCliente(c);
  const adm = socios.filter((s) => s.administrador);
  const isolado = adm.find((s) => s.assinatura === 'isolada');
  if (isolado) return [comoAssinante(isolado)];
  const conjunta = adm.filter((s) => s.assinatura === 'conjunta');
  if (conjunta.length) return conjunta.map(comoAssinante);
  if (adm.length) return [comoAssinante(adm[0])];
  if (t(c?.resp_nome)) {
    const s = socios.find((x) => mesmoNome(x.nome, c.resp_nome));
    return [s ? comoAssinante(s) : { nome: t(c.resp_nome), cpf: soDigitos(c.resp_cpf), cargo: t(c.resp_cargo) || 'Representante legal', email: c.resp_email || null, telefone: c.resp_telefone || null }];
  }
  return socios.length ? [comoAssinante(socios[0])] : [];
}

/** Assinantes escolhidos no documento (pelos nomes); sem escolha válida, a sugestão. */
export function escolherAssinantes(c, nomes) {
  if (Array.isArray(nomes) && nomes.length) {
    const socios = sociosDoCliente(c);
    const escolhidos = nomes.map((n) => socios.find((s) => mesmoNome(s.nome, n))).filter(Boolean);
    if (escolhidos.length) return escolhidos.map(comoAssinante);
  }
  return assinantesPadrao(c);
}

/** Pessoa para "A/C" e saudação de e-mails: o primeiro assinante sugerido. */
export function contatoPrincipal(c) {
  return assinantesPadrao(c)[0] || null;
}
