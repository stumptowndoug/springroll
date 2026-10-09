// What the editor adds beyond highlighting: commands (indent, comments, move lines,
// auto-close), undo history, search and replace, bracket matching, selection matches.
import { defaultCommands, editHistory } from 'prism-code-editor/commands';
import { searchWidget, highlightSelectionMatches } from 'prism-code-editor/search';
import { matchBrackets } from 'prism-code-editor/match-brackets';
import { highlightBracketPairs } from 'prism-code-editor/highlight-brackets';
import { matchTags } from 'prism-code-editor/match-tags';
import { indentGuides } from 'prism-code-editor/guides';
import { cursorPosition } from 'prism-code-editor/cursor';
import 'virtual:behaviors'; // comment and indent rules for the languages we highlight (see build.mjs)

export const extensions = () => [
  defaultCommands(), editHistory(), searchWidget(), highlightSelectionMatches(),
  matchBrackets(false), highlightBracketPairs(), matchTags(), indentGuides(), cursorPosition(),
];
