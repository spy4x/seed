---
slug: backup-e-restauracao-saas-auto-hospedado
language: pt-BR
translationOf: self-hosted-saas-backup-and-restore
title: "Backup de um SaaS auto-hospedado, e como provar que a restauração funciona"
seoTitle: "Backup de SaaS auto-hospedado: Postgres, arquivos e restauração"
description: Como fazer backup de um SaaS auto-hospedado (banco, arquivos, chaves) fora do servidor e provar a restauração antes de precisar dela.
tldr:
  - Faça backup do banco, dos arquivos enviados e de toda chave que só existe no servidor, em um bucket de outro provedor.
  - Só uma restauração prova um backup. Ensaie uma em um banco reserva; no Seed são quatro comandos.
  - O Seed salva todo dia um pg_dump, os arquivos e as chaves de notificação push com o restic, e avisa quando o último backup tem dois dias.
  - Não há recuperação para um ponto no tempo, então até um dia de gravações pode se perder, e ele não confere sozinho os dados guardados.
topic: Guias
intro: "Um SaaS no seu próprio servidor é barato até o disco morrer. Aqui está o que copiar, onde guardar e como provar que a restauração funciona, com o backup que vem no Seed como exemplo."
relatedFeature: deploy
coverAlt: "Uma planta violeta cresce de uma torre de servidor em uma ilha pequena e, em outra ilha do outro lado da água, um pote de vidro fechado guarda uma muda da mesma planta ao lado de um vaso para onde ela está sendo replantada."
author: Anton Shubin
authorUrl: https://antonshubin.com/about
publishAt: 2026-11-08T09:00:00Z
newsletter: true
devto: false
---

Para fazer backup de um SaaS auto-hospedado, salve todo dia três coisas em um armazenamento de outro
provedor: um dump do banco de dados, os arquivos que seus usuários enviaram e cada chave que só
existe no servidor. Criptografe o backup, guarde a senha dele fora do servidor e receba um aviso
quando uma execução falhar. Depois vem a parte que quase todo mundo pula: restaure um backup em um
banco reserva e confira se as tabelas estão lá. Até fazer isso, você tem uma pasta cheia de
esperança.

Um servidor de preço fixo é toda a ideia do Seed, e o que impede as pessoas de hospedar por conta
própria é o medo de perder os dados. Por isso este post fala do backup que vem no Seed: o que ele
salva, como ensaiar a restauração e, com a mesma franqueza, o que ele não faz. Os comandos vêm do
[guia de backup](/pt-BR/docs/backups) e do [guia de restauração](/pt-BR/docs/restore).

## Do que um SaaS auto-hospedado precisa fazer backup?

De tudo que você não consegue reconstruir a partir do git. Esta é a lista do Seed, de
[docs/backups.md](/pt-BR/docs/backups):

| O quê                                  | No backup? | Por quê                                                                   |
| -------------------------------------- | ---------- | ------------------------------------------------------------------------- |
| O banco Postgres, como `pg_dump`       | Sim        | Contas, grupos e tudo o que os usuários criaram.                          |
| Os arquivos enviados (Garage embutido) | Sim        | Os blocos de dados e as duas cópias por hora mais recentes dos metadados. |
| As chaves de push, `vapid.json`        | Sim        | Só existem no servidor; sem elas as notificações param de chegar.         |
| Valkey                                 | Não        | É um cache; ele se enche de novo sozinho.                                 |
| O arquivo de ambiente de produção      | Não        | Ele guarda as chaves do próprio backup. Mantenha sua cópia à parte.       |
| Arquivos em outro armazenamento S3     | Não        | Os backups desse armazenamento cuidam deles.                              |

O arquivo de ambiente é o mais esquecido. Ele tem a chave do armazenamento de arquivos e a senha do
backup, então um backup que o incluísse entregaria as duas a quem o lesse. Guarde-o no seu
gerenciador de senhas ou criptografado no git, mas não só no servidor.

## Onde os backups devem ficar?

Não no mesmo servidor, e de preferência não no mesmo provedor. Um backup no disco que morreu não é
backup, e um backup na mesma conta cai junto com uma conta bloqueada. O backup do Seed grava em
qualquer bucket compatível com S3. O
[post sobre o deploy](/blog/deploy-saas-to-one-hetzner-server) calcula o custo com o Hetzner Object
Storage, que fica fora do servidor; um bucket em um segundo provedor ainda sobrevive a problemas com
o primeiro.

Três configurações importam mais que o provedor:

1. **Uma chave só para esse bucket**, que possa ler, gravar e apagar lá e em mais nenhum lugar.
2. **Versionamento ou object lock no bucket**, se o provedor oferecer. A chave fica no servidor, e
   quem tomar o servidor poderia apagar também os backups. É essa configuração que transforma
   "apagaram meu servidor" em uma tarde ruim, e não em uma empresa fechada.
3. **A senha do repositório fora do servidor.** Sem ela nenhum snapshot pode ser lido, nem por um
   invasor nem por você.

## Como o Seed faz o backup?

Com `backup` em `COMPOSE_PROFILES`, um contêiner `backup` roda uma vez ao iniciar e depois a cada 24
horas ([infra/backup/backup.sh](https://github.com/spy4x/seed/blob/main/infra/backup/backup.sh)).
Ele salva em um repositório do [restic](https://restic.net), que criptografa cada snapshot e só
transfere o que mudou desde o anterior.

Algumas escolhas nesse script fazem a diferença entre um backup e um arquivo que só parece um:

- **O próprio restic roda o `pg_dump`** e não salva nada quando o `pg_dump` falha, então um dump
  interrompido no meio nunca vira snapshot. O `pg_dump` faz uma exportação consistente enquanto o
  app continua lendo e gravando, e não bloqueia outros usuários
  ([documentação do Postgres](https://www.postgresql.org/docs/current/app-pgdump.html)), então o
  app não para.
- **O dump usa a versão do Postgres do próprio servidor.** A imagem do backup é construída sobre a
  imagem do banco
  ([infra/backup/Dockerfile](https://github.com/spy4x/seed/blob/main/infra/backup/Dockerfile)), por
  isso `pg_dump` e `pg_restore` nunca ficam atrás do servidor.
- **O dump não é comprimido.** Quem comprime é o restic, e ele só encontra o que não mudou em dados
  sem compressão, então o dump diário de um banco que quase não muda fica pequeno.
- **Snapshots antigos são desbastados.** Todos os snapshots dos últimos dois dias ficam, depois um
  por dia durante uma semana, um por semana durante um mês e um por mês durante meio ano
  ([`forget` do restic](https://restic.readthedocs.io/en/stable/060_forget.html)).
- **Uma execução interrompida limpa a própria bagunça.** Um reboot ou o OOM killer podem deixar um
  lock do restic para trás; toda execução remove primeiro os locks vencidos, e a que encontra um
  lock ativo tenta de novo em uma hora.

Ligar o backup é o perfil `backup` e quatro variáveis no arquivo de ambiente, depois um deploy. O perfil fica desligado até
você configurar, então um produto novo não tem backup antes disso.

## Como saber que o backup continua rodando?

Um backup que parou em março é descoberto em junho, no dia em que você precisa dele. O Seed avisa de
três formas:

- `docker ps` mostra o contêiner do backup como unhealthy quando o último backup completo tem mais de
  dois dias.
- O alerta `BackupMissing`
  ([infra/configs/alerts.yml](https://github.com/spy4x/seed/blob/main/infra/configs/alerts.yml))
  manda o mesmo aviso para o ntfy.
- A página System do painel de administração avisa quando o último backup tem 26 horas e mostra um
  erro a partir de 48
  ([libs/domain/identity/admin-system.ts](https://github.com/spy4x/seed/blob/main/libs/domain/identity/admin-system.ts)).

O log diz a causa: uma senha ou chave errada, um lock ou um repositório que não responde.

## Como provar que a restauração funciona?

Restaurando. Não o servidor inteiro: um snapshot em um banco reserva, ao lado do de verdade, com o
app no ar. No Seed, no servidor e na pasta do app (`<db>` é o seu `DB_NAME`):

```sh
deno task compose exec db psql -d postgres -c 'CREATE DATABASE "<db>_restore_test"'
deno task compose run --rm backup restore
deno task compose run --rm -e PGDATABASE=<db>_restore_test backup restore <snapshot id>
deno task compose exec db psql -d <db>_restore_test -c '\dt'
```

A segunda linha lista os snapshots e não muda nada; a terceira carrega o que você indicou. A lista de
tabelas precisa bater com a do banco de verdade. Depois apague o banco reserva. Leva alguns minutos,
e a partir daí "temos backup" é um fato, não uma sensação.

Faça isso uma vez ao ligar o backup e de novo depois de qualquer mudança grande: uma versão nova do
Postgres, um bucket novo, uma senha nova.

O Seed também testa o próprio script. `deno task test:backup` e o passo `backup-restore` da CI, em
todo pull request, fazem backup de um banco com o script real, restauram em um banco vazio e
comparam as linhas
([infra/backup/restore.test.sh](https://github.com/spy4x/seed/blob/main/infra/backup/restore.test.sh)).
O mesmo teste mata uma execução no meio e confere que a seguinte dá certo, e mantém separados dois
projetos que dividem um repositório. Isso prova o script; o seu bucket, a sua chave e a sua senha só
o seu próprio ensaio prova.

## Como restaurar de verdade?

Com calma e sem sobrescrever nada. Todos os comandos estão no
[guia de restauração](/pt-BR/docs/restore); estas são as ideias por trás deles:

1. **Separe o banco danificado, nunca grave por cima.** Pare o app, renomeie o banco e crie um
   vazio. A restauração recusa um banco com tabelas, para que dois estados nunca se misturem.
2. **Escolha o snapshot pela data.** O mais novo nem sempre é o certo: um snapshot feito depois do
   estrago contém o estrago. Por isso o `restore` não tem padrão e informa o snapshot e o horário
   antes de carregar qualquer coisa.
3. **Carregue em uma única transação.** Uma restauração que falha no meio deixa um banco vazio, não
   pela metade (`pg_restore --single-transaction`,
   [documentação do Postgres](https://www.postgresql.org/docs/current/app-pgrestore.html)).
4. **Reinicie o cache, depois o app.** Migrações mais novas que o snapshot rodam como em qualquer
   inicialização.
5. **Traga os arquivos da mesma noite** que o banco.

Em um servidor novo, deixe o backup desligado até terminar a restauração. Senão o servidor novo
salva todo dia o banco vazio dele no mesmo repositório, e depois de sete execuções a limpeza começa
a apagar os snapshots do servidor antigo. Prefiro que você leia isso aqui a descobrir na prática.

## O que o backup do Seed não faz?

- **Não há recuperação para um ponto no tempo.** É um dump por dia, então uma falha pode custar até
  um dia de gravações. O Seed não arquiva o WAL; se uma hora de pedidos perdidos é demais para o seu
  produto, você precisa disso por cima.
- **Ele não relê sozinho os dados guardados.** `restic check` verifica a estrutura do repositório, e
  `--read-data` lê cada pack salvo
  ([documentação do restic](https://restic.readthedocs.io/en/stable/045_working_with_repos.html)),
  mas o script não roda nenhum dos dois. Você pode rodar à mão:
  `deno task compose run --rm backup restic check --read-data-subset=10%`.
- **Ele não ensaia a restauração por você.** A CI testa o script, não o seu bucket.
- **Ele não salva o arquivo de ambiente**, de propósito, e não grava por SSH: o repositório precisa
  ser um bucket S3.
- **Ele fica desligado até você ligar.**

É segurança honesta do dia a dia para um servidor, não a de um banco. Para a maioria dos produtos é
a medida certa: o buraco perigoso raramente é a hora perdida, e sim o backup que ninguém nunca
restaurou.

## Sua vez

Se o Seed já roda para você, ensaie uma restauração hoje: quatro comandos, alguns minutos. Se ainda
está escolhendo onde hospedar, comece por
[como instalar o Seed e rodar localmente](/blog/install-seed-and-run-it-locally), depois
[coloque-o em um servidor da Hetzner](/blog/deploy-saas-to-one-hetzner-server) e ligue o backup na
mesma sentada. Algo nos guias não ficou claro?
[Abra uma issue](https://github.com/spy4x/seed/issues) que eu corrijo.
