# Covers of Seed's blog posts

Every post of seedsaas.com's blog has one cover: an editorial illustration made by an image model
in one house style, so the blog list and link previews read as one set. Each post has three files:

- `<slug>.webp`: 1600×900 (16:9), for the post page and link previews;
- `<slug>-960.webp`: 960×540, for a phone's full-width cover;
- `<slug>-640.webp`: 640×360, for the post list.

Translations share their original's cover: a post with a `translationOf` slug uses the files of
the slug it translates and has no cover of its own.

## The house style

`HOUSE_STYLE` in `blog-cover.ts` is the source; the script sends it before every scene.

- Flat vector shapes in a gentle isometric view, soft paper grain, soft shadows and generous empty
  space: calm editorial art, like a technology magazine's.
- One accent, Seed's violet (`#59168B`, the brand's `oklch(0.381 0.176 305)` from
  `libs/ui/brand.css`), with its lavender tints, warm greys and charcoal, on a muted lavender-grey
  background of its own, so the picture sits well on the site's light and dark themes alike.
- One subject that shows the post's point as a metaphor: a plant on a server, a bridge with a
  ferry below it, a scale.
- Never text, letters or numbers, logos or brand marks, code, screenshots, interface mockups,
  people, cartoon characters, memes or photorealism.

## Making a cover for a new post

Read the post, pick one scene that shows its point as a metaphor, and run, from the repository
root, with your OpenAI key in `OPENAI_API_KEY`:

```sh
deno task blog:cover <slug> "A sealed glass terrarium with a thriving plant inside, sitting on a table, while a faded cloud floats above it."
```

The script asks `COVER_MODEL` (`gpt-image-2`) for a landscape 1536×1024 picture at high
quality, crops it to 16:9 from the middle with ImageMagick (`magick` must be installed), and
writes the three files here at WebP quality 80 with all metadata stripped. A picture takes a minute
or two.

Look at the result before you commit it, beside the other covers
(`magick montage *-640.webp -tile 3x -geometry 400x225+8+8 sheet.png`). Run it again with a
clearer scene when the picture shows text, a colour outside the palette, or a style the set does
not share. Then add the post's alt text to the table below and set the post's `cover`
(`covers/<slug>.webp`) and `coverAlt`; each translation sets `coverAlt` in its own language.

## Alt text

What each cover shows, in one sentence; a post's `coverAlt` takes it.

| Slug                                               | Alt text                                                                                                                             |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `admin-panel-for-every-feature`                    | A row of potted violet plants on a shelf, each with its own round gauge on the control desk in front of it.                          |
| `deploy-saas-to-one-hetzner-server`                | A single server tower on a small grassy island with a young plant growing from its top, and a path leading to it from a seed packet. |
| `free-saas-boilerplate`                            | Seven young plants in starter pots on a wooden shelf behind an open garden gate.                                                     |
| `install-seed-and-run-it-locally`                  | Four stepping stones leading to a small computer with a potted seedling on top, the last stone glowing.                              |
| `makerkit-alternatives`                            | A large violet toolbox standing open with trays full of tools, beside a small closed grey toolbox with a padlock.                    |
| `multi-tenant-saas-groups-roles-postgres`          | A greenhouse divided into glass rooms, each with its own plants and its own violet door, with a key hanging beside each door.        |
| `nextjs-saas-starter-alternatives`                 | A small wooden frame around a single seedling, in front of a finished glass greenhouse full of violet plants.                        |
| `nine-languages-and-right-to-left-from-day-one`    | A violet globe circled by empty speech bubbles, with arrows turning both ways around it.                                             |
| `offline-first-preact-signals-local-database-sync` | A plant thriving inside a glass terrarium on a table, linked to a cloud above by a dashed line with arrows both ways.                |
| `open-saas-alternatives`                           | A glass greenhouse with a shared planter of violet plants inside and a row of five single small pots by its open door.               |
| `over-engineering-a-saas-boilerplate`              | A tall violet scaffolding tower built around a tiny seedling in a pot, next to a plain pot where a full plant grows on its own.      |
| `passkeys-2fa-sessions-without-auth-saas`          | A key with a leaf for its handle floating towards a round violet door with two locks in a garden wall.                               |
| `per-seat-billing-stripe-webhooks-retries`         | A row of violet theatre seats, each holding a potted plant, with a new seedling lowered on a string into one more seat.              |
| `realtime-websocket-with-http-fallback`            | Two rocky islands joined by a bright bridge, with a small ferry waiting on the water below as a second way across.                   |
| `rebuilding-financy-on-seed-part-1`                | A young violet plant moved from a cracked grey pot into a new violet pot, watered by a big violet plant.                             |
| `saas-pegasus-alternatives`                        | A balance scale holding a locked treasure chest with a blank price tag on one side and two open seed packets on the other.           |
| `self-hosted-saas-backup-and-restore`              | A violet plant on a server on one island, and on another a sealed jar with a cutting of it beside a pot it is replanted into.        |
| `shipfast-alternatives`                            | Seven sailboats of different shapes lined up on calm water, one of them violet.                                                      |
| `start-a-product-from-seed-and-keep-its-updates`   | A large violet plant and a young cutting of it in a separate pot, joined by a thin line carrying drops from one to the other.        |
| `supastarter-alternatives`                         | A long violet rowing boat with many oars and empty seats, tied to a pier where a grey yacht with a blank price tag is moored.        |
| `welcome-to-the-seed-blog`                         | A violet seedling in a pot beside an open envelope from which leaves drift out like letters.                                         |
| `whats-new-in-seed-october-2026`                   | A tree whose new branches end in buds shaped like a key, a coin, a globe, a house and a gear, with leaves falling around it.         |
| `why-seed-free-saas-starter-web-standards`         | A violet sprout growing from a violet cube on top of a stepped pile of plain grey cubes.                                             |
| `your-first-feature-copy-the-notes-aggregate`      | A stack of translucent violet and grey layers beside a copy of it being built, one more layer hovering into place.                   |
