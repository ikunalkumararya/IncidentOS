/**
 * The demo storefront's catalogue.
 *
 * This is a prop. It exists so there is a real user journey — browse, add to
 * cart, pay — sitting in front of the incident intake, rather than a form on
 * its own. The checkout it feeds is instrumented to fail on purpose; see
 * app/shop/page.tsx.
 */

export interface Product {
  id: string;
  name: string;
  blurb: string;
  priceCents: number;
  /** Two letters for the tile, since there are no product images. */
  mark: string;
}

export const PRODUCTS: Product[] = [
  { id: "desk-lamp", name: "Ridgeline Desk Lamp", blurb: "Warm dimmable LED, matte aluminium", priceCents: 8900, mark: "RL" },
  { id: "notebook", name: "Field Notebook, A5", blurb: "Dot grid, 120gsm, lies flat", priceCents: 1800, mark: "FN" },
  { id: "keyboard", name: "Parsec Mechanical Keyboard", blurb: "65%, hot-swap, PBT caps", priceCents: 14900, mark: "PK" },
  { id: "mug", name: "Diner Mug, 12oz", blurb: "Thick-walled stoneware", priceCents: 2200, mark: "DM" },
  { id: "chair-mat", name: "Felt Chair Mat", blurb: "Recycled wool, 120×90cm", priceCents: 6400, mark: "CM" },
  { id: "cable-kit", name: "Braided Cable Kit", blurb: "USB-C set, three lengths", priceCents: 3400, mark: "CK" },
  { id: "monitor-arm", name: "Cantilever Monitor Arm", blurb: "Gas spring, VESA 75/100", priceCents: 11200, mark: "MA" },
  { id: "pour-over", name: "Pour-Over Kettle", blurb: "Gooseneck, 0.9L, stovetop", priceCents: 7600, mark: "PO" },
  { id: "headphones", name: "Quietline Headphones", blurb: "Over-ear, 40h battery", priceCents: 19900, mark: "QH" },
  { id: "planner", name: "Undated Weekly Planner", blurb: "52 weeks, linen cover", priceCents: 2600, mark: "WP" },
];

export function formatPrice(cents: number): string {
  return `£${(cents / 100).toFixed(2)}`;
}
