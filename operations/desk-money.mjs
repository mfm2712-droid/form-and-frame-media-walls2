// Exact money arithmetic for quotations. Every amount is an integer number of
// pence and every quantity an integer number of hundredths, so no floating-point
// rounding ever reaches a customer document. The database recomputes the same
// figures (validate_quote_lines) and refuses anything that disagrees.

export const MAX_LINES = 100;
const MAX_UNIT_PENCE = 9_999_999_999;

// "1,250.5" → 125050. Accepts at most two decimal places; returns null otherwise.
export function parsePounds(value) {
  const text = String(value ?? "").trim().replace(/^£/, "").replace(/,/g, "");
  const match = /^(\d{1,10})(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) return null;
  const pence = Number(match[1]) * 100 + Number((match[2] || "").padEnd(2, "0"));
  return Number.isSafeInteger(pence) && pence <= MAX_UNIT_PENCE ? pence : null;
}

// "2.5" → 250 hundredths. Quantities must be positive, two decimals at most.
export function parseQuantity(value) {
  const text = String(value ?? "").trim();
  const match = /^(\d{1,6})(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) return null;
  const hundredths = Number(match[1]) * 100 + Number((match[2] || "").padEnd(2, "0"));
  return hundredths > 0 ? hundredths : null;
}

export const quantityText = hundredths => {
  const whole = Math.floor(hundredths / 100), part = hundredths % 100;
  return part ? `${whole}.${String(part).padStart(2, "0").replace(/0$/, "")}` : String(whole);
};

// "17.5" (%) → 1750 basis points.
export function parsePercent(value) {
  const text = String(value ?? "").trim().replace(/%$/, "");
  const match = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) return null;
  const points = Number(match[1]) * 100 + Number((match[2] || "").padEnd(2, "0"));
  return points <= 10000 ? points : null;
}

// Positive integers only: round half up, the same as Postgres round() on positive numerics.
const divideRounded = (numerator, divisor) => Math.floor((numerator + Math.floor(divisor / 2)) / divisor);

export function lineTotalPence(quantityHundredths, unitPricePence) {
  return divideRounded(quantityHundredths * unitPricePence, 100);
}

// Turns editor rows into validated database lines plus every total.
export function calculateQuote({ lines = [], discountType = "none", discountPercent = "", discountAmount = "", taxPercent = "0" } = {}) {
  const errors = [];
  const items = [];
  lines.forEach((line, index) => {
    const description = String(line.description ?? "").trim();
    const blank = !description && !String(line.quantity ?? "").trim() && !String(line.unitPrice ?? "").trim();
    if (blank) return;
    const quantity = parseQuantity(line.quantity);
    const unitPrice = parsePounds(line.unitPrice);
    const unit = String(line.unit ?? "").trim().slice(0, 30) || "item";
    if (!description) errors.push(`Line ${index + 1}: add a description.`);
    else if (description.length > 300) errors.push(`Line ${index + 1}: the description is longer than 300 characters.`);
    if (quantity === null) errors.push(`Line ${index + 1}: enter a quantity above zero, with up to two decimals.`);
    if (unitPrice === null) errors.push(`Line ${index + 1}: enter a unit price in pounds, for example 120 or 120.50.`);
    else if (quantity !== null && !Number.isSafeInteger(quantity * unitPrice)) errors.push(`Line ${index + 1}: the line total is too large.`);
    else if (description && description.length <= 300 && quantity !== null) {
      items.push({
        description, quantity:quantityText(quantity), unit,
        unit_price_pence:unitPrice, line_total_pence:lineTotalPence(quantity, unitPrice),
        ...(line.catalogueItemId ? { catalogue_item_id:String(line.catalogueItemId) } : {})
      });
    }
  });
  if (items.length > MAX_LINES) errors.push(`A quotation can have at most ${MAX_LINES} lines.`);
  const itemsSubtotal = items.reduce((sum, item) => sum + item.line_total_pence, 0);
  // £1bn ceiling keeps every intermediate product an exact JavaScript integer.
  if (!Number.isSafeInteger(itemsSubtotal * 10000) || itemsSubtotal > 100_000_000_000) {
    return { ok:false, errors:["The quotation total is too large to calculate safely."], items:[], itemsSubtotalPence:0, discountType, discountBasisPoints:0, discountPence:0, subtotalPence:0, taxBasisPoints:0, taxPence:0, totalPence:0 };
  }
  let discountBasisPoints = 0, discountPence = 0;
  if (discountType === "percent") {
    discountBasisPoints = parsePercent(discountPercent);
    if (discountBasisPoints === null || discountBasisPoints === 0) { errors.push("Choose a discount percentage between 0.01% and 100%."); discountBasisPoints = 0; }
    discountPence = divideRounded(itemsSubtotal * discountBasisPoints, 10000);
  } else if (discountType === "fixed") {
    const amount = parsePounds(discountAmount);
    if (amount === null || amount === 0) errors.push("Enter the discount amount in pounds.");
    else if (amount > itemsSubtotal) errors.push("The discount cannot be larger than the items subtotal.");
    else discountPence = amount;
  } else if (discountType !== "none") errors.push("Choose a discount type.");
  const taxBasisPoints = parsePercent(taxPercent);
  if (taxBasisPoints === null) errors.push("Enter a VAT rate between 0% and 100%. Use 0 if VAT does not apply.");
  const subtotal = itemsSubtotal - discountPence;
  const tax = taxBasisPoints === null ? 0 : divideRounded(subtotal * taxBasisPoints, 10000);
  if (!items.length) errors.push("Add at least one item with a quantity and unit price.");
  return {
    ok:errors.length === 0, errors, items,
    itemsSubtotalPence:itemsSubtotal,
    discountType,
    discountBasisPoints:discountType === "percent" ? discountBasisPoints : 0,
    discountPence,
    subtotalPence:subtotal,
    taxBasisPoints:taxBasisPoints ?? 0,
    taxPence:tax,
    totalPence:subtotal + tax
  };
}

export const formatPence = pence => new Intl.NumberFormat("en-GB", { style:"currency", currency:"GBP" }).format(Number(pence || 0) / 100);
export const penceToInput = pence => pence == null ? "" : (Number(pence) / 100).toFixed(2);
export const basisPointsText = points => `${(Number(points || 0) / 100).toFixed(2).replace(/\.?0+$/, "")}%`;
