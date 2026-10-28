import type postgres from "postgres"
import type { ContactLinkFields } from "@domain/contact-links"

/**
 * Three links for local work: a Telegram username, a phone number and an e-mail address, all
 * made up (`example.com`, a number from no real plan). The ids are fixed, so seeding again adds
 * nothing. The public demo seeds none: the links on the website are the product's own.
 */
export const SAMPLE_CONTACT_LINKS: readonly (ContactLinkFields & { id: string })[] = [
  {
    id: `019a2f6c-0c00-7000-8000-00000000c001`,
    kind: `telegram`,
    value: `seed_example`,
    label: null,
  },
  {
    id: `019a2f6c-0c00-7000-8000-00000000c002`,
    kind: `phone`,
    value: `+15550100`,
    label: `Call us`,
  },
  {
    id: `019a2f6c-0c00-7000-8000-00000000c003`,
    kind: `email`,
    value: `hello@example.com`,
    label: null,
  },
]

/** Adds {@link SAMPLE_CONTACT_LINKS} after any links there are, skipping the ones that exist. */
export async function seedSampleContactLinks(sql: postgres.Sql): Promise<void> {
  for (const link of SAMPLE_CONTACT_LINKS) {
    await sql`
      INSERT INTO contact_links (id, kind, value, label, position)
      VALUES (
        ${link.id}, ${link.kind}, ${link.value}, ${link.label},
        (SELECT COALESCE(MAX(position) + 1, 0) FROM contact_links)
      )
      ON CONFLICT (id) DO NOTHING
    `
  }
}
