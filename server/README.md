# LDtk Web Server

Servidor HTTP que carrega/persiste projetos LDtk (manifesto + níveis separados +
imagens) para o editor web embutido. JSON tratado como opaco; conflito de escrita
detectado por versão/ETag por projeto. Sem autenticação no MVP.

## Rodar

    npm install
    STORAGE_DIR=./storage PORT=4000 npm start   # ou: npm run dev

## API

- `GET  /health` → `{ ok: true }`
- `GET  /api/project/:id/bundle` → `{ version, manifest, levels, images }`
- `PUT  /api/project/:id/manifest`     (header `If-Match: <version>`) → `{ version }`
- `PUT  /api/project/:id/level/:iid`   (header `If-Match: <version>`) → `{ version }`
- `DELETE /api/project/:id/level/:iid` (header `If-Match: <version>`) → `{ version }`
- `POST /api/project/:id/images`  (multipart `file`) → `{ id, name, pxWid, pxHei, url }`
- `GET  /api/project/:id/images/:imgId` → bytes da imagem

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
