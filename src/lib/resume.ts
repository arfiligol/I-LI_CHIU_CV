import resume from "../data/resume.json";

export type Lang = "en" | "zh";

export const basePath = import.meta.env.BASE_URL;
export const resumeData = resume;
export const languages = resume.languages;

export function localized(lang: Lang) {
  return resume.languages[lang];
}

export function withBase(path: string) {
  const normalizedBase = basePath.endsWith("/") ? basePath : `${basePath}/`;
  const normalizedPath = path.replace(/^\/+/, "");
  return `${normalizedBase}${normalizedPath}`;
}

export function alternateLang(lang: Lang): Lang {
  return lang === "en" ? "zh" : "en";
}
