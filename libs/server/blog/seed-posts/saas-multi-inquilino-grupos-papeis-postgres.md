---
slug: saas-multi-inquilino-grupos-papeis-postgres
language: pt-BR
translationOf: multi-tenant-saas-groups-roles-postgres
title: "SaaS multi-inquilino: grupos, papéis e checagem de permissões no Postgres"
seoTitle: "SaaS multi-inquilino no Postgres: grupos, papéis e permissões"
description: "Como o Seed separa inquilinos em um único banco Postgres: um id de grupo em cada linha, quatro papéis fixos, o papel checado em cada handler e relido com trava em cada escrita."
tldr:
  - "No Seed o inquilino é um grupo. Cada linha tem um group_id, e o acesso de uma pessoa é uma linha em group_members com um papel de 1 a 4."
  - "Quem pode fazer o quê é um conjunto de funções puras pequenas. Cada handler lê o papel e chama uma delas; WebSocket e HTTP usam os mesmos handlers."
  - "Cada escrita relê o papel dentro da própria transação, com trava, então alguém removido um instante antes não consegue passar uma última escrita."
  - "Não há row-level security. Um estranho recebe 404, nunca 403, e testes conferem que um grupo nunca vê os dados de outro."
topic: Em detalhe
intro: "Todo SaaS com equipes responde à mesma pergunta em cada requisição: essa pessoa pode mexer nessa linha? Veja como o Seed responde isso em um único banco Postgres, com o código real, e o único ponto em que troca segurança por simplicidade."
coverAlt: "Uma estufa dividida em salas de vidro, cada uma com suas plantas e sua porta roxa, com uma chave pendurada ao lado de cada porta."
author: Anton Shubin
authorUrl: https://antonshubin.com/about
publishAt: 2026-11-06T09:00:00Z
newsletter: true
---

Como construir um SaaS multi-inquilino (multi-tenant) no Postgres para que uma equipe nunca veja os
dados de outra? No Seed, o inquilino é um **grupo**. Cada linha que pertence a um inquilino tem um
`group_id`, o acesso de uma pessoa é uma linha em `group_members` com um papel, e cada requisição
checa esse papel no código antes de ler ou escrever. Escritas checam duas vezes: no handler e de
novo dentro da própria transação, com uma trava. Um banco compartilhado, um schema, sem row-level
security.

Este texto é para quem está construindo um produto para equipes e quer ver uma resposta completa e
funcionando, não um diagrama. Está tudo no [código do Seed](https://github.com/spy4x/seed), sob
licença MIT, e os trechos são as linhas reais, um pouco enxugadas.

## O que é um inquilino no Seed?

Um grupo. Não existe um tipo "pessoal" separado: o cadastro cria um grupo comum chamado "Personal",
com você como único membro. Assim, um usuário sozinho e uma equipe de 50 passam pelo mesmo código, e
nada precisa ser migrado quando alguém convida um colega. Uma pessoa pode estar em quantos grupos
quiser.

A participação é uma tabela
([a migração](https://github.com/spy4x/seed/blob/main/libs/server/db/migrations/2026_08_18_0001_group_core.sql)):

```sql
CREATE TABLE group_members (
    group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    user_id INT4 NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role INT2 NOT NULL,
    ...
    PRIMARY KEY (group_id, user_id),
    CONSTRAINT group_members_role_check CHECK (role BETWEEN 1 AND 4)
);
```

O próprio Postgres garante duas regras: um papel vai de 1 a 4, e um índice único parcial permite
exatamente um dono por grupo. Uma transferência de propriedade rebaixa o dono antigo antes de
promover o novo, em uma transação, porque esse índice não aceita dois donos nem por um instante.
Cada linha de um recurso (uma nota, uma tag, um arquivo) tem sua própria coluna `group_id`.

## Quais papéis existem e o que cada um pode fazer?

Quatro, fixos e ordenados: viewer (1), editor (2), admin (3), owner (4). Como são ordenados, quase
toda regra é uma comparação: "editor ou acima" é `role >= 2`.

| O quê                                            | Viewer | Editor | Admin | Owner |
| ------------------------------------------------ | ------ | ------ | ----- | ----- |
| Ler as notas do grupo                            | sim    | sim    | sim   | sim   |
| Criar, editar e excluir notas                    | não    | sim    | sim   | sim   |
| Convidar como viewer ou editor                   | não    | não    | sim   | sim   |
| Renomear o grupo, ver o e-mail dos membros       | não    | não    | sim   | sim   |
| Tornar alguém admin                              | não    | não    | não   | sim   |
| Pagar, excluir o grupo, transferir a propriedade | não    | não    | não   | sim   |

Um admin gerencia viewers e editores, nunca outro admin, e ninguém além do dono mexe no dono. No
plano Free, um convite só adiciona viewers: dar outros papéis é o que o plano pago vende. Mais
abaixo explico como plano e papel ficam separados.

## Onde fica a checagem de permissão?

Em funções puras pequenas da biblioteca de domínio, uma por pergunta
([`libs/domain/groups`](https://github.com/spy4x/seed/blob/main/libs/domain/groups/+lib.ts)). A mais
difícil, quem pode mudar o papel de quem, é a mais longa:

```ts
export function canManageMember(actor: GroupRole, target: GroupRole, next?: GroupRole): boolean {
  if (!isGroupRole(actor) || !isGroupRole(target) || (next !== undefined && !isGroupRole(next))) {
    return false
  }
  if (actor === GroupRole.OWNER) return true
  if (actor !== GroupRole.ADMIN || target > GroupRole.EDITOR) return false
  return next === undefined || next <= GroupRole.EDITOR
}
```

Sem banco, sem requisição, sem framework: um teste unitário a chama com todas as combinações de
papéis. Um handler lê o papel de quem age e passa para a checagem certa antes de chamar o
repositório:

```ts
assertCanWriteNotes(await groups.roleOf(data.groupId, data.actor.userId))
```

Os transportes não têm regra nenhuma. Uma chamada chega pelo WebSocket ou como
`POST /api/call/<name>`, as duas vão para o mesmo handler e recebem a mesma resposta. É isso que
permite ao [tempo real recorrer ao HTTP](/blog/realtime-websocket-with-http-fallback) sem um
segundo conjunto de checagens para manter em sincronia.

## Por que checar o papel duas vezes?

Porque um papel lido antes da escrita pode estar velho quando a escrita for confirmada. Imagine: o
dono remove uma editora no mesmo instante em que ela salva uma nota. O handler leu "editor" um
milissegundo antes, a remoção é confirmada e a nota vai parar em um grupo do qual a autora já não
faz parte.

Por isso toda escrita em um grupo chama primeiro `lockActorRole`, dentro da própria transação
([`group-change-log.ts`](https://github.com/spy4x/seed/blob/main/libs/server/groups/group-change-log.ts)):

```ts
const active = await sql`
  SELECT 1 FROM groups WHERE id = ${groupId} AND deleted_at IS NULL FOR NO KEY UPDATE
`
if (active.length === 0) throw new GroupNotActiveError(groupId)
const member = (await sql`
  SELECT group_members.role
  FROM group_members
  INNER JOIN users ON users.id = group_members.user_id AND users.deleted_at IS NULL
  WHERE group_members.group_id = ${groupId} AND group_members.user_id = ${actorId}
  FOR SHARE OF group_members
`)[0]
return member?.role ?? null
```

A linha do grupo é travada primeiro, na mesma ordem usada por qualquer mudança de membros, então as
duas operações esperam uma pela outra em vez de entrar em deadlock. A linha de participação é lida
`FOR SHARE`: uma remoção confirmada antes aparece, e uma que vem depois espera a escrita terminar.
Em seguida o repositório confere o papel recebido, então a segunda checagem custa uma leitura por
índice em uma transação que já estava aberta.

Um teste prova isso para cada tipo de escrita de nota: ele segura uma remoção ou um rebaixamento,
inicia a escrita, vê que ela espera, confirma a mudança e espera que a escrita seja recusada sem
nada salvo ("note update: refused when a removal commits while the write waits", em
`tests/integration/group-write-race.integration.test.ts`).

## Por que um estranho recebe 404 e não 403?

Porque 403 diz "esse grupo existe, só não é para você". Quem não é membro recebe `GROUP_NOT_FOUND`,
exatamente a resposta de um grupo que nunca existiu, então ninguém consegue testar ids para
descobrir quais são reais. Um membro sem o papel necessário recebe 403 `ROLE_INSUFFICIENT`, porque
ele já sabe que o grupo existe.

O plano segue a mesma ideia. Quando um grupo chega ao limite do plano, a resposta é **402 Payment
Required**, não 403, para o app distinguir "peça ao dono para fazer upgrade" de "você não tem o
papel". O papel decide quem pode agir; o plano, quanto o grupo recebe. A cobrança por assento e
seus webhooks têm [um texto próprio](/pt-BR/blog/cobranca-por-usuario-stripe-webhooks).

## Por que não row-level security do Postgres?

Eu considerei e deixei o trade-off escrito no
[design da sincronização de grupos](https://github.com/spy4x/seed/blob/main/docs/archive/group-sync.md#9-tradeoffs).
A row-level security colocaria uma segunda cópia das regras de permissão no banco, em políticas SQL,
ao lado da cópia que os handlers precisam de qualquer jeito para responder "você é viewer" com um
erro útil. Duas cópias de uma regra acabam divergindo. Além disso, cada conexão teria de carregar a
pessoa atual, o que complica o pool de conexões, as tarefas em segundo plano e as migrações.

O custo honesto: com filtros no código da aplicação, uma consulta que esqueça o `group_id` pode
vazar dados. O Seed responde de três formas:

- **Assinaturas com o grupo.** Um método do repositório recebe o id do grupo como argumento, como
  `get(groupId, id)`, e a consulta filtra pelos dois. Não existe "buscar nota por id" para usar
  errado.
- **Uma lista de regras para cada recurso.** [docs/aggregates.md](/pt-BR/docs/aggregates) reúne o
  que um recurso novo copia: ele vive em um grupo, cada linha tem `group_id` e cada escrita relê o
  papel.
- **Testes entre grupos.** Os testes de integração rodam contra um Postgres real com um estranho em
  um grupo próprio, em passos como "never counts a note of another group" e "a person who is not a
  member is told the group does not exist".

Se o seu produto precisa de uma garantia no nível do banco, por exemplo para uma auditoria de
conformidade, row-level security é uma boa escolha, e dá para colocá-la por cima. Para um template
inicial, escolhi um lugar só para as regras.

## O que o Seed não faz?

- **Não há papéis personalizados.** Quatro papéis fixos. Um produto que precise de "gestor de
  cobrança" adiciona um papel e suas checagens.
- **Não há permissão por registro.** Um papel vale para o grupo inteiro; não dá para compartilhar uma
  nota com uma pessoa só.
- **Não há row-level security**, como expliquei.
- **Não há schema nem banco por inquilino.** Todos os grupos dividem as tabelas.

## Experimente

Abra a [demo](https://app.seedsaas.com), crie um grupo, convide uma segunda conta como viewer e
tente editar uma nota por ela. A versão curta está na [página de grupos](/pt-BR/features/groups), e
[seu primeiro recurso](/blog/your-first-feature-copy-the-notes-aggregate) mostra como um novo tipo
de registro herda tudo isso copiando o código das notas. Se o seu app checa o papel uma vez só,
antes da transação, essa é a corrida que eu fecharia primeiro.
