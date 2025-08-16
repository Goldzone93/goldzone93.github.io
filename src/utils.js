export const notInElements = (c,needle) => {
  return ![c.ElementType1, c.ElementType2, c.ElementType3].filter(Boolean).includes(needle)
}
export const toNum = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
