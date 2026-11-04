---
slug: cobranca-por-usuario-stripe-webhooks
language: pt-BR
translationOf: per-seat-billing-stripe-webhooks-retries
title: "Cobrança por usuário com Stripe e webhooks que resistem a reenvios"
seoTitle: "Cobrança por usuário no Stripe com webhooks à prova de reenvio"
description: "Como o Seed cobra uma equipe por membro com Stripe: o número de assentos acompanha a lista de membros por meio de uma tarefa que se repete, e cada webhook é aplicado uma vez só, nunca para trás."
tldr:
  - "No Seed, a quantidade da assinatura no Stripe é o número de membros do grupo, dono incluído. O Stripe faz o rateio; o app não calcula dinheiro."
  - "O membro entra primeiro e a cobrança vem depois: uma tarefa do worker informa a nova quantidade ao Stripe e repete com a mesma chave de idempotência enquanto o Stripe estiver fora."
  - "O id de cada evento é salvo na mesma transação que o aplica: um reenvio não muda nada, e uma falha desfaz as duas coisas para o Stripe tentar de novo."
  - "Um evento antigo nunca volta um plano para trás, e uma tarefa noturna corrige qualquer número de assentos que tenha divergido."
topic: Em detalhe
intro: "Cobrar por usuário parece um número só: membros vezes preço. O difícil é manter esse número certo enquanto as pessoas entram, o Stripe cai e os webhooks chegam duas vezes ou fora de ordem. Veja como o Seed faz isso, com o código real."
coverAlt: "Uma fileira de poltronas de teatro roxas, cada uma com uma planta em vaso, enquanto uma muda nova desce presa a um fio para mais uma poltrona."
author: Anton Shubin
authorUrl: https://antonshubin.com/about
publishAt: 2026-11-05T09:00:00Z
newsletter: true
---

Como cobrar um SaaS por usuário com Stripe sem que a fatura se afaste da equipe real? No Seed, a
quantidade da assinatura é simplesmente o número de membros do grupo, e o app não confia em uma
única chamada nem em um único webhook para mantê-la assim. A mudança de membros é salva primeiro;
uma tarefa que se repete informa a nova quantidade ao Stripe; cada webhook é gravado pelo id do
evento na mesma transação que o aplica; e uma tarefa noturna corrige o que escapou.

Este texto é para quem está colocando cobrança por equipe em um SaaS, e para quem já viu um handler
de webhook funcionar bem até o Stripe reenviar um evento. Está tudo no
[código do Seed](https://github.com/spy4x/seed), sob licença MIT, e cito as linhas reais.

## O que significa cobrança por usuário no Seed?

A cobrança pertence a um grupo, a equipe no Seed. Cada grupo tem uma assinatura, paga pelo dono. O
catálogo tem dois planos ([`PLANS`](https://github.com/spy4x/seed/blob/main/libs/domain/billing/+lib.ts)):

| Plano | Preço                    | Membros | Teste   |
| ----- | ------------------------ | ------- | ------- |
| Free  | 0                        | até 3   | não     |
| Pro   | € 9,00 por membro ao mês | até 50  | 14 dias |

"Por membro" quer dizer que a quantidade da assinatura no Stripe é o número de membros do grupo,
contando o dono. É o mesmo número que o limite de 50 usa, então o assento tem uma definição só, e
não duas que discordam. Um convite pendente não reserva assento; aceitá-lo, sim.

Veja quanto uma equipe paga com os preços da demo. Mexa no controle:

<CostCalculator members={5} />

Cinco pessoas no Pro pagam € 45 por mês. O dono vê o preço de mais um assento antes de convidar
alguém: o formulário de convite mostra quanto o novo membro acrescenta e pede que ele aceite. A API
recusa um convite sem esse aceite (`SEAT_PRICE_NOT_ACCEPTED`), então a regra vale mesmo quando o
formulário é enviado sem JavaScript.

## Por que o membro entra antes de o Stripe saber?

Porque um Stripe lento nunca deve impedir alguém de entrar em uma equipe. O código óbvio chama o
Stripe dentro da requisição "aceitar convite": se o Stripe demorar demais, ou a pessoa não entra, ou
entra e a cobrança fica errada para sempre. As duas coisas são ruins, e a segunda passa despercebida.

O Seed salva primeiro a mudança de membros, em uma transação própria. O commit grava uma linha no
outbox, e o worker transforma cada mudança (entrou, foi removido, saiu) em uma tarefa de
sincronização de assentos. A tarefa lê a quantidade na hora em que roda e só chama o Stripe se ela
for diferente da salva ([`seat-sync.ts`](https://github.com/spy4x/seed/blob/main/libs/server/billing/seat-sync.ts)):

```ts
const members = await new PostgresInvitationRepository(sql).countMembers(groupId)
if (members < 1 || row.quantity === members) return
const result = await provider.updateQuantity({
  subscriptionId: row.providerSubscriptionId,
  quantity: members,
  // A retry of this row asks for the same count with the same key; a later count gets its own.
  idempotencyKey: `seats:${event.id}:${members}`,
})
if (!result.ok) {
  throw new Error(`seat sync of group ${groupId} failed: ${result.error.code} ...`)
}
```

Três detalhes seguram tudo:

1. **A quantidade é lida quando a tarefa roda**, não quando entrou na fila. Cinco pessoas entrando
   em um minuto precisam de uma chamada certa, não de cinco disputando.
2. **A chave de idempotência nomeia a tarefa e a quantidade.** Se o Stripe aplicou a mudança e a
   resposta se perdeu, a nova tentativa manda a mesma chave, e o Stripe devolve o primeiro resultado
   em vez de aplicar duas vezes.
3. **Uma falha lança erro.** O sistema de tarefas tenta de novo depois de 1 s, 2 s, 4 s e assim por
   diante, com até 15 minutos de intervalo, 20 vezes, cerca de duas horas e meia ([jobs.md](https://github.com/spy4x/seed/blob/main/docs/jobs.md)).

A mudança de quantidade pede ao Stripe `proration_behavior=create_prorations`, o
[padrão dele](https://docs.stripe.com/billing/subscriptions/prorations): o restante do período é
somado à próxima fatura ou abatido dela. O app nunca calcula sozinho um euro rateado. Conta de
dinheiro que eu não escrevo é conta que eu não erro.

## E se a sincronização nunca chegar?

Mais dois caminhos pegam o caso, porque duas horas e meia de tentativas não são "para sempre":

- **O webhook também confere.** Quando o Stripe informa uma assinatura cuja quantidade não bate com
  o número de membros, a mesma transação que salva o evento coloca uma sincronização na fila. Assim
  se corrige um checkout aberto antes de alguém entrar.
- **Uma tarefa noturna confere todo grupo pagante.** Às 03:00, a limpeza procura cada assinatura por
  membro cuja quantidade salva difere da do grupo e coloca uma sincronização na fila. Isso cobre uma
  queda longa do Stripe e uma mudança sem evento do grupo, como um membro que apaga a própria conta.

Então os assentos ficam certos depois da próxima mudança, do próximo webhook ou da próxima noite, o
que vier primeiro. Prefiro isso a um design que só acerta se todas as chamadas derem certo.

## Como deixar um webhook do Stripe seguro para reenvios?

O Stripe [reenvia uma entrega que falhou](https://docs.stripe.com/webhooks#automatic-retries) por
até três dias no modo live, e avisa que um endpoint pode receber o mesmo evento mais de uma vez. Um
handler que soma um assento ou manda um e-mail a cada entrega vai, cedo ou tarde, fazer isso duas
vezes.

O webhook do Seed faz três coisas em ordem fixa. Primeiro, a assinatura: o adaptador
[`@spy4x/billing`](https://jsr.io/@spy4x/billing) confere o cabeçalho `Stripe-Signature` contra o
corpo bruto, com janela de cinco minutos, antes de ler um byte de JSON. Assinatura inválida recebe
`400`. Depois, tudo acontece em uma transação do Postgres que começa gravando o id do evento
([`postgres-billing-repository.ts`](https://github.com/spy4x/seed/blob/main/libs/server/billing/postgres-billing-repository.ts)):

```ts
return await this.sql.begin(async (transaction) => {
  const stored = await transaction`
    INSERT INTO billing_events (id, event_type) VALUES (${event.id}, ${event.type})
    ON CONFLICT (id) DO NOTHING
    RETURNING id
  `
  if (stored.length === 0) return "duplicate"
  // ... apply the subscription, queue mails and seat syncs, record the plan change
})
```

`billing_events.id` é a chave primária, então a segunda entrega não insere nada e retorna sem tocar
na assinatura. Como o id é gravado _dentro_ da transação, o caso oposto também é seguro: se algo
falhar depois, o id é desfeito junto com o resto, a rota responde `500` e o reenvio do Stripe tem
uma segunda tentativa limpa. Gravar o id primeiro e aplicar depois, em dois passos, perderia o
evento na primeira vez que um deploy reiniciasse a API entre os dois.

Os e-mails ao dono (pagamento recusado, fim do teste, fim do plano) entram no outbox nessa mesma
transação, então um evento repetido nunca coloca um segundo e-mail na fila. Um evento que o Seed não
trata recebe `200`, e o Stripe para de enviá-lo.

## E os eventos que chegam fora de ordem?

O Stripe [não garante a ordem](https://docs.stripe.com/webhooks#event-ordering) dos eventos. Um
`customer.subscription.updated` atrasado dizendo "trialing" não pode desfazer o `active` que veio
antes. O Seed grava a assinatura com um upsert que só anda para a frente:

```sql
ON CONFLICT (group_id) DO UPDATE SET ...
WHERE (subscriptions.provider_event_at, subscriptions.provider_event_rank)
    <= (EXCLUDED.provider_event_at, EXCLUDED.provider_event_rank)
```

Primeiro vale a hora do evento, e o tipo desempata: criado, depois atualizado, depois excluído. Um
evento mais antigo não casa com nenhuma linha e não muda nada. Uma segunda regra no mesmo `WHERE`
impede que uma assinatura nova que não paga (uma cobrança recusada atrasada, por exemplo) tome o
lugar de uma que paga.

Vou ser direto sobre o limite. A documentação do Stripe diz para não usar `created` para ordenar
eventos, porque ele vem em segundos inteiros. O Seed usa esse campo só como trava contra
retrocesso, nunca para achar duplicatas, que é para isso que existe o id do evento. Dois eventos do
mesmo tipo no mesmo segundo, chegando invertidos, ainda deixam o mais antigo salvo, até o próximo
evento ou uma mudança no portal corrigir. Esse caso está descrito na
[documentação de cobrança](/pt-BR/docs/billing-lifecycle#known-limits), e a correção espera
[spy4x/ts-libs#380](https://github.com/spy4x/ts-libs/issues/380). Prefiro contar a deixar você
descobrir.

## Os testes provam isso?

Eles rodam contra um Postgres de verdade. Os 26 passos da suíte do webhook
(`tests/integration/billing.integration.test.ts`) incluem "uma segunda entrega do mesmo evento não
muda nada" e "um evento mais antigo que o salvo nunca volta o plano". Os assentos têm sua própria
suíte (`tests/integration/seat-billing.integration.test.ts`), com passos como "um membro removido e
um que sai diminuem um cada" e "a tarefa noturna coloca na fila uma mudança de assentos para cada
grupo divergente".

## O que o Seed não faz?

Para você saber antes de construir em cima dele:

- **Um plano pago, mensal, por membro.** Sem cobrança por uso ou medição, sem faixas. Adicionar um
  plano são cinco passos em [Plans and limits](/pt-BR/docs/billing-plans).
- **Só Stripe.** O código conversa com uma interface de provedor, mas o Stripe é o único adaptador
  que existe. Dá para desligar a cobrança também, e aí todo grupo tem todos os recursos.
- **`invoice.paid` e `invoice.payment_failed` são salvos, mas ainda não mudam nada.** O plano segue o
  status da própria assinatura.
- **O dinheiro fica no Stripe.** O app guarda o que os webhooks informam e nunca decide um plano por
  conta própria.

## Experimente

Abra a [demo](https://app.seedsaas.com), crie um grupo e veja a aba Cobrança; convide alguém e você
verá o preço do assento antes de enviar. A versão curta está na
[página de cobrança](/pt-BR/features/billing), [Set up billing](/pt-BR/docs/billing) leva você do zero
ao Stripe real, primeiro no modo de teste, e os grupos têm [sua própria página](/pt-BR/features/groups).
Se o seu handler de webhook grava o id do evento em um passo e aplica em outro, essa é a primeira
linha que eu mudaria hoje.
