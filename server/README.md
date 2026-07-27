# LDtk Web Server

Servidor HTTP que carrega/persiste projetos LDtk (manifesto + níveis separados +
imagens) para o editor web embutido. JSON tratado como opaco; conflito de escrita
detectado por versão/ETag por projeto. Sem autenticação no MVP.

## Rodar

    npm install
    STORAGE_DIR=./storage PORT=4000 npm start   # ou: npm run dev

## API

- `GET  /api/project/:id/bundle` → `{ version, manifest, levels, images }`
- `PUT  /api/project/:id/manifest`     (header `If-Match: <version>`) → `{ version }`
- `PUT  /api/project/:id/level/:iid`   (header `If-Match: <version>`) → `{ version }`
- `DELETE /api/project/:id/level/:iid` (header `If-Match: <version>`) → `{ version }`
- `POST /api/project/:id/images`  (multipart `file`) → `{ id, name, pxWid, pxHei, url }`
- `GET  /api/project/:id/images/:imgId` → bytes da imagem

`If-Match` divergente ⇒ `409 version_conflict`. Ausente em mutação ⇒ `428`.

## Testes

    npm test
