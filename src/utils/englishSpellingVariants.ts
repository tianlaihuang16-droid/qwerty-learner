// Explicit word families: a blanket s/z or our/or substitution accepts real typos.
const pairs: [string, string][] = []
const add = (british: string, american: string, suffixes = ['', 's']) => {
  for (const suffix of suffixes) pairs.push([british + suffix, american + suffix])
}
for (const [british, american] of [
  ['organisation', 'organization'], ['organisational', 'organizational'],
  ['realisation', 'realization'], ['specialisation', 'specialization'],
  ['globalisation', 'globalization'], ['industrialisation', 'industrialization'],
  ['modernisation', 'modernization'], ['standardisation', 'standardization'],
  ['urbanisation', 'urbanization'], ['civilisation', 'civilization'],
  ['colour', 'color'], ['flavour', 'flavor'], ['honour', 'honor'], ['labour', 'labor'],
  ['neighbour', 'neighbor'], ['behaviour', 'behavior'], ['favour', 'favor'], ['humour', 'humor'], ['harbour', 'harbor'],
  ['centre', 'center'], ['metre', 'meter'], ['litre', 'liter'], ['theatre', 'theater'],
  ['amphitheatre', 'amphitheater'], ['encyclopaedia', 'encyclopedia'],
  ['instal', 'install'],
  ['catalogue', 'catalog'], ['dialogue', 'dialog'], ['programme', 'program'],
  ['defence', 'defense'], ['offence', 'offense'], ['licence', 'license'],
  ['grey', 'gray'], ['jewellery', 'jewelry'], ['mould', 'mold'],
]) add(british, american)
for (const stem of ['organ', 'real', 'recogn', 'special', 'apolog', 'critic', 'summar', 'emphas',
  'modern', 'standard', 'civil', 'global', 'industrial', 'priorit', 'memor', 'custom', 'optim',
  'stabil', 'normal', 'minim', 'maxim', 'util', 'symbol', 'categor', 'character', 'author',
  'familiar', 'fertil', 'acclimat', 'bapt', 'central', 'colon', 'commercial', 'crystall',
  'democrat', 'desalin', 'digit', 'econom', 'energ', 'epitom', 'fantas', 'final', 'formal',
  'fossil', 'general', 'harmon', 'homogen', 'hybrid', 'hypothes', 'ideal', 'idol', 'immun',
  'individual', 'institutional', 'intellectual', 'internal', 'international', 'item',
  'jeopard', 'legal', 'legitim', 'liberal', 'material', 'mechan', 'mesmer', 'mobil',
  'moistur', 'monopol', 'natural', 'neutral', 'pasteur', 'patron', 'penal', 'personal',
  'plagiar', 'popular', 'privat', 'professional', 'public', 'pulver', 'revital',
  'revolution', 'satir', 'scrutin', 'social', 'steril', 'subsid', 'sympath', 'synchron',
  'synthes', 'systemat', 'tantal', 'terror', 'theor', 'trivial', 'universal', 'urban',
  'victim', 'visual', 'vocal', 'american', 'unauthor', 'unrecogn', 'disorgan',
  'digital', 'pedestrian', 'reorgan']) {
  add(`${stem}ise`, `${stem}ize`, ['', 's', 'd', 'r', 'rs'])
  add(`${stem}ising`, `${stem}izing`, [''])
  add(`${stem}isation`, `${stem}ization`)
}
for (const [british, american] of [
  ['analyse', 'analyze'], ['analyses', 'analyzes'], ['analysed', 'analyzed'], ['analysing', 'analyzing'],
  ['paralyse', 'paralyze'], ['paralysed', 'paralyzed'], ['paralysing', 'paralyzing'],
  ['travelling', 'traveling'], ['travelled', 'traveled'], ['traveller', 'traveler'],
  ['cancelling', 'canceling'], ['cancelled', 'canceled'],
  ['modelling', 'modeling'], ['modelled', 'modeled'],
  ['labelled', 'labeled'], ['labelling', 'labeling'],
  ['colourful', 'colorful'], ['colourless', 'colorless'], ['favourite', 'favorite'],
  ['harboured', 'harbored'], ['harbouring', 'harboring'],
  ['neighbourhood', 'neighborhood'], ['behavioural', 'behavioral'],
]) add(british, american)

const alternatives = new Map<string, string>()
for (const [a, b] of pairs) { alternatives.set(a, b); alternatives.set(b, a) }

export function acceptedEnglishSpellings(target: string, language: string, dictionarySpellings?: string[]): string[] {
  if (language !== 'en') return [target]
  // A dictionary entry owns its accepted spellings. Legacy entries use the explicit pairs below.
  if (dictionarySpellings) return Array.from(new Set([target, ...dictionarySpellings]))
  let spellings = ['']
  for (const part of target.split(/([ ␣-])/)) {
    const alternative = alternatives.get(part.toLowerCase())
    const cased = alternative && (part === part.toUpperCase() ? alternative.toUpperCase()
      : /^[A-Z][a-z]+$/.test(part) ? alternative[0].toUpperCase() + alternative.slice(1)
      : part === part.toLowerCase() ? alternative : undefined)
    const options = cased && cased !== part ? [part, cased] : [part]
    spellings = spellings.flatMap(prefix => options.map(option => prefix + option))
  }
  return spellings
}

export function matchingSpelling(input: string, spellings: string[], ignoreCase: boolean, prefix = false) {
  const actual = ignoreCase ? input.toLowerCase() : input
  return spellings.find(spelling => {
    const expected = ignoreCase ? spelling.toLowerCase() : spelling
    return prefix ? expected.startsWith(actual) : expected === actual
  })
}
