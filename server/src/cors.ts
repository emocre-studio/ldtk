/**
 * Política de CORS do servidor.
 *
 * Sem `CORS_ORIGINS`, o default libera apenas localhost (qualquer porta), o que
 * cobre desenvolvimento e testes sem configuração. Requisições sem cabeçalho
 * `Origin` são atendidas: CORS é política de navegador, e clientes como curl
 * não enviam `Origin` nem são afetados por ela.
 */

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1']);

export function parseOrigins(raw: string | undefined): string[] | null {
  if (raw === undefined) return null;
  const list = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return list.length > 0 ? list : null;
}

export function isOriginAllowed(origin: string | undefined, allowList: string[] | null): boolean {
  if (origin === undefined) return true; // não é requisição de navegador
  if (allowList !== null) return allowList.includes(origin);
  try {
    return LOCAL_HOSTNAMES.has(new URL(origin).hostname);
  } catch {
    return false;
  }
}
