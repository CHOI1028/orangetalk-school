// Some statistical labels arrive with a leading @. It is not part of a disease
// name in the reference catalog. Only remove that prefix, preserving KCD/name punctuation.
export function cleanDiseaseLabel(value) {
  return String(value ?? '').normalize('NFKC').trim().replace(/^(?:@\s*)+/, '').trim();
}
