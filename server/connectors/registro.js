import { conectorPncp } from './pncp.js';
import { conectorPncpContratos } from './pncpContratos.js';
import { conectorCompras14133, conectorComprasLegado } from './comprasgov.js';

// Somente conectores com implementação real entram aqui.
export const CONECTORES = {
  pncp: conectorPncp,
  pncp_contratos: conectorPncpContratos,
  comprasgov_14133: conectorCompras14133,
  comprasgov_legado: conectorComprasLegado,
};
