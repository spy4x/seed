import type { TagColor } from "@domain/tags"

/**
 * The words and names the demo's fake data is built from (docs/demo.md): people's names by
 * culture, one theme per group with notes that each read as their own, the browsers people sign in
 * with, and the newsletter's sent issues. Data only; `fake-data.ts` picks from it.
 */

/** First and last names that belong together, one pool per Western culture. */
export const NAME_POOLS: readonly { first: readonly string[]; last: readonly string[] }[] = [
  {
    first: [`James`, `Olivia`, `William`, `Emma`, `Benjamin`, `Charlotte`, `Henry`, `Amelia`],
    last: [`Smith`, `Johnson`, `Taylor`, `Walker`, `Wright`, `Carter`, `Hughes`, `Bennett`],
  },
  {
    first: [`Siobhan`, `Liam`, `Aoife`, `Conor`, `Niamh`, `Cian`, `Ciara`, `Seán`],
    last: [`Murphy`, `Walsh`, `O'Brien`, `Byrne`, `Kelly`, `Ryan`, `Doyle`, `Gallagher`],
  },
  {
    first: [`Élodie`, `Julien`, `Camille`, `Hugo`, `Léa`, `Mathis`, `Chloé`, `Antoine`],
    last: [`Dubois`, `Moreau`, `Laurent`, `Lefèvre`, `Girard`, `Bonnet`, `Fontaine`, `Rousseau`],
  },
  {
    first: [`Lukas`, `Hannah`, `Felix`, `Lena`, `Jonas`, `Mia`, `Paul`, `Clara`],
    last: [`Müller`, `Schmidt`, `Becker`, `Wagner`, `Hoffmann`, `Schulz`, `Fischer`, `Weber`],
  },
  {
    first: [`Daan`, `Sanne`, `Bram`, `Fleur`, `Joris`, `Lotte`, `Thijs`, `Femke`],
    last: [`de Vries`, `Jansen`, `Visser`, `Bakker`, `Smit`, `Meijer`, `de Boer`, `Mulder`],
  },
  {
    first: [`Astrid`, `Lars`, `Ingrid`, `Erik`, `Sigrid`, `Nils`, `Freya`, `Magnus`],
    last: [`Lindqvist`, `Andersen`, `Johansson`, `Berg`, `Nilsen`, `Holm`, `Larsen`, `Eriksson`],
  },
  {
    first: [`Giulia`, `Marco`, `Chiara`, `Luca`, `Francesca`, `Matteo`, `Alessia`, `Lorenzo`],
    last: [`Rossi`, `Ricci`, `Esposito`, `Romano`, `Conti`, `Bruno`, `Gallo`, `Marino`],
  },
  {
    first: [`Mateo`, `Valentina`, `Diego`, `Lucía`, `Santiago`, `Carmen`, `Pablo`, `Elena`],
    last: [`García`, `Hernández`, `López`, `Martínez`, `Ramírez`, `Torres`, `Navarro`, `Ruiz`],
  },
  {
    first: [`João`, `Ana`, `Lucas`, `Beatriz`, `Rafael`, `Inês`, `Tiago`, `Marta`],
    last: [`Silva`, `Santos`, `Oliveira`, `Costa`, `Pereira`, `Almeida`, `Ferreira`, `Carvalho`],
  },
]

/**
 * The person the admin panel's video follows (`docs/screenshots/admin-video.ts`): always there.
 * No pool has the surname, so the video's search for it finds her and her {@link VIDEO_NAMESAKES}.
 */
export const VIDEO_PERSON = { firstName: `Claire`, lastName: `Hartley` } as const

/** The first names of the two other people who share {@link VIDEO_PERSON}'s surname. */
export const VIDEO_NAMESAKES = [`Daniel`, `Rose`] as const

/** A sample note: its title and a body that reads as its own. */
export interface ThemeNote {
  title: string
  body: string
}

/** One theme per group: its name, how many members besides the owner, its tags and notes. */
export interface Theme {
  name: string
  members: readonly [min: number, max: number]
  tags: readonly { name: string; color: TagColor }[]
  notes: readonly ThemeNote[]
}

export const THEMES: readonly Theme[] = [
  {
    name: `Product team`,
    members: [9, 13],
    tags: [
      { name: `roadmap`, color: `#1d4ed8` },
      { name: `bug`, color: `#b91c1c` },
      { name: `idea`, color: `#7e22ce` },
      { name: `done`, color: `#15803d` },
    ],
    notes: [
      {
        title: `Q3 roadmap draft`,
        body:
          `Three bets for the quarter: offline search, shared tags and a calmer inbox.\nEach one needs an owner before Monday's planning.`,
      },
      {
        title: `Onboarding drop-off: what we know`,
        body:
          `Most people who leave do it on the second screen, right after naming their group.\n\n- Half never open the invite step\n- Phones drop twice as often\n- Nobody reads the tooltip`,
      },
      {
        title: `Pricing page feedback`,
        body:
          `Five customers said the per-member price is clear. Two missed that the owner counts as a member, so it is worth one more line under the price.`,
      },
      {
        title: `Release notes for 2.4`,
        body:
          `Faster note search, tag colours, and the group switcher finally remembers where you were.\nEdits welcome until Thursday.`,
      },
      {
        title: `Customer interview: Acme Corp`,
        body:
          `Their ops lead uses groups as shared runbooks. She wants to pin two notes to the top of a group and would pay for it.`,
      },
      {
        title: `Search is slow on large accounts`,
        body:
          `Reproduced with 12,000 notes: the first query takes 1.8 s, the ones after are fast. Probably a cold index; checking with Engineering.`,
      },
      {
        title: `Dark mode polish list`,
        body:
          `- Tag chips lose contrast on the grey background\n- The empty-state picture is too bright\n- The focus ring is hard to see in the sidebar`,
      },
      {
        title: `Weekly product sync`,
        body:
          `Agenda: churn numbers, the beta feedback form, and who answers support while Lena is away.`,
      },
      {
        title: `Ideas for the referral program`,
        body:
          `A free month for both sides is what everyone does. Could we give an extra member instead? Cheaper for us, more useful for a group.`,
      },
      {
        title: `Mobile app beta checklist`,
        body:
          `- TestFlight group set up\n- Crash reports on\n- Feedback form linked from the menu\n- Store screenshots, still missing`,
      },
    ],
  },
  {
    name: `Marketing`,
    members: [5, 8],
    tags: [
      { name: `blog`, color: `#c2410c` },
      { name: `social`, color: `#1d4ed8` },
      { name: `launch`, color: `#7e22ce` },
    ],
    notes: [
      {
        title: `Launch post outline`,
        body:
          `Open with the problem in one sentence, then the 40-second video, then three things a reader can do on day one. Pricing goes last.`,
      },
      {
        title: `Newsletter topics for next month`,
        body:
          `- How a support team uses tags\n- A customer story from the beta\n- Keyboard shortcuts nobody knows about`,
      },
      {
        title: `Landing page headline tests`,
        body:
          `Variant B, "Notes your whole team can find", beat the current one by 11% on sign-ups over two weeks. Shipping it.`,
      },
      {
        title: `Conference talk proposal`,
        body:
          `Working title: "What we learned shipping an offline-first app". The call for papers closes on the 15th.`,
      },
      {
        title: `Case study: Northwind`,
        body:
          `They moved 400 notes from a shared drive in one afternoon. We still need a quote from their team lead and one screenshot.`,
      },
      {
        title: `SEO keywords to target`,
        body:
          `Team notes app, shared notes for small teams, offline notes with sync. The generic "note taking" terms are not worth the fight.`,
      },
      {
        title: `Social calendar, next two weeks`,
        body:
          `Tuesday: the release clip. Thursday: a customer quote. Saturday: nothing, nobody reads it.`,
      },
      {
        title: `Podcast guest list`,
        body: `Four founders who build in public made the shortlist. Hannah knows two of them.`,
      },
    ],
  },
  {
    name: `Engineering`,
    members: [6, 8],
    tags: [
      { name: `infra`, color: `#4b5563` },
      { name: `incident`, color: `#b91c1c` },
      { name: `rfc`, color: `#1d4ed8` },
      { name: `tech-debt`, color: `#c2410c` },
    ],
    notes: [
      {
        title: `RFC: move jobs to the outbox`,
        body:
          `Jobs are written in the same transaction as the change, so a crash can never lose one. Comments open until Wednesday.`,
      },
      {
        title: `Postgres upgrade plan`,
        body:
          `A dry run on a copy first, then a ten-minute window on Sunday morning. Rollback is the snapshot from the night before.`,
      },
      {
        title: `Incident review: login outage`,
        body:
          `23 minutes of failed sign-ins after a config change. The new proxy dropped one header.\n\n- Smoke-test sign-in after every deploy\n- Alert on the sign-in error rate`,
      },
      {
        title: `On-call handbook`,
        body:
          `Who to page, where the dashboards live and how to roll back. Read it before your first week on call.`,
      },
      {
        title: `Flaky tests to fix`,
        body:
          `The invitation browser test fails about once in 30 runs, always on the same wait. Taking it this sprint.`,
      },
      {
        title: `Backup restore drill`,
        body:
          `Restored last night's backup into a scratch database in six minutes. Row counts match. Next drill in a month.`,
      },
      {
        title: `API rate limits`,
        body:
          `Proposal: 120 requests a minute per token, with a header that says how many are left.`,
      },
      {
        title: `Dependency updates`,
        body:
          `Twelve packages behind, none with a known security issue. One pull request for all of them on Friday.`,
      },
      {
        title: `Code review guidelines`,
        body:
          `Review within one working day. Ask questions instead of rewriting. Approve when it is better than before, not when it is perfect.`,
      },
    ],
  },
  {
    name: `Book club`,
    members: [4, 7],
    tags: [
      { name: `to-read`, color: `#1d4ed8` },
      { name: `finished`, color: `#15803d` },
      { name: `favourite`, color: `#7e22ce` },
    ],
    notes: [
      {
        title: `Next month's pick`,
        body: `Votes so far: "Piranesi" 4, "The Remains of the Day" 3. Last call on Sunday.`,
      },
      {
        title: `Notes on "The Left Hand of Darkness"`,
        body:
          `The crossing of the ice is the best part of the book. Did anyone else find the first 50 pages slow?`,
      },
      {
        title: `Meeting schedule`,
        body:
          `First Thursday of the month at 7 pm, at Chiara's place unless it rains. Bring snacks, not spoilers.`,
      },
      {
        title: `Books everyone suggested`,
        body:
          `- "Klara and the Sun"\n- "Pachinko"\n- "Station Eleven"\n- "The Overstory", long but worth it`,
      },
      {
        title: `Questions for Thursday`,
        body: `Why does the narrator never name the town? And was the ending hopeful or not?`,
      },
      {
        title: `Favourite quotes so far`,
        body: `Collecting them here, so we can read a few aloud at the start of the evening.`,
      },
    ],
  },
  {
    name: `Home renovation`,
    members: [1, 2],
    tags: [
      { name: `kitchen`, color: `#c2410c` },
      { name: `budget`, color: `#b91c1c` },
      { name: `done`, color: `#15803d` },
    ],
    notes: [
      {
        title: `Kitchen layout options`,
        body:
          `An L shape keeps the window free. A galley fits more cupboards but feels narrow. Leaning towards the L.`,
      },
      {
        title: `Quotes from contractors`,
        body:
          `Three quotes in, from 8,400 to 11,200. The middle one includes taking the old units away.`,
      },
      {
        title: `Paint colours shortlist`,
        body:
          `Warm white for the hall, sage for the kitchen. Testing samples on the north wall this weekend.`,
      },
      {
        title: `Budget tracker`,
        body: `3,100 of 12,000 spent so far. The tiles came in under budget, the electrician over.`,
      },
      {
        title: `Things to buy this weekend`,
        body: `- Masking tape\n- Two more rollers\n- 6 mm wall plugs\n- Coffee for the painters`,
      },
      {
        title: `Bathroom tiles`,
        body:
          `The matte grey ones scratch too easily. Going with the glazed ones, even if they cost a bit more.`,
      },
      {
        title: `Permit paperwork`,
        body:
          `Only moving the wall needs one. The form went in on the 3rd; the answer comes within four weeks.`,
      },
    ],
  },
  {
    name: `Trip to Japan`,
    members: [2, 3],
    tags: [
      { name: `booking`, color: `#1d4ed8` },
      { name: `food`, color: `#c2410c` },
      { name: `must-see`, color: `#7e22ce` },
    ],
    notes: [
      {
        title: `Itinerary, two weeks`,
        body:
          `Tokyo 4 nights, Kanazawa 2, Kyoto 4, Osaka 3, and one night in Hakone at the end to rest.`,
      },
      {
        title: `Ryokan options in Kyoto`,
        body:
          `Two with dinner included, both near the river. The cheaper one has shared baths only.`,
      },
      {
        title: `Rail pass: worth it?`,
        body: `Only if we go to Kanazawa and Hiroshima. Otherwise single tickets come out cheaper.`,
      },
      {
        title: `Restaurants to try in Osaka`,
        body:
          `Okonomiyaki near Dotonbori, the standing sushi bar Tom keeps talking about, and anything at Kuromon market.`,
      },
      {
        title: `Packing list`,
        body:
          `- A light rain jacket\n- Comfortable shoes, already broken in\n- A coin purse\n- Plug adapter, type A`,
      },
      {
        title: `Phrases to learn`,
        body: `Thank you, excuse me, and "one more, please". Also how to ask for no fish, for Sam.`,
      },
      {
        title: `Day trip to Nara`,
        body:
          `Early train to beat the crowds at Todai-ji. The deer are pushy, so keep the map in a pocket.`,
      },
    ],
  },
  {
    name: `Design studio`,
    members: [4, 6],
    tags: [
      { name: `client`, color: `#1d4ed8` },
      { name: `review`, color: `#c2410c` },
      { name: `approved`, color: `#15803d` },
    ],
    notes: [
      {
        title: `Brand refresh brief`,
        body:
          `The client wants to look less corporate without losing trust. The budget covers the logo, colours and type.`,
      },
      {
        title: `Feedback on the logo concepts`,
        body:
          `Concept 2 won the room. They asked for a heavier weight and a version without the tagline.`,
      },
      {
        title: `Icon set inventory`,
        body:
          `86 icons in use, 23 of them near-duplicates. Merging them saves a whole review round.`,
      },
      {
        title: `Type scale proposal`,
        body: `Eight steps from 12 to 48 px on a 1.25 ratio. Body text stays at 16.`,
      },
      {
        title: `Client workshop agenda`,
        body: `45 minutes: goals, three mood boards, a vote with stickers, and the next steps.`,
      },
      {
        title: `Accessibility audit notes`,
        body:
          `Six contrast failures, all in the grey text. Two buttons have no name for screen readers.`,
      },
    ],
  },
  {
    name: `Running club`,
    members: [6, 8],
    tags: [
      { name: `race`, color: `#b91c1c` },
      { name: `training`, color: `#1d4ed8` },
    ],
    notes: [
      {
        title: `Autumn half marathon plan`,
        body:
          `Ten weeks, three runs a week. The long run grows by 1.5 km each Sunday, with an easy week every fourth.`,
      },
      {
        title: `Sunday long run routes`,
        body:
          `The river loop for 12 km, the park and back for 16. The fountain at the bridge works again.`,
      },
      {
        title: `Interval sessions`,
        body:
          `Tuesdays at the track: 6 × 800 m with a 400 m jog between. Bring a watch, not a phone.`,
      },
      {
        title: `Shoe recommendations`,
        body:
          `Most of us swear by a wide toe box. Try them on in the afternoon, when feet are bigger.`,
      },
      {
        title: `Race day checklist`,
        body: `- Bib and pins\n- Gels for km 10 and 16\n- An old jumper to leave at the start`,
      },
    ],
  },
  {
    name: `Wedding planning`,
    members: [1, 2],
    tags: [
      { name: `venue`, color: `#7e22ce` },
      { name: `guests`, color: `#1d4ed8` },
      { name: `budget`, color: `#b91c1c` },
    ],
    notes: [
      {
        title: `Venue shortlist`,
        body: `The barn has the view, the hotel has the parking. Visiting both on Saturday.`,
      },
      {
        title: `Guest list draft`,
        body: `112 names, which is 30 too many. Each side cuts 15 by Friday.`,
      },
      {
        title: `Music for the evening`,
        body: `A band for the first two hours, then a playlist. Everyone gets to add three songs.`,
      },
      {
        title: `Questions for the caterer`,
        body:
          `A vegetarian main for 14, a children's menu, and whether they bring their own plates.`,
      },
    ],
  },
  {
    name: `Research lab`,
    members: [5, 8],
    tags: [
      { name: `paper`, color: `#1d4ed8` },
      { name: `data`, color: `#15803d` },
      { name: `meeting`, color: `#c2410c` },
    ],
    notes: [
      {
        title: `Reading group, week 6`,
        body: `Two papers on sparse attention. Lukas presents the first, discussion after lunch.`,
      },
      {
        title: `Experiment log, run 14`,
        body:
          `Learning rate halved after epoch 8. Validation loss has been flat since; stopping at 20 unless it moves.`,
      },
      {
        title: `Grant report outline`,
        body:
          `Progress, outputs, budget, and the plan for year two. Drafts by the 20th, the report by the end of the month.`,
      },
      {
        title: `Lab meeting notes`,
        body:
          `The new cluster quota starts next week. Please clear out old checkpoints: the disk is 91% full.`,
      },
      {
        title: `Data sharing agreement`,
        body: `Legal approved the template. Each partner signs before we send them anything.`,
      },
    ],
  },
  {
    name: `Support team`,
    members: [4, 7],
    tags: [
      { name: `urgent`, color: `#b91c1c` },
      { name: `billing`, color: `#c2410c` },
      { name: `faq`, color: `#15803d` },
    ],
    notes: [
      {
        title: `Saved replies`,
        body:
          `Password reset, adding a member, changing the plan. Keep each one under five sentences.`,
      },
      {
        title: `Escalation rules`,
        body:
          `Anything about money or lost data goes to a lead within the hour. Everything else the same day.`,
      },
      {
        title: `Weekly ticket review`,
        body:
          `Volume is down 8% since the new help page. The most common topic is still invitations.`,
      },
      {
        title: `Refund policy, in plain words`,
        body: `A full refund within 14 days, no questions asked. After that, we look at each case.`,
      },
      {
        title: `Holiday cover`,
        body:
          `Sophie covers the first week, Felix the second. The auto-reply mentions slower answers.`,
      },
    ],
  },
  {
    name: `Community garden`,
    members: [6, 8],
    tags: [
      { name: `planting`, color: `#15803d` },
      { name: `tools`, color: `#4b5563` },
      { name: `events`, color: `#7e22ce` },
    ],
    notes: [
      {
        title: `Planting calendar`,
        body: `Garlic in October, broad beans in November, then nothing until March.`,
      },
      {
        title: `Tool shed inventory`,
        body: `Two spades are missing again. Please sign tools out on the clipboard.`,
      },
      {
        title: `Harvest swap`,
        body:
          `Last Saturday of the month at 10. Bring what you have too much of, take what you need.`,
      },
      {
        title: `Watering rota`,
        body: `Pairs of two, one week each. Swap with someone directly, then update the list here.`,
      },
    ],
  },
  {
    name: `Podcast`,
    members: [1, 3],
    tags: [
      { name: `episode`, color: `#1d4ed8` },
      { name: `guest`, color: `#7e22ce` },
      { name: `edit`, color: `#c2410c` },
    ],
    notes: [
      {
        title: `Episode 18 outline`,
        body:
          `Cold open with the failed launch story, then the three lessons, then listener questions.`,
      },
      {
        title: `Guest wishlist`,
        body:
          `Someone who runs a one-person company, someone who sold one, and someone who shut one down.`,
      },
      {
        title: `Editing notes, episode 17`,
        body:
          `Cut the two minutes about microphones. Raise the guest's level a little in the second half.`,
      },
      {
        title: `Sponsor read`,
        body: `Thirty seconds, in our own words. They asked us not to say "best".`,
      },
    ],
  },
  {
    name: `Family`,
    members: [2, 4],
    tags: [
      { name: `school`, color: `#1d4ed8` },
      { name: `home`, color: `#15803d` },
      { name: `trips`, color: `#c2410c` },
    ],
    notes: [
      {
        title: `School pick-up rota`,
        body:
          `Monday and Wednesday: Dad. Tuesday and Thursday: Grandma. Friday: whoever finishes work first.`,
      },
      {
        title: `Birthday party plan`,
        body:
          `Twelve children, the park if it is dry and the community hall if not. The cake is ordered.`,
      },
      {
        title: `Weekend in the mountains`,
        body: `The cabin is booked for two nights. Pack boots and the card games.`,
      },
      {
        title: `Things to fix at home`,
        body:
          `- The dripping tap in the bathroom\n- The squeaky door upstairs\n- The smoke alarm battery`,
      },
    ],
  },
]

/** A browser people sign in with: its user agent, from which the API names the device. */
export const DEVICES: readonly string[] = [
  `Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0`,
  `Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1`,
  `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36`,
  `Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36`,
  `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0`,
  `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15`,
  `Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0`,
  `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36`,
  `Mozilla/5.0 (iPad; CPU OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1`,
  `Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36`,
]

/** The video person's two browsers: Firefox on Windows and Safari on an iPhone. */
export const VIDEO_PERSON_DEVICES = [0, 1] as const

/** The newsletter's sent issues, newest first: the issue's id, its subject, days since it went. */
export const SENT_ISSUES: readonly { issue: string; subject: string; daysAgo: number }[] = [
  { issue: `search-first-time`, subject: `Search that finds it the first time`, daysAgo: 5 },
  {
    issue: `hand-a-group-over`,
    subject: `Hand a group over without losing a thing`,
    daysAgo: 34,
  },
  { issue: `tags-and-colours`, subject: `Tags, colours and a calmer list`, daysAgo: 63 },
]

/** What people rename their first group, "Personal", to. */
export const FIRST_GROUP_NAMES = [
  `Ideas`,
  `Work`,
  `Reading list`,
  `Side project`,
  `Recipes`,
  `Thesis`,
  `Freelance`,
  `Journal`,
  `Inbox`,
  `Learning Spanish`,
  `Garden`,
  `Gift ideas`,
] as const

/** Small groups a few recent sign-ups start together: two to four people, a couple of notes. */
export const SMALL_THEMES: readonly Theme[] = [
  {
    name: `Flat 4B`,
    members: [1, 2],
    tags: [{ name: `bills`, color: `#c2410c` }],
    notes: [
      {
        title: `Cleaning rota`,
        body: `Kitchen: Mon/Thu. Bathroom: Sat. Swap in the chat if needed.`,
      },
      {
        title: `Internet contract`,
        body: `Ends in March. The fibre offer downstairs is €5 cheaper.`,
      },
    ],
  },
  {
    name: `Climbing crew`,
    members: [2, 3],
    tags: [{ name: `trip`, color: `#15803d` }],
    notes: [
      { title: `Gym times`, body: `Tuesday 7 pm works for everyone but Sam. Friday as a backup.` },
      { title: `Gear to borrow`, body: `Two harnesses spare, no size 42 shoes. Chalk is shared.` },
      { title: `Outdoor day`, body: `Weather looks dry on the 2nd. Meet at the car park at 9.` },
    ],
  },
  {
    name: `Thesis group`,
    members: [2, 3],
    tags: [{ name: `deadline`, color: `#b91c1c` }, { name: `reading`, color: `#1d4ed8` }],
    notes: [
      {
        title: `Draft deadlines`,
        body: `Chapter 2 to the supervisor by the 15th, feedback round after.`,
      },
      {
        title: `Shared sources`,
        body: `The survey paper from 2023 cites all three datasets we use.`,
      },
    ],
  },
  {
    name: `Side project`,
    members: [1, 2],
    tags: [{ name: `idea`, color: `#7e22ce` }],
    notes: [
      {
        title: `Name ideas`,
        body: `Shortlist: Tidy, Ledgerly, Plainbook. Check the domains first.`,
      },
      { title: `First week`, body: `Landing page, a waitlist form and ten people to talk to.` },
    ],
  },
  {
    name: `Wedding guests`,
    members: [1, 2],
    tags: [{ name: `rsvp`, color: `#b91c1c` }],
    notes: [
      {
        title: `Who still has to answer`,
        body: `Aunt Rosa, the Lindqvists and two from the office.`,
      },
      { title: `Seating`, body: `Keep the cousins away from the speakers this time.` },
    ],
  },
  {
    name: `Study group`,
    members: [2, 3],
    tags: [{ name: `exam`, color: `#b91c1c` }],
    notes: [
      {
        title: `Topics we split`,
        body: `Graphs to me, dynamic programming to Lea, the rest together.`,
      },
      { title: `Mock exam`, body: `Saturday 10:00 in the library, room 3. Timed, no phones.` },
      { title: `Formulas`, body: `Write them out by hand once; it sticks better than reading.` },
    ],
  },
  {
    name: `Band practice`,
    members: [2, 3],
    tags: [{ name: `setlist`, color: `#c2410c` }],
    notes: [
      { title: `Setlist for the 14th`, body: `Open fast, the slow one third, the cover last.` },
      { title: `Rehearsal room`, body: `Booked Wednesdays 8–10 pm until the end of the month.` },
    ],
  },
  {
    name: `Volunteers`,
    members: [2, 3],
    tags: [{ name: `shift`, color: `#1d4ed8` }],
    notes: [
      { title: `Food bank shifts`, body: `Saturday mornings need two more people from next week.` },
      { title: `Van keys`, body: `With the front desk. Sign the sheet when you take them.` },
    ],
  },
  {
    name: `Supper club`,
    members: [2, 3],
    tags: [{ name: `menu`, color: `#c2410c` }],
    notes: [
      { title: `Next host`, body: `Pieter, then Ingrid. Theme for March: one pot only.` },
      {
        title: `Allergies`,
        body: `No nuts for Emma, no pork for Marco. Everything else is fair game.`,
      },
    ],
  },
  {
    name: `Garden plot 12`,
    members: [1, 2],
    tags: [{ name: `sowing`, color: `#15803d` }],
    notes: [
      { title: `What we planted`, body: `Garlic in the back row, broad beans along the fence.` },
      { title: `Watering`, body: `Every other evening in a dry week. The tap is by the shed.` },
    ],
  },
  {
    name: `Board games night`,
    members: [2, 3],
    tags: [{ name: `to-buy`, color: `#7e22ce` }],
    notes: [
      { title: `Games we own`, body: `Catan, Azul, Codenames, and the long one nobody finishes.` },
      { title: `Next host`, body: `Second Friday at Liam's. Snacks rotate, the host makes tea.` },
    ],
  },
  {
    name: `Kids' school`,
    members: [1, 2],
    tags: [{ name: `forms`, color: `#c2410c` }],
    notes: [
      {
        title: `Forms to sign`,
        body: `Museum trip permission by Thursday, photo consent by Monday.`,
      },
      { title: `Pick-up rota`, body: `Mon/Wed me, Tue/Thu you, Fridays whoever finishes first.` },
    ],
  },
  {
    name: `Hiking Patagonia`,
    members: [2, 3],
    tags: [{ name: `booking`, color: `#1d4ed8` }],
    notes: [
      { title: `Refugios`, body: `Two nights booked, one waitlisted. Pay the rest by the 1st.` },
      {
        title: `Kit list`,
        body: `Rain shell, gaiters, two warm layers, a spare headlamp battery.`,
      },
      { title: `Flights`, body: `Cheapest via Santiago on a Tuesday. Hold off a week.` },
    ],
  },
  {
    name: `Freelance clients`,
    members: [1, 2],
    tags: [{ name: `invoice`, color: `#15803d` }],
    notes: [
      { title: `Invoices due`, body: `Two sent, one overdue by a week. Send a friendly reminder.` },
      { title: `Rates`, body: `Day rate up 10% from January; tell existing clients in December.` },
    ],
  },
  {
    name: `Language exchange`,
    members: [2, 3],
    tags: [{ name: `topic`, color: `#7e22ce` }],
    notes: [
      { title: `This week's topic`, body: `Food from home. Half in English, half in Portuguese.` },
      { title: `Where we meet`, body: `The café by the station, Thursday 6:30 pm, upstairs.` },
    ],
  },
  {
    name: `Home studio`,
    members: [1, 2],
    tags: [{ name: `gear`, color: `#4b5563` }],
    notes: [
      {
        title: `Acoustic panels`,
        body: `Six for the back wall, two for the corners. Measure first.`,
      },
      { title: `Mic choice`, body: `The dynamic one: the room is too live for a condenser.` },
    ],
  },
]

/** Notes people keep in their own first group, picked a few at a time. */
export const PERSONAL_NOTES: readonly ThemeNote[] = [
  { title: `Groceries`, body: `Oat milk, lemons, rice, coffee beans, dish soap.` },
  { title: `Books to read`, body: `"Piranesi", "The Dispossessed", "Educated".` },
  { title: `Gift ideas`, body: `Mum: a good scarf. Leo: the Lego set he keeps looking at.` },
  { title: `Passwords to change`, body: `Old email, the bank app, the router. Use the manager.` },
  { title: `Running plan`, body: `3 runs a week: one long, one easy, one with hills.` },
  {
    title: `Recipe: dal`,
    body: `Red lentils, onion, garlic, ginger, cumin, a tin of tomatoes. 25 minutes.`,
  },
  { title: `Call the dentist`, body: `Ask about the cleaning and the cracked filling, top left.` },
  { title: `Holiday packing`, body: `Charger, adapter, swim things, the good sunglasses.` },
  { title: `Podcast list`, body: `The one about city planning, and the cooking one Ana liked.` },
  {
    title: `Ideas for the weekend`,
    body: `Flea market Saturday morning, the new exhibition on Sunday.`,
  },
  { title: `Car service`, body: `Due in 1,000 km. Ask them to look at the left rear tyre.` },
  { title: `Meeting notes`, body: `Agreed: ship the draft Friday, review on Monday.` },
  { title: `Words to look up`, body: `Sonder, hygge, saudade, mamihlapinatapai.` },
  { title: `Budget for the month`, body: `Rent first, then savings, then everything else.` },
  { title: `Plants`, body: `Water the fern twice a week. The cactus is fine on its own.` },
  { title: `Films to watch`, body: `"Perfect Days", "Past Lives", the new Miyazaki.` },
  { title: `Learning Spanish`, body: `Ten minutes a day. This week: the past tense, again.` },
  { title: `Things to fix at home`, body: `Dripping tap, the wobbly chair, the hallway light.` },
  { title: `Birthday list`, body: `Freya on the 3rd, Matteo on the 19th, Dad on the 28th.` },
  { title: `Work ideas`, body: `A checklist for new hires; a shorter weekly report.` },
  { title: `Bike route`, body: `Along the canal to the bridge, back through the park: 18 km.` },
  { title: `Reading notes`, body: `Chapter 4: habits stick when they are easy and obvious.` },
  { title: `Moving checklist`, body: `Change the address with the bank, the doctor and the post.` },
  {
    title: `Questions for the landlord`,
    body: `Heating schedule, bike storage, when the deposit comes back.`,
  },
]
