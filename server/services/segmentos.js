// Classificação automática de segmento por palavras-chave do objeto.
// É uma ESTIMATIVA (exibida como tal na interface) — não substitui CATMAT/CATSER.
const REGRAS = [
  ['Obras e engenharia', /obra|engenharia|pavimenta|reforma|constru|drenagem|edifica|asfalt|terraplen|ponte|calçament/i],
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
  for (const [nome, re] of REGRAS) if (re.test(objeto)) return nome;
  return 'Outros';
}
export const SEGMENTOS = [...REGRAS.map(([n]) => n), 'Outros'];
