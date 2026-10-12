// Texto sem acento e em minúsculas, para comparar "Vitória" com "vitoria".
export const semAcento = (v) => (v == null ? null : String(v).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase());
