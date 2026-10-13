// Municípios oficiais por UF (IBGE: 5.570 municípios + Brasília), copiados do pacote @brazilian-utils/brazilian-utils
// 2.5.0 (licença MIT), que traz a relação do IBGE. ES = 78. Usado na escolha de cidades do jornal e nos filtros.
import { readFileSync } from 'node:fs';

export const MUNICIPIOS_IBGE = JSON.parse(readFileSync(new URL('../data/municipios-ibge.json', import.meta.url), 'utf8'));
