// Stage 3 is the Great Bow — only the true hero strings it, and only by
// combining the two pieces a team already holds: the numeric cipher from
// the Sirens' song (Stage 1) and the word won from the Cyclops (Stage 2).
// This function is the single source of truth for that combination: the
// page displays the instructions in English, the team computes it by hand,
// and the server checks their answer by running the exact same function.
// If those two ever disagreed, the puzzle would be unsolvable — keeping
// the rule in one place is what prevents that.
//
// Rule: Caesar-shift each letter of the Stage 2 word forward through the
// alphabet by the digit sum of the Stage 1 code (wrapping Z back to A).
function digitSum(code) {
  return String(code)
    .split("")
    .filter((ch) => ch >= "0" && ch <= "9")
    .reduce((sum, d) => sum + Number(d), 0);
}

function caesarShift(word, shift) {
  const s = ((shift % 26) + 26) % 26;
  return word
    .toUpperCase()
    .split("")
    .map((ch) => {
      const code = ch.charCodeAt(0);
      if (code < 65 || code > 90) return ch; // leave non-letters (spaces etc.) untouched
      const shifted = ((code - 65 + s) % 26) + 65;
      return String.fromCharCode(shifted);
    })
    .join("");
}

function computeFinalAnswer(stage1Code, stage2Word) {
  const shift = digitSum(stage1Code);
  return caesarShift(stage2Word, shift);
}

function describeRule(stage1Code) {
  const shift = digitSum(stage1Code);
  return `To string the bow, shift each letter of the word the Cyclops let slip forward by ${shift} (the digits of the Sirens' cipher, added together). Z wraps back around to A.`;
}

module.exports = { computeFinalAnswer, describeRule, digitSum, caesarShift };
