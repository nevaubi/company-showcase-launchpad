// Short industry names for tables inside a sector page. The sector is already in the page title, so an
// industry cell need not repeat the sector's words, and the long GICS-style names ("Electronic Equipment &
// Components") are cut to what tells the industries of one sector apart. The full name stays in the cell's
// title and in the industry filter chips.

const SHORT: Record<string, string> = {
  "Interactive Media & Services": "Interactive Media",
  "Telecommunication Services": "Telecom",
  "Automobiles & Components": "Autos & Components",
  "Consumer Discretionary Retail": "Retail",
  "Hotels, Restaurants & Leisure": "Hotels & Restaurants",
  "Textiles, Apparel & Luxury Goods": "Apparel & Luxury",
  "Consumer Staples Retail": "Retail",
  "Food, Beverage & Tobacco": "Food & Beverage",
  "Household & Personal Products": "Household Products",
  "Energy Equipment & Services": "Equipment & Services",
  "Integrated Oil & Refining": "Integrated Oil",
  "Oil & Gas Exploration & Production": "Exploration",
  "Oil & Gas Midstream": "Midstream",
  "Health Care Equipment & Supplies": "Equipment & Supplies",
  "Health Care Providers & Services": "Providers & Services",
  "Health Care Technology": "Technology",
  "Life Sciences Tools & Services": "Life Sciences Tools",
  "Commercial & Professional Services": "Business Services",
  "Construction & Engineering": "Construction",
  "Trading Companies & Distributors": "Distributors",
  "Communications Equipment": "Comms Equipment",
  "Electronic Equipment & Components": "Electronic Equipment",
  "Semiconductors & Equipment": "Semiconductors",
  "Technology Hardware & Storage": "Hardware & Storage",
  "Construction Materials": "Construction",
  "Containers, Packaging & Paper": "Packaging & Paper",
  "Real Estate Management & Services": "Property Services",
  "Electric Utilities": "Electric",
  "Gas & Water Utilities": "Gas & Water",
};

/** Longest short name the companies table is sized for (characters). */
export const SHORT_INDUSTRY_MAX = 20;

/**
 * The industry's short name inside `sector`: a known short form, else the name without a leading copy of
 * the sector's name, else the name as it is.
 */
export function shortIndustry(industry: string, sector?: string): string {
  const known = SHORT[industry];
  if (known) return known;
  if (sector && industry.toLowerCase().startsWith(sector.toLowerCase() + " ")) {
    const rest = industry.slice(sector.length + 1).trim();
    if (rest) return rest.charAt(0).toUpperCase() + rest.slice(1);
  }
  return industry;
}
