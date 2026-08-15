import type { DistrictId } from "./districts";

export type MerchCategory = "camiseta" | "saco" | "pasamontanas" | "buckethat" | "abanico" | "earplugs" | "arte";

export type MerchItem = {
  slug: string;
  name: string;
  category: MerchCategory;
  priceCop: number;
  image?: string;
};

export const TICKET_PRICES = { normal: 30000, vip: 50000 } as const;
export type TicketTier = keyof typeof TICKET_PRICES;

export type CartTicketItem = {
  kind: "ticket";
  eventId: number;
  eventTitle: string;
  tier: TicketTier;
  unitPriceCop: number;
  quantity: number;
};

export type CartMerchItem = {
  kind: "merch";
  slug: string;
  name: string;
  unitPriceCop: number;
  quantity: number;
};

export type CartItem = CartTicketItem | CartMerchItem;

export type OrderItemRecord = {
  itemType: "ticket" | "merch";
  name: string;
  unitPriceCop: number;
  quantity: number;
  ticketTier: TicketTier | null;
};

export type OrderRecord = {
  id: number;
  status: "pending" | "paid" | "cancelled";
  amountCop: number;
  currency: string;
  createdAt: string;
  paidAt: string | null;
  items: OrderItemRecord[];
};

export type Trophy = {
  eventId: number;
  eventTitle: string;
  eventDate: string;
  district: DistrictId;
};
