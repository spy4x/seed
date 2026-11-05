---
slug: saas-beifen-huifu
language: zh-CN
translationOf: self-hosted-saas-backup-and-restore
title: "自托管 SaaS 怎么备份，以及怎样证明恢复真的能用"
seoTitle: "自托管 SaaS 备份与恢复：Postgres、文件和恢复演练"
description: 一台服务器上的自托管 SaaS 如何把 Postgres 数据库、文件和密钥备份到服务器之外，以及如何在真正需要之前证明恢复可行。
tldr:
  - 把数据库、用户上传的文件和只存在于服务器上的密钥，备份到另一家服务商的存储桶里。
  - 只有恢复才能证明备份有效。往一个备用数据库里恢复一次；在 Seed 里只要四条命令。
  - Seed 每天用 restic 保存 pg_dump、文件和 Web 推送密钥，最近一次备份超过两天就会提醒你。
  - 它没有时间点恢复，最多可能丢失一天的写入，也不会自动回读已存储的数据。
topic: 指南
intro: "把 SaaS 跑在自己的服务器上很便宜，直到硬盘坏掉的那一天。这篇讲该备份什么、放在哪里、怎样证明恢复能用，并以 Seed 自带的备份为例。"
relatedFeature: deploy
coverAlt: "一株紫色植物从小岛上的服务器机柜顶上长出来；水对面的另一座小岛上，一个密封玻璃罐里装着同一株植物的插枝，旁边是正在把插枝移栽进去的花盆。"
author: Anton Shubin
authorUrl: https://antonshubin.com/about
publishAt: 2026-11-08T09:00:00Z
newsletter: true
devto: false
---

自托管 SaaS 的备份，就是每天把三样东西存到另一家服务商的存储里：数据库的转储（dump）、用户上传的文件，以及每一个只存在于服务器上的密钥。备份要加密，密码放在服务器以外的地方，任何一次运行失败都要有人收到通知。然后做大多数人跳过的那一步：把一份备份恢复到备用数据库里，确认表都在。在做到这一步之前，你手里只是一个装满“希望没事”的文件夹。

一台固定月费的服务器是 Seed 的全部思路，而让人不敢自托管的，正是怕丢数据。所以这篇讲 Seed 自带的备份：它保存什么、怎样演练恢复，也同样直白地讲它不做什么。命令都来自[备份指南](/zh-CN/docs/backups)和[恢复指南](/zh-CN/docs/restore)。

## 自托管 SaaS 需要备份什么？

所有无法从 git 重新构建的东西。下面是 Seed 的清单，出自 [docs/backups.md](/zh-CN/docs/backups)：

| 内容                         | 是否备份 | 原因                                         |
| ---------------------------- | -------- | -------------------------------------------- |
| Postgres 数据库（`pg_dump`） | 是       | 账号、群组，以及用户创建的一切。             |
| 上传的文件（自带的 Garage）  | 是       | 它的数据块，以及元数据最新的两份每小时副本。 |
| Web 推送密钥（`vapid.json`） | 是       | 只存在于服务器上；丢了推送就收不到了。       |
| Valkey                       | 否       | 它是缓存，会自己重新填满。                   |
| 生产环境的 env 文件          | 否       | 里面有备份自己的密钥。请自己另存一份。       |
| 存在其他 S3 存储上的文件     | 否       | 由那个存储自己的备份负责。                   |

最容易被忘掉的是 env 文件。它里面有文件存储的密钥和备份的密码，如果备份里包含它，谁能读备份就能同时拿到这两样。把它放进密码管理器，或者加密后放进 git，但不要只放在服务器上。

## 备份应该放在哪里？

不要放在同一台服务器上，最好也不要放在同一家服务商。放在坏掉那块硬盘上的备份不算备份，放在同一个账号里的备份会随着账号被封一起消失。Seed 的备份可以写入任何兼容 S3 的存储桶。[部署到 Hetzner 那篇文章](/blog/deploy-saas-to-one-hetzner-server)用 Hetzner Object Storage 算了费用，它在服务器之外；而另一家服务商的存储桶，还能扛住第一家出的问题。

有三项设置比选哪家服务商更重要：

1. **只给这个存储桶用的密钥**，只能在这里读、写、删，别处一概不行。
2. **存储桶开启版本控制或对象锁**（如果服务商支持）。密钥就在服务器上，不开的话，拿下服务器的人也能把备份删掉。有了这项设置，“服务器被清空了”只是一个糟糕的下午，而不是公司关门。
3. **仓库密码放在服务器之外。** 没有它，谁都读不了任何快照，攻击者不行，你也不行。

## Seed 是怎么做备份的？

`COMPOSE_PROFILES` 里有 `backup` 时，`backup` 容器会在启动时运行一次，之后每 24 小时运行一次（[infra/backup/backup.sh](https://github.com/spy4x/seed/blob/main/infra/backup/backup.sh)）。它把数据存进 [restic](https://restic.net) 仓库，restic 会加密每个快照，并且只传输自上次以来变化的部分。

这个脚本里有几处选择，决定了它是真正的备份，而不是一个看起来像备份的文件：

- **由 restic 自己运行 `pg_dump`**，`pg_dump` 失败就什么都不保存，所以中途断掉的转储永远不会变成快照。`pg_dump` 在应用继续读写时也能导出一致的数据，而且不会阻塞其他用户（[Postgres 文档](https://www.postgresql.org/docs/current/app-pgdump.html)），所以应用不用停。
- **转储用的是服务器自己的 Postgres 版本。** 备份镜像基于数据库镜像构建（[infra/backup/Dockerfile](https://github.com/spy4x/seed/blob/main/infra/backup/Dockerfile)），所以 `pg_dump` 和 `pg_restore` 永远不会落后于服务器。
- **转储不压缩。** 压缩交给 restic，而它只能在未压缩的数据里找出没变的部分，所以一个变化不大的数据库，每天的转储占用很小。
- **旧快照会被稀释。** 最近两天的快照全部保留，之后一周内每天留一个，一个月内每周留一个，半年内每月留一个（[restic 的 `forget`](https://restic.readthedocs.io/en/stable/060_forget.html)）。
- **被中断的运行会自己收拾。** 重启或 OOM killer 可能留下 restic 的锁；每次运行都会先清掉过期的锁，遇到仍然有效的锁则一小时后重试。

开启它只需要在 env 文件里加上 `backup` profile、设四个变量，然后部署。在你配置之前这个 profile 是关闭的，所以新产品一开始没有备份。

## 怎么知道备份还在正常运行？

三月就停掉的备份，往往到六月、真正需要它的那天才被发现。Seed 用三种方式提醒你：

- 最近一次完整备份超过两天时，`docker ps` 会把备份容器显示为 unhealthy。
- `BackupMissing` 告警（[infra/configs/alerts.yml](https://github.com/spy4x/seed/blob/main/infra/configs/alerts.yml)）会把同样的消息发到 ntfy。
- 管理后台的 System 页面在最近一次备份满 26 小时时给出警告，满 48 小时显示错误（[libs/domain/identity/admin-system.ts](https://github.com/spy4x/seed/blob/main/libs/domain/identity/admin-system.ts)）。

日志会写明原因：密码或密钥错误、被锁住，或者仓库没有响应。

## 怎样证明恢复能用？

真的恢复一次。不是恢复整台服务器，而是把一个快照恢复到正式数据库旁边的备用数据库里，应用照常运行。在 Seed 里，到服务器上应用所在的目录执行（`<db>` 是你的 `DB_NAME`）：

```sh
deno task compose exec db psql -d postgres -c 'CREATE DATABASE "<db>_restore_test"'
deno task compose run --rm backup restore
deno task compose run --rm -e PGDATABASE=<db>_restore_test backup restore <snapshot id>
deno task compose exec db psql -d <db>_restore_test -c '\dt'
```

第二行列出快照，不改动任何东西；第三行加载你指定的快照。表的列表必须和正式数据库一致。最后删掉备用数据库。整个过程几分钟，做完之后，“我们有备份”就是事实，而不再是感觉。

开启备份后做一次，之后每次有大变动再做一次：新的 Postgres 版本、新的存储桶、新的密码。

Seed 也测试脚本本身。`deno task test:backup` 和 CI 里的 `backup-restore` 步骤会在每个 pull request 上用真实脚本备份一个数据库，恢复到空数据库里，再比对数据行（[infra/backup/restore.test.sh](https://github.com/spy4x/seed/blob/main/infra/backup/restore.test.sh)）。同一个测试还会在中途杀掉一次运行，确认下一次能成功，并确保共用一个仓库的两个项目互不干扰。这证明的是脚本；你的存储桶、密钥和密码，只有你自己的演练才能证明。

## 真要恢复时怎么做？

慢慢来，不覆盖任何东西。所有命令都在[恢复指南](/zh-CN/docs/restore)里，这里讲背后的思路：

1. **把损坏的数据库挪开，绝不直接覆盖。** 停掉应用，给数据库改名，再建一个空库。恢复会拒绝写入有表的数据库，所以两种状态永远不会混在一起。
2. **按日期挑快照。** 最新的不一定对：损坏发生之后的快照里也带着损坏。所以 `restore` 没有默认值，加载之前会先报出快照和它的时间。
3. **在一个事务里加载。** 中途失败的恢复留下的是空库，而不是装了一半的库（`pg_restore --single-transaction`，[Postgres 文档](https://www.postgresql.org/docs/current/app-pgrestore.html)）。
4. **先重启缓存，再启动应用。** 比快照新的迁移会像平时启动一样执行。
5. **文件要恢复同一晚的**，和数据库对应。

在新服务器上，恢复完成之前先别开备份。否则新服务器每天都会把它的空数据库存进同一个仓库，运行七次之后，清理就会开始删除旧服务器的快照。这件事我宁愿你在这里读到，也不想你亲自踩坑发现。

## Seed 的备份不做什么？

- **没有时间点恢复。** 每天只做一次转储，所以一次故障最多可能丢掉一天的写入。Seed 不归档 WAL；如果丢一小时的订单对你的产品来说都太多，那你需要另外加上这一层。
- **它不会自动回读已存储的数据。** `restic check` 检查仓库结构，`--read-data` 会读取每一个已存储的数据包（[restic 文档](https://restic.readthedocs.io/en/stable/045_working_with_repos.html)），但脚本两者都不运行。你可以手动执行：`deno task compose run --rm backup restic check --read-data-subset=10%`。
- **它不会替你演练恢复。** CI 测的是脚本，不是你的存储桶。
- **它不保存 env 文件**，这是有意的；它也不能通过 SSH 写入：仓库必须是 S3 存储桶。
- **在你开启之前，它是关闭的。**

这是给单台服务器的、实在的日常级安全，不是银行级。对大多数产品来说正合适：真正危险的漏洞很少是丢掉的那一小时，而是从来没人恢复过的那份备份。

## 轮到你了

如果你已经在跑 Seed，今天就演练一次恢复：四条命令，几分钟。如果还在挑在哪里托管，先看[如何安装 Seed 并在本地运行](/blog/install-seed-and-run-it-locally)，再[把它部署到一台 Hetzner 服务器](/blog/deploy-saas-to-one-hetzner-server)，同一次就把备份打开。指南里有哪里不清楚？[提个 issue](https://github.com/spy4x/seed/issues)，我来改。
