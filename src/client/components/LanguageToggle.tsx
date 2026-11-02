import { Languages } from "lucide-react";
import { chooseLocale, locale, t } from "../i18n";

/** One quiet button that switches to the other language, named in that language so it stays readable from either side. */
export function LanguageToggle() {
  const target = locale === "zh-CN"
    ? { value: "en", short: "EN", label: "English" } as const
    : { value: "zh-CN", short: "中文", label: "简体中文" } as const;
  const name = t("Switch Language To {0}", target.label);
  return (
    <button className="icon-button language-toggle" type="button" aria-label={name} title={name} onClick={() => chooseLocale(target.value)}>
      <Languages aria-hidden="true" />
      <span lang={target.value}>{target.short}</span>
    </button>
  );
}
