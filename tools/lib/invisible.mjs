// The characters that show as nothing, or that a reader can not tell from nothing. Text is cleaned of them before it is checked,
// so none of them can split a path, a link, a contraction, or a name. The set is the Unicode Default_Ignorable_Code_Point property
// (zero-width characters, joiners, soft hyphen, variation selectors, tag characters, fillers, the Khmer inherent vowels),
// the format characters (Cf), the Braille blank, and the control characters except tab, line feed, and carriage return.
// It is built from a string because some of these characters combine with their neighbors inside a character class.

// eslint-disable-next-line no-control-regex
export const HIDDEN = new RegExp("[\\p{Default_Ignorable_Code_Point}\\p{Cf}\\u{2800}\\u{115f}\\u{1160}\\u{3164}\\u{ffa0}\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f-\\u009f]", "gu");

/** The text with every hidden character removed. */
export function stripHidden(text) {
  return text.replace(HIDDEN, "");
}

/** The text with every hidden character turned into a space, for counting words. */
export function spaceHidden(text) {
  return text.replace(HIDDEN, " ");
}
