# Servidor Web — Rede de Segurança Pré-Produção

**Data:** 2026-07-27
**Status:** Aprovado (brainstorming)
**Issue:** #1 (parcial — o item de autenticação continua aberto)

## Contexto e limite honesto

A issue #1 previa três frentes: autenticação, CORS e echo de erro. **A autenticação foi adiada por decisão de escopo do usuário.**

Isso precisa ficar explícito porque muda o significado do trabalho: **este design não torna o servidor seguro para exposição pública.** Sem autenticação não há controle de acesso algum — quem alcançar a porta lê, escreve e apaga qualquer projeto, e o `projectId` não é segredo (IDs como `demo` ou `test` são adivinháveis).

O que este trabalho entrega é uma **rede de segurança**: tornar a exposição acidental improvável e barrar uso via navegador a partir de origens não autorizadas.

Consequência prática: enquanto não houver auth, o servidor deve rodar apenas em `localhost` ou atrás de um proxy que faça a autenticação.

## Objetivo

Três mudanças, todas em `server/`:

1. Escutar em loopback por padrão; expor exige ato explícito.
2. Restringir CORS a uma lista de origens configurável.
3. Parar de ecoar o input rejeitado nas mensagens de erro.

## 1. Bind seguro por padrão

**Hoje:** `app.listen(port)` sem host — o Express escuta em `0.0.0.0` (todas as interfaces). Basta rodar numa máquina com IP público ou na rede da empresa para o servidor ficar aberto, sem nenhum aviso.

**Passa a ser:** `BIND_HOST` com default `127.0.0.1`. Para expor, é preciso setar a variável explicitamente (ex.: `BIND_HOST=0.0.0.0`).

Quando `BIND_HOST` **não** for loopback, o servidor imprime um aviso destacado no log, lembrando que não há autenticação e que qualquer um com acesso à rede pode ler e apagar projetos. O aviso é ruidoso de propósito: expor sem auth é uma decisão que merece atenção, não um efeito colateral silencioso.

`localhost` e `::1` contam como loopback (não disparam o aviso).

## 2. CORS por lista de origens

**Hoje:** `cors()` sem opções — qualquer origem é aceita, então qualquer página web pode fazer requisições ao servidor a partir do navegador de quem a visita (relevante quando o servidor roda em `localhost` da máquina do usuário).

**Passa a ser:** `CORS_ORIGINS`, origens separadas por vírgula (ex.: `https://meuapp.com,https://staging.meuapp.com`). Sem a variável, o default libera apenas `localhost` e `127.0.0.1` em **qualquer porta**, o que cobre desenvolvimento e o e2e sem configuração.

Origem presente na requisição e ausente da lista ⇒ rejeitada (sem cabeçalho `Access-Control-Allow-Origin`).

**Requisições sem cabeçalho `Origin` continuam passando.** CORS é política de navegador: `curl` e chamadas server-to-server não enviam `Origin` e não são afetados por CORS de qualquer forma. Bloqueá-las daria falsa sensação de segurança sem impedir nada — e quebraria clientes legítimos não-browser.

## 3. Erros sem echo do input

**Hoje:** `safeSegment` lança `Invalid ${kind}: ${name}`, e o `errorMiddleware` devolve `message` no corpo do 400 — refletindo o valor rejeitado de volta ao cliente.

**Passa a ser:** a mensagem informa apenas o campo e o formato aceito, sem repetir o payload. Ex.: `Invalid projectId: expected letters, digits, hyphen or underscore`.

Não é vetor de ataque conhecido aqui (nada é lido ou escrito com o valor), mas ecoar input é hábito ruim e barato de corrigir.

## Componentes

| Arquivo | Mudança |
|---|---|
| `server/src/server.ts` | lê `BIND_HOST` (default `127.0.0.1`), passa o host ao `listen`, emite o aviso quando não-loopback |
| `server/src/app.ts` | `createApp` passa a aceitar opções de CORS; monta `cors()` com a lista de origens |
| `server/src/cors.ts` (novo) | resolve a lista de origens a partir de `CORS_ORIGINS` e implementa a checagem (incluindo o default de localhost) |
| `server/src/routes/validate.ts` | mensagem de erro sem o valor rejeitado |
| `server/README.md` | documenta `BIND_HOST` e `CORS_ORIGINS` e o aviso sobre ausência de auth |

O `createApp` recebe a configuração de CORS por parâmetro (em vez de ler `process.env` internamente), para que os testes exercitem as duas políticas sem manipular variáveis de ambiente do processo.

## Testes

Tudo cabe no vitest já existente do servidor:

- **Bind:** `resolveBindHost()` devolve `127.0.0.1` sem env e o valor da env quando setada; `isLoopback()` reconhece `127.0.0.1`, `localhost` e `::1` e rejeita `0.0.0.0`.
- **CORS:** origem na lista recebe `Access-Control-Allow-Origin`; origem fora da lista não recebe; requisição **sem** `Origin` é atendida normalmente; o default libera `http://localhost:8100` e `http://127.0.0.1:3000` e rejeita `https://evil.com`.
- **Erro:** o corpo do 400 para um id inválido **não** contém o valor rejeitado, e mantém `code: "invalid_id"`.

O e2e continua rodando com o default (o estático serve em `localhost:8100`), então serve de verificação de que o default não quebra o fluxo real.

## Fora de escopo

- **Autenticação** — adiada; a issue #1 permanece aberta só com esse item.
- Rate limiting, HTTPS/TLS, headers de segurança (CSP, HSTS) — pertencem à camada de proxy/deploy, não a este servidor.
