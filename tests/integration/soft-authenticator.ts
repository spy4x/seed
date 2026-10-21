import { decodeBase64Url, encodeBase64Url } from "@std/encoding/base64url"
import type {
  AuthenticationResponse,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponse,
} from "@spy4x/server/webauthn"

/**
 * A passkey made in software for the passkey tests (#222): a real ES256 key from Web Crypto, and
 * the bytes a browser sends for `create()` and `get()`, so the API's checks run end to end. The
 * `user present`, `user verified`, `backup eligible` and `backed up` flags are always set, as by a
 * synced passkey.
 */
export class SoftPasskey {
  readonly #rawId = crypto.getRandomValues(new Uint8Array(32))
  #keys: CryptoKeyPair | null = null
  /** The user handle the server put in the options, given back at each sign-in. */
  userHandle: string | null = null

  constructor(readonly origin: string) {}

  /** The credential id, as the server stores it. */
  get id(): string {
    return encodeBase64Url(this.#rawId)
  }

  /** Answers `navigator.credentials.create()` for `options`. */
  async create(options: PublicKeyCredentialCreationOptionsJSON): Promise<RegistrationResponse> {
    this.userHandle = options.user.id
    const { x, y } = await crypto.subtle.exportKey("jwk", (await this.#pair()).publicKey)
    const coseKey = cbor(
      new Map<number, number | Uint8Array>([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, decodeBase64Url(x!)],
        [-3, decodeBase64Url(y!)],
      ]),
    )
    const authData = concat(
      await header(options.rp.id!, FLAGS | ATTESTED, 0),
      new Uint8Array(16),
      new Uint8Array([0, this.#rawId.length]),
      this.#rawId,
      coseKey,
    )
    const attestation = cbor(
      new Map<string, unknown>([
        ["fmt", "none"],
        ["attStmt", new Map()],
        ["authData", authData],
      ]),
    )
    return {
      id: this.id,
      rawId: this.id,
      type: "public-key",
      response: {
        clientDataJSON: clientData("webauthn.create", options.challenge, this.origin),
        attestationObject: encodeBase64Url(attestation),
        transports: ["internal", "hybrid"],
      },
    }
  }

  /** Answers `navigator.credentials.get()` for `options`. */
  async get(options: PublicKeyCredentialRequestOptionsJSON): Promise<AuthenticationResponse> {
    const authData = await header(options.rpId!, FLAGS, 0)
    const clientDataJSON = clientData("webauthn.get", options.challenge, this.origin)
    const hash = new Uint8Array(
      await crypto.subtle.digest("SHA-256", decodeBase64Url(clientDataJSON)),
    )
    const raw = new Uint8Array(
      await crypto.subtle.sign(
        { name: "ECDSA", hash: "SHA-256" },
        (await this.#pair()).privateKey,
        concat(authData, hash),
      ),
    )
    return {
      id: this.id,
      rawId: this.id,
      type: "public-key",
      response: {
        clientDataJSON,
        authenticatorData: encodeBase64Url(authData),
        signature: encodeBase64Url(der(raw)),
        userHandle: this.userHandle,
      },
    }
  }

  async #pair(): Promise<CryptoKeyPair> {
    this.#keys ??= await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["sign", "verify"],
    )
    return this.#keys
  }
}

/** User present, user verified, backup eligible, backed up. */
const FLAGS = 1 | 4 | 8 | 16
/** Attested credential data follows. */
const ATTESTED = 64

function clientData(type: string, challenge: string, origin: string): string {
  const json = JSON.stringify({ type, challenge, origin, crossOrigin: false })
  return encodeBase64Url(new TextEncoder().encode(json))
}

/** The authenticator data up to the counter: the RP ID's hash, the flags and the counter. */
async function header(rpId: string, flags: number, counter: number): Promise<Uint8Array> {
  const hash = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rpId)),
  )
  const count = new Uint8Array(4)
  new DataView(count.buffer).setUint32(0, counter)
  return concat(hash, new Uint8Array([flags]), count)
}

/** The CBOR of integers, text, bytes and maps of them: all an attestation needs. */
function cbor(value: unknown): Uint8Array {
  const head = (major: number, length: number) =>
    length < 24
      ? new Uint8Array([major << 5 | length])
      : length < 256
      ? new Uint8Array([major << 5 | 24, length])
      : new Uint8Array([major << 5 | 25, length >> 8, length & 255])
  if (typeof value === "number") return value >= 0 ? head(0, value) : head(1, -1 - value)
  if (typeof value === "string") {
    const bytes = new TextEncoder().encode(value)
    return concat(head(3, bytes.length), bytes)
  }
  if (value instanceof Uint8Array) return concat(head(2, value.length), value)
  if (value instanceof Map) {
    return concat(head(5, value.size), ...[...value].flatMap(([k, v]) => [cbor(k), cbor(v)]))
  }
  throw new Error(`cannot encode ${typeof value}`)
}

/** WebAuthn sends ES256 signatures as ASN.1 DER; Web Crypto makes them as raw `r || s`. */
function der(raw: Uint8Array): Uint8Array {
  const integer = (bytes: Uint8Array) => {
    let start = 0
    while (start < bytes.length - 1 && bytes[start] === 0) start++
    let value = bytes.slice(start)
    if (value[0] & 0x80) value = concat(new Uint8Array([0]), value)
    return concat(new Uint8Array([0x02, value.length]), value)
  }
  const body = concat(integer(raw.slice(0, 32)), integer(raw.slice(32)))
  return concat(new Uint8Array([0x30, body.length]), body)
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}
