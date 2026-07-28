# Servidor Web — Rede de Segurança Pré-Produção Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tornar a exposição acidental do servidor improvável e restringir o acesso via navegador, **sem** autenticação (adiada por decisão de escopo).

**Architecture:** Três mudanças pequenas e independentes em `server/`: bind em loopback por padrão com aviso ao expor, CORS por lista de origens configurável (default localhost), e mensagens de erro que não ecoam o input. A política de CORS entra por parâmetro em `createApp` para ser testável sem mexer em variáveis de ambiente do processo.

**Tech Stack:** Node/TypeScript, Express, `cors`; testes em vitest + supertest (suíte já existente).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-27-server-network-hardening-design.md`.
- Node >= 20, TypeScript estrito, ESM (imports relativos terminam em `.js`). Todo o código em `server/`.
- **Isto não torna o servidor seguro para exposição pública** — sem auth não há controle de acesso. O objetivo é evitar exposição acidental.
- `BIND_HOST` default `127.0.0.1`; loopback = `127.0.0.1`, `localhost`, `::1`.
- `CORS_ORIGINS` = origens separadas por vírgula; sem a env, o default libera `localhost`/`127.0.0.1` em qualquer porta.
- Requisições **sem** cabeçalho `Origin` continuam sendo atendidas (CORS é política de navegador; bloquear não impediria `curl`).
- O e2e (`e2e/`) roda com o default e deve continuar passando — serve de verificação de que o default não quebra o fluxo real.

---

### Task 1: Módulo de política de CORS

**Files:**
- Create: `server/src/cors.ts`
- Test: `server/test/cors.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `export function parseOrigins(raw: string | undefined): string[] | null` — divide por vírgula, apara espaços, descarta vazios; devolve `null` quando `raw` é `undefined`/vazio (significando "usar o default de localhost").
  - `export function isOriginAllowed(origin: string | undefined, allowList: string[] | null): boolean` — `origin` ausente ⇒ `true` (não é requisição de navegador). Com `allowList`, compara exatamente. Sem `allowList` (default), aceita qualquer origem cujo host seja `localhost` ou `127.0.0.1`, em qualquer porta e esquema.

- [ ] **Step 1: Escrever o teste que falha**

`server/test/cors.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseOrigins, isOriginAllowed } from '../src/cors.js';

describe('parseOrigins', () => {
  it('returns null when unset or empty', () => {
    expect(parseOrigins(undefined)).toBeNull();
    expect(parseOrigins('')).toBeNull();
    expect(parseOrigins('   ')).toBeNull();
  });

  it('splits on commas and trims', () => {
    expect(parseOrigins('https://a.com, https://b.com')).toEqual(['https://a.com', 'https://b.com']);
  });

  it('drops empty entries', () => {
    expect(parseOrigins('https://a.com,,')).toEqual(['https://a.com']);
  });
});

describe('isOriginAllowed', () => {
  it('allows requests without an Origin header (not a browser)', () => {
    expect(isOriginAllowed(undefined, null)).toBe(true);
    expect(isOriginAllowed(undefined, ['https://a.com'])).toBe(true);
  });

  it('default policy allows localhost on any port', () => {
    expect(isOriginAllowed('http://localhost:8100', null)).toBe(true);
    expect(isOriginAllowed('http://127.0.0.1:3000', null)).toBe(true);
    expect(isOriginAllowed('https://localhost', null)).toBe(true);
  });

  it('default policy rejects non-local origins', () => {
    expect(isOriginAllowed('https://evil.com', null)).toBe(false);
    // hostname deve bater exatamente: não basta conter "localhost"
    expect(isOriginAllowed('https://localhost.evil.com', null)).toBe(false);
  });

  it('explicit list matches exactly', () => {
    const list = ['https://app.com'];
    expect(isOriginAllowed('https://app.com', list)).toBe(true);
    expect(isOriginAllowed('https://other.com', list)).toBe(false);
    expect(isOriginAllowed('http://localhost:8100', list)).toBe(false);
  });

  it('malformed origin is rejected under the default policy', () => {
    expect(isOriginAllowed('not-a-url', null)).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `cd /Users/afonsof/Projects/emocre/ldtk/server && npm test -- cors`
Expected: FAIL — `Cannot find module '../src/cors.js'`.

- [ ] **Step 3: Implementar `server/src/cors.ts`**

```typescript
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
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `cd /Users/afonsof/Projects/emocre/ldtk/server && npm test -- cors`
Expected: PASS (9 testes).

- [ ] **Step 5: Commit**

```bash
git add server/src/cors.ts server/test/cors.test.ts
git commit -m "feat(server): política de CORS por lista de origens (default localhost)"
```

---

### Task 2: Aplicar a política de CORS no `createApp`

**Files:**
- Modify: `server/src/app.ts`
- Test: `server/test/routes/corsPolicy.test.ts`

**Interfaces:**
- Consumes: `parseOrigins`, `isOriginAllowed` (Task 1).
- Produces: `createApp(storage: Storage, opts?: { corsOrigins?: string[] | null }): Express` — o segundo parâmetro é opcional; quando ausente, a política é o default (localhost). Os testes existentes que chamam `createApp(storage)` seguem válidos.

- [ ] **Step 1: Escrever o teste que falha**

`server/test/routes/corsPolicy.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../../src/app.js';
import { DiskStorage } from '../../src/storage/DiskStorage.js';

let storage: DiskStorage;

beforeEach(async () => {
  storage = new DiskStorage(await mkdtemp(join(tmpdir(), 'ldtk-store-')));
});

describe('CORS policy', () => {
  it('default policy allows a localhost origin', async () => {
    const app = createApp(storage);
    const res = await request(app).get('/health').set('Origin', 'http://localhost:8100');
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:8100');
  });

  it('default policy does not allow a foreign origin', async () => {
    const app = createApp(storage);
    const res = await request(app).get('/health').set('Origin', 'https://evil.com');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('serves requests without an Origin header', async () => {
    const app = createApp(storage);
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('explicit allow list permits the configured origin only', async () => {
    const app = createApp(storage, { corsOrigins: ['https://app.com'] });

    const ok = await request(app).get('/health').set('Origin', 'https://app.com');
    expect(ok.headers['access-control-allow-origin']).toBe('https://app.com');

    const denied = await request(app).get('/health').set('Origin', 'http://localhost:8100');
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `cd /Users/afonsof/Projects/emocre/ldtk/server && npm test -- corsPolicy`
Expected: FAIL — a origem `https://evil.com` recebe `Access-Control-Allow-Origin` (o `cors()` atual libera tudo).

- [ ] **Step 3: Aplicar a política no `server/src/app.ts`**

Adicionar o import e trocar a linha `app.use(cors())`:

```typescript
import { isOriginAllowed } from './cors.js';
```

```typescript
export interface AppOptions {
  /** Origens permitidas; `null`/ausente usa o default (apenas localhost). */
  corsOrigins?: string[] | null;
}

export function createApp(storage: Storage, opts: AppOptions = {}): Express {
  const allowList = opts.corsOrigins ?? null;
  const app = express();
  app.use(
    cors({
      origin: (origin, cb) => cb(null, isOriginAllowed(origin ?? undefined, allowList)),
    }),
  );
  app.use(express.json({ limit: '64mb' }));
```

(o restante do corpo de `createApp` permanece igual)

- [ ] **Step 4: Rodar o teste e a suíte inteira**

Run: `cd /Users/afonsof/Projects/emocre/ldtk/server && npm test`
Expected: PASS — os 4 novos testes de CORS e os 38 anteriores (nenhum deles envia `Origin`, então não são afetados).

- [ ] **Step 5: Commit**

```bash
git add server/src/app.ts server/test/routes/corsPolicy.test.ts
git commit -m "feat(server): createApp aplica a política de CORS configurável"
```

---

### Task 3: Bind em loopback por padrão + aviso ao expor

**Files:**
- Create: `server/src/bind.ts`
- Modify: `server/src/server.ts`
- Test: `server/test/bind.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `export function resolveBindHost(env: NodeJS.ProcessEnv): string` — devolve `env.BIND_HOST` se definido e não vazio, senão `127.0.0.1`.
  - `export function isLoopback(host: string): boolean` — `true` para `127.0.0.1`, `localhost`, `::1`.
  - `export function exposureWarning(host: string, port: number): string | null` — `null` se loopback; senão, a mensagem de aviso (multi-linha) sobre ausência de autenticação.
  - `server.ts` passa o host ao `listen` e imprime o aviso quando houver.

- [ ] **Step 1: Escrever o teste que falha**

`server/test/bind.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { resolveBindHost, isLoopback, exposureWarning } from '../src/bind.js';

describe('resolveBindHost', () => {
  it('defaults to loopback', () => {
    expect(resolveBindHost({})).toBe('127.0.0.1');
    expect(resolveBindHost({ BIND_HOST: '' })).toBe('127.0.0.1');
  });

  it('uses BIND_HOST when set', () => {
    expect(resolveBindHost({ BIND_HOST: '0.0.0.0' })).toBe('0.0.0.0');
    expect(resolveBindHost({ BIND_HOST: '192.168.1.10' })).toBe('192.168.1.10');
  });
});

describe('isLoopback', () => {
  it('recognises loopback hosts', () => {
    expect(isLoopback('127.0.0.1')).toBe(true);
    expect(isLoopback('localhost')).toBe(true);
    expect(isLoopback('::1')).toBe(true);
  });

  it('treats anything else as exposed', () => {
    expect(isLoopback('0.0.0.0')).toBe(false);
    expect(isLoopback('192.168.1.10')).toBe(false);
  });
});

describe('exposureWarning', () => {
  it('is silent on loopback', () => {
    expect(exposureWarning('127.0.0.1', 4000)).toBeNull();
  });

  it('warns about the missing authentication when exposed', () => {
    const msg = exposureWarning('0.0.0.0', 4000);
    expect(msg).not.toBeNull();
    expect(msg!.toLowerCase()).toContain('autentica');
  });
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `cd /Users/afonsof/Projects/emocre/ldtk/server && npm test -- bind`
Expected: FAIL — `Cannot find module '../src/bind.js'`.

- [ ] **Step 3: Implementar `server/src/bind.ts`**

```typescript
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
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `cd /Users/afonsof/Projects/emocre/ldtk/server && npm test -- bind`
Expected: PASS (6 testes).

- [ ] **Step 5: Usar no `server/src/server.ts`**

```typescript
import { createApp } from './app.js';
import { DiskStorage } from './storage/DiskStorage.js';
import { resolveBindHost, exposureWarning } from './bind.js';
import { parseOrigins } from './cors.js';

const port = Number(process.env.PORT ?? 4000);
const storageDir = process.env.STORAGE_DIR ?? './storage';
const host = resolveBindHost(process.env);
const corsOrigins = parseOrigins(process.env.CORS_ORIGINS);

const app = createApp(new DiskStorage(storageDir), { corsOrigins });
app.listen(port, host, () => {
  console.log(`LDtk web server on ${host}:${port} (storage: ${storageDir})`);
  console.log(`CORS: ${corsOrigins ? corsOrigins.join(', ') : 'localhost (default)'}`);
  const warning = exposureWarning(host, port);
  if (warning) console.warn(warning);
});
```

- [ ] **Step 6: Verificar o boot nas duas configurações**

Run:
```bash
cd /Users/afonsof/Projects/emocre/ldtk/server && STORAGE_DIR=$(mktemp -d) PORT=4499 timeout 3 npm start
```
Expected: loga `LDtk web server on 127.0.0.1:4499` e `CORS: localhost (default)`, **sem** aviso.

Run:
```bash
cd /Users/afonsof/Projects/emocre/ldtk/server && STORAGE_DIR=$(mktemp -d) PORT=4499 BIND_HOST=0.0.0.0 timeout 3 npm start
```
Expected: loga `on 0.0.0.0:4499` **e** o aviso de exposição sem autenticação.

- [ ] **Step 7: Commit**

```bash
git add server/src/bind.ts server/src/server.ts server/test/bind.test.ts
git commit -m "feat(server): escuta em loopback por padrão, com aviso ao expor"
```

---

### Task 4: Erros sem echo do input + documentação

**Files:**
- Modify: `server/src/routes/validate.ts`
- Modify: `server/README.md`
- Test: `server/test/routes/pathTraversal.test.ts` (adicionar asserção)

**Interfaces:**
- Consumes: nada.
- Produces: `safeSegment` mantém `HttpError(400, 'invalid_id', ...)`, mas a mensagem descreve o formato aceito em vez de repetir o valor rejeitado.

- [ ] **Step 1: Adicionar a asserção ao teste existente**

Em `server/test/routes/pathTraversal.test.ts`, acrescentar ao final do `describe`:

```typescript
  it('does not echo the rejected value back to the client', async () => {
    const res = await request(app)
      .get(`/api/project/${encodeURIComponent('../../secret')}/bundle`);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_id');
    expect(JSON.stringify(res.body)).not.toContain('secret');
  });
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd /Users/afonsof/Projects/emocre/ldtk/server && npm test -- pathTraversal`
Expected: FAIL — o corpo contém `secret` (a mensagem atual ecoa o valor).

- [ ] **Step 3: Ajustar a mensagem em `server/src/routes/validate.ts`**

```typescript
export function safeSegment(name: string, kind: string): string {
  if (!SAFE_SEGMENT.test(name)) {
    // Sem ecoar `name`: refletir input do cliente na resposta é hábito ruim.
    throw new HttpError(
      400,
      'invalid_id',
      `Invalid ${kind}: expected letters, digits, hyphen or underscore`,
    );
  }
  return name;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd /Users/afonsof/Projects/emocre/ldtk/server && npm test`
Expected: PASS — suíte inteira verde.

- [ ] **Step 5: Documentar as variáveis no `server/README.md`**

Substituir a seção `## Rodar` por:

```markdown
## Rodar

    npm install
    STORAGE_DIR=./storage PORT=4000 npm start   # ou: npm run dev

### Variáveis de ambiente

| Variável | Default | Descrição |
|---|---|---|
| `PORT` | `4000` | porta de escuta |
| `STORAGE_DIR` | `./storage` | diretório dos projetos |
| `BIND_HOST` | `127.0.0.1` | interface de escuta |
| `CORS_ORIGINS` | localhost | origens permitidas, separadas por vírgula |

> **Sem autenticação.** Este servidor não autentica ninguém: quem alcança a
> porta lê, modifica e apaga qualquer projeto. Por isso ele escuta apenas em
> `127.0.0.1` por padrão. Só use `BIND_HOST` para expor se houver um proxy
> autenticando na frente — o servidor avisa no log quando é iniciado exposto.
```

- [ ] **Step 6: Rodar a suíte completa e o e2e**

Run:
```bash
cd /Users/afonsof/Projects/emocre/ldtk/server && npm test 2>&1 | grep -E "Test Files|Tests" \
 && cd ../e2e && npm test 2>&1 | tail -3
```
Expected: servidor com todos os testes verdes (38 anteriores + 9 CORS + 4 política + 6 bind + 1 echo) e e2e `4 passed` — este último confirma que o default de bind/CORS não quebra o fluxo real.

- [ ] **Step 7: Commit**

```bash
git add server/src/routes/validate.ts server/test/routes/pathTraversal.test.ts server/README.md
git commit -m "fix(server): erros não ecoam o input + documenta BIND_HOST/CORS_ORIGINS"
```

---

## Self-Review

**Spec coverage:**
- Bind seguro por padrão + aviso ao expor → Task 3. ✓
- CORS por lista configurável, default localhost, sem-`Origin` passa → Tasks 1–2. ✓
- Erros sem echo do input → Task 4. ✓
- `createApp` recebe CORS por parâmetro (testável sem mexer em env do processo) → Task 2. ✓
- Documentação de `BIND_HOST`/`CORS_ORIGINS` e do aviso sobre ausência de auth → Task 4. ✓
- Autenticação → **fora de escopo, declarado** no spec e nas Global Constraints; a issue #1 segue aberta com esse item. ✓

**Placeholder scan:** sem "TBD"/"TODO"; todo passo traz código real e comando com saída esperada.

**Type consistency:** `parseOrigins(raw) → string[] | null` e `isOriginAllowed(origin, allowList)` (Task 1) são consumidos por `createApp(storage, { corsOrigins })` (Task 2) e por `server.ts` (Task 3) com os mesmos tipos. `resolveBindHost(env) → string`, `isLoopback(host) → boolean` e `exposureWarning(host, port) → string | null` (Task 3) são usados só em `server.ts`. `createApp` mantém a assinatura de um argumento para os testes já existentes (o segundo é opcional).

**Risco declarado:** a mudança de default do bind (`0.0.0.0` → `127.0.0.1`) **altera comportamento** — qualquer setup que dependesse de acesso externo ao servidor de dev passa a precisar de `BIND_HOST`. É intencional (o ponto da tarefa), está documentado no README, e o e2e cobre o caminho local.
