/** "You pay Sara" / "Inès pays Sara": the verb agrees with the subject. Used for the visible text and the accessible label. */
export function transferSentence(fromName: string, toName: string, fromIsMe: boolean): string {
  return `${fromIsMe ? 'You' : fromName} ${fromIsMe ? 'pay' : 'pays'} ${toName}`
}
