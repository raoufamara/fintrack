/** Invite codes are shown in groups of four: "a1b2 c3d4". */
export function formatInviteCode(code: string): string {
  return code.replace(/\s+/g, '').replace(/(.{4})(?=.)/g, '$1 ')
}

/** What a user typed or pasted, reduced to the code itself (lower case, no spaces or link). */
export function normalizeInviteCode(input: string): string {
  const fromLink = /\/trips\/join\/([^/?#\s]+)/.exec(input)?.[1]
  return (fromLink ?? input).replace(/[^a-zA-Z0-9]/g, '').toLowerCase()
}

export function inviteLink(origin: string, code: string): string {
  return `${origin}/trips/join/${code}`
}

export function remindMessage(debtor: string, creditor: string, amountText: string, tripName: string): string {
  return `Hi ${debtor}, you owe ${creditor} ${amountText} for ${tripName}.`
}
