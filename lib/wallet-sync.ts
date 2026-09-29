/**
 * When the wallet snapshot has to be rebuilt from the server.
 *
 * The member app has two views of the same money:
 *
 *  • `wallet` — the raw `users/<uid>` document, streamed live by a Firestore listener. It is
 *    immediate but *not* derived: it does not know what has cleared, what a payout request is
 *    holding, or when the next clearing date falls.
 *  • `payouts` / `walletMeta` — the snapshot built by `GET /api/wallet`, which runs the settlement
 *    pass and is the only thing that can turn a matured pending credit into a withdrawable one.
 *
 * The listener used to be the only thing that updated `wallet` after mount, so the dashboard's
 * headline figure ("Withdrawable") froze at whatever it was when the page opened. A referral bonus,
 * a staff grant or a clearing entry could land in Firestore and the tile would not move until
 * something explicitly re-read the wallet.
 *
 * The fix is to re-read whenever the document's own balances move. That decision lives here, on its
 * own, so the rule — including "the first observation is only a baseline" — is testable without a
 * browser or a Firestore.
 */

export type WalletBalances = {
  pendingUsd: number
  availableUsd: number
}

/**
 * Whether the live document's balances moved enough to be worth rebuilding the snapshot.
 *
 * `previous` is null until the document has been seen once. A first observation is only a baseline:
 * the snapshot effect already issues its own read on mount, and counting the baseline as a change
 * would double every wallet read on every page load.
 */
export function walletBalancesChanged(previous: WalletBalances | null, next: WalletBalances): boolean {
  if (!previous) return false
  return previous.pendingUsd !== next.pendingUsd || previous.availableUsd !== next.availableUsd
}
