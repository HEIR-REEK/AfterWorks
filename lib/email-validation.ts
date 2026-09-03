/**
 * Email validation helpers — shared between client (auth-form) and server (API routes).
 *
 * Strategy:
 *  1. Structural check  — basic RFC-5321 format via regex.
 *  2. Disposable check  — reject known throwaway / temporary-inbox domains.
 *  3. TLD plausibility  — reject obviously fake TLDs (.test, .invalid, .localhost, .example).
 *
 * For high-assurance flows the app already sends a Firebase verification email; that is the
 * real gate.  This layer gives instant UI feedback and stops the most common fake-account patterns.
 */

// ─── Disposable domain list ────────────────────────────────────────────────────
const DISPOSABLE_DOMAINS = new Set([
  '0-mail.com','10minutemail.com','10minutemail.net','10minutemail.org',
  '20minutemail.com','33mail.com','anonbox.net','anonymbox.com',
  'beefmilk.com','binkmail.com','bugmenot.com','burnermail.io',
  'byom.de','chacuo.net','crapmail.org','dayrep.com','deadaddress.com',
  'discard.email','discardmail.com','discardmail.de','disposableaddress.com',
  'disposableemailaddresses.com','disposableinbox.com','disposemail.com',
  'dispostable.com','dodgit.com','dumpmail.de','e4ward.com',
  'emailna.co','emailnull.com','emailondeck.com','emailtemporary.com',
  'emailtmp.com','explodemail.com','fakeinbox.com','fakeinformation.com',
  'fakemail.fr','fakemailgenerator.com','filzmail.com','fleckens.hu',
  'garbagemail.org','get2mail.fr','getairmail.com','ghosttexter.de',
  'grr.la','guerillamail.biz','guerillamail.com','guerillamail.de',
  'guerillamail.info','guerillamail.net','guerillamail.org',
  'guerrillamail.biz','guerrillamail.com','guerrillamail.de',
  'guerrillamail.info','guerrillamail.net','guerrillamail.org',
  'guerrillamailblock.com','gustr.com','haltospam.com','hmamail.com',
  'ieatspam.eu','ieatspam.info','inboxalias.com','inboxbear.com',
  'inoutmail.de','instant-mail.de','instantemailaddress.com',
  'jnxjn.com','jojomail.com','junk.to','junkmail.com',
  'kasmail.com','keepmymail.com','laoeq.com','letthemeatspam.com',
  'mailbidon.com','mailbucket.org','mailcat.biz','mailcatch.com',
  'maildrop.cc','maileater.com','mailempty.com','mailexpire.com',
  'mailfall.com','mailforspam.com','mailfreeonline.com','mailguard.me',
  'mailinator.com','mailinator.net','mailinator.org','mailinator2.com',
  'mailismagic.com','mailme.lv','mailme24.com','mailmetrash.com',
  'mailmoat.com','mailnew.com','mailnull.com','mailproxsy.com',
  'mailquack.com','mailscrap.com','mailsiphon.com','mailslite.com',
  'mailsucker.net','mailtome.de','mailtothis.com','mailzilla.com',
  'meltmail.com','mintemail.com','mohmal.com','mytempemail.com',
  'mytrashmail.com','neverbox.com','no-spam.ws','nomail.pw',
  'nomail2me.com','nospam.ze.tc','nospam4.us','nospamthanks.info',
  'notmailinator.com','nowmymail.com','nullbox.info','objectmail.com',
  'odaymail.com','oneoffemail.com','oneoffmail.com','onewaymail.com',
  'opayq.com','ownmail.net','pjjkp.com','pokemail.net','privacy.net',
  'proxymail.eu','quickinbox.com','rejectmail.com','rmqkr.net',
  'safe-mail.net','safetymail.info','sandelf.de',
  'selfdestructingmail.com','sendspamhere.com','sharklasers.com',
  'shiftmail.com','sibmail.com','slapsfromlastnight.com','slopsbox.com',
  'snakemail.com','sneakemail.com','sofimail.com','spam.la','spam.su',
  'spamavert.com','spambox.info','spambox.us','spamcannon.com',
  'spamcon.org','spamcorpse.com','spamday.com','spamex.com',
  'spamfree24.de','spamfree24.eu','spamfree24.info','spamfree24.net',
  'spamfree24.org','spamgoes.in','spamgourmet.com','spamgourmet.net',
  'spamgourmet.org','spamherelots.com','spamhereplease.com',
  'spamhole.com','spamify.com','spamkill.info','spaml.de',
  'spammotel.com','spamout.de','spamspot.com','spamthis.co.uk',
  'spamtroll.net','spoofmail.de','stuffmail.de','supergreatmail.com',
  'suremail.info','t-online-de.com','teewars.org','teleworm.us',
  'tempalias.com','tempemail.biz','tempemail.co.uk','tempemail.com',
  'tempemail.net','tempemail.org','tempinbox.co.uk','tempinbox.com',
  'tempmail.com','tempmail.de','tempmail.eu','tempmail.it',
  'tempmail.net','tempmail.org','tempmail.us','tempmail2.com',
  'tempr.email','throwam.com','throwaway.email','throwmail.net',
  'tilien.com','tmail.com','tmail.io','tmailinator.com','tokem.co',
  'tormail.org','tp-email.com','trash-amil.com','trash-mail.at',
  'trash-mail.com','trash-mail.de','trash-mail.io','trash2009.com',
  'trashdevil.com','trashdevil.de','trashemail.de','trashmail.app',
  'trashmail.at','trashmail.com','trashmail.de','trashmail.io',
  'trashmail.me','trashmail.net','trashmail.org','trashmail.xyz',
  'trashmailer.com','trashymail.com','trbvm.com','trickmail.net',
  'trmailbox.com','turual.com','twinmail.de','tyldd.com','uroid.com',
  'valemail.net','wh4f.org','whyspam.me','willselfdestruct.com',
  'wuzupmail.net','xagloo.co','xagloo.com','xemaps.com','xents.com',
  'xmaily.com','xoxy.net','yomail.info','yopmail.com','yopmail.fr',
  'yopmail.net','youmail.ga','yourspam.eu','zainmax.net',
  'zippymail.info','zoaxe.com','zoemail.net','zoemail.org',
])

// TLDs that are not valid for real email accounts
const FAKE_TLDS = new Set(['test', 'invalid', 'localhost', 'example', 'local', 'internal', 'intranet'])

// Broad email format regex
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Returns null if the email is acceptable, or an error string if it should be rejected.
 */
export function validateEmailAddress(email: string): string | null {
  const trimmed = email.trim().toLowerCase()

  if (!EMAIL_REGEX.test(trimmed)) {
    return 'Please enter a valid email address.'
  }

  const [, domain] = trimmed.split('@')
  if (!domain) return 'Please enter a valid email address.'

  const parts = domain.split('.')
  const tld = parts[parts.length - 1]
  if (FAKE_TLDS.has(tld)) {
    return 'Please use a real email address (that TLD is reserved/invalid).'
  }

  if (DISPOSABLE_DOMAINS.has(domain)) {
    return 'Temporary or disposable email addresses are not allowed. Please use a real email.'
  }

  return null
}

/**
 * Returns true when the email passes all checks.
 */
export function isEmailAllowed(email: string): boolean {
  return validateEmailAddress(email) === null
}
