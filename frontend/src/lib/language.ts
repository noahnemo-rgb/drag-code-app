// Central language metadata used by the editor and file-creation flows.
import type { Language } from "@/src/lib/api";

export const LANGS: { key: Language; label: string; ext: string }[] = [
  { key: "javascript", label: "JavaScript", ext: "js" },
  { key: "typescript", label: "TypeScript", ext: "ts" },
  { key: "python", label: "Python", ext: "py" },
  { key: "html", label: "HTML", ext: "html" },
  { key: "css", label: "CSS", ext: "css" },
];

export const EXT_TO_LANG: Record<string, Language> = {
  js: "javascript", jsx: "javascript",
  ts: "typescript", tsx: "typescript",
  py: "python",
  html: "html", htm: "html",
  css: "css",
};

export const inferLang = (name: string): Language => {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return EXT_TO_LANG[ext] ?? "javascript";
};

export const starterFor = (lang: Language): string => {
  switch (lang) {
    case "python": return "print('Hello from Syntax IDE')\n";
    case "javascript": return "console.log('Hello from Syntax IDE');\n";
    case "typescript": return "const greeting: string = 'Hello from Syntax IDE';\nconsole.log(greeting);\n";
    case "html": return "<!doctype html>\n<html>\n  <body>\n    <h1>Hello Syntax IDE</h1>\n  </body>\n</html>\n";
    case "css": return "body {\n  background: #111;\n  color: #FFB000;\n}\n";
  }
};
