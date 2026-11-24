// A statement row's label as the table shows it. Pure.
// The schema writes some pairs with an em dash ("Weighted avg. shares — basic"); the copy rules keep em dashes
// out of labels, so the table shows "Weighted avg. shares, basic". The schema itself is left as it is.
export const rowLabel = (label: string) => label.replace(/\s*—\s*/g, ", ");
