/**
 * Escolha da interface de escuta.
 *
 * O default é loopback porque o servidor NÃO tem autenticação: qualquer um que
 * alcance a porta lê, escreve e apaga qualquer projeto. Expor precisa ser um ato
 * explícito (`BIND_HOST`) e vem acompanhado de um aviso no log.
 */

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);

export function resolveBindHost(env: NodeJS.ProcessEnv): string {
  const raw = env.BIND_HOST?.trim();
  return raw ? raw : '127.0.0.1';
}

export function isLoopback(host: string): boolean {
  return LOOPBACK.has(host);
}

export function exposureWarning(host: string, port: number): string | null {
  if (isLoopback(host)) return null;
  return [
    '',
    '  ┌──────────────────────────────────────────────────────────────┐',
    '  │  ATENÇÃO: servidor exposto na rede SEM autenticação          │',
    '  └──────────────────────────────────────────────────────────────┘',
    `  Escutando em ${host}:${port} — qualquer um com acesso a esta rede`,
    '  pode ler, modificar e APAGAR qualquer projeto.',
    '',
    '  Use BIND_HOST=127.0.0.1 (default) ou coloque um proxy com',
    '  autenticação na frente antes de expor.',
    '',
  ].join('\n');
}
