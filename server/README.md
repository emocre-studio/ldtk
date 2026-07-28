# LDtk Web Server

Servidor HTTP que carrega/persiste projetos LDtk (manifesto + níveis separados +
imagens) para o editor web embutido. JSON tratado como opaco; conflito de escrita
detectado por versão/ETag por projeto. Sem autenticação no MVP.

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

## API

- `GET  /health` → `{ ok: true }`
- `GET  /api/project/:id/bundle` → `{ version, manifest, levels, images }`
- `PUT  /api/project/:id/manifest`     (header `If-Match: <version>`) → `{ version }`
- `PUT  /api/project/:id/level/:iid`   (header `If-Match: <version>`) → `{ version }`
- `DELETE /api/project/:id/level/:iid` (header `If-Match: <version>`) → `{ version }`
- `POST /api/project/:id/images`  (multipart `file`) → `{ id, name, pxWid, pxHei, url }`
- `GET  /api/project/:id/images/:imgId` → bytes da imagem
- `DELETE /api/project/:id/images/:imgId` (header `If-Match: <version>`) → `{ version }`
- `POST /api/project/:id/images/prune`    (header `If-Match: <version>`) → `{ version, deleted }`

O `prune` recebe `{ "keep": ["img_a", ...] }` e apaga toda imagem do projeto fora
da lista. O servidor não interpreta o JSON do projeto: quem sabe quais imagens
estão em uso é o editor, que envia a lista ao salvar. Upload não altera a versão;
`DELETE` e `prune` alteram.

### Códigos de erro

- `400 invalid_id` — `:id`/`:iid`/`:imgId` fora do padrão `[A-Za-z0-9_-]+` (proteção contra path traversal)
- `400 no_file` — upload sem campo multipart `file`
- `400 upload_error` — erro do multer não relacionado a tamanho (ex.: campo com nome errado)
- `400 invalid_json` — corpo JSON malformado
- `404 level_not_found` / `image_not_found`
- `409 version_conflict` — `If-Match` divergente da versão atual
- `413 file_too_large` — imagem acima de 20MB
- `415 unsupported_media_type` — tipo de imagem não suportado
- `428 precondition_required` — `If-Match` ausente em mutação

## Limitações conhecidas (MVP)

- Sem autenticação/autorização.
- CORS totalmente aberto (qualquer origem).
- Não há endpoint de exclusão de imagens; uploads se acumulam no storage.
- O JSON do projeto é opaco ao servidor — é responsabilidade do cliente manter
  o campo `levels` embutido no manifesto sincronizado com o storage de níveis
  separado (`PUT`/`DELETE /api/project/:id/level/:iid`).

## Testes

    npm test

## Testes do porte web

Três suítes, da mais rápida para a mais lenta:

    # 1. Servidor (unit + integração)
    cd server && npm test

    # 2. Cliente web (unit, sem rede: XHR e servidor falsos)
    haxe -cp srcweb -cp test -main webtest.VirtualFSTest --interp
    mkdir -p .tmp && haxe test.transport.hxml && node test/webtest/run-transport-test.mjs

    # 3. Smoke e2e (Chrome real + servidor real)
    haxe renderer.web.hxml          # obrigatório: o e2e usa o build
    cd e2e && npm test

O e2e usa o Chrome do sistema (`channel: "chrome"`), então a instalação roda com
`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install`.
