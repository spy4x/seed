---
slug: seed-chegou-tour
language: pt-BR
translationOf: welcome-to-the-seed-blog
title: "O Seed chegou: um tour pelo starter SaaS gratuito, tela por tela"
seoTitle: "O Seed chegou: o starter SaaS gratuito, tela por tela"
description: O Seed, um starter SaaS gratuito com licença MIT, já pode ser usado. O que funciona desde o primeiro dia, o que ainda falta e como testar em um minuto.
tldr:
  - O Seed é um starter SaaS gratuito com licença MIT que você já pode usar. Você copia um repositório e cada linha é sua.
  - "Já pronto: passkeys e 2FA, grupos com funções, cobrança por membro via Stripe, tempo real, modo offline, painel de administração e nove idiomas."
  - "Ainda não: os apps para Android e desktop."
  - A demo abre com um clique, e localmente o Seed sobe com quatro comandos.
topic: Seed
intro: "O Seed, o starter SaaS gratuito que eu construo em público, já pode ser usado. Mostro tela por tela o que você ganha no primeiro dia, o que ainda falta e como testar em um minuto."
coverAlt: "Um broto roxo em um vaso ao lado de um envelope aberto, do qual saem folhas voando como cartas."
author: Anton Shubin
authorUrl: https://antonshubin.com/about
publishAt: 2026-11-01T09:00:00Z
newsletter: false
---

O Seed chegou. É um starter SaaS gratuito, com licença MIT, que você pode usar hoje: você copia um
repositório e começa com login, grupos com funções, cobrança por membro via Stripe, atualizações em
tempo real, um app que funciona offline, um painel de administração e nove idiomas já funcionando.
Ele roda em Postgres e Docker Compose, em um único servidor que você controla, e dá para navegar pelo
app na [demo ao vivo](https://app.seedsaas.com) antes de instalar qualquer coisa.

Eu sou o Anton e desenvolvo MVPs de SaaS para clientes. Todos começavam com o mesmo mês de
encanamento: login, equipes, cobrança e uma página de admin que eu sempre prometia deixar bonita
"depois". O Seed é esse mês, feito uma vez e mantido em dia. Este post é o tour; uma comparação
honesta com outros starters está em
[Boilerplate SaaS gratuito](/pt-BR/blog/boilerplate-saas-gratuito).

## Como as pessoas fazem login?

De todos os jeitos que elas esperam: e-mail e senha com código de confirmação, passkeys, Google e
GitHub, e códigos de acesso por e-mail. A verificação em duas etapas com um app autenticador é um
botão na página de segurança, e a mesma página lista todos os dispositivos conectados, para
encerrar uma sessão que você não reconhece. Um visitante também pode começar como convidado com um
clique e adicionar um método de login depois, sem perder nada.

![A página de segurança de um perfil: a senha, um botão Adicionar chave de acesso, a verificação em duas etapas ativada e o começo da lista de dispositivos conectados.](/shots/profile-security-dark-800.webp)

Ninguém nunca assinou um produto porque o "esqueci minha senha" funcionava. Muita gente já foi
embora porque não funcionava. Como isso foi feito sem pagar um serviço de autenticação:
[Passkeys, 2FA and sessions without an auth SaaS](/blog/passkeys-2fa-sessions-without-auth-saas)
(em inglês).

## Como funcionam as equipes?

Com grupos. O cadastro cria a conta, a sessão e um primeiro grupo em uma única transação do banco
de dados, então um espaço pessoal e uma equipe são a mesma coisa, com as mesmas regras. As pessoas
são convidadas por e-mail com uma de quatro funções: leitor, editor, administrador ou dono. O dono
pode passar o grupo para outra pessoa, e um grupo excluído pode ser restaurado por 30 dias.

![Os membros de um grupo, cada um com sua função, um botão para convidar pessoas e o menu de um membro aberto: “Tornar leitor”, “Tornar administrador”, “Remover do grupo”.](/shots/group-members-dark-800.webp)

## Como é a cobrança?

Assinaturas do Stripe por grupo, cobradas por membro. O catálogo da demo tem um plano gratuito (até
3 membros e 10 notas) e um plano Pro de € 9 por membro por mês, incluindo o dono, com 14 dias de
teste. A quantidade acompanha o número de membros, o dono confirma o novo preço antes de cada
convite, e um cartão recusado ganha um período de carência em vez de um bloqueio imediato. Os preços
são exemplos: seus planos são uma lista em um arquivo ([planos](/docs/billing-plans), em inglês).

![O plano de um grupo de exemplo no app de demo, com os preços de exemplo da demo: plano Pro com data de renovação, € 36,00 por mês, para 4 membros a € 9,00 cada, incluindo o dono.](/shots/billing-plan-dark-780.webp)

Uma equipe de quatro pessoas paga € 36 por mês no Pro. Mova o controle para ver quanto a sua
pagaria.

<CostCalculator members={4} />

## E se duas pessoas editarem ao mesmo tempo, ou o Wi-Fi cair?

As mudanças chegam a todas as abas abertas por WebSocket, e quando o socket cai, as chamadas vão por
HTTP comum. O app pode ser instalado, abre sem rede, lê as últimas notas e grupos do IndexedDB e
guarda numa fila as alterações de notas até a conexão voltar. Se alguém mudou a mesma nota nesse
meio-tempo, você vê um conflito para resolver, nunca uma sobrescrita silenciosa do trabalho de um
colega.

![A página Notas de uma equipe chamada Acme Studio: seis notas com seus autores, etiquetas coloridas e horário de alteração, um campo de busca, filtros por etiqueta e autor e um botão Nova nota.](/shots/notes-dark-800.webp)

Notas é a funcionalidade de referência: a sua primeira funcionalidade a copia arquivo por arquivo
([sua primeira funcionalidade](/blog/your-first-feature-copy-the-notes-aggregate), em inglês).
Os detalhes, em inglês:
[tempo real por WebSocket com HTTP de reserva](/blog/realtime-websocket-with-http-fallback) e
[como o banco de dados local sincroniza](/blog/offline-first-preact-signals-local-database-sync).

## O que o operador vê?

Um painel de administração em um domínio próprio. O operador encontra uma pessoa, vê os métodos de
login, as sessões e os grupos dela, reembolsa um pagamento, escreve este blog, cuida dos assinantes
da newsletter e reexecuta uma tarefa que falhou. Ações arriscadas pedem confirmação, e toda ação vai
para um log de auditoria.

![A página Usuários do painel de administração: busca por nome ou endereço, filtros por status, tipo de conta e função, e uma tabela de pessoas inventadas com função, status e quando foram vistas pela última vez.](/video/admin-panel-poster-1280.webp)

Cada funcionalidade do app ganha sua tela no painel na mesma mudança, para que os dois nunca fiquem
fora de sincronia ([como o painel fica em dia](/blog/admin-panel-for-every-feature), em inglês).

## Quais idiomas ele fala?

Nove: português do Brasil, inglês, alemão, espanhol, francês, russo, japonês, chinês simplificado e
árabe, que se lê da direita para a esquerda. O app, o painel, este site e os e-mails mudam de
idioma, então você pode testar seu layout em árabe antes que seu primeiro cliente árabe encontre o
bug por você
([nove idiomas e RTL desde o primeiro dia](/pt-BR/blog/nove-idiomas-e-rtl-desde-o-primeiro-dia)).

## O que ainda falta?

O app para Android ([#202](https://github.com/spy4x/seed/issues/202)) e o app para desktop
([#203](https://github.com/spy4x/seed/issues/203)). O resto do plano está nas
[issues abertas](https://github.com/spy4x/seed/issues). Login com Google e GitHub e cobrança pelo
Stripe precisam das suas próprias chaves, por isso ficam desligados na demo, que mostra pagamentos
inventados em vez de reais. O painel de administração também não faz parte da demo:
[um vídeo o mostra](/pt-BR/admin).

E o Seed não serve para todo projeto. Se você faz deploy em funções serverless ou quer um backend
hospedado, escolha outra coisa: o Seed conta com um servidor que você administra.

## Como testar?

Dois caminhos, um minuto cada:

- **A demo ao vivo.** "Experimentar sem conta" abre uma conta de convidado cheia de dados de
  exemplo: um grupo seu e duas equipes de pessoas inventadas. Ela é apagada toda noite, então pode
  quebrar o que quiser.
- **Na sua máquina.** Deno 2 e Docker, depois quatro comandos. O guia
  [Get started](/docs/get-started) explica passo a passo, e
  [o post de instalação](/blog/install-seed-and-run-it-locally) mostra a saída real e os tropeços
  comuns (ambos em inglês).

Comece pela demo: [abra agora](https://app.seedsaas.com), clique em "Experimentar sem conta" e
fuce numa equipe que não é a sua.
