# Ciclo de Vida de Imagens — Design

**Data:** 2026-07-27
**Status:** Aprovado (brainstorming)
**Issue:** #2

## Problema

Hoje imagens só entram no servidor, nunca saem. Dois caminhos geram lixo permanente:

1. **Import abandonado** — o upload acontece no momento do import (antes de salvar). Se o usuário desistir e fechar sem salvar, a imagem fica órfã para sempre.
2. **Tileset removido** — ao apagar um tileset do projeto, a imagem correspondente continua no storage.

Não há endpoint de remoção, nem qualquer coleta de lixo.

## Restrição que define a solução

**O servidor trata o JSON do projeto como opaco** (decisão da peça 1: ele não conhece o formato LDtk, e por isso não quebra quando o formato evolui). Consequência direta: o servidor **não consegue** descobrir sozinho quais imagens estão em uso — isso exigiria interpretar `defs.tilesets[]` e `levels[].bgRelPath`.

O cliente, ao contrário, sabe exatamente: o próprio LDtk consulta esses dois lugares em `Project.isCachedImageUsed()`.

Portanto a limpeza é **dirigida pelo cliente**. O servidor recebe uma instrução explícita; nunca infere.

## Servidor

### `DELETE /api/project/:id/images/:imgId`

Remove uma imagem específica. Exige `If-Match` como as demais mutações (`428` sem o header, `409` se divergente). Imagem inexistente ⇒ `404 image_not_found`. Sucesso ⇒ `200 { version }` + header `ETag`.

Serve ao produto hospedeiro e a limpeza manual. O editor não o usa (usa o prune).

### `POST /api/project/:id/images/prune`

Corpo: `{ "keep": ["img_a", "img_b"] }`. Apaga toda imagem do projeto que **não** esteja em `keep`. Exige `If-Match`. Responde `200 { version, deleted: ["img_c"] }` + `ETag`.

`keep` ausente ou não-array ⇒ `400 invalid_keep`. `keep: []` apaga todas as imagens (é uma instrução válida: projeto sem imagem alguma).

**Versão:** upload de imagem não altera a versão (decisão da peça 1, mantida), mas **prune e delete alteram** — eles mudam o estado persistido do projeto e precisam invalidar o ETag de outros clientes.

### `Storage`

Ganha `deleteImage(projectId: string, imgId: string): Promise<boolean>` — remove `<id>.<ext>` e `<id>.meta.json`; devolve `false` se a imagem não existia.

## Cliente

`ProjectTransport.flush` ganha uma etapa final, **após** os PUT/DELETE de nível e dentro da mesma cadeia de `If-Match`: monta a lista de imagens referenciadas e chama o prune.

**Como montar a lista** (sem duplicar lógica do LDtk): varrer o manifesto nos dois lugares que o próprio LDtk consulta —
- `defs.tilesets[].relPath`
- `levels[].bgRelPath` (incluindo `worlds[].levels[]` em projetos multi-mundo)

De cada path, extrair o id no padrão que o web usa: `images/<id>.<ext>`. Paths fora desse padrão são ignorados (não são imagens do servidor — ex.: um projeto importado do desktop com caminhos de disco).

**Ordem importa:** o prune roda só depois do manifesto ter sido aceito. Um cliente desatualizado leva `409` no PUT do manifesto e aborta antes de apagar qualquer coisa — o ETag protege o caso multi-cliente sem lógica adicional.

## Risco aceito

Se o cliente enviar uma lista incompleta por bug, imagens em uso são apagadas — **sem lixeira, sem recuperação**. Decisão consciente do usuário, pelos motivos:

- O ETag já cobre o caso multi-cliente (o cenário realista de divergência).
- O cliente sempre inclui uploads recém-feitos na lista, porque o picker grava a referência no manifesto no mesmo instante do upload.
- Lixeira ou limite de segurança adicionariam estado e knobs para um risco hipotético.

Os testes unitários do cliente cobrem justamente a montagem da lista, que é onde tal bug moraria.

## Testes

**Servidor:**
- `deleteImage` remove ambos os arquivos; devolve `false` para inexistente.
- `DELETE` sem `If-Match` ⇒ 428; divergente ⇒ 409; desconhecida ⇒ 404; sucesso incrementa versão.
- `prune` apaga só o que está fora de `keep`, devolve `deleted`, incrementa versão.
- `prune` com `keep: []` apaga todas; com `keep` inválido ⇒ 400.

**Cliente (unit, XHR e servidor falsos):**
- flush chama o prune **depois** do manifesto, com os ids extraídos de tilesets e de bg de nível.
- relPaths fora do padrão `images/<id>.<ext>` não entram na lista.
- conflito no manifesto aborta a sequência antes do prune.

**E2E:** subir imagem → salvar → remover a referência → salvar → a imagem sumiu do bundle.

## Fora de escopo

- Contagem de referências entre projetos (imagens são por projeto).
- Limpeza agendada/periódica no servidor — o prune no save cobre os casos reais.
