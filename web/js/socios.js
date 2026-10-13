// Lista editável de sócios, usada no cadastro da empresa (Empresas Assessoradas) e no passo 1 da Captação.
// A Receita traz nome e qualificação; CPF e forma de assinatura vêm do contrato social.
import { h, toast } from './ui.js';

const fmtCpf = (c) => String(c || '').replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');

/**
 * Devolve { caixa, botao, adicionar, ler, valido, preencherDaReceita }.
 * aoUsar(socio): se informado, cada sócio ganha o botão "Usar como representante".
 */
export function editorSocios(socios = [], { aoUsar } = {}) {
  const caixa = h('div', { class: 'lista-socios' });
  const itens = [];
  const linha = (sc) => {
    const el = {
      nome: h('input', { value: sc.nome || '', placeholder: 'Nome completo', 'aria-label': 'Nome do sócio' }),
      cpf: h('input', { value: sc.cpf ? fmtCpf(sc.cpf) : '', inputmode: 'numeric', placeholder: '000.000.000-00', 'aria-label': 'CPF do sócio' }),
      qualificacao: h('input', { value: sc.qualificacao || '', placeholder: 'ex.: Sócio-Administrador', 'aria-label': 'Qualificação' }),
      email: h('input', { type: 'email', value: sc.email || '', placeholder: 'E-mail', 'aria-label': 'E-mail do sócio' }),
      telefone: h('input', { type: 'tel', value: sc.telefone || '', placeholder: 'Telefone / WhatsApp', 'aria-label': 'Telefone do sócio' }),
      administrador: h('input', { type: 'checkbox', checked: !!sc.administrador }),
      assinatura: h('select', { 'aria-label': 'Forma de assinatura' }, [['', 'Assinatura: não informada'], ['isolada', 'Assina sozinho'], ['conjunta', 'Assina em conjunto']]
        .map(([v, t]) => h('option', { value: v, selected: (sc.assinatura || '') === v }, t))),
    };
    const ler = () => ({ nome: el.nome.value.trim(), cpf: el.cpf.value.replace(/\D/g, ''), qualificacao: el.qualificacao.value.trim(),
      email: el.email.value.trim(), telefone: el.telefone.value.trim(), administrador: el.administrador.checked, assinatura: el.assinatura.value || null });
    const bloco = h('div', { class: 'socio-linha' },
      h('div', { class: 'filtros' },
        h('div', { class: 'largo' }, h('label', {}, 'Nome do sócio'), el.nome),
        h('div', {}, h('label', {}, 'CPF'), el.cpf),
        h('div', {}, h('label', {}, 'Qualificação'), el.qualificacao),
        h('div', {}, h('label', {}, 'E-mail'), el.email),
        h('div', {}, h('label', {}, 'Telefone'), el.telefone)),
      h('div', { class: 'linha socio-flags' },
        h('label', { class: 'flag-socio' }, el.administrador, ' Sócio administrador'),
        el.assinatura,
        aoUsar ? h('button', { type: 'button', class: 'btn pequeno', onclick: () => {
          const s = ler(); if (!s.nome) return toast('Preencha o nome do sócio.');
          aoUsar(s);
        } }, 'Usar como representante') : null,
        h('button', { type: 'button', class: 'btn pequeno perigo', onclick: () => { bloco.remove(); itens.splice(itens.indexOf(item), 1); } }, 'Remover')));
    const item = { bloco, ler };
    return item;
  };
  const adicionar = (sc = {}) => { const it = linha(sc); itens.push(it); caixa.append(it.bloco); return it; };
  socios.forEach((sc) => adicionar(sc));
  const botao = h('button', { type: 'button', class: 'btn pequeno', onclick: () => adicionar().bloco.querySelector('input')?.focus() }, '+ Adicionar sócio');
  return {
    caixa, botao, adicionar,
    ler: () => itens.map((it) => it.ler()).filter((x) => x.nome),
    // Linha com CPF/contato mas sem nome: o usuário esqueceu o nome
    valido: () => !itens.map((it) => it.ler()).some((x) => !x.nome && (x.cpf || x.email || x.telefone)),
    vazio: () => !itens.some((it) => it.ler().nome),
    /** Troca a lista pelos sócios da Receita, só se nenhum sócio foi digitado. */
    preencherDaReceita(lista = []) {
      if (!lista.length || itens.some((it) => it.ler().nome)) return false;
      itens.splice(0).forEach((it) => it.bloco.remove());
      lista.forEach((sc) => adicionar({ nome: sc.nome, qualificacao: sc.qualificacao, administrador: /administrador/i.test(sc.qualificacao || '') }));
      return true;
    },
  };
}
