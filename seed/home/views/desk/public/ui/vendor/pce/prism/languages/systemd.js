import{a as n}from"../../core-Dr0o9A-8.js";var e=/^[;#].*/gm,t=`"(?:\\\\[\\s\\S]|[^\\\\
"])*"(?!\\S)`;n.systemd={comment:e,section:{pattern:/^\[[^\n[\]]*\](?=[ 	]*$)/gm,inside:{punctuation:/^\[|\]$/,"section-name":{pattern:/[^]+/,alias:"selector"}}},key:{pattern:/^[^\s=]+(?=[ 	]*=)/gm,alias:"attr-name"},value:{pattern:RegExp(`(=[ 	]*(?!\\s))(?:[^\\\\\\s]|[ 	]+(?:(?![ 	"])|${t})|\\\\
+(?:[#;].*
+)*(?![#;]))+`,"g"),lookbehind:!0,alias:"attr-value",inside:{comment:e,quoted:{pattern:RegExp("(^|\\s)"+t,"g"),lookbehind:!0},punctuation:/\\$/m,boolean:/^(?:false|true|no|off|on|yes)$/g}},punctuation:/=/};
