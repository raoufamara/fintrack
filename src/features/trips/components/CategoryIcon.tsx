import {
  Baby, Bike, BedDouble, Beer, Briefcase, Bus, Camera, Car, CircleDollarSign, Coffee, Dog,
  Ellipsis, Fuel, Gift, GraduationCap, HandCoins, HeartPulse, Hotel, Landmark, Mountain, Music,
  Pill, Pizza, Plane, Receipt, Scissors, Shirt, Ship, ShoppingBag, ShoppingBasket, Smartphone,
  Sparkles, Tag, Tent, Ticket, TrainFront, Utensils, Waves, Wifi, Wine,
  type LucideIcon,
} from 'lucide-react'
import type { CategoryColorKey } from '../types'

/** Lucide name (as stored in the database) to component. Static imports only. */
const ICONS: Record<string, LucideIcon> = {
  'bed-double': BedDouble, hotel: Hotel, tent: Tent, utensils: Utensils, coffee: Coffee,
  wine: Wine, beer: Beer, pizza: Pizza, 'train-front': TrainFront, plane: Plane, bus: Bus,
  car: Car, ship: Ship, bike: Bike, fuel: Fuel, ticket: Ticket, landmark: Landmark,
  camera: Camera, mountain: Mountain, waves: Waves, music: Music, 'shopping-bag': ShoppingBag,
  'shopping-basket': ShoppingBasket, shirt: Shirt, gift: Gift, 'heart-pulse': HeartPulse,
  pill: Pill, sparkles: Sparkles, scissors: Scissors, wifi: Wifi, smartphone: Smartphone,
  'circle-dollar-sign': CircleDollarSign, receipt: Receipt, 'hand-coins': HandCoins,
  baby: Baby, dog: Dog, briefcase: Briefcase, 'graduation-cap': GraduationCap,
  ellipsis: Ellipsis, tag: Tag,
}

export const CATEGORY_ICON_COMPONENTS: Readonly<Record<string, LucideIcon>> = ICONS

interface CategoryIconProps {
  icon: string
  color: CategoryColorKey
  size?: number
  /** Icon size in px. */
  iconSize?: number
}

/** Icon tile for a category. The category name is always shown next to it. */
export function CategoryIcon({ icon, color, size = 42, iconSize = 20 }: CategoryIconProps) {
  const Icon = ICONS[icon] ?? Tag
  return (
    <span
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center"
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.31),
        color: `var(--color-tripcat-${color})`,
        background: `var(--color-tripcat-${color}-bg)`,
      }}
    >
      <Icon size={iconSize} />
    </span>
  )
}
