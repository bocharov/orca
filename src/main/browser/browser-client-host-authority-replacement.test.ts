import { describe, expect, it } from 'vitest'
import { BROWSER_CLIENT_HOST_AUTHORITY_MISMATCH_CODE } from '../../shared/browser-client-host-protocol'
import { isBrowserClientHostAuthorityReplaced } from './browser-client-host-authority-replacement'

function errorWithCode(message: string, code: unknown): Error {
  return Object.assign(new Error(message), { code })
}

describe('browser client host authority replacement', () => {
  it('recognizes the structured mismatch code a current runtime sends', () => {
    const rejected = errorWithCode(
      'lease attach named a retired runtime',
      BROWSER_CLIENT_HOST_AUTHORITY_MISMATCH_CODE
    )

    expect(isBrowserClientHostAuthorityReplaced(rejected)).toBe(true)
  })

  it('recognizes the mismatch when a new client talks to a runtime older than the typed code', () => {
    // The pre-typed-code wire shape: same condition, reported as a generic error carrying the code
    // as its whole message. A false negative here destroys live guests on every restart.
    const rejected = new Error(BROWSER_CLIENT_HOST_AUTHORITY_MISMATCH_CODE)

    expect('code' in rejected).toBe(false)
    expect(isBrowserClientHostAuthorityReplaced(rejected)).toBe(true)
  })

  it('rejects a host error that carries an unrelated code and an unrelated message', () => {
    const unrelated = errorWithCode('browser host process exited', 'runtime_error')

    expect(isBrowserClientHostAuthorityReplaced(unrelated)).toBe(false)
  })

  it('rejects a codeless host error with an unrelated message', () => {
    expect(isBrowserClientHostAuthorityReplaced(new Error('browser host process exited'))).toBe(
      false
    )
  })

  it('rejects non-Error rejections, including a bare object carrying the mismatch code', () => {
    expect(isBrowserClientHostAuthorityReplaced(undefined)).toBe(false)
    expect(isBrowserClientHostAuthorityReplaced(null)).toBe(false)
    expect(isBrowserClientHostAuthorityReplaced(BROWSER_CLIENT_HOST_AUTHORITY_MISMATCH_CODE)).toBe(
      false
    )
    expect(
      isBrowserClientHostAuthorityReplaced({ code: BROWSER_CLIENT_HOST_AUTHORITY_MISMATCH_CODE })
    ).toBe(false)
  })

  it('rejects a non-string code that a loose comparison could coerce', () => {
    expect(isBrowserClientHostAuthorityReplaced(errorWithCode('host rejected attach', 503))).toBe(
      false
    )
    expect(
      isBrowserClientHostAuthorityReplaced(
        errorWithCode('host rejected attach', {
          toString: () => BROWSER_CLIENT_HOST_AUTHORITY_MISMATCH_CODE
        })
      )
    ).toBe(false)
  })

  it('rejects a message that merely contains the mismatch code inside a longer sentence', () => {
    // Substring matching was rejected deliberately: it would keep guests alive on unrelated errors
    // that happen to quote the code.
    const quoted = new Error(`failed: ${BROWSER_CLIENT_HOST_AUTHORITY_MISMATCH_CODE} occurred`)

    expect(isBrowserClientHostAuthorityReplaced(quoted)).toBe(false)
  })

  it('pins the mismatch code string', () => {
    // Wire contract shared with the runtime: changing the value breaks mixed-version clients, whose
    // legacy message fallback compares against exactly this string.
    expect(BROWSER_CLIENT_HOST_AUTHORITY_MISMATCH_CODE).toBe(
      'browser_client_host_authority_mismatch'
    )
  })
})
