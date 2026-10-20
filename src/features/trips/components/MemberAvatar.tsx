export function MemberAvatar({
  name,
  color,
  size = 30,
}: {
  name: string
  color: string
  size?: number
}) {
  return (
    <span
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center font-extrabold text-primary-dark"
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        background: color,
        fontSize: Math.max(10, Math.round(size * 0.4)),
      }}
    >
      {name.trim().charAt(0).toUpperCase()}
    </span>
  )
}
