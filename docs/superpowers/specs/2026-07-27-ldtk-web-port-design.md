# LDtk Web Port — Design

**Data:** 2026-07-27
**Status:** Aprovado (brainstorming)

## Objetivo

Rodar o editor LDtk no navegador, embutido em um produto do usuário, com os dados
de projeto carregados e salvos em um servidor via HTTP. O editor abre um projeto
por vez (identificado por `projectId`); não há tela Home nem gestão de múltiplos
projetos dentro do editor.

## Contexto técnico

O LDtk já é Haxe compilado para JavaScript, renderizando com Heaps.io sobre WebGL,
com a UI em jQuery/HTML DOM, empacotado no Electron. O renderer (o editor em si)
tem ~48 mil linhas em `src/electron.renderer/`. A renderização, a UI e a
serialização (`data/Project.hx` → `toJson`/`fromJson`, schema `ldtk.Json`) já são
browser-native e praticamente não mudam. O trabalho é substituir a camada de
acesso a disco (Electron/node `fs`) por HTTP.

Acoplamento nativo relevante:
- `dn.js.NodeTools` (alias `NT`) — filesystem, usado em ~25 arquivos do renderer.
- `dn.js.ElectronTools` (alias `ET`) — janela, zoom, menu, dirs, exit.
- `dn.js.ElectronDialogs` — pickers nativos de arquivo.
- `FileWatcher` (`fs.watch`), `IpcRenderer`, `electron-updater`, `CommandRunner`
  (`child_process`), e o processo main `src/electron.main/ElectronMain.hx`.
- Persistência concentrada em `ui/ProjectSaver.hx` e `ui/ProjectLoader.hx`.

## Decisões de escopo

- **Fork só-web.** Remove o Electron por completo; assume browser. Sem manter o
  desktop em paralelo.
- **Editor embutido**, aberto para **um projeto por `projectId`**. Sem tela Home.
- **Servidor novo em Node/TypeScript**, construído do zero.
- **Tilesets por upload:** o usuário importa PNGs pelo editor; o servidor guarda e
  serve por URL.
- **Sem autenticação no MVP** — apenas `projectId` na rota. Segurança fica para
  depois.
- **Salvar explícito** (Ctrl+S), com **níveis armazenados separadamente** no
  servidor (modelo multi-arquivo do LDtk preservado).
- **Cortado do MVP:** exporters (Tiled/GameMaker/CSV), importers (Ogmo/enums
  externos), "rodar comando"/auto-update/menus nativos, backups automáticos.

## Abordagem escolhida — VFS em memória + flush (Abordagem C)

O acesso a disco síncrono do editor é preservado por meio de um filesystem virtual
em memória. O HTTP fica contido em três momentos pontuais e naturalmente
assíncronos: carregar (boot), salvar (flush) e importar imagem (upload). Nenhuma
leitura durante a edição vira assíncrona, o que minimiza mudanças e risco de
regressão.

Alternativas descartadas:
- **A) Shim HTTP direto no `NodeTools`:** choque de sincronia (código chama `NT`
  de forma síncrona; HTTP é assíncrono). Frágil.
- **B) Reescrever a persistência inteira:** mais limpo, porém mexe em muito código
  e tem maior risco de regressão / menor velocidade.

## Arquitetura

```
Navegador (produto host)                         Servidor Node/TS
┌───────────────────────────────┐               ┌─────────────────────────┐
│ LDtk editor (Haxe→JS)         │  GET  bundle   │ GET  /api/project/:id/  │
│ Heaps/WebGL + jQuery DOM      │◄──────────────►│        bundle           │
│ ┌───────────────────────────┐ │  PUT  manifest │ PUT  .../manifest       │
│ │ VirtualFS (memória)       │ │  PUT  level    │ PUT  .../level/:iid      │
│ │ projeto + níveis + imgs   │ │  DELETE level  │ DELETE .../level/:iid    │
│ └───────────────────────────┘ │  POST image    │ POST .../images         │
│   ▲ leituras síncronas        │  GET  image    │ GET  .../images/:imgId  │
│   ▼ flush no save             │               │ Storage: disco (→ S3)    │
└───────────────────────────────┘               └─────────────────────────┘
```

### Fluxo de dados

- **Bootstrap:** o produto host embute o editor e injeta
  `window.LDTK_CONFIG = { projectId, apiBaseUrl }` (via query param ou objeto JS).
  O `Boot`/`App` pula a Home e dispara o carregamento do projeto.
- **Load:** `GET /api/project/:id/bundle` traz manifesto + todos os níveis +
  metadados das imagens numa requisição. Popula o `VirtualFS`. O `ProjectLoader`
  roda como hoje, lendo do VFS (síncrono).
- **Editar:** tudo em memória, exatamente como o desktop. Zero rede.
- **Save (Ctrl+S):** o `ProjectSaver` escreve no VFS; o flush envia ao servidor
  apenas o que mudou (dirty set): `PUT` do manifesto + níveis alterados, `DELETE`
  dos removidos.
- **Importar tileset:** upload imediato (`POST images`); a referência (id/url)
  entra no VFS/manifesto — os bytes não vão no JSON.

## Componentes do cliente

### `VirtualFS` (novo)
Mapa `caminho → bytes/string` em memória, com a assinatura **síncrona** que o
código já espera: `readFileString`, `readFileBytes`, `writeFileString`,
`writeFileBytes`, `fileExists`, `removeFile`, listagem de diretório, etc. Mantém um
**dirty set**: todo `write`/`remove` marca o caminho como alterado — base do flush.

### `WebFS` (novo) — substituto do `NodeTools`
Em `import.hx`, troca-se o alias `import dn.js.NodeTools as NT` por
`import web.WebFS as NT`. `WebFS` expõe exatamente os métodos estáticos que o
código chama, delegando ao `VirtualFS`. Os ~25 call sites (`NT.readFileBytes(...)`
etc.) continuam compilando sem edição.

> **Primeira tarefa concreta do plano:** grep de `NT.`, `ET.`, `js.node.*`,
> `electron`, `js.node.Fs` em `src/electron.renderer/` para listar cada símbolo
> usado e definir a superfície exata de `WebFS` e dos stubs.

### `ProjectTransport` (novo) — única peça que fala HTTP
- `loadBundle(projectId) : Promise` — busca o bundle, popula o `VirtualFS`, limpa
  o dirty set. Chamado no bootstrap antes do `ProjectLoader`.
- `flush(projectId) : Promise` — envia o dirty set (`PUT` manifesto + níveis,
  `DELETE` removidos), limpa o dirty set. Chamado no fim do save.
- `uploadImage(bytes, name) : Promise<{id,url,pxWid,pxHei}>` — chamado no import.

### Ganchos no fluxo existente
- `ProjectLoader`: inalterado (o bundle já está no VFS antes dele rodar); só o
  bootstrap ganha `await ProjectTransport.loadBundle()`.
- `ProjectSaver`: continua escrevendo no VFS; ao final chama
  `ProjectTransport.flush()`.
- Import de imagem: o picker nativo (`ElectronDialogs`) vira `<input type=file>`
  → lê bytes → `uploadImage()` → grava a referência no VFS.

## Contrato da API (servidor)

Sem auth no MVP. Formato de fio = JSON nativo do LDtk. O servidor trata o JSON do
projeto como **opaco** (valida só que é JSON válido e o tamanho); não conhece o
schema LDtk. Apenas imagens são inspecionadas (dimensões/content-type).

```
GET /api/project/:id/bundle
→ 200 {
    manifest: <ProjectJson com externalLevels: true>,
    levels:   { "<levelIid>": <LevelJson>, ... },
    images:   [ { id, name, url, pxWid, pxHei }, ... ]
  }

PUT    /api/project/:id/manifest      body: <ProjectJson>   If-Match: <etag>  → 200
PUT    /api/project/:id/level/:iid    body: <LevelJson>     If-Match: <etag>  → 200
DELETE /api/project/:id/level/:iid                          If-Match: <etag>  → 200

POST   /api/project/:id/images        multipart: file  → 201 {id,name,url,pxWid,pxHei}
GET    /api/project/:id/images/:imgId → 200 (bytes do PNG, Cache-Control longo)
```

- **Projeto default:** `GET /bundle` de projeto sem `manifest.json` devolve um
  `ProjectJson` em branco gerado pelo servidor a partir de um template mínimo.
- **Criação do registro do projeto** é responsabilidade do produto host (fornece o
  `id`). `POST /api/project` fica fora do escopo.
- **Concorrência:** um editor por projeto por vez. Cada bundle carrega uma
  `version`/ETag; `PUT`/`DELETE` mandam `If-Match` e recebem `409` se divergir. Sem
  merge automático no MVP.

## Modelo de storage (servidor)

```
storage/projects/<projectId>/
  manifest.json          # ProjectJson (externalLevels: true)
  version                # etag atual (contador ou hash)
  levels/<levelIid>.json # cada .ldtkl
  images/<imgId>.png     # PNGs enviados
  images/<imgId>.meta.json  # { name, pxWid, pxHei, contentType }
```

- **Abstração `Storage` (interface):** `getManifest`, `putManifest`, `listLevels`,
  `getLevel`, `putLevel`, `deleteLevel`, `putImage`, `getImage`,
  `getVersion`/`bumpVersion`. Implementação inicial `DiskStorage`; `S3Storage`
  depois, sem tocar nas rotas.
- **ETag:** arquivo `version` por projeto; todo `PUT` bem-sucedido incrementa.
- **Imagens:** dimensões extraídas no upload (ex.: `image-size`); servidas com
  `Cache-Control` longo (`imgId` imutável).

## Build, bootstrap e remoções

- **`.hxml`:** remove o alvo `main.hxml`/`ElectronMain`. `renderer.hxml` vira o
  único build; remove `-D electron`, adiciona `-D web`; remove libs `electron` e
  `hxnodejs`. Saída `renderer.js` + assets (fontes, ícones, CSS, e as libs JS já
  browser-native: codemirror, jquery, sortablejs, simple-color-picker) servidos
  como estáticos.
- **`index.html` host:** carrega `renderer.js` e assets; expõe `LDTK_CONFIG`.
- **Bootstrap (`Boot`/`App`):** remove init de Electron/IPC/menu; lê `LDTK_CONFIG`,
  faz `await ProjectTransport.loadBundle(projectId)`, entra direto no `Editor`
  (pula a Home).

| Item | Ação |
|---|---|
| `src/electron.main/` | removido do build |
| `ElectronTools` (`ET`) | stub web (zoom→CSS/noop, exit→noop, appResourceDir→URL base) |
| `ElectronDialogs` | import de imagem vira `<input type=file>`; open/save de projeto inexistente |
| `FileWatcher` (`fs.watch`) | stub vazio (sem hot-reload de tileset no MVP) |
| `IpcRenderer` / `electron-updater` | removidos |
| `CommandRunner` (child_process) | removido |
| Importers / Exporters | removidos do build |
| `Home` / gestão de projetos | fora do fluxo (bypass no bootstrap) |
| atalhos de app | atalhos de editor (Ctrl+S etc.) via handlers JS já existentes |

## Tratamento de erros

Princípio: durante a sessão, **a memória é a fonte da verdade**; falha de rede
nunca corrompe nem perde o estado em edição — apenas adia a persistência.

| Momento | Falha | Comportamento |
|---|---|---|
| `loadBundle` (boot) | rede/404/500 | Tela de erro bloqueante + *Tentar de novo*. Editor não abre parcial. |
| `flush` (save) | rede/500 | Dirty set **não** é limpo; aviso não-bloqueante ("falha ao salvar, alterações em memória"). Próximo flush reenvia. |
| `flush` (save) | 409 (ETag) | Aviso: "o projeto mudou no servidor; recarregue". Sem merge automático. |
| `uploadImage` | rede/500/tipo inválido | Aborta só aquele import; projeto intacto. |

Servidor: erros retornam `{ error, code }` com status adequado — 400 (JSON
inválido), 404 (projeto/nível inexistente), 409 (conflito de versão), 413 (imagem
grande demais), 415 (tipo não suportado).

## Testes

Foco na fronteira nova (servidor + VFS/transport + bootstrap). Não re-testamos a
lógica interna do editor LDtk (ferramentas, render, regras) — código existente e
estável, cuja fonte de I/O apenas trocamos.

1. **Servidor (unitário + integração):** cada endpoint contra `DiskStorage` em
   diretório temporário — round-trip de manifesto/nível, fluxo do ETag (`If-Match`
   correto passa, errado dá 409), upload de imagem (dimensões extraídas, tipo
   inválido rejeitado), projeto default. Stack: `vitest`/`jest` + `supertest`.
   Cobertura alta.
2. **VFS/transport (cliente, unitário):** `VirtualFS` (read/write/exists/dirty
   set) e `ProjectTransport` (loadBundle popula o VFS; flush manda só os dirty;
   uploadImage grava a ref) contra servidor fake/mock.
3. **Fumaça end-to-end:** subir servidor + editor, abrir `projectId`, editar,
   Ctrl+S, recarregar e conferir persistência; importar tileset e conferir após
   reload. Um teste Playwright no caminho feliz; o resto por verificação manual.

## Decomposição em sub-projetos

Este design cobre duas peças que devem virar planos de implementação separados,
nesta ordem:

1. **Servidor Node/TS** — API + storage + testes (independente, testável isolado).
2. **Fork web do editor** — VFS/WebFS/ProjectTransport, stubs, build, bootstrap,
   integração contra o servidor.
