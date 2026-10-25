// Normalise un nom : sans accents, en minuscules, sans ponctuation, mots triés.
// "Jean-Paul MBÉKI" -> "jean mbeki paul"
function normaliserNom(texte) {
  return String(texte || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(' ');
}

module.exports = { normaliserNom };