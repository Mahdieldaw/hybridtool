import nlp from 'compromise';

export function skeletonize(text: string): string {
  if (!text || typeof text !== 'string') return '···';

  const trimmed = text.trim();
  if (trimmed.length === 0) return '···';

  try {
    const doc = nlp(trimmed);

    doc.remove('#Verb');
    doc.remove('#Adverb');
    doc.remove('#Adjective');
    doc.remove('#Conjunction');
    doc.remove('#Preposition');
    doc.remove('#Determiner');
    doc.remove('#Pronoun');
    doc.remove('#Modal');
    doc.remove('#Auxiliary');
    doc.remove('#Copula');
    doc.remove('#Negative');
    doc.remove('#QuestionWord');

    let skeleton = doc.text('normal');
    skeleton = skeleton.replace(/\s+/g, ' ').trim();

    return skeleton.length > 0 ? skeleton : '···';
  } catch (err) {
    console.warn('[Skeletonizer] compromise.js failed:', err);
    return '···';
  }
}
