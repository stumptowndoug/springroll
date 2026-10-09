import{a}from"../../core-Dr0o9A-8.js";var e=a.diff={coord:/^(?:\*{3}|-{3}|\+{3}|\d).*$|^@@.*@@$/m},i={"deleted-sign":"-","deleted-arrow":"<","inserted-sign":"\\+","inserted-arrow":">",unchanged:" ",diff:"!"};for(var d in i){var r=d.split("-")[0];e[d]={pattern:RegExp("(?:^"+i[d]+`.*
?)+`,"m"),alias:r!=d?r:d=="diff"?"bold":void 0,inside:{prefix:{pattern:RegExp("^"+i[d],"mg"),alias:r}}}}
